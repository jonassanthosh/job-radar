import { useState } from 'react';
import { CONTACT_LABEL, FAMILY_LABEL, ageLabel, fmtDate, type Job } from '../lib/data';
import { STATUSES, STATUS_LABEL, type Application, type AppStatus } from '../lib/tracker';

type Tone = 'ok' | 'warn' | 'bad';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
};
const GLYPH: Record<Tone, string> = { ok: '✓', warn: '?', bad: '✕' };

function Gate({ name, tone, verdict, evidence, href }: { name: string; tone: Tone; verdict: string; evidence: string | null; href?: string | null }) {
  return (
    <div className="min-w-0 flex-1 basis-56 border-l-[3px] pl-3" style={{ borderColor: `var(--${tone})` }}>
      <div className="flex items-baseline gap-x-2 text-[13px] leading-snug">
        <span className={`inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${TONE[tone]}`} aria-hidden>
          {GLYPH[tone]}
        </span>
        <span className="font-semibold">{name}</span>
        <span className="min-w-0 text-ink-soft">{verdict}</span>
      </div>
      {evidence && (
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-faint">
          “{evidence}”{href && <> <a href={href} target="_blank" rel="noreferrer" className="whitespace-nowrap">source</a></>}
        </p>
      )}
    </div>
  );
}

export function locationGate(j: Job): { tone: Tone; verdict: string } {
  if (j.location.india === 'eligible') return { tone: 'ok', verdict: 'Open to India, remote' };
  if (j.location.india === 'verification_required') return { tone: 'warn', verdict: 'Not confirmed for India' };
  return { tone: 'bad', verdict: j.location.reason };
}
export function payGate(j: Job): { tone: Tone; verdict: string } {
  if (j.compensation.status === 'verified') return { tone: 'ok', verdict: j.compensation.display };
  if (j.compensation.status === 'below_target') return { tone: 'bad', verdict: j.compensation.display };
  return { tone: 'warn', verdict: j.compensation.applicability === 'unspecified' && !j.compensation.currency ? 'Not disclosed — verify with recruiter' : j.compensation.display };
}

const BREAKDOWN: [keyof Job['fit']['breakdown'], string, number][] = [
  ['technical', 'Technical skills', 30],
  ['devSupport', 'Developer-facing support', 25],
  ['experience', 'Experience & seniority', 20],
  ['industry', 'Industry & technology', 15],
  ['customerFacing', 'Customer-facing work', 10],
];

