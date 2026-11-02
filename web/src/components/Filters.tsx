import { FAMILY_LABEL, type Job } from '../lib/data';
import { STATUSES, STATUS_LABEL, type AppStatus } from '../lib/tracker';

export interface FilterState {
  q: string;
  family: Job['jobFamily'] | '';
  company: string;
  minInrLakh: number;
  pay: '' | 'verified' | 'unverified';
  region: string;
  postedWithin: number;
  minScore: number;
  employment: string;
  discovered: '' | 'today' | 'week' | 'older';
  appStatus: AppStatus | '' | 'untracked';
  sort: 'score' | 'posted' | 'found' | 'pay';
}

export const DEFAULT_FILTERS: FilterState = { q: '', family: '', company: '', minInrLakh: 0, pay: '', region: '', postedWithin: 0, minScore: 0, employment: '', discovered: '', appStatus: '', sort: 'score' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[13px]">
      <span className="mb-1 block font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Filters({ f, set, jobs, onReset }: { f: FilterState; set: (p: Partial<FilterState>) => void; jobs: Job[]; onReset: () => void }) {
  const companies = [...new Set(jobs.map((j) => j.company))].sort((a, b) => a.localeCompare(b));
  const regions = [...new Set(jobs.map((j) => j.location.region))].sort();
  const employment = [...new Set(jobs.map((j) => j.employmentType).filter(Boolean) as string[])].sort();
  const active = JSON.stringify({ ...f, sort: 'score' }) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="space-y-3">
      <Field label="Search">
        <input type="search" className="field" placeholder="Title, company, skill…" value={f.q} onChange={(e) => set({ q: e.target.value })} />
      </Field>
      <Field label="Sort by">
        <select className="field" value={f.sort} onChange={(e) => set({ sort: e.target.value as FilterState['sort'] })}>
          <option value="score">Fit score</option>
          <option value="posted">Most recently posted</option>
          <option value="found">Most recently found</option>
          <option value="pay">Highest verified pay</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Min fit score">
          <select className="field" value={f.minScore} onChange={(e) => set({ minScore: +e.target.value })}>
            {[0, 70, 80, 90].map((n) => <option key={n} value={n}>{n ? `${n}+` : 'Any'}</option>)}
          </select>
        </Field>
        <Field label="Min pay (INR)">
          <select className="field" value={f.minInrLakh} onChange={(e) => set({ minInrLakh: +e.target.value })}>
            {[0, 60, 75, 100].map((n) => <option key={n} value={n}>{n ? (n >= 100 ? '₹1Cr+' : `₹${n}L+`) : 'Any'}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Pay evidence">
        <select className="field" value={f.pay} onChange={(e) => set({ pay: e.target.value as FilterState['pay'] })}>
          <option value="">Any</option>
          <option value="verified">Verified for India</option>
          <option value="unverified">Not disclosed for India</option>
        </select>
      </Field>
      <Field label="Role family">
        <select className="field" value={f.family} onChange={(e) => set({ family: e.target.value as FilterState['family'] })}>
          <option value="">All</option>
          {Object.entries(FAMILY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Company">
        <select className="field" value={f.company} onChange={(e) => set({ company: e.target.value })}>
          <option value="">All ({companies.length})</option>
          {companies.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Remote region">
          <select className="field" value={f.region} onChange={(e) => set({ region: e.target.value })}>
            <option value="">Any</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Employment">
          <select className="field" value={f.employment} onChange={(e) => set({ employment: e.target.value })}>
            <option value="">Any</option>
            {employment.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Posted within">
          <select className="field" value={f.postedWithin} onChange={(e) => set({ postedWithin: +e.target.value })}>
            {[0, 1, 7, 14, 30].map((n) => <option key={n} value={n}>{n ? `${n} day${n > 1 ? 's' : ''}` : 'Any time'}</option>)}
          </select>
        </Field>
        <Field label="Found">
          <select className="field" value={f.discovered} onChange={(e) => set({ discovered: e.target.value as FilterState['discovered'] })}>
            <option value="">Any time</option>
            <option value="today">New today</option>
            <option value="week">New this week</option>
            <option value="older">Seen before</option>
          </select>
        </Field>
      </div>
      <Field label="Your status">
        <select className="field" value={f.appStatus} onChange={(e) => set({ appStatus: e.target.value as FilterState['appStatus'] })}>
          <option value="">Any</option>
          <option value="untracked">Not acted on</option>
          {STATUSES.filter((s) => s !== 'new').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      {active && (
        <button type="button" onClick={onReset} className="text-sm font-medium text-link hover:underline">Clear filters</button>
      )}
    </div>
  );
}

export function applyFilters(jobs: Job[], f: FilterState, ctx: { isNew: (j: Job) => { today: boolean; week: boolean }; statusOf: (id: string) => AppStatus }): Job[] {
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const out = jobs.filter((j) => {
    if (q && ![j.title, j.company, j.location.raw, ...j.techStack, ...j.fit.matchedSkills].join(' ').toLowerCase().includes(q)) return false;
    if (f.family && j.jobFamily !== f.family) return false;
    if (f.company && j.company !== f.company) return false;
    if (f.region && j.location.region !== f.region) return false;
    if (f.employment && j.employmentType !== f.employment) return false;
    if (f.minScore && j.fit.score < f.minScore) return false;
    if (f.pay === 'verified' && j.compensation.status !== 'verified') return false;
    if (f.pay === 'unverified' && j.compensation.status !== 'unverified') return false;
    if (f.minInrLakh && (j.compensation.status !== 'verified' || (j.compensation.inrMax ?? 0) < f.minInrLakh * 100_000)) return false;
    if (f.postedWithin && (!j.postedAt || (now - Date.parse(j.postedAt)) / 86_400_000 > f.postedWithin)) return false;
    if (f.discovered) {
      const n = ctx.isNew(j);
      if (f.discovered === 'today' && !n.today) return false;
      if (f.discovered === 'week' && !n.week) return false;
      if (f.discovered === 'older' && n.week) return false;
    }
    if (f.appStatus) {
      const s = ctx.statusOf(j.id);
      if (f.appStatus === 'untracked' ? s !== 'new' : s !== f.appStatus) return false;
    }
    return true;
  });
  const t = (s: string | null) => (s ? Date.parse(s) : 0);
  return out.sort((a, b) =>
    f.sort === 'posted' ? t(b.postedAt) - t(a.postedAt)
    : f.sort === 'found' ? t(b.firstSeenAt) - t(a.firstSeenAt)
    : f.sort === 'pay' ? (b.compensation.status === 'verified' ? b.compensation.inrMax ?? 0 : -1) - (a.compensation.status === 'verified' ? a.compensation.inrMax ?? 0 : -1)
    : b.fit.score - a.fit.score,
  );
}
