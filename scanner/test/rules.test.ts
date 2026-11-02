import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { applyObservation } from '../src/rules/status.js';
import { buildIndex, canonicalUrl, findExisting, jobId, parseAtsUrl } from '../src/rules/dedup.js';
import { makeRoleRules } from '../src/rules/role.js';
import { decideFeed } from '../src/rules/feed.js';
import { extractPostingContacts, mergeContacts } from '../src/rules/contacts.js';
import { parseYearsRequired } from '../src/rules/score.js';
import { makeJob } from './helpers.js';

const cfg = loadConfig();
const role = makeRoleRules(cfg.search);
const T = '2026-11-02T01:30:00.000Z';

const DEV_SUPPORT_DESC = `You will help developers integrate our REST APIs and SDKs, debug webhooks and OAuth issues,
investigate production issues using logs and SQL, reproduce bugs and work with our engineering team, handle L2/L3 escalations
from customers, write scripts and tools, and improve our documentation. Our cloud database platform is used by 100k developers.`;

describe('URL canonicalisation', () => {
  it('collapses Greenhouse host variants and tracking params', () => {
    const a = canonicalUrl('https://boards.greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=x');
    const b = canonicalUrl('https://job-boards.greenhouse.io/acme/jobs/123');
    expect(a).toBe(b);
  });
  it('strips Lever/Ashby /apply suffixes', () => {
    const id = '0a1b2c3d-1111-2222-3333-444455556666';
    expect(canonicalUrl(`https://jobs.lever.co/acme/${id}/apply?lever-source=LinkedIn`)).toBe(`https://jobs.lever.co/acme/${id}`);
    expect(canonicalUrl(`https://jobs.ashbyhq.com/Acme/${id}/application`)).toBe(`https://jobs.ashbyhq.com/acme/${id}`);
  });
  it('removes tracking params from company career URLs but keeps meaningful ones', () => {
    expect(canonicalUrl('https://www.Acme.com/careers/job?id=9&utm_campaign=x#apply')).toBe('https://acme.com/careers/job?id=9');
  });
  it('detects gh_jid embeds', () => {
    expect(parseAtsUrl('https://acme.com/careers?gh_jid=555')).toEqual({ ats: 'greenhouse', board: '', id: '555' });
  });
});

describe('deduplication', () => {
  const existing = makeJob({ id: jobId('greenhouse', 'acme', '123'), reqId: 'R-1', fingerprint: 'fp1' });
  const idx = buildIndex([existing]);
  const base = { id: 'gh-acme-999', canonicalUrl: 'https://job-boards.greenhouse.io/acme/jobs/999', company: 'Acme', title: existing.title, location: existing.location.raw, reqId: null as string | null, fingerprint: 'other' };

  it('matches on ATS id first', () => {
    expect(findExisting(idx, { ...base, id: existing.id }, new Set())?.via).toBe('ats_id');
  });
  it('matches on canonical URL', () => {
    expect(findExisting(idx, { ...base, canonicalUrl: existing.keys.canonicalUrl }, new Set())?.via).toBe('url');
  });
  it('matches on company + title + location + requisition id', () => {
    expect(findExisting(idx, { ...base, reqId: 'R-1' }, new Set())?.via).toBe('requisition');
  });
  it('folds a re-post with an identical description into the old record when the old one is no longer live', () => {
    expect(findExisting(idx, { ...base, fingerprint: 'fp1' }, new Set())?.via).toBe('repost');
  });
  it('keeps a same-title job as separate when the original is still live (second headcount)', () => {
    expect(findExisting(idx, { ...base, fingerprint: 'fp1' }, new Set([existing.id]))).toBeNull();
  });
  it('keeps a different requisition id as a separate position', () => {
    expect(findExisting(idx, { ...base, fingerprint: 'fp1', reqId: 'R-2' }, new Set())).toBeNull();
  });
});

describe('status transitions', () => {
  const j = makeJob({});
  it('absent after a successful fetch -> closed with audit entry', () => {
    const n = applyObservation(j, { kind: 'absent' }, T);
    expect(n.status).toBe('closed');
    expect(n.history.at(-1)).toMatchObject({ type: 'status', from: 'active', to: 'closed' });
  });
  it('source failure never closes a job', () => {
    const n = applyObservation(j, { kind: 'fetch_failed', error: 'HTTP 503' }, T);
    expect(n.status).toBe('verification_failed');
    expect(n.consecutiveFailures).toBe(1);
    const n2 = applyObservation(n, { kind: 'fetch_failed', error: 'timeout' }, T);
    expect(n2.consecutiveFailures).toBe(2);
    expect(n2.history.filter((h) => h.type === 'status')).toHaveLength(1);
  });
  it('closed job that reappears -> active, logged as reopened', () => {
    const c = applyObservation(j, { kind: 'absent' }, T);
    const r = applyObservation(c, { kind: 'seen' }, T);
    expect(r.status).toBe('active');
    expect(r.history.at(-1)?.reason).toMatch(/reopened/);
  });
  it('closed job is not flipped to verification_failed by a later outage', () => {
    const c = applyObservation(j, { kind: 'absent' }, T);
    expect(applyObservation(c, { kind: 'fetch_failed', error: 'x' }, T).status).toBe('closed');
  });
});

