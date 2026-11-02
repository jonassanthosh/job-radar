/**
 * Canonical data model. Every file in /data is validated against these schemas
 * on read AND before write, so a bad source payload can never silently corrupt
 * the store. The dashboard imports the inferred types from here.
 */
import { z } from 'zod';

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const url = z.string().url();

export const Ats = z.enum(['greenhouse', 'lever', 'ashby', 'workday']);
export type Ats = z.infer<typeof Ats>;

export const IndiaEligibility = z.enum(['eligible', 'verification_required', 'ineligible']);
export const RemoteType = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export const CompStatus = z.enum(['verified', 'unverified', 'below_target']);
export const CompApplicability = z.enum(['india', 'global', 'us', 'other_region', 'unspecified']);
export const Confidence = z.enum(['high', 'medium', 'low', 'none']);
export const JobStatus = z.enum(['active', 'closed', 'verification_failed']);
export const Feed = z.enum(['recommended', 'review', 'location_check', 'excluded']);
export const JobFamily = z.enum([
  'developer_support',
  'technical_support',
  'customer_engineering',
  'solutions_integration',
  'developer_experience',
]);
export const ContactType = z.enum([
  'confirmed_hiring_manager',
  'confirmed_recruiter',
  'potential_team_contact',
  'potential_recruiting_contact',
]);

export const Location = z.object({
  raw: z.string(),
  remoteType: RemoteType,
  region: z.string(),
  india: IndiaEligibility,
  /** Exact phrase that proves (or disproves) eligibility, copied from the posting. */
  evidence: z.string().nullable(),
  evidenceSource: url.nullable(),
  reason: z.string(),
});
export type Location = z.infer<typeof Location>;

export const Compensation = z.object({
  status: CompStatus,
  currency: z.string().nullable(),
  interval: z.enum(['year', 'month', 'hour']).nullable(),
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  annualMin: z.number().nonnegative().nullable(),
  annualMax: z.number().nonnegative().nullable(),
  inrMin: z.number().nonnegative().nullable(),
  inrMax: z.number().nonnegative().nullable(),
  fxRate: z.number().positive().nullable(),
  fxDate: isoDate.nullable(),
  components: z.object({
    base: z.string().nullable(),
    bonus: z.string().nullable(),
    equity: z.string().nullable(),
  }),
  applicability: CompApplicability,
  confidence: Confidence,
  evidence: z.string().nullable(),
  sourceUrl: url.nullable(),
  display: z.string(),
});
export type Compensation = z.infer<typeof Compensation>;

export const Fit = z.object({
  score: z.number().int().min(0).max(100),
  category: z.enum(['exceptional', 'strong', 'possible', 'exclude']),
  breakdown: z.object({
    technical: z.number().min(0).max(30),
    devSupport: z.number().min(0).max(25),
    experience: z.number().min(0).max(20),
    industry: z.number().min(0).max(15),
    customerFacing: z.number().min(0).max(10),
  }),
  matchedSkills: z.array(z.string()),
  strongestMatch: z.array(z.string()),
  missing: z.array(z.string()),
  concerns: z.array(z.string()),
  whyFit: z.string(),
  worthApplying: z.string(),
});
export type Fit = z.infer<typeof Fit>;

export const Contact = z.object({
  name: z.string().min(2),
  role: z.string().min(2),
  company: z.string(),
  linkedinUrl: url.nullable(),
  sourceUrl: url,
  type: ContactType,
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
  verifiedAt: isoDate,
  /** Set when verifiedAt is older than the staleness window. */
  stale: z.boolean().default(false),
  /** posting = named in the official job ad; manual = added by you; claude = researched by the daily Claude agent */
  addedBy: z.enum(['posting', 'manual', 'claude']).default('manual'),
});
export type Contact = z.infer<typeof Contact>;

export const HistoryEntry = z.object({
  at: isoDateTime,
  type: z.enum(['created', 'status', 'description', 'compensation', 'location', 'feed', 'reposted']),
  from: z.string().nullable(),
  to: z.string().nullable(),
  reason: z.string(),
});

export const Job = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  keys: z.object({
    ats: Ats,
    board: z.string(),
    atsId: z.string(),
    canonicalUrl: url,
    reqId: z.string().nullable(),
  }),
  company: z.string().min(1),
  companyInfo: z.object({
    hq: z.string().nullable(),
    international: z.boolean().nullable(),
    source: url.nullable(),
  }),
  title: z.string().min(1),
  normalizedTitle: z.string(),
  jobFamily: JobFamily,
  employmentType: z.string().nullable(),
  location: Location,
  postedAt: isoDateTime.nullable(),
  firstSeenAt: isoDateTime,
  lastCheckedAt: isoDateTime,
  lastVerifiedAt: isoDateTime.nullable(),
  lastModifiedAt: isoDateTime,
  status: JobStatus,
  consecutiveFailures: z.number().int().nonnegative(),
  descriptionFingerprint: z.string(),
  techStack: z.array(z.string()),
  yearsRequired: z.number().nullable(),
  compensation: Compensation,
  fit: Fit,
  feed: Feed,
  feedReasons: z.array(z.string()),
  officialUrl: url,
  applyUrl: url,
  discoverySources: z.array(z.string()).min(1),
  contacts: z.array(Contact),
  contactSearchLinks: z.array(z.object({ label: z.string(), url })),
  notes: z.array(z.string()),
  /** True when the job matches an entry imported via `npm run import` (applied / dismissed elsewhere). */
  suppressed: z.boolean(),
  repostOf: z.string().nullable(),
  history: z.array(HistoryEntry).min(1),
});
export type Job = z.infer<typeof Job>;

