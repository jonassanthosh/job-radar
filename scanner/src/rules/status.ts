/**
 * Job status transitions. Pure functions so every path is unit-tested.
 *
 *   seen         -> active      (closed/verification_failed -> active is logged as "reopened"/"verified")
 *   absent       -> closed      (only when the source was fetched successfully and the job is gone)
 *   fetch_failed -> verification_failed (never closed on a source error)
 */
import type { Job } from '../schema.js';

export type Observation = { kind: 'seen' } | { kind: 'absent'; reason?: string } | { kind: 'fetch_failed'; error: string };

export function applyObservation(job: Job, obs: Observation, at: string): Job {
  const prev = job.status;
  if (obs.kind === 'seen') {
    const next: Job = { ...job, status: 'active', lastCheckedAt: at, lastVerifiedAt: at, consecutiveFailures: 0 };
    if (prev !== 'active') {
      next.history = [...job.history, { at, type: 'status', from: prev, to: 'active', reason: prev === 'closed' ? 'Posting reappeared on the official board (reopened)' : 'Verified again after earlier fetch failure' }];
      next.lastModifiedAt = at;
    }
    return next;
  }
  if (obs.kind === 'absent') {
    if (prev === 'closed') return { ...job, lastCheckedAt: at };
    return {
      ...job,
      status: 'closed',
      lastCheckedAt: at,
      lastModifiedAt: at,
      consecutiveFailures: 0,
      history: [...job.history, { at, type: 'status', from: prev, to: 'closed', reason: obs.reason ?? 'No longer listed on the official job board' }],
    };
  }
  // fetch_failed: keep the last known status for closed jobs; flag active ones.
  if (prev === 'closed') return { ...job, lastCheckedAt: at };
  const next: Job = { ...job, status: 'verification_failed', lastCheckedAt: at, consecutiveFailures: job.consecutiveFailures + 1 };
  if (prev !== 'verification_failed') {
    next.history = [...job.history, { at, type: 'status', from: prev, to: 'verification_failed', reason: `Source unavailable: ${obs.error.slice(0, 160)}` }];
    next.lastModifiedAt = at;
  }
  return next;
}