export function JobCard({ job, isNew, app, onTrack }: { job: Job; isNew: boolean; app: Application | undefined; onTrack: (patch: Partial<Pick<Application, 'status' | 'notes' | 'appliedAt'>>) => void }) {
  const [open, setOpen] = useState(false);
  const loc = locationGate(job);
  const pay = payGate(job);
  const fitTone: Tone = job.fit.score >= 80 ? 'ok' : job.fit.score >= 70 ? 'warn' : 'bad';
  const status: AppStatus = app?.status ?? 'new';
  const closed = job.status !== 'active';

  return (
    <article className={`rounded-lg border border-line bg-surface ${closed ? 'opacity-70' : ''}`}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
              <span className="font-semibold text-ink">{job.company}</span>
              <span aria-hidden>/</span>
              <span>{FAMILY_LABEL[job.jobFamily]}</span>
              {isNew && <span className="rounded bg-link px-1.5 py-px text-[11px] font-semibold text-surface">New</span>}
              {job.discoverySources.includes('claude-agent') && <span className="rounded border border-link px-1.5 py-px text-[11px] font-semibold text-link" title="Found by the daily Claude research agent, then verified on the official job board">Found by Claude</span>}
              {job.status === 'closed' && <span className="rounded bg-bad-bg px-1.5 py-px text-[11px] font-semibold text-bad">Closed</span>}
              {job.status === 'verification_failed' && <span className="rounded bg-warn-bg px-1.5 py-px text-[11px] font-semibold text-warn">Could not re-check</span>}
            </div>
            <h3 className="mt-1 text-lg leading-tight font-bold text-balance sm:text-xl">{job.title}</h3>
            <p className="mt-1 text-[13px] text-ink-soft">
              {job.location.raw}
              {job.employmentType ? `, ${job.employmentType}` : ''}. Posted {ageLabel(job.postedAt)}, found {fmtDate(job.firstSeenAt)}.
            </p>
          </div>
          <div className="shrink-0 text-right" title="Fit score out of 100">
            <div className={`text-3xl leading-none font-extrabold ${fitTone === 'ok' ? 'text-ok' : fitTone === 'warn' ? 'text-warn' : 'text-bad'}`}>{job.fit.score}</div>
            <div className="mt-1 text-[11px] text-ink-faint">fit / 100</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
          <Gate name="Location" tone={loc.tone} verdict={loc.verdict} evidence={job.location.evidence} href={job.location.evidenceSource} />
          <Gate name="Pay" tone={pay.tone} verdict={pay.verdict} evidence={job.compensation.evidence && job.compensation.status !== 'unverified' ? job.compensation.evidence : null} href={job.compensation.sourceUrl} />
        </div>

        <p className="mt-4 max-w-[72ch] text-[15px] leading-relaxed">{job.fit.whyFit}</p>
        {job.fit.matchedSkills.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Matching skills">
            {job.fit.matchedSkills.slice(0, 8).map((s) => (
              <li key={s} className="rounded border border-line px-1.5 py-0.5 text-[12px] text-ink-soft">{s}</li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <a href={job.applyUrl} target="_blank" rel="noreferrer" className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-paper no-underline visited:text-paper hover:opacity-90">
            Open official posting
          </a>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Application status</span>
            <select className="field w-auto" value={status} onChange={(e) => onTrack({ status: e.target.value as AppStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded-md px-2 py-1.5 text-sm font-medium text-link hover:underline">
            {open ? 'Hide details' : 'Details, contacts and notes'}
          </button>
          {job.contacts.length > 0 && !open && (
            <span className="text-[13px] text-ink-soft">{job.contacts[0].name}, {CONTACT_LABEL[job.contacts[0].type].toLowerCase()}</span>
          )}
        </div>
      </div>

      {open && (
        <div className="grid gap-6 border-t border-line p-4 sm:grid-cols-2 sm:p-5">
          <section>
            <h4 className="text-sm font-bold">Why it fits</h4>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-snug">
              {job.fit.strongestMatch.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <p className="mt-3 text-[14px] text-ink-soft">{job.fit.worthApplying}</p>
            <dl className="mt-4 space-y-1.5">
              {BREAKDOWN.map(([k, label, max]) => (
                <div key={k} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[13px]">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className="tabular-nums">{job.fit.breakdown[k]}/{max}</dd>
                  <div className="col-span-2 h-1 rounded bg-line"><div className="h-1 rounded bg-link" style={{ width: `${(job.fit.breakdown[k] / max) * 100}%` }} /></div>
                </div>
              ))}
            </dl>
          </section>

          <section>
            <h4 className="text-sm font-bold">Gaps and concerns</h4>
            {job.fit.missing.length + job.fit.concerns.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-soft">None detected in the posting text.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[14px]">
                {job.fit.missing.map((m) => <li key={m}>Missing: {m}</li>)}
                {job.fit.concerns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
            {job.yearsRequired != null && <p className="mt-2 text-[13px] text-ink-soft">Asks for {job.yearsRequired}+ years.</p>}
            <p className="mt-2 text-[13px] text-ink-soft">Location: {job.location.reason}.</p>

            <h4 className="mt-5 text-sm font-bold">People to approach</h4>
            {job.contacts.length === 0 ? (
              <p className="mt-2 text-[14px] text-ink-soft">No verified contact yet. Search publicly:</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {job.contacts.map((c) => (
                  <li key={c.name} className="text-[14px]">
                    <div className="font-semibold">
                      {c.linkedinUrl ? <a href={c.linkedinUrl} target="_blank" rel="noreferrer">{c.name}</a> : c.name}
                      <span className="font-normal text-ink-soft">, {c.role}</span>
                    </div>
                    <div className="text-[13px] text-ink-soft">
                      {CONTACT_LABEL[c.type]}, {c.confidence} confidence{c.addedBy === 'claude' ? ', researched by Claude' : c.addedBy === 'posting' ? ', named in the posting' : ''}. {c.reason}. Verified {fmtDate(c.verifiedAt)} via <a href={c.sourceUrl} target="_blank" rel="noreferrer">source</a>.
                      {c.stale && <span className="text-warn"> Re-verify: older than 4 months.</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
              {job.contactSearchLinks.map((l) => <li key={l.label}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}
            </ul>

            <h4 className="mt-5 text-sm font-bold">Your notes</h4>
            <p className="text-[12px] text-ink-faint">Saved only in this browser.</p>
            <textarea className="field mt-1 min-h-20" defaultValue={app?.notes ?? ''} onBlur={(e) => e.target.value !== (app?.notes ?? '') && onTrack({ notes: e.target.value })} placeholder="Referral, recruiter call, follow-up date…" />
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              Applied on
              <input type="date" className="field w-auto" value={app?.appliedAt ?? ''} onChange={(e) => onTrack({ appliedAt: e.target.value || null })} />
            </label>
          </section>

          <section className="sm:col-span-2">
            <h4 className="text-sm font-bold">Record history</h4>
            <ol className="mt-2 space-y-1 text-[13px] text-ink-soft">
              {[...job.history].reverse().slice(0, 8).map((h, i) => (
                <li key={i}><span className="text-ink">{fmtDate(h.at)}</span>: {h.reason}{h.to && h.type !== 'description' ? ` (${h.to})` : ''}</li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] text-ink-faint">
              ID {job.id}. Last verified {fmtDate(job.lastVerifiedAt)}. Sources: {job.discoverySources.join(', ')}. {job.feedReasons.join(' ')}
            </p>
          </section>
        </div>
      )}
    </article>
  );
}
