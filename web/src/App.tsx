import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_FILTERS, Filters, applyFilters, type FilterState } from './components/Filters';
import { JobCard } from './components/JobCard';
import { Contacts, History, Overview, ScanHealth, TrackerView } from './components/Views';
import { fmtDate, loadData, newness, type Dataset, type Job } from './lib/data';
import { useTracker } from './lib/tracker';

const ROUTES = [
  { id: 'overview', label: 'Overview' },
  { id: 'recommended', label: 'Recommended' },
  { id: 'review', label: 'Pay unverified' },
  { id: 'location', label: 'Check eligibility' },
  { id: 'all', label: 'All active' },
  { id: 'tracker', label: 'Applications' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'history', label: 'History' },
  { id: 'health', label: 'Scan health' },
] as const;
type Route = (typeof ROUTES)[number]['id'];

const LANE: Partial<Record<Route, { feed: Job['feed'][]; title: string; blurb: string }>> = {
  recommended: { feed: ['recommended'], title: 'Recommended', blurb: 'Open to remote work from India, with an official pay range that reaches ₹60L or more.' },
  review: { feed: ['review'], title: 'Strong fit, pay not disclosed for India', blurb: 'India-eligible and a strong technical match. The employer has not published pay for India, so ask the recruiter before investing time.' },
  location: { feed: ['location_check'], title: 'Check India eligibility first', blurb: 'Strong matches listed as APAC, worldwide or just “remote”. The posting does not confirm India, so confirm with the recruiter before applying.' },
  all: { feed: ['recommended', 'review', 'location_check'], title: 'All qualified, active jobs', blurb: 'Every list combined. Use the filters to narrow down.' },
};