export const JobsFile = z.object({
  schemaVersion: z.literal(1),
  updatedAt: isoDateTime.nullable(),
  jobs: z.array(Job),
});
export type JobsFile = z.infer<typeof JobsFile>;

export const Board = z.object({
  ats: Ats,
  slug: z.string().min(1),
  company: z.string().min(1),
  workday: z.object({ host: z.string(), tenant: z.string(), site: z.string() }).nullable().default(null),
  origin: z.enum(['seed', 'discovered', 'manual']),
  discoveredVia: z.string(),
  discoveredAt: isoDateTime,
  lastScannedAt: isoDateTime.nullable(),
  lastOkAt: isoDateTime.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  disabled: z.boolean(),
  disabledReason: z.string().nullable(),
  relevantSeen: z.number().int().nonnegative(),
  companyInfo: z
    .object({ hq: z.string().nullable(), international: z.boolean().nullable(), source: url.nullable() })
    .nullable()
    .default(null),
});
export type Board = z.infer<typeof Board>;

export const BoardsFile = z.object({
  schemaVersion: z.literal(1),
  boards: z.array(Board),
  /** Company names already probed for an ATS board (name -> last probe time), so failed probes are not repeated daily. */
  probed: z.record(z.string(), isoDateTime).default({}),
});
export type BoardsFile = z.infer<typeof BoardsFile>;

export const SourceFailure = z.object({ source: z.string(), error: z.string() });
export type SourceFailure = z.infer<typeof SourceFailure>;

export const Run = z.object({
  id: z.string(),
  mode: z.enum(['initial', 'incremental', 'fixtures']),
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  ok: z.boolean(),
  boardsScanned: z.number().int(),
  boardsFailed: z.number().int(),
  postingsExamined: z.number().int(),
  candidatesAfterTitleFilter: z.number().int(),
  newJobs: z.number().int(),
  newQualified: z.number().int(),
  updatedJobs: z.number().int(),
  closedJobs: z.number().int(),
  reopenedJobs: z.number().int(),
  verificationFailed: z.number().int(),
  duplicatesDiscarded: z.number().int(),
  suppressedByImport: z.number().int(),
  newBoardsDiscovered: z.number().int(),
  sourceFailures: z.array(SourceFailure),
  /** What happened to the Claude agent's leads in this scan. */
  agentLeads: z
    .object({
      considered: z.number().int(),
      newBoards: z.number().int(),
      published: z.number().int(),
      rejected: z.array(z.object({ url: z.string(), company: z.string(), title: z.string(), reason: z.string() })),
      unsupported: z.array(z.object({ url: z.string(), company: z.string(), title: z.string() })),
    })
    .default({ considered: 0, newBoards: 0, published: 0, rejected: [], unsupported: [] }),
  fxDate: isoDate.nullable(),
  nextScheduledAt: isoDateTime,
});
export type Run = z.infer<typeof Run>;

export const RunsFile = z.object({ schemaVersion: z.literal(1), runs: z.array(Run) });
export type RunsFile = z.infer<typeof RunsFile>;

/** Hand-verified contacts, keyed to a company and optionally to specific job ids. */
export const ContactsFile = z.object({
  schemaVersion: z.literal(1),
  contacts: z.array(Contact.extend({ jobIds: z.array(z.string()).default([]) })),
});

export const FxFile = z.object({
  schemaVersion: z.literal(1),
  base: z.literal('INR'),
  date: isoDate.nullable(),
  source: z.string(),
  /** INR per 1 unit of currency */
  rates: z.record(z.string(), z.number().positive()),
});
export type FxFile = z.infer<typeof FxFile>;

/** Imported applied/dismissed jobs. Only SHA-256 hashes are stored so the public repo does not reveal where you applied. */
export const SuppressFile = z.object({
  schemaVersion: z.literal(1),
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
});

/**
 * Written ONLY by the daily Claude agent (see AGENT.md). Leads are official posting URLs the agent found;
 * the scanner re-reads every one from the employer's ATS and applies the same rules as any other job.
 */
export const AgentLead = z.object({
  url,
  company: z.string().min(1),
  title: z.string().min(1),
  /** Exact sentence from the official posting about location/eligibility, if the agent found one. */
  locationEvidence: z.string().nullable().default(null),
  note: z.string().nullable().default(null),
  foundAt: isoDateTime,
});
export type AgentLead = z.infer<typeof AgentLead>;

export const AgentRun = z.object({
  at: isoDateTime,
  searches: z.number().int().nonnegative(),
  postingsOpened: z.number().int().nonnegative(),
  leadsAdded: z.number().int().nonnegative(),
  contactsAdded: z.number().int().nonnegative(),
  summary: z.string(),
});

export const AgentFile = z.object({
  schemaVersion: z.literal(1),
  leads: z.array(AgentLead),
  runs: z.array(AgentRun),
});
export type AgentFile = z.infer<typeof AgentFile>;
