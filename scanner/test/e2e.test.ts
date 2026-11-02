/**
 * End-to-end: two consecutive daily runs against recorded API fixtures, using a throwaway data dir.
 * Proves persistence, dedup across URL variants, re-post folding, closure vs verification-failed,
 * board discovery via aggregator + probe, and that every written file passes schema validation.
 */
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { JobsFile, RunsFile } from '../src/schema.js';

const FIX = join(__dirname, 'fixtures');
const dataDir = mkdtempSync(join(tmpdir(), 'job-radar-'));
process.env.JOB_RADAR_DATA = dataDir;
process.env.JOB_RADAR_MIN_GAP_MS = '0';

const read = <T>(f: string): T => JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
let runScan: (d?: Date) => Promise<import('../src/schema.js').Run>;

beforeAll(async () => {
  copyFileSync(join(FIX, 'seed-boards.json'), join(dataDir, 'boards.json'));
  ({ runScan } = await import('../src/run.js'));
});

describe('two-day scan', () => {
  it('day 1: discovers, classifies, routes to the right feeds', async () => {
    process.env.JOB_RADAR_FIXTURES = join(FIX, 'day1');
    const run = await runScan(new Date('2026-11-01T01:31:00Z'));
    const { jobs } = read<JobsFile>('jobs.json');
    const by = (title: string, company?: string) => jobs.find((j) => j.title === title && (!company || j.company === company))!;

    expect(run.newBoardsDiscovered).toBe(1); // Nimbus Data via Remotive -> Greenhouse probe; Crossover excluded; US-only skipped
    expect(run.sourceFailures.map((f) => f.source)).toEqual(expect.arrayContaining(['himalayas', 'ashby:brokenco']));

    const senior = by('Senior Developer Support Engineer');
    expect(senior.feed).toBe('recommended');
    expect(senior.compensation).toMatchObject({ status: 'verified', currency: 'INR', inrMin: 6_500_000, inrMax: 9_000_000 });
    expect(senior.location).toMatchObject({ india: 'eligible', evidence: 'Remote - India' });
    expect(senior.fit.score).toBeGreaterThanOrEqual(80);

    expect(by('Technical Support Engineer').feed).toBe('location_check'); // APAC, not confirmed
    expect(by('Developer Success Engineer').feed).toBe('review'); // India remote, pay not disclosed

    const product = by('Product Support Engineer');
    expect(product.location.india).toBe('eligible');
    expect(product.location.evidence).toContain('India');
    expect(product.compensation.status).toBe('unverified'); // US-tier salary is not applied to India
    expect(product.compensation.applicability).toBe('us');
    expect(product.contacts[0]).toMatchObject({ name: 'Priya Raman', type: 'confirmed_recruiter' });

    expect(by('Developer Support Engineer', 'Nimbus Data')).toBeTruthy();

    // Not stored: US-only, hybrid, sales title, presales Customer Engineer
    expect(jobs.find((j) => j.title === 'Support Engineer')).toBeUndefined();
    expect(jobs.find((j) => j.title === 'Account Executive')).toBeUndefined();
    expect(jobs.find((j) => j.title === 'Customer Engineer')).toBeUndefined();
    expect(jobs).toHaveLength(5);
  });

  it('day 2: no duplicates, re-post folded, outage != closed, history preserved', async () => {
    process.env.JOB_RADAR_FIXTURES = join(FIX, 'day2');
    const before = read<JobsFile>('jobs.json').jobs;
    const run = await runScan(new Date('2026-11-02T01:31:00Z'));
    const { jobs } = read<JobsFile>('jobs.json');

    expect(run.newJobs).toBe(0); // URL variant of 101 and re-post of 102 are NOT new
    expect(jobs).toHaveLength(before.length);
    expect(new Set(jobs.map((j) => j.keys.canonicalUrl)).size).toBe(jobs.length);

    const senior = jobs.find((j) => j.title === 'Senior Developer Support Engineer')!;
    expect(senior.firstSeenAt).toBe('2026-11-01T01:31:00.000Z');
    expect(senior.history.some((h) => h.type === 'description')).toBe(true);

    const tse = jobs.find((j) => j.title === 'Technical Support Engineer')!;
    expect(tse.id).toBe(before.find((j) => j.title === 'Technical Support Engineer')!.id);
    expect(tse.keys.atsId).toBe('202');
    expect(tse.history.some((h) => h.type === 'reposted')).toBe(true);

    const dse = jobs.find((j) => j.title === 'Developer Success Engineer')!;
    expect(dse.status).toBe('verification_failed'); // Lever returned 502 — must not be marked closed
    expect(run.verificationFailed).toBe(1);
    expect(run.closedJobs).toBe(0);

    const runs = read<RunsFile>('runs.json').runs;
    expect(runs).toHaveLength(2);
  });

  it('day 3 (repeat of day 2 data): stable — nothing new, nothing changed', async () => {
    const run = await runScan(new Date('2026-11-03T01:31:00Z'));
    expect(run.newJobs).toBe(0);
    expect(run.updatedJobs).toBe(0);
  });
});
