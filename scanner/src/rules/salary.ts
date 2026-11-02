/**
 * Deterministic compensation classifier.
 *
 * A range counts as evidence for an India hire only if it is in INR, mentions India, or the posting
 * says pay is location-independent. A USD range with US geography or no stated geography is NEVER
 * assumed to apply to India — it is recorded but classified `unverified`.
 */
import type { Compensation, FxFile } from '../schema.js';
import { sentenceAround } from '../util/text.js';

export interface RawRange {
  min: number | null;
  max: number | null;
  currency: string | null;
  interval: 'year' | 'month' | 'hour' | null;
  /** Any label/blurb the ATS attaches to the range ("US Zone 1", "Salary range for India") */
  context?: string;
  origin: 'structured' | 'text';
  evidence?: string;
}

export interface SalaryInput {
  ranges: RawRange[];
  description: string;
  sourceUrl: string;
  fx: FxFile;
  minAnnualInr: number;
}

export const NOT_DISCLOSED = 'Not disclosed — verify with recruiter';

const SYMBOLS: Record<string, string> = { '$': 'USD', 'us$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', 'rs': 'INR', 'rs.': 'INR', 'c$': 'CAD', 'a$': 'AUD', 's$': 'SGD' };
const CODES = ['usd', 'eur', 'gbp', 'inr', 'cad', 'aud', 'sgd', 'chf', 'jpy'];

function currencyOf(token: string | undefined): string | null {
  if (!token) return null;
  const t = token.toLowerCase().trim();
  if (SYMBOLS[t]) return SYMBOLS[t];
  if (CODES.includes(t)) return t.toUpperCase();
  return null;
}

function num(raw: string, unit?: string): number {
  const n = parseFloat(raw.replace(/,/g, ''));
  const u = (unit ?? '').toLowerCase();
  if (u === 'k') return n * 1_000;
  if (u === 'm' || u === 'mn') return n * 1_000_000;
  if (u === 'l' || u === 'lakh' || u === 'lakhs' || u === 'lac' || u === 'lacs' || u === 'lpa') return n * 100_000;
  if (u === 'cr' || u === 'crore' || u === 'crores') return n * 10_000_000;
  return n;
}

function intervalOf(s: string | undefined): RawRange['interval'] {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/hour|hr/.test(t)) return 'hour';
  if (/month|mo\b/.test(t)) return 'month';
  if (/year|yr|annum|annual|pa\b|lpa/.test(t)) return 'year';
  return null;
}

/** The line containing the match plus the line before it (salary headings like "India:" usually sit there). Deliberately narrow so an unrelated mention of India elsewhere in the posting cannot relabel a US range. */
function lineAround(text: string, index: number, len: number): string {
  const start = text.lastIndexOf('\n', index - 1);
  const prevStart = start > 0 ? text.lastIndexOf('\n', start - 1) : -1;
  const endIdx = text.indexOf('\n', index + len);
  return text.slice(prevStart + 1, endIdx === -1 ? undefined : endIdx).trim();
}