describe('role relevance', () => {
  it('accepts primary titles with technical responsibilities', () => {
    expect(role.classifyRole('Senior Developer Support Engineer', DEV_SUPPORT_DESC).include).toBe(true);
    expect(role.classifyRole('Technical Support Engineer II', DEV_SUPPORT_DESC).include).toBe(true);
  });
  it('rejects managers, sales and helpdesk titles', () => {
    expect(role.classifyTitle('Support Engineering Manager').include).toBe(false);
    expect(role.classifyTitle('IT Support Engineer').include).toBe(false);
    expect(role.classifyTitle('Sales Engineer').include).toBe(false);
    expect(role.classifyTitle('Forward Deployed Engineer').include).toBe(false);
    expect(role.classifyTitle('Software Engineer').include).toBe(false);
  });
  it('rejects support titles whose description is generic customer service', () => {
    const generic = 'Answer inbound calls, handle password resets, refunds and order status questions for our customers.';
    expect(role.classifyRole('Customer Support Engineer', generic).include).toBe(false);
  });
  it('judges Customer Engineer by responsibilities and rejects quota-driven presales', () => {
    const presales = `${DEV_SUPPORT_DESC} You will partner with account executives to run proofs of concept for prospects, carry a quota and drive technical wins in the sales cycle.`;
    expect(role.classifyRole('Customer Engineer', presales).include).toBe(false);
    expect(role.classifyRole('Customer Engineer', DEV_SUPPORT_DESC).include).toBe(true);
  });
});

describe('feed gates', () => {
  const t = cfg.profile.thresholds;
  const base = makeJob({});
  it('location ineligible is excluded regardless of score', () => {
    const j = { ...base, location: { ...base.location, india: 'ineligible' as const, reason: 'Limited to US' }, fit: { ...base.fit, score: 99 } };
    expect(decideFeed(j, t).feed).toBe('excluded');
  });
  it('eligible + verified pay -> recommended', () => {
    const j = { ...base, compensation: { ...base.compensation, status: 'verified' as const } };
    expect(decideFeed(j, t).feed).toBe('recommended');
  });
  it('eligible + unverified pay + strong fit -> review; weaker fit -> excluded', () => {
    expect(decideFeed({ ...base, fit: { ...base.fit, score: 85 } }, t).feed).toBe('review');
    expect(decideFeed({ ...base, fit: { ...base.fit, score: 74 } }, t).feed).toBe('excluded');
  });
  it('ambiguous location -> location_check', () => {
    const j = { ...base, location: { ...base.location, india: 'verification_required' as const } };
    expect(decideFeed(j, t).feed).toBe('location_check');
  });
  it('below-target pay never reaches the feed', () => {
    const j = { ...base, compensation: { ...base.compensation, status: 'below_target' as const } };
    expect(decideFeed(j, t).feed).toBe('excluded');
  });
  it('suppressed (already applied) never reaches the feed', () => {
    expect(decideFeed({ ...base, suppressed: true }, t).feed).toBe('excluded');
  });
});

describe('contacts', () => {
  it('extracts only explicitly labelled people from the posting', () => {
    const d = 'Your recruiter for this role is Priya Raman. You will report to Alex Chen, Head of Developer Support. The Team is great.';
    const c = extractPostingContacts(d, 'Acme', 'https://x.test', '2026-11-02');
    expect(c.map((x) => [x.name, x.type])).toEqual([
      ['Priya Raman', 'confirmed_recruiter'],
      ['Alex Chen', 'potential_team_contact'],
    ]);
  });
  it('never upgrades a company-level curated contact to "confirmed" for a specific job', () => {
    const curated = [{ name: 'Sam Lee', role: 'Recruiter', company: 'Acme', linkedinUrl: null, sourceUrl: 'https://x.test', type: 'confirmed_recruiter' as const, confidence: 'high' as const, reason: 'r', verifiedAt: '2026-10-01', stale: false, jobIds: [] }];
    const [m] = mergeContacts({ id: 'gh-acme-1', company: 'Acme' }, [], curated, '2026-11-02', 120);
    expect(m.type).toBe('potential_recruiting_contact');
  });
  it('flags stale curated contacts', () => {
    const curated = [{ name: 'Sam Lee', role: 'Recruiter', company: 'Acme', linkedinUrl: null, sourceUrl: 'https://x.test', type: 'potential_recruiting_contact' as const, confidence: 'medium' as const, reason: 'r', verifiedAt: '2026-01-01', stale: false, jobIds: [] }];
    expect(mergeContacts({ id: 'x', company: 'Acme' }, [], curated, '2026-11-02', 120)[0].stale).toBe(true);
  });
});

describe('years of experience', () => {
  it('reads the minimum years requested', () => {
    expect(parseYearsRequired('3+ years of experience in technical support')).toBe(3);
    expect(parseYearsRequired('4-6 years experience; ideally 8 years in industry')).toBe(4);
    expect(parseYearsRequired('Founded 12 years ago.')).toBeNull();
  });
});

describe('import suppression', () => {
  it('an imported URL variant suppresses the stored job', async () => {
    const { hashesFor } = await import('../src/import.js');
    const { suppressKeysFor } = await import('../src/rules/dedup.js');
    const job = makeJob({});
    const hashes = new Set(hashesFor({ url: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=linkedin' }));
    expect(suppressKeysFor(job).some((h) => hashes.has(h))).toBe(true);
    const other = new Set(hashesFor({ url: 'https://boards.greenhouse.io/acme/jobs/999' }));
    expect(suppressKeysFor(job).some((h) => other.has(h))).toBe(false);
  });
  it('company + title works when there is no URL', async () => {
    const { hashesFor } = await import('../src/import.js');
    const { suppressKeysFor } = await import('../src/rules/dedup.js');
    const hashes = new Set(hashesFor({ company: 'acme', title: 'Sr. Developer Support Engineer (Remote)' }));
    expect(suppressKeysFor(makeJob({})).some((h) => hashes.has(h))).toBe(true);
  });
});
