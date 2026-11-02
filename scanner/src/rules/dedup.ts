/**
 * Identity and de-duplication.
 *
 * Priority: (1) ATS + board + ATS job id, (2) canonical URL, (3) company + title + location + requisition id.
 * A re-post (new ATS id, same company/title/location/description) of a job that is no longer live is
 * folded into the original record instead of appearing as new. If the original is still live in the
 * same run, or the requisition ids differ, it is a genuinely separate position.
 */
import type { Ats, Job } from '../schema.js';
import { sha256, slugify } from '../util/text.js';
import { normalizeTitle } from './role.js';

const TRACKING = /^(utm_.*|gh_src|lever-source|lever-origin|source|ref|referrer|src|trk|trackingid|campaign|_hs.*|mc_.*|fbclid|gclid|ashby_jid)$/i;

export interface AtsRef {
  ats: Ats;
  board: string;
  id: string;
}

/** Recognise official ATS posting URLs (including the alternate hosts each ATS uses). */
export function parseAtsUrl(raw: string): AtsRef | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    // boards.greenhouse.io/{board}/jobs/{id}, job-boards.greenhouse.io/{board}/jobs/{id}, job-boards.eu.greenhouse.io/...
    const i = parts.indexOf('jobs');
    if (parts[0] === 'embed') {
      const board = u.searchParams.get('for');
      const id = u.searchParams.get('token');
      return board && id ? { ats: 'greenhouse', board: board.toLowerCase(), id } : null;
    }
    if (i > 0 && parts[i + 1] && /^\d+$/.test(parts[i + 1])) return { ats: 'greenhouse', board: parts[0].toLowerCase(), id: parts[i + 1] };
    if (parts[0] && !['embed', 'v1'].includes(parts[0]) && parts.length === 1) return { ats: 'greenhouse', board: parts[0].toLowerCase(), id: '' };
    return null;
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (!parts[0]) return null;
    return { ats: 'lever', board: parts[0].toLowerCase(), id: parts[1] && /^[0-9a-f-]{36}$/i.test(parts[1]) ? parts[1].toLowerCase() : '' };
  }
  if (host === 'jobs.ashbyhq.com') {
    if (!parts[0]) return null;
    return { ats: 'ashby', board: decodeURIComponent(parts[0]).toLowerCase(), id: parts[1] && /^[0-9a-f-]{36}$/i.test(parts[1]) ? parts[1].toLowerCase() : '' };
  }
  // Company careers pages that embed Greenhouse: https://acme.com/careers?gh_jid=123
  const ghJid = u.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) return { ats: 'greenhouse', board: '', id: ghJid };
  return null;
}

/** Canonical form of an official posting URL: https, lowercase host, no tracking params, no trailing /apply. */
export function canonicalUrl(raw: string): string {
  const ref = parseAtsUrl(raw);
  if (ref && ref.board && ref.id) {
    if (ref.ats === 'greenhouse') return `https://job-boards.greenhouse.io/${ref.board}/jobs/${ref.id}`;
    if (ref.ats === 'lever') return `https://jobs.lever.co/${ref.board}/${ref.id}`;
    if (ref.ats === 'ashby') return `https://jobs.ashbyhq.com/${ref.board}/${ref.id}`;
  }
  const u = new URL(raw);
  u.protocol = 'https:';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  u.pathname = u.pathname.replace(/\/(apply|application)\/?$/i, '').replace(/\/+$/, '') || '/';
  return u.toString();
}

/** Canonical URL for a posting whose ATS identity is already known (preferred over parsing the public URL). */
export function postingCanonicalUrl(ats: Ats, board: string, atsId: string, officialUrl: string): string {
  if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${board}/jobs/${atsId}`;
  if (ats === 'lever') return `https://jobs.lever.co/${board}/${atsId}`;
  if (ats === 'ashby') return `https://jobs.ashbyhq.com/${board}/${atsId}`;
  return canonicalUrl(officialUrl);
}

export function jobId(ats: Ats, board: string, atsId: string): string {
  const prefix = { greenhouse: 'gh', lever: 'lv', ashby: 'ab', workday: 'wd' }[ats];
  const short = atsId.length > 16 ? sha256(atsId).slice(0, 12) : atsId.toLowerCase();
  return slugify(`${prefix}-${board}-${short}`);
}

export function reqKey(company: string, title: string, location: string, reqId: string | null): string | null {
  if (!reqId) return null;
  return [slugify(company), normalizeTitle(title), slugify(location), reqId.toLowerCase()].join('|');
}

export function repostKey(company: string, title: string, location: string, descFingerprint: string): string {
  return [slugify(company), normalizeTitle(title), slugify(location), descFingerprint].join('|');
}

/** Hash used for the imported applied/dismissed list. */
export function suppressHash(key: string): string {
  return sha256(`job-radar:v1:${key}`);
}

export function suppressKeysFor(job: Pick<Job, 'keys' | 'company' | 'title' | 'location'>): string[] {
  const keys = [`url:${job.keys.canonicalUrl}`, `ats:${job.keys.ats}:${job.keys.board}:${job.keys.atsId}`];
  keys.push(`ct:${slugify(job.company)}|${normalizeTitle(job.title)}`);
  return keys.map(suppressHash);
}

export interface Index {
  byId: Map<string, Job>;
  byUrl: Map<string, Job>;
  byReq: Map<string, Job>;
  byRepost: Map<string, Job[]>;
}

export function buildIndex(jobs: Job[]): Index {
  const idx: Index = { byId: new Map(), byUrl: new Map(), byReq: new Map(), byRepost: new Map() };
  for (const j of jobs) {
    idx.byId.set(j.id, j);
    idx.byUrl.set(j.keys.canonicalUrl, j);
    const rk = reqKey(j.company, j.title, j.location.raw, j.keys.reqId);
    if (rk) idx.byReq.set(rk, j);
    const pk = repostKey(j.company, j.title, j.location.raw, j.descriptionFingerprint);
    idx.byRepost.set(pk, [...(idx.byRepost.get(pk) ?? []), j]);
  }
  return idx;
}

export type MatchVia = 'ats_id' | 'url' | 'requisition' | 'repost';

export function findExisting(
  idx: Index,
  c: { id: string; canonicalUrl: string; company: string; title: string; location: string; reqId: string | null; fingerprint: string },
  liveIdsThisRun: Set<string>,
): { job: Job; via: MatchVia } | null {
  const a = idx.byId.get(c.id);
  if (a) return { job: a, via: 'ats_id' };
  const b = idx.byUrl.get(c.canonicalUrl);
  if (b) return { job: b, via: 'url' };
  const rk = reqKey(c.company, c.title, c.location, c.reqId);
  if (rk) {
    const r = idx.byReq.get(rk);
    if (r) return { job: r, via: 'requisition' };
  }
  const pk = repostKey(c.company, c.title, c.location, c.fingerprint);
  for (const p of idx.byRepost.get(pk) ?? []) {
    const differentReq = p.keys.reqId && c.reqId && p.keys.reqId !== c.reqId;
    if (!differentReq && !liveIdsThisRun.has(p.id)) return { job: p, via: 'repost' };
  }
  return null;
}
