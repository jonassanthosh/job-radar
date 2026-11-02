/**
 * Employer discovery. Aggregators and search engines are used ONLY to find new employers/boards;
 * every job that reaches the dashboard is read from the employer's official ATS.
 *
 *   - Remotive public API          (https://remotive.com/api/remote-jobs)
 *   - Remote OK public API         (https://remoteok.com/api)
 *   - Himalayas public API         (https://himalayas.app/jobs/api)
 *   - Brave Search API (optional)  set BRAVE_SEARCH_API_KEY to enable site:ATS queries
 *
 * Output: ATS boards parsed from apply links, plus company names to probe for an ATS board.
 */
import { z } from 'zod';
import type { SearchConfig } from '../config.js';
import { parseAtsUrl } from '../rules/dedup.js';
import type { Ats } from '../schema.js';
import { fetchJson } from '../util/http.js';

export interface DiscoveredBoard {
  ats: Ats;
  slug: string;
  company: string | null;
  via: string;
}
export interface DiscoveryResult {
  boards: DiscoveredBoard[];
  companies: { name: string; via: string }[];
  failures: { source: string; error: string }[];
}

/** Locations that obviously cannot include India — no point probing these companies. */
const NOT_INDIA = /^(usa?|us only|united states|canada|uk|europe|emea|latam|north america|americas)( only)?$/i;

export async function discover(search: SearchConfig, titleFilter: (t: string) => boolean): Promise<DiscoveryResult> {
  const boards: DiscoveredBoard[] = [];
  const companies: { name: string; via: string }[] = [];
  const failures: { source: string; error: string }[] = [];
  const consider = (via: string, title: string, company: string | null | undefined, applyUrl: string | null | undefined, location?: string | null) => {
    if (!titleFilter(title)) return;
    if (location && NOT_INDIA.test(location.trim())) return;
    const ref = applyUrl ? parseAtsUrl(applyUrl) : null;
    if (ref && ref.board) boards.push({ ats: ref.ats, slug: ref.board, company: company ?? null, via });
    else if (company) companies.push({ name: company, via });
  };

  // Remotive — a few keyword searches; their docs ask for low request rates, once a day is fine.
  for (const q of search.aggregatorQueries.slice(0, 4)) {
    try {
      const r = z
        .object({ jobs: z.array(z.object({ title: z.string(), company_name: z.string().nullish(), candidate_required_location: z.string().nullish(), url: z.string().nullish() }).passthrough()) })
        .parse(await fetchJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=100`));
      for (const j of r.jobs) consider('remotive', j.title, j.company_name, null, j.candidate_required_location);
    } catch (e) {
      failures.push({ source: `remotive:${q}`, error: (e as Error).message });
      break;
    }
  }

  // Remote OK — single feed; first element is a legal notice.
  try {
    const arr = z.array(z.record(z.string(), z.unknown())).parse(await fetchJson('https://remoteok.com/api'));
    for (const j of arr.slice(1)) {
      const title = String(j.position ?? '');
      consider('remoteok', title, j.company as string, (j.apply_url as string) ?? null, (j.location as string) ?? null);
    }
  } catch (e) {
    failures.push({ source: 'remoteok', error: (e as Error).message });
  }

  // Himalayas — paginated feed.
  try {
    for (let offset = 0; offset < 400; offset += 100) {
      const r = z
        .object({ jobs: z.array(z.object({ title: z.string(), companyName: z.string().nullish(), applicationLink: z.string().nullish(), locationRestrictions: z.array(z.unknown()).nullish() }).passthrough()) })
        .parse(await fetchJson(`https://himalayas.app/jobs/api?limit=100&offset=${offset}`));
      if (!r.jobs.length) break;
      for (const j of r.jobs) {
        const restr = (j.locationRestrictions ?? []).map((x) => (typeof x === 'string' ? x : (x as { name?: string })?.name ?? '')).filter(Boolean);
        if (restr.length && !restr.some((x) => /india|asia|apac|worldwide|anywhere/i.test(x))) continue;
        consider('himalayas', j.title, j.companyName, j.applicationLink, null);
      }
    }
  } catch (e) {
    failures.push({ source: 'himalayas', error: (e as Error).message });
  }

  // Optional: Brave Search API for site:ATS queries (finds boards no aggregator lists).
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (key) {
    for (const q of search.searchApiQueries) {
      try {
        const r = z
          .object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string().nullish() }).passthrough()) }).nullish() })
          .parse(await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&freshness=pm`, { headers: { 'X-Subscription-Token': key, accept: 'application/json' } }));
        for (const res of r.web?.results ?? []) {
          const ref = parseAtsUrl(res.url);
          if (ref && ref.board) boards.push({ ats: ref.ats, slug: ref.board, company: null, via: 'brave-search' });
        }
      } catch (e) {
        failures.push({ source: `brave-search`, error: (e as Error).message });
        break;
      }
    }
  }

  const seen = new Set<string>();
  return {
    boards: boards.filter((b) => (seen.has(`${b.ats}:${b.slug}`) ? false : (seen.add(`${b.ats}:${b.slug}`), true))),
    companies: companies.filter((c) => (seen.has(`c:${c.name.toLowerCase()}`) ? false : (seen.add(`c:${c.name.toLowerCase()}`), true))),
    failures,
  };
}

/** Candidate ATS slugs for a company name: "Acme Labs, Inc." -> ["acmelabs", "acme-labs", "acme"] */
export function slugCandidates(name: string): string[] {
  const clean = name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|corp|corporation|co|technologies|technology|labs?|hq|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const full = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [...new Set([words.join(''), words.join('-'), full].filter((s) => s && s.length >= 3))].slice(0, 3);
}
