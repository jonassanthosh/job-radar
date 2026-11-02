import type { Job } from '../src/schema.js';

export function makeJob(o: { id?: string; reqId?: string | null; fingerprint?: string }): Job {
  const at = '2026-11-01T01:30:00.000Z';
  return {
    id: o.id ?? 'gh-acme-123',
    keys: { ats: 'greenhouse', board: 'acme', atsId: '123', canonicalUrl: 'https://job-boards.greenhouse.io/acme/jobs/123', reqId: o.reqId ?? null },
    company: 'Acme',
    companyInfo: { hq: null, international: null, source: null },
    title: 'Senior Developer Support Engineer',
    normalizedTitle: 'senior developer support engineer',
    jobFamily: 'developer_support',
    employmentType: 'Full-time',
    location: { raw: 'Remote - India', remoteType: 'remote', region: 'India', india: 'eligible', evidence: 'Remote - India', evidenceSource: 'https://job-boards.greenhouse.io/acme/jobs/123', reason: 'ok' },
    postedAt: '2026-10-30T00:00:00.000Z',
    firstSeenAt: at,
    lastCheckedAt: at,
    lastVerifiedAt: at,
    lastModifiedAt: at,
    status: 'active',
    consecutiveFailures: 0,
    descriptionFingerprint: o.fingerprint ?? 'fp',
    techStack: [],
    yearsRequired: null,
    compensation: {
      status: 'unverified', currency: null, interval: null, min: null, max: null, annualMin: null, annualMax: null, inrMin: null, inrMax: null,
      fxRate: null, fxDate: null, components: { base: null, bonus: null, equity: null }, applicability: 'unspecified', confidence: 'none', evidence: null, sourceUrl: null,
      display: 'Not disclosed — verify with recruiter',
    },
    fit: {
      score: 82, category: 'strong', breakdown: { technical: 25, devSupport: 20, experience: 15, industry: 12, customerFacing: 10 },
      matchedSkills: [], strongestMatch: [], missing: [], concerns: [], whyFit: '', worthApplying: '',
    },
    feed: 'review',
    feedReasons: [],
    officialUrl: 'https://job-boards.greenhouse.io/acme/jobs/123',
    applyUrl: 'https://job-boards.greenhouse.io/acme/jobs/123',
    discoverySources: ['greenhouse:acme'],
    contacts: [],
    contactSearchLinks: [],
    notes: [],
    suppressed: false,
    repostOf: null,
    history: [{ at, type: 'created', from: null, to: 'active', reason: 'test' }],
  };
}
