import { describe, expect, it } from 'vitest';
import { classifyLocation } from '../src/rules/location.js';

const url = 'https://jobs.example.com/1';
const loc = (locationText: string, description = '', extra: Partial<Parameters<typeof classifyLocation>[0]> = {}) =>
  classifyLocation({ locationText, description, url, ...extra });

describe('India eligibility', () => {
  it('accepts explicit Remote - India', () => {
    const r = loc('Remote - India');
    expect(r.india).toBe('eligible');
    expect(r.evidence).toBe('Remote - India');
  });

  it('accepts India city when the ATS says remote', () => {
    expect(loc('Bengaluru, India', '', { workplaceType: 'remote' }).india).toBe('eligible');
    expect(loc('Chennai', '', { isRemote: true }).india).toBe('eligible');
  });

  it('accepts multi-location strings that include India', () => {
    expect(loc('Remote - US | Remote - India').india).toBe('eligible');
  });

  it('accepts remote listings whose description explicitly opens the role to India, quoting the sentence', () => {
    const r = loc('Remote', 'About the role. We can hire in the following countries: Germany, India, Brazil. Apply now.');
    expect(r.india).toBe('eligible');
    expect(r.evidence).toContain('India');
  });

  it('treats a company-wide all-remote statement as remote (GitLab style)', () => {
    const r = loc('Bangalore, India', 'All of our roles are remote, however some roles may carry specific location-based eligibility requirements.');
    expect(r.india).toBe('eligible');
    expect(r.remoteType).toBe('remote');
  });

  it('requires verification for an India city with no remote signal', () => {
    expect(loc('Bengaluru, India').india).toBe('verification_required');
  });

  it('requires verification for APAC / worldwide / bare remote', () => {
    expect(loc('Remote - APAC').india).toBe('verification_required');
    expect(loc('Remote (Worldwide)').india).toBe('verification_required');
    expect(loc('Remote').india).toBe('verification_required');
    expect(loc('').india).toBe('verification_required');
  });

  it('rejects hybrid and office roles even in India', () => {
    expect(loc('Hybrid - Bengaluru, India').india).toBe('ineligible');
    expect(loc('Bengaluru, India', '', { workplaceType: 'onsite' }).india).toBe('ineligible');
    expect(loc('Bengaluru, India', 'This role is hybrid, 3 days per week in the office.').india).toBe('ineligible');
  });

  it('rejects region-locked remote', () => {
    expect(loc('Remote - US').india).toBe('ineligible');
    expect(loc('Remote, United States').india).toBe('ineligible');
    expect(loc('Remote - EMEA').india).toBe('ineligible');
    expect(loc('Remote (Canada)').india).toBe('ineligible');
    expect(loc('Singapore').india).toBe('ineligible');
  });

  it('rejects US work-authorization requirements on bare remote', () => {
    expect(loc('Remote', 'Candidates must be authorized to work in the United States.').india).toBe('ineligible');
  });

  it('rejects explicit India exclusions, even with an APAC location', () => {
    const r = loc('Remote - APAC', 'We hire across APAC excluding India and China.');
    expect(r.india).toBe('ineligible');
    expect(r.reason).toMatch(/excludes India/);
  });

  it('rejects relocation and heavy travel', () => {
    expect(loc('Remote - India', 'You will need to relocate to Singapore within 6 months.').india).toBe('ineligible');
    expect(loc('Remote - India', 'Travel to customer sites up to 50% of the time.').india).toBe('ineligible');
  });

  it('does not treat "IN" (Indiana) in US locations as India', () => {
    expect(loc('Indianapolis, IN, United States').india).not.toBe('eligible');
  });
});
