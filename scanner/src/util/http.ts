/**
 * HTTP with timeouts, bounded retries (429/5xx/network only), per-host pacing and a fixture mode.
 * Fixture mode (JOB_RADAR_FIXTURES=<dir>) serves responses from <dir>/index.json so the whole
 * pipeline can be exercised offline and deterministically in tests and CI.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class HttpError extends Error {
  constructor(public status: number, public url: string, message?: string) {
    super(message ?? `HTTP ${status} for ${url}`);
  }
}

const USER_AGENT = process.env.JOB_RADAR_UA ?? 'job-radar/1.0 (personal job search; contact via GitHub repo)';
const lastHit = new Map<string, number>();
const MIN_GAP_MS = Number(process.env.JOB_RADAR_MIN_GAP_MS ?? 300);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fixtureIndexes = new Map<string, Record<string, { file?: string; status?: number }>>();
function fixture(url: string): { status: number; body: string } | null {
  const dir = process.env.JOB_RADAR_FIXTURES;
  if (!dir) return null;
  if (!fixtureIndexes.has(dir)) fixtureIndexes.set(dir, JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
  const fixtureIndex = fixtureIndexes.get(dir)!;
  const entry = fixtureIndex[url];
  if (!entry) return { status: 404, body: '' };
  if (entry.status && entry.status !== 200) return { status: entry.status, body: '' };
  return { status: 200, body: readFileSync(join(dir, entry.file!), 'utf8') };
}

export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const fx = fixture(url);
  if (fx) {
    if (fx.status !== 200) throw new HttpError(fx.status, url);
    return fx.body;
  }
  const { method = 'GET', body, headers = {}, timeoutMs = 20_000, retries = 2 } = opts;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    const wait = (lastHit.get(host) ?? 0) + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const res = await fetch(url, {
        method,
        headers: { 'user-agent': USER_AGENT, accept: 'application/json, text/plain, */*', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) throw new HttpError(res.status, url);
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.min(30_000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500 * 2 ** attempt));
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (attempt >= retries) throw new Error(`Network error for ${url}: ${(e as Error).message}`);
      await sleep(1500 * 2 ** attempt);
    }
    attempt++;
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}

/** Run tasks with bounded concurrency; never rejects — each result is ok/error. */
export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<({ ok: true; value: R; item: T } | { ok: false; error: Error; item: T })[]> {
  const out: ({ ok: true; value: R; item: T } | { ok: false; error: Error; item: T })[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try {
          out[k] = { ok: true, value: await fn(items[k]), item: items[k] };
        } catch (e) {
          out[k] = { ok: false, error: e as Error, item: items[k] };
        }
      }
    }),
  );
  return out;
}
