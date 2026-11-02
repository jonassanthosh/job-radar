// Copies the public data files into the static site. suppressed.json and contacts.json are not published
// (contacts are already embedded in jobs; the suppression hashes have no use in the browser).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = process.env.JOB_RADAR_DATA ?? join(root, 'data');
const out = join(root, 'web', 'public', 'data');
mkdirSync(out, { recursive: true });
const empty = { 'agent-leads.json': { schemaVersion: 1, leads: [], runs: [] }, 'jobs.json': { schemaVersion: 1, updatedAt: null, jobs: [] }, 'runs.json': { schemaVersion: 1, runs: [] }, 'fx.json': { schemaVersion: 1, base: 'INR', date: null, source: 'none', rates: {} } };
for (const f of Object.keys(empty)) {
  const p = join(src, f);
  if (existsSync(p)) copyFileSync(p, join(out, f));
  else writeFileSync(join(out, f), JSON.stringify(empty[f]));
}
console.log(`copied data from ${src}`);
