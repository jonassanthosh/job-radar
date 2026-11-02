/**
 * Which list a job belongs in. Location and pay are hard gates; the fit score never compensates for them.
 *
 *   recommended    — India-eligible, pay verified ≥ target, score ≥ recommendedMinScore
 *   review         — India-eligible, pay not disclosed for India, score ≥ reviewQueueMinScore
 *   location_check — eligibility ambiguous (APAC / worldwide / bare remote), score ≥ locationCheckMinScore
 *   excluded       — everything else, with the reasons recorded
 */
import type { ProfileConfig } from '../config.js';
import type { Job } from '../schema.js';

export function decideFeed(
  j: Pick<Job, 'location' | 'compensation' | 'fit' | 'suppressed' | 'postedAt' | 'firstSeenAt'>,
  t: ProfileConfig['thresholds'],
): { feed: Job['feed']; reasons: string[] } {
  const reasons: string[] = [];
  if (j.suppressed) reasons.push('Already applied to or dismissed (imported list)');
  if (j.location.india === 'ineligible') reasons.push(`Location: ${j.location.reason}`);
  if (j.compensation.status === 'below_target') reasons.push(`Pay below target: ${j.compensation.display}`);
  if (j.fit.score < t.recommendedMinScore) reasons.push(`Fit score ${j.fit.score} < ${t.recommendedMinScore}`);
  if (j.postedAt) {
    const ageAtDiscovery = (Date.parse(j.firstSeenAt) - Date.parse(j.postedAt)) / 86_400_000;
    if (ageAtDiscovery > t.maxPostingAgeDays) reasons.push(`Posted ${Math.round(ageAtDiscovery)} days before discovery (likely stale/evergreen)`);
  }
  if (reasons.length) return { feed: 'excluded', reasons };

  if (j.location.india === 'verification_required') {
    if (j.fit.score >= t.locationCheckMinScore) return { feed: 'location_check', reasons: [j.location.reason] };
    return { feed: 'excluded', reasons: [`${j.location.reason}; fit ${j.fit.score} below location-check threshold ${t.locationCheckMinScore}`] };
  }
  if (j.compensation.status === 'verified') return { feed: 'recommended', reasons: ['India-eligible, pay verified at or above target'] };
  if (j.fit.score >= t.reviewQueueMinScore) return { feed: 'review', reasons: ['India-eligible; pay not disclosed for India — verify with recruiter'] };
  return { feed: 'excluded', reasons: [`Pay unverified and fit ${j.fit.score} below review threshold ${t.reviewQueueMinScore}`] };
}
