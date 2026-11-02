/**
 * Import jobs you already applied to / rejected / dismissed so they are never shown as new.
 *
 *   npm run import -- path/to/applied.csv      (columns: url, company, title — any order, header row required)
 *   npm run import -- path/to/applied.json     ([{ "url": "...", "company": "...", "title": "..." }] or a dashboard export)
 *
 * Only one-way SHA-256 hashes of the canonical URL (or company+title when there is no URL) are written
 * to data/suppressed.json, so a public repository does not list where you applied.
 */
import { readFileSync } from 'node:fs';
import { canonicalUrl, parseAtsUrl, suppressHash, suppressKeysFor } from './rules/dedup.js';
import { normalizeTitle } from './rules/role.js';
import { readData, writeData } from './store.js';
import { slugify } from './util/text.js';

interface Row { url?: string; company?: string; title?: string }

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(field); field = '';
      if (cur.some((x) => x.trim())) rows.push(cur);
      cur = [];
    } else field += c;
  }
  cur.push(field);
  if (cur.some((x) => x.trim())) rows.push(cur);
  const [header, ...body] = rows;
  const h = header.map((x) => x.trim().toLowerCase());
  const col = (names: string[]) => h.findIndex((x) => names.includes(x));
  const iu = col(['url', 'link', 'job url', 'job_url', 'applyurl', 'apply url']);
  const ic = col(['company', 'employer', 'company name']);
  const it = col(['title', 'job title', 'role', 'position']);
  return body.map((r) => ({ url: iu >= 0 ? r[iu]?.trim() : undefined, company: ic >= 0 ? r[ic]?.trim() : undefined, title: it >= 0 ? r[it]?.trim() : undefined }));
}

export function hashesFor(row: Row): string[] {
  const out: string[] = [];
  if (row.url) {
    try {
      out.push(suppressHash(`url:${canonicalUrl(row.url)}`));
      const ref = parseAtsUrl(row.url);
      if (ref?.board && ref.id) out.push(suppressHash(`ats:${ref.ats}:${ref.board}:${ref.id}`));
    } catch { /* not a URL */ }
  }
  if (!out.length && row.company && row.title) out.push(suppressHash(`ct:${slugify(row.company)}|${normalizeTitle(row.title)}`));
  return out;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run import -- <file.csv|file.json>');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  let rows: Row[];
  if (file.endsWith('.json')) {
    const data = JSON.parse(text);
    // Accept a plain array, or a dashboard tracker export { applications: { [jobId]: { status, url, company, title } } }
    rows = Array.isArray(data) ? data : Object.values((data.applications ?? {}) as Record<string, Row & { status?: string }>).filter((a) => a.status && a.status !== 'new' && a.status !== 'saved');
  } else rows = parseCsv(text);

  const current = readData('suppress');
  const set = new Set(current.hashes);
  let added = 0, skipped = 0;
  for (const r of rows) {
    const hs = hashesFor(r);
    if (!hs.length) { skipped++; continue; }
    for (const h of hs) if (!set.has(h)) { set.add(h); added++; }
  }
  writeData('suppress', { schemaVersion: 1, hashes: [...set].sort() });

  // Apply immediately to stored jobs so the next dashboard build reflects it.
  const jobs = readData('jobs');
  let flagged = 0;
  for (const j of jobs.jobs) {
    if (!j.suppressed && suppressKeysFor(j).some((h) => set.has(h))) {
      j.suppressed = true;
      j.feed = 'excluded';
      j.feedReasons = ['Already applied to or dismissed (imported list)'];
      flagged++;
    }
  }
  writeData('jobs', jobs);
  console.log(`Imported ${rows.length} rows: ${added} new hashes, ${skipped} rows without url or company+title. ${flagged} stored jobs now hidden from feeds.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
