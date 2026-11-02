/** Validated, atomic JSON persistence for /data. Invalid data aborts the run instead of being written. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod';
import { BoardsFile, ContactsFile, FxFile, JobsFile, RunsFile, SuppressFile } from './schema.js';

export const DATA_DIR = process.env.JOB_RADAR_DATA ?? join(process.cwd(), 'data');

const FILES = {
  jobs: { file: 'jobs.json', schema: JobsFile, empty: { schemaVersion: 1, updatedAt: null, jobs: [] } },
  boards: { file: 'boards.json', schema: BoardsFile, empty: { schemaVersion: 1, boards: [], probed: {} } },
  runs: { file: 'runs.json', schema: RunsFile, empty: { schemaVersion: 1, runs: [] } },
  contacts: { file: 'contacts.json', schema: ContactsFile, empty: { schemaVersion: 1, contacts: [] } },
  fx: { file: 'fx.json', schema: FxFile, empty: { schemaVersion: 1, base: 'INR', date: null, source: 'none', rates: {} } },
  suppress: { file: 'suppressed.json', schema: SuppressFile, empty: { schemaVersion: 1, hashes: [] } },
} as const;

type Files = typeof FILES;
export type FileKey = keyof Files;
type Out<K extends FileKey> = z.infer<Files[K]['schema']>;

export function readData<K extends FileKey>(key: K, dir = DATA_DIR): Out<K> {
  const { file, schema, empty } = FILES[key];
  const p = join(dir, file);
  const raw = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : empty;
  const parsed = (schema as z.ZodTypeAny).safeParse(raw);
  if (!parsed.success) {
    throw new Error(`data/${file} failed schema validation:\n${parsed.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data as Out<K>;
}

export function writeData<K extends FileKey>(key: K, value: Out<K>, dir = DATA_DIR): void {
  const { file, schema } = FILES[key];
  const parsed = (schema as z.ZodTypeAny).safeParse(value);
  if (!parsed.success) {
    throw new Error(`Refusing to write invalid data/${file}:\n${parsed.error.issues.slice(0, 10).map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const p = join(dir, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(parsed.data, null, 2) + '\n');
  renameSync(`${p}.tmp`, p);
}
