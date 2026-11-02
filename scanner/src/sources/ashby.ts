/** Ashby public job posting API (documented): https://developers.ashbyhq.com/docs/public-job-posting-api */
import { z } from 'zod';
import type { RawRange } from '../rules/salary.js';
import { HttpError, fetchJson } from '../util/http.js';
import { htmlToText } from '../util/text.js';
import type { Posting, SourceAdapter } from './types.js';

const API = 'https://api.ashbyhq.com/posting-api/job-board';

const Comp = z.object({ compensationType: z.string().nullish(), interval: z.string().nullish(), currencyCode: z.string().nullish(), minValue: z.number().nullish(), maxValue: z.number().nullish() }).passthrough();
const AJob = z
  .object({
    id: z.string(),
    title: z.string(),
    employmentType: z.string().nullish(),
    location: z.string().nullish(),
    secondaryLocations: z.array(z.object({ location: z.string().nullish() }).passthrough()).nullish(),
    isRemote: z.boolean().nullish(),
    workplaceType: z.string().nullish(),
    isListed: z.boolean().nullish(),
    publishedAt: z.string().nullish(),
    jobUrl: z.string(),
    applyUrl: z.string().nullish(),
    descriptionPlain: z.string().nullish(),
    descriptionHtml: z.string().nullish(),
    compensation: z
      .object({
        compensationTierSummary: z.string().nullish(),
        compensationTiers: z.array(z.object({ title: z.string().nullish(), tierSummary: z.string().nullish(), components: z.array(Comp).nullish() }).passthrough()).nullish(),
        summaryComponents: z.array(Comp).nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
const ABoard = z.object({ jobs: z.array(AJob) }).passthrough();

const interval = (s?: string | null): RawRange['interval'] => (/hour/i.test(s ?? '') ? 'hour' : /month/i.test(s ?? '') ? 'month' : 'year');

function ranges(j: z.infer<typeof AJob>): RawRange[] {
  const c = j.compensation;
  if (!c) return [];
  const mk = (comp: z.infer<typeof Comp>, context: string): RawRange | null =>
    /salary/i.test(comp.compensationType ?? '') && comp.currencyCode && (comp.minValue != null || comp.maxValue != null)
      ? { min: comp.minValue ?? null, max: comp.maxValue ?? null, currency: comp.currencyCode.toUpperCase(), interval: interval(comp.interval), context, origin: 'structured', evidence: context }
      : null;
  const tiers = (c.compensationTiers ?? []).flatMap((t) => (t.components ?? []).map((comp) => mk(comp, `${t.title ?? ''} ${t.tierSummary ?? ''}`.trim())));
  const summary = (c.summaryComponents ?? []).map((comp) => mk(comp, c.compensationTierSummary ?? ''));
  return [...tiers, ...(tiers.some(Boolean) ? [] : summary)].filter((r): r is RawRange => r != null);
}

function toPosting(slug: string, company: string, j: z.infer<typeof AJob>): Posting {
  const locs = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean) as string[];
  const wt = (j.workplaceType ?? '').toLowerCase();
  return {
    ats: 'ashby',
    board: slug,
    atsId: j.id.toLowerCase(),
    company,
    title: j.title.trim(),
    locationText: [...new Set(locs)].join(' | '),
    workplaceType: wt === 'remote' ? 'remote' : wt === 'hybrid' ? 'hybrid' : wt === 'onsite' ? 'onsite' : null,
    isRemote: j.isRemote ?? null,
    employmentType: j.employmentType?.replace(/([a-z])([A-Z])/g, '$1-$2') ?? null,
    postedAt: j.publishedAt ? new Date(j.publishedAt).toISOString() : null,
    officialUrl: j.jobUrl,
    applyUrl: j.applyUrl ?? j.jobUrl,
    reqId: null,
    description: [j.descriptionPlain ?? htmlToText(j.descriptionHtml), j.compensation?.compensationTierSummary ? `Compensation: ${j.compensation.compensationTierSummary}` : ''].filter(Boolean).join('\n\n'),
    ranges: ranges(j),
  };
}

export const ashby: SourceAdapter = {
  ats: 'ashby',
  async list(board, _s, titleFilter) {
    const data = ABoard.parse(await fetchJson(`${API}/${encodeURIComponent(board.slug)}?includeCompensation=true`));
    return {
      company: board.company,
      complete: true,
      examined: data.jobs.length,
      postings: data.jobs.filter((j) => j.isListed !== false && titleFilter(j.title)).map((j) => toPosting(board.slug, board.company, j)),
    };
  },
  async probe(slug) {
    try {
      ABoard.parse(await fetchJson(`${API}/${encodeURIComponent(slug)}`, { retries: 0 }));
      return { exists: true };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { exists: false };
      throw e;
    }
  },
};
