import { useRef, useState } from 'react';
import { CONTACT_LABEL, FEED_LABEL, fmtDate, fmtDateTime, type Dataset, type Job } from '../lib/data';
import { STATUS_LABEL, type useTracker } from '../lib/tracker';
import { locationGate, payGate } from './JobCard';

type Tracker = ReturnType<typeof useTracker>;

/* ---------- Overview ---------------------------------------------------------------- */
export function Overview({ data, counts, go }: { data: Dataset; counts: Record<string, number>; go: (route: string) => void }) {
  const run = data.runs.at(-1);
  const lanes: { key: Job['feed']; route: string; tone: string }[] = [
    { key: 'recommended', route: 'recommended', tone: 'var(--ok)' },
    { key: 'review', route: 'review', tone: 'var(--warn)' },
    { key: 'location_check', route: 'location', tone: 'var(--link)' },
  ];
  const qualified = counts.recommended + counts.review + counts.location_check;
  // Every stage is measured within the last scan, so the bars always narrow.
  const verified = run ? data.jobs.filter((j) => j.lastVerifiedAt === run.startedAt) : [];
  const funnel: [string, number | undefined][] = [
    ['postings examined on official job boards', run?.postingsExamined],
    ['matched a target title', run?.candidatesAfterTitleFilter],
    ['technical support role, not ruled out for India', verified.length],
    ['qualified for one of your three lists', verified.filter((j) => j.feed !== 'excluded' && !j.suppressed).length],
  ];
  const max = Math.max(1, ...funnel.map(([, n]) => n ?? 0));

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {qualified === 0 ? 'No qualified openings yet' : `${qualified} opening${qualified === 1 ? '' : 's'} worth your time`}
        </h2>
        <p className="mt-1 text-ink-soft">
          {counts.newToday} new today, {counts.newWeek} new in the past 7 days. Last scan {fmtDateTime(run?.finishedAt ?? null)}.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {lanes.map((l) => (
            <button key={l.key} type="button" onClick={() => go(l.route)} className="rounded-lg border border-line bg-surface p-4 text-left hover:border-ink-faint" style={{ borderTop: `4px solid ${l.tone}` }}>
              <div className="text-3xl font-extrabold">{counts[l.key]}</div>
              <div className="mt-1 font-semibold">{FEED_LABEL[l.key]}</div>
              <div className="mt-1 text-[13px] text-ink-soft">
                {l.key === 'recommended' && 'India-eligible, pay verified at ₹60L or more.'}
                {l.key === 'review' && 'India-eligible, strong fit, pay not disclosed for India.'}
                {l.key === 'location_check' && 'Strong fit, but India eligibility is not stated.'}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-bold">How the last scan narrowed down</h3>
        <ol className="mt-3 space-y-2">
          {funnel.map(([label, n]) => (
            <li key={label} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 text-[14px]">
              <span className="text-right text-lg font-bold tabular-nums">{n ?? '—'}</span>
              <span>
                <span className="block h-2 rounded bg-link" style={{ width: `${Math.max(1, ((n ?? 0) / max) * 100)}%`, opacity: 0.85 }} />
                <span className="text-ink-soft">{label}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="font-bold">Totals</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[14px] sm:grid-cols-4">
          {[
            ['Qualified jobs', qualified],
            ['Verified ₹60L+ pay', counts.verifiedPay],
            ['Pay unverified', counts.unverifiedPay],
            ['Active records', counts.active],
            ['Closed', counts.closed],
            ['Could not re-check', counts.failed],
            ['Verified contacts', counts.contacts],
            ['Companies tracked', counts.companies],
          ].map(([k, v]) => (
            <div key={k as string} className="border-t border-line pt-2">
              <dt className="text-ink-soft">{k}</dt>
              <dd className="text-xl font-bold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/* ---------- History ----------------------------------------------------------------- */
export function History({ jobs, tracker }: { jobs: Job[]; tracker: Tracker }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const rows = jobs.filter((j) => (!status || j.status === status) && (!q || `${j.title} ${j.company}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div>
      <h2 className="text-2xl font-extrabold">Every job ever recorded</h2>
      <p className="mt-1 text-ink-soft">Includes closed and excluded jobs, with the reason each was excluded.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <input className="field max-w-xs" type="search" placeholder="Filter by title or company" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="verification_failed">Could not re-check</option>
        </select>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <thead className="border-b border-line text-[13px] text-ink-soft">
            <tr><th className="p-3 font-medium">Job</th><th className="p-3 font-medium">List</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Fit</th><th className="p-3 font-medium">Found</th><th className="p-3 font-medium">Your status</th></tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="border-b border-line align-top last:border-0">
                <td className="p-3">
                  <a href={j.officialUrl} target="_blank" rel="noreferrer" className="font-semibold">{j.title}</a>
                  <div className="text-[13px] text-ink-soft">{j.company}, {j.location.raw}</div>
                  {j.feed === 'excluded' && <div className="text-[12px] text-ink-faint">{j.feedReasons.join(' ')}</div>}
                </td>
                <td className="p-3">{FEED_LABEL[j.feed]}</td>
                <td className="p-3">{j.status === 'verification_failed' ? 'Could not re-check' : j.status[0].toUpperCase() + j.status.slice(1)}</td>
                <td className="p-3 tabular-nums">{j.fit.score}</td>
                <td className="p-3 whitespace-nowrap">{fmtDate(j.firstSeenAt)}</td>
                <td className="p-3">{STATUS_LABEL[tracker.statusOf(j.id)]}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">No records match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- Contacts ---------------------------------------------------------------- */
export function Contacts({ jobs }: { jobs: Job[] }) {
  const rows = jobs.filter((j) => j.status === 'active' && j.feed !== 'excluded').flatMap((j) => j.contacts.map((c) => ({ c, j })));
  return (
    <div>
      <h2 className="text-2xl font-extrabold">People you can approach</h2>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        Only people named in an official posting or verified by hand with a public source appear here. A company-level contact is never shown as the confirmed hiring manager for a specific opening.
      </p>
      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line p-6 text-ink-soft">
          No verified contacts yet. Each job has prefilled public search links under “Details”. When you confirm someone, add them to <code>data/contacts.json</code> with the page that proves their role, and the next scan attaches them.
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {rows.map(({ c, j }) => (
            <li key={`${j.id}-${c.name}`} className="rounded-lg border border-line bg-surface p-4">
              <div className="font-bold">{c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noreferrer">{c.name}</a> : c.name}</div>
              <div className="text-[14px] text-ink-soft">{c.role}, {c.company}</div>
              <div className="mt-2 text-[13px]">{CONTACT_LABEL[c.type]} for <a href={j.officialUrl} target="_blank" rel="noreferrer">{j.title}</a></div>
              <div className="mt-1 text-[13px] text-ink-soft">{c.confidence[0].toUpperCase() + c.confidence.slice(1)} confidence. {c.reason}. Verified {fmtDate(c.verifiedAt)}, <a href={c.sourceUrl} target="_blank" rel="noreferrer">source</a>.{c.stale && ' Needs re-verifying.'}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Tracker ----------------------------------------------------------------- */
export function TrackerView({ jobs, tracker }: { jobs: Job[]; tracker: Tracker }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const apps = Object.entries(tracker.state.applications).filter(([, a]) => a.status !== 'new').sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt));

  return (
    <div>
      <h2 className="text-2xl font-extrabold">Your applications</h2>
      <p className="mt-1 max-w-[70ch] text-ink-soft">
        Statuses and notes are stored only in this browser, never in the repository. Export a backup to move them to another device, or to feed <code>npm run import</code> so applied jobs are never shown as new again.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={tracker.exportJson} className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-paper">Export backup</button>
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-semibold">Import backup</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { setMsg(await tracker.importJson(f)); } catch (err) { setMsg((err as Error).message); }
          e.target.value = '';
        }} />
        {msg && <span role="status" className="text-sm text-ink-soft">{msg}</span>}
      </div>
      {apps.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-ink-soft">Nothing tracked yet. Set a status on any job card to start.</p>
      ) : (
        <ul className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface">
          {apps.map(([id, a]) => {
            const j = byId.get(id);
            return (
              <li key={id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <a href={a.url} target="_blank" rel="noreferrer" className="font-semibold">{a.title}</a>
                  <span className="text-ink-soft">, {a.company}</span>
                  {j && j.status !== 'active' && <span className="ml-2 text-[12px] text-bad">{j.status === 'closed' ? 'Posting closed' : 'Could not re-check'}</span>}
                  {a.notes && <p className="mt-1 text-[14px] whitespace-pre-wrap text-ink-soft">{a.notes}</p>}
                </div>
                <div className="text-[13px] sm:text-right">
                  <div className="font-semibold">{STATUS_LABEL[a.status]}</div>
                  <div className="text-ink-soft">{a.appliedAt ? `Applied ${fmtDate(a.appliedAt)}` : `Updated ${fmtDate(a.updatedAt)}`}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------- Scan health ------------------------------------------------------------- */
export function ScanHealth({ data }: { data: Dataset }) {
  const runs = [...data.runs].reverse();
  const last = runs[0];
  const lastOk = runs.find((r) => r.ok);
  return (
    <div>
      <h2 className="text-2xl font-extrabold">Scan health</h2>
      {!last ? (
        <p className="mt-4 rounded-lg border border-dashed border-line p-6 text-ink-soft">No scan has run yet. Run the “Daily scan” workflow from the repository’s Actions tab.</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
            {[
              ['Last successful scan', fmtDateTime(lastOk?.finishedAt ?? null)],
              ['Next scheduled', `${fmtDateTime(last.nextScheduledAt)} (GitHub may delay it)`],
              ['Boards scanned', `${last.boardsScanned} (${last.boardsFailed} failed)`],
              ['Postings examined', last.postingsExamined],
              ['New jobs stored', last.newJobs],
              ['Duplicates discarded', last.duplicatesDiscarded],
              ['New employers found', last.newBoardsDiscovered],
              ['FX rates dated', last.fxDate ?? 'unavailable'],
            ].map(([k, v]) => (
              <div key={k as string} className="border-t border-line pt-2"><dt className="text-ink-soft">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
          {last.sourceFailures.length > 0 && (
            <details className="mt-5 rounded-lg border border-line bg-surface p-4">
              <summary className="cursor-pointer font-semibold">{last.sourceFailures.length} source failure{last.sourceFailures.length > 1 ? 's' : ''} in the last scan</summary>
              <ul className="mt-3 space-y-1 text-[13px]">
                {last.sourceFailures.map((f, i) => <li key={i}><span className="font-semibold">{f.source}</span>: <span className="text-ink-soft">{f.error}</span></li>)}
              </ul>
              <p className="mt-2 text-[12px] text-ink-faint">Jobs from a failed source are marked “Could not re-check”, never closed.</p>
            </details>
          )}
          <div className="mt-6 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[13px]">
              <thead className="border-b border-line text-ink-soft"><tr>{['Run', 'Result', 'Boards', 'Examined', 'New', 'Updated', 'Closed', 'Dupes', 'Failures'].map((h) => <th key={h} className="p-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {runs.slice(0, 30).map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="p-2.5 whitespace-nowrap">{fmtDateTime(r.startedAt)}</td>
                    <td className="p-2.5">{r.ok ? 'OK' : 'Degraded'}{r.mode !== 'incremental' ? ` (${r.mode})` : ''}</td>
                    <td className="p-2.5 tabular-nums">{r.boardsScanned}</td>
                    <td className="p-2.5 tabular-nums">{r.postingsExamined}</td>
                    <td className="p-2.5 tabular-nums">{r.newJobs}</td>
                    <td className="p-2.5 tabular-nums">{r.updatedJobs}</td>
                    <td className="p-2.5 tabular-nums">{r.closedJobs}</td>
                    <td className="p-2.5 tabular-nums">{r.duplicatesDiscarded}</td>
                    <td className="p-2.5 tabular-nums">{r.sourceFailures.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export { locationGate, payGate };
