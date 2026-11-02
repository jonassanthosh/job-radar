/** Lever Postings API (public, documented): https://github.com/lever/postings-api */
import { z } from 'zod';
import { HttpError, fetchJson } from '../util/http.js';
import { htmlToText } from '../util/text.js';
import type { Posting, SourceAdapter } from './types.js';

const API = 'https://api.lever.co/v0/postings';

const LJob = z
  .object({
    id: z.string(),
    text: z.string(),
    categories: z.object({ commitment: z.string().nullish(), location: z.string().nullish(), allLocations: z.array(z.string()).nullish(), team: z.string().nullish() }).partial().nullish(),
    workplaceType: z.string().nullish(),
    country: z.string().nullish(),
    descriptionPlain: z.string().nullish(),
    description: z.string().nullish(),
    lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
    additionalPlain: z.string().nullish(),
    hostedUrl: z.string(),
    applyUrl: z.string().nullish(),
    createdAt: z.number().nullish(),
    salaryRange: z.object({ min: z.number().nullish(), max: z.number().nullish(), currency: z.string().nullish(), interval: z.string().nullish() }).nullish(),
    salaryDescriptionPlain: z.string().nullish(),
  })
  .passthrough();

function toPosting(slug: string, company: string, j: z.infer<typeof LJob>): Posting {
  const locs = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean) as string[];
  const wt = (j.workplaceType ?? '').toLowerCase();
  const lists = (j.lists ?? []).map((l) => `${l.text ?? ''}\n${htmlToText(l.content)}`).join('\n\n');
  const description = [j.descriptionPlain ?? htmlToText(j.description), lists, j.additionalPlain, j.salaryDescriptionPlain].filter(Boolean).join('\n\n');
  const sr = j.salaryRange;
  const interval = /hour/.test(sr?.interval ?? '') ? 'hour' : /month/.test(sr?.interval ?? '') ? 'month' : 'year';
  return {
    ats: 'lever',
    board: slug,
    atsId: j.id.toLowerCase(),
    company,
    title: j.text.trim(),
    locationText: [...new Set(locs)].join(' | ') + (j.country ? ` (${j.country})` : ''),
    workplaceType: wt === 'remote' ? 'remote' : wt === 'hybrid' ? 'hybrid' : wt === 'onsite' || wt === 'on-site' ? 'onsite' : null,
    isRemote: null,
    employmentType: j.categories?.commitment ?? null,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    officialUrl: j.hostedUrl,
    applyUrl: j.applyUrl ?? j.hostedUrl,
    reqId: null,
    description,
    ranges:
      sr && sr.currency && (sr.min != null || sr.max != null)
        ? [{ min: sr.min ?? null, max: sr.max ?? null, currency: sr.currency.toUpperCase(), interval, context: `${j.salaryDescriptionPlain ?? ''} ${locs.join(' ')} ${j.country ?? ''}`, origin: 'structured', evidence: `Lever salary range: ${sr.min}–${sr.max} ${sr.currency} ${sr.interval ?? ''}`.trim() }]
        : [],
  };
}

export const lever: SourceAdapter = {
  ats: 'lever',
  async list(board, _s, titleFilter) {
    const data = z.array(LJob).parse(await fetchJson(`${API}/${board.slug}?mode=json`));
    return { company: board.company, complete: true, examined: data.length, postings: data.filter((j) => titleFilter(j.text)).map((j) => toPosting(board.slug, board.company, j)) };
  },
  async probe(slug) {
    try {
      const data = z.array(z.unknown()).parse(await fetchJson(`${API}/${slug}?mode=json&limit=1`, { retries: 0 }));
      return { exists: Array.isArray(data) };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { exists: false };
      throw e;
    }
  },
};