const routeFromHash = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.some((r) => r.id === h) ? h : 'overview';
};

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const tracker = useTracker();

  useEffect(() => {
    loadData().then(setData).catch((e: Error) => setError(e.message));
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (r: string) => { window.location.hash = `/${r}`; window.scrollTo(0, 0); };

  const latestRun = data?.runs.at(-1)?.startedAt ?? null;
  const isNew = useMemo(() => (j: Job) => newness(j, latestRun), [latestRun]);

  const counts = useMemo(() => {
    const jobs = data?.jobs ?? [];
    const live = jobs.filter((j) => j.status !== 'closed' && !j.suppressed);
    const q = live.filter((j) => j.feed !== 'excluded');
    return {
      recommended: live.filter((j) => j.feed === 'recommended').length,
      review: live.filter((j) => j.feed === 'review').length,
      location_check: live.filter((j) => j.feed === 'location_check').length,
      stored: jobs.length,
      newToday: q.filter((j) => isNew(j).today).length,
      newWeek: q.filter((j) => isNew(j).week).length,
      verifiedPay: q.filter((j) => j.compensation.status === 'verified').length,
      unverifiedPay: q.filter((j) => j.compensation.status === 'unverified').length,
      active: jobs.filter((j) => j.status === 'active').length,
      closed: jobs.filter((j) => j.status === 'closed').length,
      failed: jobs.filter((j) => j.status === 'verification_failed').length,
      contacts: q.reduce((n, j) => n + j.contacts.length, 0),
      companies: new Set(jobs.map((j) => j.company)).size,
    };
  }, [data, isNew]);

  if (error) return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-bold">The dashboard could not load its data</h1><p className="mt-2 text-ink-soft">{error}. If this is a fresh repository, run the “Daily scan” workflow once from the Actions tab.</p></main>;
  if (!data) return <main className="p-8 text-ink-soft" aria-busy>Loading jobs…</main>;

  const lane = LANE[route];
  const laneJobs = lane ? data.jobs.filter((j) => lane.feed.includes(j.feed) && j.status !== 'closed' && !j.suppressed) : [];
  const shown = lane ? applyFilters(laneJobs, filters, { isNew, statusOf: tracker.statusOf }) : [];
  const badge = (id: Route) => (id === 'recommended' ? counts.recommended : id === 'review' ? counts.review : id === 'location' ? counts.location_check : null);

  return (
    <div className="min-h-screen pb-20 lg:grid lg:grid-cols-[15rem_1fr] lg:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">Skip to content</a>
      <aside className="hidden border-r border-line lg:block">
        <div className="sticky top-0 p-5">
          <div className="flex items-center gap-2 text-lg font-extrabold">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="14" fill="none" stroke="var(--link)" strokeWidth="3" /><circle cx="16" cy="16" r="7" fill="none" stroke="var(--link)" strokeWidth="3" /><circle cx="16" cy="16" r="2.5" fill="var(--ok)" /></svg>
            Job Radar
          </div>
          <p className="mt-1 text-[12px] text-ink-faint">Remote support engineering roles open to India</p>
          <nav className="mt-6 space-y-0.5" aria-label="Sections">
            {ROUTES.map((r) => (
              <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined}
                className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[14px] no-underline ${route === r.id ? 'bg-surface font-semibold text-ink' : 'text-ink-soft hover:text-ink'}`}>
                {r.label}
                {badge(r.id) != null && <span className="tabular-nums text-ink-faint">{badge(r.id)}</span>}
              </a>
            ))}
          </nav>
          <p className="mt-8 text-[12px] text-ink-faint">Data updated {fmtDate(data.updatedAt)}.</p>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-10 flex gap-1 overflow-x-auto border-t border-line bg-surface px-2 py-1.5 lg:hidden" aria-label="Sections">
        {ROUTES.map((r) => (
          <a key={r.id} href={`#/${r.id}`} aria-current={route === r.id ? 'page' : undefined}
            className={`shrink-0 rounded-md px-2.5 py-1.5 text-[13px] no-underline ${route === r.id ? 'bg-paper font-semibold text-ink' : 'text-ink-soft'}`}>
            {r.label}{badge(r.id) != null ? ` ${badge(r.id)}` : ''}
          </a>
        ))}
      </nav>

      <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-base font-extrabold lg:hidden">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="14" fill="none" stroke="var(--link)" strokeWidth="3" /><circle cx="16" cy="16" r="7" fill="none" stroke="var(--link)" strokeWidth="3" /><circle cx="16" cy="16" r="2.5" fill="var(--ok)" /></svg>
        Job Radar
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
        {route === 'overview' && <Overview data={data} counts={counts} go={go} />}
        {route === 'history' && <History jobs={data.jobs} tracker={tracker} />}
        {route === 'contacts' && <Contacts jobs={data.jobs} />}
        {route === 'tracker' && <TrackerView jobs={data.jobs} tracker={tracker} />}
        {route === 'health' && <ScanHealth data={data} />}
        {lane && (
          <div className="lg:grid lg:grid-cols-[1fr_16rem] lg:gap-8">
            <div>
              <h2 className="text-2xl font-extrabold">{lane.title}</h2>
              <p className="mt-1 max-w-[70ch] text-ink-soft">{lane.blurb}</p>
              <div className="mt-3 flex items-center gap-3 text-[14px] text-ink-soft">
                <span>{shown.length} of {laneJobs.length} shown</span>
                <button type="button" className="font-medium text-link lg:hidden" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
                  {showFilters ? 'Hide filters' : 'Filter and sort'}
                </button>
              </div>
              {showFilters && (
                <div className="mt-4 rounded-lg border border-line bg-surface p-4 lg:hidden">
                  <Filters f={filters} set={(p) => setFilters({ ...filters, ...p })} jobs={laneJobs} onReset={() => setFilters(DEFAULT_FILTERS)} />
                </div>
              )}
              <div className="mt-5 space-y-4">
                {shown.map((j) => (
                  <JobCard key={j.id} job={j} isNew={isNew(j).today} app={tracker.state.applications[j.id]} onTrack={(p) => tracker.update(j, p)} />
                ))}
                {shown.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line p-6 text-ink-soft">
                    {laneJobs.length === 0
                      ? 'Nothing in this list right now. The scan runs every morning around 7:00 IST and adds jobs as they appear.'
                      : 'No jobs match these filters. Clear a filter to see more.'}
                  </div>
                )}
              </div>
            </div>
            <aside className="hidden lg:block">
              <div className="sticky top-10">
                <Filters f={filters} set={(p) => setFilters({ ...filters, ...p })} jobs={laneJobs} onReset={() => setFilters(DEFAULT_FILTERS)} />
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
