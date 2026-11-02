/**
 * Daily scan. `npm run scan`
 *
 *  1. Refresh FX            4. Classify: role → location → pay → fit → contacts → feed
 *  2. Discover new boards   5. Merge into history (dedup, change audit, status transitions)
 *  3. Scan every board      6. Validate + write data/*.json, append run record, print summary
 *
 * A failing source never aborts the run; it is recorded in runs.json and its jobs are marked
 * `verification_failed`, never `closed`. The process exits non-zero only on a bug or invalid data.
 */
import { appendFileSync } from 'node:fs';
import { loadConfig } from './config.js';
import { refreshFx } from './fx.js';
import { contactSearchLinks, extractPostingContacts, mergeContacts } from './rules/contacts.js';
import { buildIndex, findExisting, postingCanonicalUrl, jobId, suppressKeysFor, type MatchVia } from './rules/dedup.js';
import { decideFeed } from './rules/feed.js';
import { classifyLocation } from './rules/location.js';
import { makeRoleRules, normalizeTitle } from './rules/role.js';
import { classifyCompensation } from './rules/salary.js';
import { makeScorer } from './rules/score.js';
import { applyObservation } from './rules/status.js';
import type { Board, Job, Run, SourceFailure } from './schema.js';
import { ashby } from './sources/ashby.js';
import { discover, slugCandidates } from './sources/discovery.js';
import { greenhouse } from './sources/greenhouse.js';
import { lever } from './sources/lever.js';
import type { BoardListing, Posting, SourceAdapter } from './sources/types.js';
import { workday } from './sources/workday.js';
import { readData, writeData } from './store.js';
import { HttpError, pool } from './util/http.js';
import { compileAll, fingerprint, slugify } from './util/text.js';

const ADAPTERS: Record<Board['ats'], SourceAdapter> = { greenhouse, lever, ashby, workday };
const MAX_PROBES = Number(process.env.JOB_RADAR_MAX_PROBES ?? 25);
const CONCURRENCY = Number(process.env.JOB_RADAR_CONCURRENCY ?? 4);

export function nextRunAfter(d: Date): string {
  // 07:00 IST = 01:30 UTC
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 1, 30));
  if (n <= d) n.setUTCDate(n.getUTCDate() + 1);
  return n.toISOString();
}

