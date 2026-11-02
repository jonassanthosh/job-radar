/** `npm run validate` — schema-check every data file plus cross-file invariants. Used in CI before deploy. */
import { readData } from './store.js';

const errors: string[] = [];
const jobs = readData('jobs').jobs;
readData('boards');
readData('runs');
readData('contacts');
readData('fx');
readData('suppress');

const ids = new Set<string>();
const urls = new Map<string, string>();
for (const j of jobs) {
  if (ids.has(j.id)) errors.push(`duplicate job id ${j.id}`);
  ids.add(j.id);
  const u = urls.get(j.keys.canonicalUrl);
  if (u) errors.push(`duplicate canonical URL ${j.keys.canonicalUrl} (${u}, ${j.id})`);
  urls.set(j.keys.canonicalUrl, j.id);
  // No claims without evidence:
  if (j.location.india === 'eligible' && !j.location.evidence) errors.push(`${j.id}: eligible without location evidence`);
  if (j.compensation.status !== 'unverified' && !j.compensation.sourceUrl) errors.push(`${j.id}: ${j.compensation.status} pay without source URL`);
  if (j.feed === 'recommended' && (j.location.india !== 'eligible' || j.compensation.status !== 'verified')) errors.push(`${j.id}: recommended without eligibility + verified pay`);
  for (const c of j.contacts) if (!c.sourceUrl) errors.push(`${j.id}: contact ${c.name} without source`);
  if (Date.parse(j.firstSeenAt) > Date.parse(j.lastCheckedAt)) errors.push(`${j.id}: firstSeenAt after lastCheckedAt`);
}

if (errors.length) {
  console.error(`Validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Data valid: ${jobs.length} jobs.`);
