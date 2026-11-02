/** Daily FX (INR per unit of foreign currency), dated. Falls back to the last stored rates on failure. */
import { z } from 'zod';
import type { FxFile } from './schema.js';
import { fetchJson } from './util/http.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'CHF', 'JPY'];

export async function refreshFx(prev: FxFile): Promise<{ fx: FxFile; error: string | null }> {
  // Frankfurter publishes European Central Bank reference rates (no key needed).
  try {
    const r = z
      .object({ date: z.string(), rates: z.record(z.string(), z.number()) })
      .parse(await fetchJson(`https://api.frankfurter.dev/v1/latest?base=INR&symbols=${CURRENCIES.join(',')}`));
    const rates = Object.fromEntries(Object.entries(r.rates).map(([k, v]) => [k, Math.round((1 / v) * 10000) / 10000]));
    return { fx: { schemaVersion: 1, base: 'INR', date: r.date, source: 'ECB reference rates via frankfurter.dev', rates }, error: null };
  } catch (e1) {
    try {
      const r = z
        .object({ time_last_update_utc: z.string(), rates: z.record(z.string(), z.number()) })
        .parse(await fetchJson('https://open.er-api.com/v6/latest/INR'));
      const rates = Object.fromEntries(CURRENCIES.filter((c) => r.rates[c]).map((c) => [c, Math.round((1 / r.rates[c]) * 10000) / 10000]));
      const date = new Date(r.time_last_update_utc).toISOString().slice(0, 10);
      return { fx: { schemaVersion: 1, base: 'INR', date, source: 'open.er-api.com', rates }, error: null };
    } catch (e2) {
      return { fx: prev, error: `FX refresh failed (${(e1 as Error).message}; ${(e2 as Error).message}); using rates dated ${prev.date ?? 'never'}` };
    }
  }
}