/** Extract salary ranges written in the description text. Requires an explicit currency and a two-sided range. */
export function parseTextRanges(text: string): RawRange[] {
  const out: RawRange[] = [];
  const cur = '(\\$|us\\$|c\\$|a\\$|s\\$|€|£|₹|rs\\.?|usd|eur|gbp|inr|cad|aud|sgd)';
  const amt = '([\\d][\\d,]*(?:\\.\\d+)?)\\s*(k|m|mn|l|lakhs?|lacs?|lpa|cr|crores?)?';
  const re = new RegExp(
    `${cur}\\s?${amt}\\s*(?:-|–|—|to)\\s*${cur}?\\s?${amt}\\s*${cur}?(?:\\s*(?:per|/|a|an)\\s*(year|yr|annum|hour|hr|month)|\\s*(annually|annual|lpa|p\\.a\\.|pa)\\b)?`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const currency = currencyOf(m[1]) ?? currencyOf(m[4]) ?? currencyOf(m[7]);
    if (!currency) continue;
    const unitHi = m[6] ?? m[3];
    const unitLo = m[3] ?? m[6];
    let lo = num(m[2], unitLo);
    let hi = num(m[5], unitHi);
    if (hi < lo) [lo, hi] = [hi, lo];
    const lpa = /^l(pa|akh|ac)/i.test(unitHi ?? '');
    const interval = intervalOf(m[8] ?? m[9]) ?? (lpa ? 'year' : 'year');
    out.push({ min: lo, max: hi, currency, interval, origin: 'text', evidence: sentenceAround(text, m.index), context: lineAround(text, m.index, m[0].length) });
  }
  // "40-70 LPA" / "40 to 70 lakhs per annum" — Indian notation without a currency symbol
  const lpa = /\b(\d{1,3}(?:\.\d+)?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:lpa|lakhs?(?: per annum| p\.?a\.?)?|lacs?)\b/gi;
  while ((m = lpa.exec(text))) {
    const hit = m[0];
    if (out.some((o) => o.evidence?.includes(hit))) continue;
    const lo = parseFloat(m[1]) * 100_000;
    const hi = parseFloat(m[2]) * 100_000;
    out.push({ min: Math.min(lo, hi), max: Math.max(lo, hi), currency: 'INR', interval: 'year', origin: 'text', evidence: sentenceAround(text, m.index), context: lineAround(text, m.index, m[0].length) });
  }
  return out;
}

function annualize(v: number | null, interval: RawRange['interval']): number | null {
  if (v == null) return null;
  if (interval === 'hour') return Math.round(v * 2080);
  if (interval === 'month') return Math.round(v * 12);
  return v;
}

function plausible(annualMax: number | null, currency: string): boolean {
  if (annualMax == null) return false;
  if (currency === 'INR') return annualMax >= 200_000 && annualMax <= 50_000_000;
  if (currency === 'JPY') return annualMax >= 2_000_000 && annualMax <= 100_000_000;
  return annualMax >= 10_000 && annualMax <= 1_500_000;
}

