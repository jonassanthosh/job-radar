import type { AgentFile, Job, JobsFile, Run, RunsFile, FxFile } from '../../../scanner/src/schema';

export type { Job, Run };

export interface Dataset {
  jobs: Job[];
  updatedAt: string | null;
  runs: Run[];
  fx: FxFile;
  agent: AgentFile;
}

export async function loadData(): Promise<Dataset> {
  const base = import.meta.env.BASE_URL;
  const get = async <T,>(f: string): Promise<T> => {
    const r = await fetch(`${base}data/${f}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not load data/${f} (HTTP ${r.status})`);
    return r.json() as Promise<T>;
  };
  const [jobs, runs, fx, agent] = await Promise.all([
    get<JobsFile>('jobs.json'),
    get<RunsFile>('runs.json'),
    get<FxFile>('fx.json'),
    get<AgentFile>('agent-leads.json').catch((): AgentFile => ({ schemaVersion: 1, leads: [], runs: [] })),
  ]);
  return { jobs: jobs.jobs, updatedAt: jobs.updatedAt, runs: runs.runs, fx, agent };
}

const IST = 'Asia/Kolkata';
export const istDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(iso));

export function daysAgo(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}

export function ageLabel(iso: string | null): string {
  const d = daysAgo(iso);
  if (d == null) return 'date not published';
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return `${Math.round(d / 30)} mo ago`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) + ' IST';
}

export function inrShort(n: number | null): string {
  if (n == null) return '—';
  return n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')}Cr` : `₹${Math.round(n / 100_000)}L`;
}

/** "New" = first seen on the latest run's IST day, and the posting itself is not old. */
export function newness(j: Job, latestRun: string | null, freshDays = 30): { today: boolean; week: boolean } {
  const fresh = !j.postedAt || (Date.parse(j.firstSeenAt) - Date.parse(j.postedAt)) / 86_400_000 <= freshDays;
  if (!fresh) return { today: false, week: false };
  const today = latestRun ? istDay(j.firstSeenAt) === istDay(latestRun) : false;
  const week = (Date.now() - Date.parse(j.firstSeenAt)) / 86_400_000 <= 7;
  return { today, week };
}

export const FEED_LABEL: Record<Job['feed'], string> = {
  recommended: 'Recommended',
  review: 'Pay unverified',
  location_check: 'Check India eligibility',
  excluded: 'Excluded',
};

export const FAMILY_LABEL: Record<Job['jobFamily'], string> = {
  developer_support: 'Developer support',
  technical_support: 'Technical support',
  customer_engineering: 'Customer engineering',
  solutions_integration: 'Solutions / integrations',
  developer_experience: 'Developer experience',
};

export const CONTACT_LABEL: Record<Job['contacts'][number]['type'], string> = {
  confirmed_hiring_manager: 'Confirmed hiring manager',
  confirmed_recruiter: 'Confirmed recruiter for this opening',
  potential_team_contact: 'Potential team contact',
  potential_recruiting_contact: 'Potential recruiting contact',
};
