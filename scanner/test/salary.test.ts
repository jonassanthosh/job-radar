import { describe, expect, it } from 'vitest';
import { classifyCompensation, NOT_DISCLOSED, parseTextRanges } from '../src/rules/salary.js';
import type { FxFile } from '../src/schema.js';

const fx: FxFile = { schemaVersion: 1, base: 'INR', date: '2026-11-02', source: 'test', rates: { USD: 88, EUR: 100, GBP: 115 } };
const run = (description: string, ranges: Parameters<typeof classifyCompensation>[0]['ranges'] = []) =>
  classifyCompensation({ ranges, description, sourceUrl: 'https://x.test/job', fx, minAnnualInr: 6_000_000 });

describe('text range parsing', () => {
  it('parses USD k ranges', () => {
    const [r] = parseTextRanges('The base salary is $120k - $160k per year.');
    expect(r).toMatchObject({ min: 120000, max: 160000, currency: 'USD', interval: 'year' });
  });
  it('parses INR lakh ranges and LPA notation', () => {
    expect(parseTextRanges('CTC: ₹45L - ₹70L')[0]).toMatchObject({ min: 4_500_000, max: 7_000_000, currency: 'INR' });
    expect(parseTextRanges('Compensation: 40-55 LPA')[0]).toMatchObject({ min: 4_000_000, max: 5_500_000, currency: 'INR' });
  });
  it('ignores single amounts like funding totals', () => {
    expect(parseTextRanges('We raised $50M from top investors.')).toHaveLength(0);
  });
});

describe('compensation classification', () => {
  it('no range -> unverified with the exact required wording', () => {
    const c = run('Great team, competitive pay.');
    expect(c.status).toBe('unverified');
    expect(c.display).toBe(NOT_DISCLOSED);
    expect(c.confidence).toBe('none');
  });

  it('INR range at/above target -> verified, high confidence', () => {
    const c = run('Salary range for this role in India: ₹60L - ₹85L per year.');
    expect(c.status).toBe('verified');
    expect(c.applicability).toBe('india');
    expect(c.inrMax).toBe(8_500_000);
    expect(c.confidence).toBe('high');
  });

  it('INR range whose ceiling is below ₹60L -> below_target', () => {
    expect(run('CTC 30-45 LPA').status).toBe('below_target');
  });

  it('US range is never assumed to apply to India', () => {
    const c = run('The base salary range for this role in the United States is $140,000 - $180,000.');
    expect(c.status).toBe('unverified');
    expect(c.applicability).toBe('us');
    expect(c.display).toContain('applies to US');
    expect(c.inrMax).toBe(180000 * 88); // stored for reference only
  });

  it('USD range without geography -> unverified (unspecified)', () => {
    const c = run('Pay: $90k-$110k.');
    expect(c.status).toBe('unverified');
    expect(c.applicability).toBe('unspecified');
  });

  it('explicit global pay policy -> verified, medium confidence, FX-converted', () => {
    const c = run('We pay the same salary regardless of location. Salary: $80,000 - $100,000 USD per year.');
    expect(c.status).toBe('verified');
    expect(c.applicability).toBe('global');
    expect(c.inrMin).toBe(80000 * 88);
    expect(c.fxDate).toBe('2026-11-02');
    expect(c.confidence).toBe('medium');
  });

  it('global policy but converted ceiling below target -> below_target', () => {
    expect(run('Same salary regardless of location: $40k - $60k').status).toBe('below_target');
  });

  it('prefers an India-labelled structured range over a US one', () => {
    const c = run('', [
      { min: 150000, max: 190000, currency: 'USD', interval: 'year', context: 'US Zone A', origin: 'structured' },
      { min: 7_000_000, max: 9_000_000, currency: 'INR', interval: 'year', context: 'India', origin: 'structured' },
    ]);
    expect(c.status).toBe('verified');
    expect(c.currency).toBe('INR');
  });

  it('annualises hourly ranges', () => {
    const c = run('', [{ min: 50, max: 70, currency: 'USD', interval: 'hour', context: 'Global, regardless of location', origin: 'structured' }]);
    expect(c.annualMax).toBe(70 * 2080);
  });

  it('missing FX rate for a global range stays unverified', () => {
    const c = run('', [{ min: 90000, max: 120000, currency: 'SGD', interval: 'year', context: 'regardless of location', origin: 'structured' }]);
    expect(c.status).toBe('unverified');
    expect(c.confidence).toBe('low');
  });
});

describe('applicability is judged locally, not by any India mention in the posting', () => {
  it('a US range is not relabelled India because India appears elsewhere', () => {
    const d = 'We can hire in Canada, Germany, India and Brazil.\nWe are remote-first.\n\nCompensation: $150K – $180K';
    const c = run(d, [{ min: 150000, max: 180000, currency: 'USD', interval: 'year', context: 'United States', origin: 'structured' }]);
    expect(c.status).toBe('unverified');
    expect(c.applicability).toBe('us');
  });
  it('a range on a line labelled India is India-applicable', () => {
    const c = run('Salary bands\nIndia: $70,000 - $90,000 per year\nUS: $150,000 - $180,000 per year');
    expect(c.applicability).toBe('india');
    expect(c.status).toBe('verified');
  });
});