export async function runScan(now = new Date()): Promise<Run> {
  const at = now.toISOString();
  const today = at.slice(0, 10);
  const fixtures = !!process.env.JOB_RADAR_FIXTURES;
  const cfg = loadConfig();
  const t = cfg.profile.thresholds;
  const role = makeRoleRules(cfg.search);
  const scorer = makeScorer(cfg.profile, cfg.search);
  const excludedCompany = compileAll(cfg.search.excludedCompanies);
  const isExcludedCompany = (name: string) => excludedCompany.some((r) => r.test(name));
  const titleFilter = (title: string) => role.classifyTitle(title).include;

  const jobsFile = readData('jobs');
  const boardsFile = readData('boards');
  const runsFile = readData('runs');
  const contactsFile = readData('contacts');
  const suppress = new Set(readData('suppress').hashes);
  const mode: Run['mode'] = fixtures ? 'fixtures' : jobsFile.jobs.length === 0 ? 'initial' : 'incremental';
  const failures: SourceFailure[] = [];
  const log = (...a: unknown[]) => console.log(`[scan]`, ...a);

  // 1. FX ------------------------------------------------------------------------------------
  const { fx, error: fxError } = await refreshFx(readData('fx'));
  if (fxError) failures.push({ source: 'fx', error: fxError });
  log(`FX ${fx.date ?? 'unavailable'} USD=${fx.rates.USD ?? '?'} INR`);

  // 2. Discovery -----------------------------------------------------------------------------
  const boardKey = (ats: string, slug: string) => `${ats}:${slug.toLowerCase()}`;
  const known = new Map(boardsFile.boards.map((b) => [boardKey(b.ats, b.slug), b]));
  let newBoards = 0;
  const addBoard = (ats: Board['ats'], slug: string, company: string, via: string) => {
    if (known.has(boardKey(ats, slug)) || isExcludedCompany(company) || isExcludedCompany(slug)) return false;
    const b: Board = {
      ats, slug: slug.toLowerCase(), company, workday: null, origin: 'discovered', discoveredVia: via, discoveredAt: at,
      lastScannedAt: null, lastOkAt: null, consecutiveFailures: 0, disabled: false, disabledReason: null, relevantSeen: 0, companyInfo: null,
    };
    boardsFile.boards.push(b);
    known.set(boardKey(ats, slug), b);
    newBoards++;
    return true;
  };

  if (process.env.JOB_RADAR_SKIP_DISCOVERY !== '1') {
    const d = await discover(cfg.search, titleFilter);
    failures.push(...d.failures);
    for (const b of d.boards) addBoard(b.ats, b.slug, b.company ?? b.slug, b.via);
    const knownNames = new Set(boardsFile.boards.map((b) => slugify(b.company)));
    const probeCutoff = now.getTime() - 30 * 86_400_000;
    const toProbe = d.companies
      .filter((c) => !isExcludedCompany(c.name) && !knownNames.has(slugify(c.name)))
      .filter((c) => Date.parse(boardsFile.probed[c.name.toLowerCase()] ?? '1970-01-01T00:00:00Z') < probeCutoff)
      .slice(0, MAX_PROBES);
    for (const c of toProbe) {
      boardsFile.probed[c.name.toLowerCase()] = at;
      found: for (const slug of slugCandidates(c.name)) {
        for (const adapter of [greenhouse, ashby, lever]) {
          try {
            const p = await adapter.probe(slug);
            if (!p.exists) continue;
            // Only accept the board if it really lists a matching role — guards against same-slug different companies.
            const tmp = { ats: adapter.ats, slug, company: p.company ?? c.name, workday: null } as Board;
            const listing = await adapter.list(tmp, cfg.search, titleFilter);
            if (listing.postings.length > 0 && addBoard(adapter.ats, slug, p.company ?? c.name, `${c.via} → ATS probe`)) break found;
          } catch {
            /* probing is best-effort */
          }
        }
      }
    }
    log(`discovery: ${d.boards.length} board links, ${toProbe.length} companies probed, ${newBoards} new boards`);
  }

  // 3. Scan boards ---------------------------------------------------------------------------
  const active = boardsFile.boards.filter((b) => !b.disabled);
  const results = await pool(active, CONCURRENCY, async (b): Promise<BoardListing> => {
    const adapter = ADAPTERS[b.ats];
    const listing = await adapter.list(b, cfg.search, titleFilter);
    const postings: Posting[] = [];
    for (const p of listing.postings) postings.push(adapter.enrich ? await adapter.enrich(p) : p);
    return { ...listing, postings };
  });
  const boardResult = new Map<string, { ok: true; listing: BoardListing } | { ok: false; error: Error }>();
  let examined = 0;
  for (const r of results) {
    const b = r.item;
    b.lastScannedAt = at;
    if (r.ok) {
      b.lastOkAt = at;
      b.consecutiveFailures = 0;
      if (b.company === b.slug && r.value.company) b.company = r.value.company;
      examined += r.value.examined;
      boardResult.set(boardKey(b.ats, b.slug), { ok: true, listing: r.value });
    } else {
      b.consecutiveFailures++;
      failures.push({ source: `${b.ats}:${b.slug}`, error: r.error.message.slice(0, 300) });
      boardResult.set(boardKey(b.ats, b.slug), { ok: false, error: r.error });
      if (r.error instanceof HttpError && r.error.status === 404 && b.consecutiveFailures >= 3) {
        b.disabled = true;
        b.disabledReason = `Board returned 404 on ${b.consecutiveFailures} consecutive runs`;
      }
    }
  }
  const boardsFailed = results.filter((r) => !r.ok).length;
  log(`scanned ${active.length} boards (${boardsFailed} failed), ${examined} postings examined`);

  // 4+5. Classify and merge ------------------------------------------------------------------
  const jobs = new Map(jobsFile.jobs.map((j) => [j.id, j]));
  const idx = buildIndex(jobsFile.jobs);
  const allPostings = [...boardResult.values()].flatMap((r) => (r.ok ? r.listing.postings : []));

  // Pass 1: which existing records are directly live this run (so re-post detection never steals a live record).
  const liveIds = new Set<string>();
  for (const p of allPostings) {
    const id = jobId(p.ats, p.board, p.atsId);
    const m = findExisting(idx, { id, canonicalUrl: postingCanonicalUrl(p.ats, p.board, p.atsId, p.officialUrl), company: p.company, title: p.title, location: p.locationText, reqId: p.reqId, fingerprint: '\u0000' }, new Set(jobs.keys()));
    if (m) liveIds.add(m.job.id);
  }

  const touched = new Set<string>();
  const createdThisRun = new Set<string>();
  const runKeys = new Map<string, string>(); // canonical url / req key -> job id (within-run dedup)
  let candidates = 0, newJobs = 0, updated = 0, dupes = 0, suppressedCount = 0;
  const curated = contactsFile.contacts;

  for (const p of allPostings) {
    if (isExcludedCompany(p.company)) continue;
    candidates++;
    const id = jobId(p.ats, p.board, p.atsId);
    const canon = postingCanonicalUrl(p.ats, p.board, p.atsId, p.officialUrl);
    const fp = fingerprint(p.description);

    // Within-run duplicates (same job reachable from two boards / alternate URLs)
    const runKey = [canon, p.reqId ? `${slugify(p.company)}|${normalizeTitle(p.title)}|${p.reqId}` : null].filter(Boolean) as string[];
    const dupOf = runKeys.get(id) ?? runKey.map((k) => runKeys.get(k)).find(Boolean);
    if (dupOf) {
      dupes++;
      const j = jobs.get(dupOf)!;
      const src = `${p.ats}:${p.board}`;
      if (!j.discoverySources.includes(src)) jobs.set(dupOf, { ...j, discoverySources: [...j.discoverySources, src] });
      continue;
    }

    const match = findExisting(idx, { id, canonicalUrl: canon, company: p.company, title: p.title, location: p.locationText, reqId: p.reqId, fingerprint: fp }, liveIds);
    const existing = match ? jobs.get(match.job.id) ?? match.job : null;

    const rv = role.classifyRole(p.title, p.description);
    const location = classifyLocation({ locationText: p.locationText, workplaceType: p.workplaceType, isRemote: p.isRemote, description: p.description, url: p.officialUrl });
    // New postings that are clearly irrelevant or not open to India are not stored (keeps history meaningful).
    if (!existing && (!rv.include || location.india === 'ineligible')) continue;

    const compensation = classifyCompensation({ ranges: p.ranges, description: p.description, sourceUrl: p.officialUrl, fx, minAnnualInr: cfg.profile.compensation.minAnnualInr });
    const family = rv.family ?? existing?.jobFamily ?? 'technical_support';
    const { yearsRequired, ...fit } = scorer.score({ title: p.title, company: p.company, family, description: p.description, responsibilityGroups: rv.responsibilityGroups, groupLabel: role.groupLabel });
    const board = known.get(boardKey(p.ats, p.board));
    const finalId = existing?.id ?? id;
    const postingContacts = extractPostingContacts(p.description, p.company, p.officialUrl, today);

    const fresh: Job = {
      id: finalId,
      keys: { ats: p.ats, board: p.board, atsId: p.atsId, canonicalUrl: canon, reqId: p.reqId },
      company: p.company,
      companyInfo: board?.companyInfo ?? existing?.companyInfo ?? { hq: null, international: null, source: null },
      title: p.title,
      normalizedTitle: normalizeTitle(p.title),
      jobFamily: family,
      employmentType: p.employmentType,
      location,
      postedAt: p.postedAt,
      firstSeenAt: existing?.firstSeenAt ?? at,
      lastCheckedAt: at,
      lastVerifiedAt: at,
      lastModifiedAt: existing?.lastModifiedAt ?? at,
      status: existing?.status ?? 'active',
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      descriptionFingerprint: fp,
      techStack: scorer.techStack(p.description),
      yearsRequired,
      compensation,
      fit,
      feed: existing?.feed ?? 'excluded',
      feedReasons: [],
      officialUrl: p.officialUrl,
      applyUrl: p.applyUrl,
      discoverySources: [...new Set([...(existing?.discoverySources ?? []), `${p.ats}:${p.board}`, ...(board && board.origin === 'discovered' ? [board.discoveredVia] : [])])],
      contacts: mergeContacts({ id: finalId, company: p.company }, postingContacts, curated, today, t.contactStaleDays),
      contactSearchLinks: contactSearchLinks(p.company),
      notes: [
        ...(!rv.include ? [`Role no longer matches: ${rv.reason}`] : []),
        ...(p.postedAt ? [] : ['Posting date not published by the ATS']),
      ],
      suppressed: false,
      repostOf: existing?.repostOf ?? null,
      history: existing?.history ?? [{ at, type: 'created', from: null, to: 'active', reason: `Discovered on ${p.ats}:${p.board}` }],
    };
    fresh.suppressed = (existing?.suppressed ?? false) || suppressKeysFor(fresh).some((h) => suppress.has(h));
    if (fresh.suppressed) suppressedCount++;

    let job = fresh;
    if (existing) {
      const changes: Job['history'] = [];
      if (match!.via === 'repost') changes.push({ at, type: 'reposted', from: existing.keys.canonicalUrl, to: canon, reason: 'Same role re-posted under a new ATS id; folded into the original record' });
      if (existing.descriptionFingerprint !== fp) changes.push({ at, type: 'description', from: existing.descriptionFingerprint, to: fp, reason: 'Job description changed' });
      if (existing.compensation.display !== compensation.display) changes.push({ at, type: 'compensation', from: existing.compensation.display, to: compensation.display, reason: 'Compensation information changed' });
      if (existing.location.raw !== location.raw || existing.location.india !== location.india) changes.push({ at, type: 'location', from: `${existing.location.raw} [${existing.location.india}]`, to: `${location.raw} [${location.india}]`, reason: 'Location / eligibility changed' });
      job = { ...fresh, history: [...existing.history, ...changes], lastModifiedAt: changes.length ? at : existing.lastModifiedAt, repostOf: match!.via === 'repost' ? existing.keys.canonicalUrl : fresh.repostOf };
      if (changes.length) updated++;
    } else {
      newJobs++;
      createdThisRun.add(finalId);
    }
    job = applyObservation(job, { kind: 'seen' }, at);
    if (!rv.include) job.feedReasons = [`Role check: ${rv.reason}`];
    jobs.set(finalId, job);
    touched.add(finalId);
    runKeys.set(id, finalId);
    for (const k of runKey) runKeys.set(k, finalId);
    if (board && rv.include) board.relevantSeen++;
  }

  // Jobs not seen this run: closed, or verification failed, depending on why.
  let closed = 0, verificationFailed = 0, reopened = 0;
  for (const [id, j] of jobs) {
    if (touched.has(id)) {
      if (j.history.at(-1)?.reason.includes('reopened') && j.history.at(-1)?.at === at) reopened++;
      continue;
    }
    if (j.status === 'closed') continue;
    const b = known.get(boardKey(j.keys.ats, j.keys.board));
    const r = boardResult.get(boardKey(j.keys.ats, j.keys.board));
    let next = j;
    if (!b) continue;
    if (b.disabled) next = applyObservation(j, { kind: 'absent', reason: `Board unavailable: ${b.disabledReason}` }, at);
    else if (!r) continue;
    else if (!r.ok) next = applyObservation(j, { kind: 'fetch_failed', error: r.error.message }, at);
    else if (r.listing.complete) next = applyObservation(j, { kind: 'absent' }, at);
    else {
      try {
        const open = await ADAPTERS[b.ats].isOpen!(b, j.keys.atsId, j.officialUrl);
        next = applyObservation(j, open ? { kind: 'seen' } : { kind: 'absent', reason: 'Posting no longer accepts applications' }, at);
      } catch (e) {
        next = applyObservation(j, { kind: 'fetch_failed', error: (e as Error).message }, at);
      }
    }
    if (next.status === 'closed') closed++;
    if (next.status === 'verification_failed') verificationFailed++;
    jobs.set(id, next);
  }

  // Feeds + contacts for every record (thresholds or curated contacts may have changed).
  let newQualified = 0;
  for (const [id, j] of jobs) {
    const keepReasons = j.feedReasons.filter((r) => r.startsWith('Role check:'));
    let { feed, reasons } = decideFeed(j, t);
    if (keepReasons.length) { feed = 'excluded'; reasons = [...keepReasons, ...reasons]; }
    const postingContacts = j.contacts.filter((c) => c.sourceUrl === j.officialUrl);
    const contacts = mergeContacts(j, postingContacts, curated, today, t.contactStaleDays);
    const history = j.feed !== feed && !createdThisRun.has(id) ? [...j.history, { at, type: 'feed' as const, from: j.feed, to: feed, reason: reasons.join('; ') || 'Feed recalculated' }] : j.history;
    jobs.set(id, { ...j, feed, feedReasons: reasons, contacts, history });
    if (createdThisRun.has(id) && feed !== 'excluded') newQualified++;
  }

  // 6. Persist -------------------------------------------------------------------------------
  const FEED_ORDER = { recommended: 0, review: 1, location_check: 2, excluded: 3 } as const;
  const STATUS_ORDER = { active: 0, verification_failed: 1, closed: 2 } as const;
  const sorted = [...jobs.values()].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || FEED_ORDER[a.feed] - FEED_ORDER[b.feed] || b.fit.score - a.fit.score || a.id.localeCompare(b.id));

  const run: Run = {
    id: at, mode, startedAt: at, finishedAt: new Date().toISOString(),
    ok: active.length === 0 || boardsFailed < active.length,
    boardsScanned: active.length, boardsFailed, postingsExamined: examined, candidatesAfterTitleFilter: candidates,
    newJobs, newQualified, updatedJobs: updated, closedJobs: closed, reopenedJobs: reopened, verificationFailed,
    duplicatesDiscarded: dupes, suppressedByImport: suppressedCount, newBoardsDiscovered: newBoards,
    sourceFailures: failures, fxDate: fx.date, nextScheduledAt: nextRunAfter(now),
  };

  writeData('jobs', { schemaVersion: 1, updatedAt: at, jobs: sorted });
  writeData('boards', boardsFile);
  writeData('fx', fx);
  writeData('runs', { schemaVersion: 1, runs: [...runsFile.runs, run].slice(-120) });
  return run;
}