const GLOBAL = /regardless of (?:your |where you )?(?:location|live|are based)|location[- ](?:agnostic|independent)|same (?:salary|pay|compensation|base)[^.\n]{0,40}(?:everywhere|regardless|across|for everyone|no matter)|globally consistent|global (?:salary|pay|compensation) (?:band|range|structure)|no matter where you (?:live|are|work)|we (?:do not|don't) (?:adjust|vary) (?:pay|salary|compensation) (?:by|based on) location/i;
const INDIA_CTX = /\bindia\b|\binr\b|₹|\blpa\b|lakhs?/i;
const US_UPPER = /\bUS\b|\bU\.S\.|\bUSA\b/;
const US_CTX = /\b(?:united states|us[- ]based|san francisco|new york|nyc|seattle|california|colorado|washington|zone [a-d1-4]|tier [1-4]|metro(?:politan)?|pay transparency|the base (?:pay|salary) range for this (?:role|position) (?:in|across))\b/i;
const OTHER_CTX = /\b(?:canada|uk|united kingdom|europe|eu|germany|ireland|australia|singapore|emea)\b/i;
const BONUS = /\bbonus(?:es)?\b[^.\n]{0,80}/i;
const EQUITY = /\b(?:equity|stock options?|rsus?|esops?)\b[^.\n]{0,80}/i;

function applicabilityOf(r: RawRange, description: string): Compensation['applicability'] {
  if (r.currency === 'INR') return 'india';
  const ctx = `${r.context ?? ''}`;
  if (INDIA_CTX.test(ctx)) return 'india';
  if (GLOBAL.test(ctx) || GLOBAL.test(description)) return 'global';
  if (US_CTX.test(ctx) || US_UPPER.test(ctx)) return 'us';
  if (OTHER_CTX.test(ctx)) return 'other_region';
  return 'unspecified';
}

function fmt(n: number, currency: string): string {
  if (currency === 'INR') {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2).replace(/\.?0+$/, '')}Cr`;
    return `₹${(n / 100_000).toFixed(1).replace(/\.0$/, '')}L`;
  }
  const sym: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
  return `${sym[currency] ?? currency + ' '}${n >= 1000 ? Math.round(n / 1000) + 'k' : n}`;
}

const EMPTY: Omit<Compensation, 'status' | 'display' | 'sourceUrl'> = {
  currency: null, interval: null, min: null, max: null, annualMin: null, annualMax: null, inrMin: null, inrMax: null,
  fxRate: null, fxDate: null, components: { base: null, bonus: null, equity: null }, applicability: 'unspecified', confidence: 'none', evidence: null,
};

export function classifyCompensation(input: SalaryInput): Compensation {
  const { description, fx, minAnnualInr, sourceUrl } = input;
  // A text range that repeats a structured ATS range adds nothing and would lose the ATS's geography label.
  const structured = input.ranges;
  const fromText = parseTextRanges(description).filter(
    (t) => !structured.some((r) => r.currency?.toUpperCase() === t.currency && Math.abs((r.min ?? 0) - (t.min ?? 0)) < 1 && Math.abs((r.max ?? 0) - (t.max ?? 0)) < 1),
  );
  const all = [...structured, ...fromText]
    .map((r) => ({ ...r, currency: r.currency?.toUpperCase() ?? null }))
    .filter((r) => r.currency && (r.min != null || r.max != null))
    .filter((r) => plausible(annualize(r.max ?? r.min, r.interval ?? 'year'), r.currency!));

  if (all.length === 0) {
    return { ...EMPTY, status: 'unverified', display: NOT_DISCLOSED, sourceUrl: null };
  }

  const scored = all.map((r) => ({ r, app: applicabilityOf(r, description) }));
  const rank = { india: 0, global: 1, unspecified: 2, other_region: 3, us: 4 } as const;
  scored.sort((a, b) => rank[a.app] - rank[b.app] || (a.r.origin === 'structured' ? -1 : 1));
  const { r, app } = scored[0];
  const currency = r.currency!;
  const interval = r.interval ?? 'year';
  const annualMin = annualize(r.min, interval);
  const annualMax = annualize(r.max ?? r.min, interval);
  const rate = currency === 'INR' ? 1 : fx.rates[currency] ?? null;
  const inrMin = annualMin != null && rate ? Math.round(annualMin * rate) : null;
  const inrMax = annualMax != null && rate ? Math.round(annualMax * rate) : null;
  const bonus = BONUS.exec(r.context ?? '')?.[0]?.trim() ?? null;
  const equity = EQUITY.exec(r.context ?? '')?.[0]?.trim() ?? null;
  const common = {
    currency, interval, min: r.min, max: r.max ?? r.min, annualMin, annualMax, inrMin, inrMax,
    fxRate: currency === 'INR' ? 1 : rate, fxDate: currency === 'INR' ? null : fx.date,
    components: { base: `${fmt(annualMin ?? 0, currency)}–${fmt(annualMax ?? 0, currency)} ${interval === 'year' ? 'per year' : `annualised from per-${interval}`}`, bonus, equity },
    applicability: app,
    evidence: r.evidence ?? r.context ?? null,
    sourceUrl,
  };
  const range = `${fmt(annualMin ?? 0, currency)}–${fmt(annualMax ?? 0, currency)}`;

  if (app === 'india' || app === 'global') {
    if (inrMax == null) {
      return { ...common, status: 'unverified', confidence: 'low', display: `${range} (no FX rate for ${currency}) — verify` };
    }
    const inrText = currency === 'INR' ? range : `${range} ≈ ${fmt(inrMin ?? inrMax, 'INR')}–${fmt(inrMax, 'INR')}`;
    if (inrMax < minAnnualInr) {
      return { ...common, status: 'below_target', confidence: app === 'india' ? 'high' : 'medium', display: `${inrText} (below ₹${minAnnualInr / 100_000}L)` };
    }
    return { ...common, status: 'verified', confidence: app === 'india' && currency === 'INR' ? 'high' : 'medium', display: `${inrText}${app === 'global' ? ' (global pay policy)' : ''}` };
  }

  const where = app === 'us' ? 'US' : app === 'other_region' ? 'another region' : 'an unstated location';
  return { ...common, status: 'unverified', confidence: 'none', display: `${NOT_DISCLOSED} (published ${range} applies to ${where})` };
}
