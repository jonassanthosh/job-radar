/**
 * Workday career sites. Uses the same public JSON endpoints the career page itself calls
 * (no login, no CAPTCHA). Only tenants you list in data/boards.json are scanned, with a few
 * keyword searches per run. Workday search is not a complete listing, so previously seen jobs
 * that are missing from results are checked individually before being marked closed.
 */
import { z } from 'zod';
import { HttpError, fetchJson } from '../util/http.js';
import { htmlToText } from '../util/text.js';
import type { Posting, SourceAdapter } from './types.js';

const Search = z.object({ total: z.number().nullish(), jobPostings: z.array(z.object({ title: z.string(), externalPath: z.string(), locationsText: z.string().nullish(), postedOn: z.string().nullish(), bulletFields: z.array(z.string()).nullish() }).passthrough()) }).passthrough();
const Detail = z
  .object({
    jobPostingInfo: z
      .object({
        id: z.string().nullish(),
        title: z.string(),
        jobDescription: z.string().nullish(),
        location: z.string().nullish(),
        additionalLocations: z.array(z.string()).nullish(),
        timeType: z.string().nullish(),
        remoteType: z.string().nullish(),
        startDate: z.string().nullish(),
        jobReqId: z.string().nullish(),
        externalUrl: z.string().nullish(),
        canApply: z.boolean().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

const base = (w: { host: string; tenant: string; site: string }) => `https://${w.host}/wday/cxs/${w.tenant}/${w.site}`;

export const workday: SourceAdapter = {
  ats: 'workday',
  async list(board, search, titleFilter) {
    if (!board.workday) throw new Error('Workday board is missing host/tenant/site');
    const w = board.workday;
    const seen = new Map<string, { title: string; externalPath: string }>();
    let examined = 0;
    for (const term of search.workdaySearchTerms) {
      const res = Search.parse(await fetchJson(`${base(w)}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset: 0, searchText: term } }));
      examined += res.jobPostings.length;
      for (const p of res.jobPostings) if (titleFilter(p.title)) seen.set(p.externalPath, p);
    }
    const postings: Posting[] = [];
    for (const p of seen.values()) {
      const d = Detail.parse(await fetchJson(`${base(w)}${p.externalPath}`)).jobPostingInfo;
      if (d.canApply === false) continue;
      const rt = (d.remoteType ?? '').toLowerCase();
      postings.push({
        ats: 'workday',
        board: board.slug,
        atsId: (d.jobReqId ?? d.id ?? p.externalPath).toLowerCase(),
        company: board.company,
        title: d.title.trim(),
        locationText: [d.location, ...(d.additionalLocations ?? [])].filter(Boolean).join(' | '),
        workplaceType: /remote/.test(rt) ? 'remote' : /hybrid/.test(rt) ? 'hybrid' : /office|on-?site/.test(rt) ? 'onsite' : null,
        isRemote: null,
        employmentType: d.timeType ?? null,
        postedAt: d.startDate ? new Date(d.startDate).toISOString() : null,
        officialUrl: d.externalUrl ?? `https://${w.host}/${w.site}${p.externalPath}`,
        applyUrl: d.externalUrl ?? `https://${w.host}/${w.site}${p.externalPath}`,
        reqId: d.jobReqId ?? null,
        description: htmlToText(d.jobDescription),
        ranges: [],
      });
    }
    return { company: board.company, complete: false, examined, postings };
  },
  async isOpen(board, _atsId, officialUrl) {
    if (!board.workday) return true;
    const path = new URL(officialUrl).pathname.replace(new RegExp(`^/(?:[a-z]{2}-[A-Z]{2}/)?${board.workday.site}`), '');
    try {
      const d = Detail.parse(await fetchJson(`${base(board.workday)}${path}`)).jobPostingInfo;
      return d.canApply !== false;
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 410)) return false;
      throw e;
    }
  },
  async probe() {
    return { exists: false }; // Workday tenants are added manually (host/tenant/site cannot be guessed reliably)
  },
};