function summary(run: Run): string {
  const lines = [
    `## Job Radar scan — ${run.mode} — ${run.ok ? '✅ ok' : '⚠️ degraded'}`,
    '',
    `| Metric | Value |`, `|---|---|`,
    `| Boards scanned / failed | ${run.boardsScanned} / ${run.boardsFailed} |`,
    `| Postings examined | ${run.postingsExamined} |`,
    `| Title-matched candidates | ${run.candidatesAfterTitleFilter} |`,
    `| New jobs stored / newly qualified | ${run.newJobs} / ${run.newQualified} |`,
    `| Updated · closed · reopened | ${run.updatedJobs} · ${run.closedJobs} · ${run.reopenedJobs} |`,
    `| Verification failed | ${run.verificationFailed} |`,
    `| Duplicates discarded | ${run.duplicatesDiscarded} |`,
    `| New boards discovered | ${run.newBoardsDiscovered} |`,
    `| FX date | ${run.fxDate ?? 'n/a'} |`,
    `| Next scheduled | ${run.nextScheduledAt} |`,
  ];
  if (run.sourceFailures.length) {
    lines.push('', `### Source failures (${run.sourceFailures.length})`, '', ...run.sourceFailures.slice(0, 40).map((f) => `- \`${f.source}\`: ${f.error.replace(/\n/g, ' ')}`));
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScan()
    .then((run) => {
      const s = summary(run);
      console.log(s);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n');
    })
    .catch((e) => {
      console.error('[scan] FATAL', e);
      process.exit(1);
    });
}
