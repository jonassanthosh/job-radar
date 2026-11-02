/** Greenhouse Job Board API (public, documented): https://developers.greenhouse.io/job-board.html */
import { z } from 'zod';
import { HttpError, fetchJson } from '../util/http.js';
import { htmlToText } from '../util/text.js';
import type { Posting, SourceAdapter } from './types.js';

const API = 'https://boards-api.greenhouse.io/v1/boards';

const GJob = z
  .object({
    id: z.number(),
    title: z.string(),
    updated_at: z.string().nullish(),
    first_published: z.string().nullish(),
    location: z.object({ name: z.string().nullish() }).nullish(),
    absolute_url: z.string(),
    content: z.string().nullish(),
    requisition_id: z.string().nullish(),
    offices: z.array(z.object({ name: z.string().nullish(), location: z.string().nullish() })).nullish(),
    metadata: z.array(z.object({ name: z.string().nullish(), value: z.unknown() })).nullish(),
    pay_input_ranges: z
      .array(z.object({ min_cents: z.number().nullish(), max_cents: z.number().nullish(), currency_type: z.string().nullish(), title: z.string().nullish(), blurb: z.string().nullish() }))
      .nullish(),
  })
  .passthrough();
const GList = z.object({ jobs: z.array(GJob) });
const GBoard = z.object({ name: z.string() }).passthrough();

function toPosting(slug: string, company: string, j: z.infer<typeof GJob>): Posting {
  const offices = (j.offices ?? []).map((o) => o.location || o.name).filter(Boolean) as string[];
  const loc = [j.location?.name, ...offices].filter(Boolean).join(' | ');
  const meta = (j.metadata ?? []).map((m) => `${m.name}: ${typeof m.value === 'string' ? m.value : Array.isArray(m.value) ? m.value.join(', ') : ''}`).join('\n');
  const wt = (j.metadata ?? []).find((m) => /workplace|remote|location type/i.test(m.name ?? ''))?.value;
  const wtStr = typeof wt === 'string' ? wt.toLowerCase() : '';
  const employment = (j.metadata ?? []).find((m) => /employment type|job type/i.test(m.name ?? ''))?.value;
  return {
    ats: 'greenhouse',
    board: slug,
    atsId: String(j.id),
    company,
    title: j.title.trim(),
    locationText: loc,
    workplaceType: /remote/.test(wtStr) ? 'remote' : /hybrid/.test(wtStr) ? 'hybrid' : /office|on-?site/.test(wtStr) ? 'onsite' : null,
    isRemote: null,
    employmentType: typeof employment === 'string' ? employment : null,
    postedAt: j.first_published ? new Date(j.first_published).toISOString() : null,
    officialUrl: j.absolute_url,
    applyUrl: j.absolute_url,
    reqId: j.requisition_id ?? null,
    description: [htmlToText(j.content), meta].filter(Boolean).join('\n\n'),
    ranges: [],
  };
}

export const greenhouse: SourceAdapter = {
  ats: 'greenhouse',
  async list(board, _search, titleFilter) {
    const info = GBoard.safeParse(await fetchJson(`${API}/${board.slug}`).catch(() => ({})));
    const company = info.success ? info.data.name : board.company;
    const data = GList.parse(await fetchJson(`${API}/${board.slug}/jobs?content=true`));
    return { company, complete: true, examined: data.jobs.length, postings: data.jobs.filter((j) => titleFilter(j.title)).map((j) => toPosting(board.slug, company, j)) };
  },
  async enrich(p) {
    try {
      const j = GJob.parse(await fetchJson(`${API}/${p.board}/jobs/${p.atsId}?pay_transparency=true`));
      const ranges = (j.pay_input_ranges ?? [])
        .filter((r) => r.currency_type && (r.min_cents != null || r.max_cents != null))
        .map((r) => ({
          min: r.min_cents != null ? r.min_cents / 100 : null,
          max: r.max_cents != null ? r.max_cents / 100 : null,
          currency: r.currency_type!.toUpperCase(),
          interval: /hour/i.test(`${r.title} ${r.blurb}`) ? ('hour' as const) : ('year' as const),
          context: `${r.title ?? ''} ${htmlToText(r.blurb)}`.trim(),
          origin: 'structured' as const,
          evidence: `${r.title ?? 'Pay range'}: ${(r.min_cents ?? 0) / 100}–${(r.max_cents ?? 0) / 100} ${r.currency_type}`,
        }));
      return { ...p, ranges };
    } catch {
      return p; // pay detail is optional; the listing already gave us the description
    }
  },
  async probe(slug) {
    try {
      const b = GBoard.parse(await fetchJson(`${API}/${slug}`, { retries: 0 }));
      return { exists: true, company: b.name };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { exists: false };
      throw e;
    }
  },
};
