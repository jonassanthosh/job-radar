/**
 * Fit score (0–100), fully deterministic and explainable. Weights per the brief:
 * technical 30 · developer-facing support 25 · experience 20 · industry 15 · customer-facing 10.
 * Location and pay never feed into this number.
 */
import type { ProfileConfig, SearchConfig } from '../config.js';
import type { Fit, Job } from '../schema.js';
import { compileAll, uniq } from '../util/text.js';

export interface ScoreInput {
  title: string;
  company: string;
  family: Job['jobFamily'];
  description: string;
  responsibilityGroups: string[];
  groupLabel: (id: string) => string;
}

export function parseYearsRequired(text: string): number | null {
  const re = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b[^.\n]{0,60}?(?:experience|exp\b|support|engineering|industry)/gi;
  let m: RegExpExecArray | null;
  const found: number[] = [];
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 20) found.push(n);
  }
  return found.length ? Math.min(...found) : null;
}

export function makeScorer(profile: ProfileConfig, search: SearchConfig) {
  const skills = profile.skills.map((s) => ({ ...s, re: compileAll(s.patterns) }));
  const unfamiliar = profile.unfamiliarSkills.map((s) => ({ ...s, re: compileAll(s.patterns) }));
  const industries = profile.industries.map((s) => ({ ...s, re: compileAll(s.patterns) }));
  const concerns = search.concernSignals.map((c) => ({ ...c, re: compileAll(c.patterns) }));
  const senior = compileAll(search.seniorityTitle.senior);
  const staff = compileAll(search.seniorityTitle.staff);
  const junior = compileAll(search.seniorityTitle.junior);

  function techStack(description: string): string[] {
    return uniq([
      ...skills.filter((s) => s.re.some((r) => r.test(description))).map((s) => s.name),
      ...unfamiliar.filter((s) => s.re.some((r) => r.test(description))).map((s) => s.name),
    ]);
  }

  function score(input: ScoreInput): Fit & { yearsRequired: number | null } {
    const d = input.description;
    const matched = skills.filter((s) => s.re.some((r) => r.test(d))).sort((a, b) => b.weight - a.weight);
    const gaps = unfamiliar.filter((s) => s.re.some((r) => r.test(d)));
    const groups = new Set(input.responsibilityGroups);

    // Technical skills — 30
    const w = matched.reduce((a, s) => a + s.weight, 0);
    const technical = Math.max(0, Math.round(30 * Math.min(1, w / 15)) - 2 * Math.min(3, gaps.length));

    // Developer-facing support — 25
    const prior = { developer_support: 12, technical_support: 8, developer_experience: 8, customer_engineering: 5, solutions_integration: 5 }[input.family];
    const devGroups = ['developer_customers', 'api_debugging', 'production_investigation', 'bug_reproduction', 'escalations'].filter((g) => groups.has(g)).length;
    const devSupport = Math.min(25, Math.round(prior + devGroups * 2.6));

    // Experience & seniority — 20
    const yearsRequired = parseYearsRequired(d);
    const yrs = profile.yearsExperience;
    let experience = yearsRequired == null ? 15 : yearsRequired <= yrs ? 20 : yearsRequired <= yrs + 2 ? 12 : 5;
    const isStaff = staff.some((r) => r.test(input.title));
    const isJunior = junior.some((r) => r.test(input.title));
    const isSenior = senior.some((r) => r.test(input.title));
    if (isStaff && yrs < 8) experience = Math.min(experience, 12);
    if (isJunior) experience = Math.min(experience, 14);

    // Industry & technology — 15
    const ind = industries.filter((i) => i.re.some((r) => r.test(d)));
    const industry = Math.round(15 * Math.min(1, ind.reduce((a, i) => a + i.weight, 0) / 8));

    // Customer-facing engineering — 10
    const customerFacing = (groups.has('technical_customers') ? 4 : 0) + (groups.has('documentation_dx') ? 2 : 0) + (groups.has('tooling') ? 2 : 0) + (groups.has('escalations') ? 2 : 0);

    const total = Math.max(0, Math.min(100, technical + devSupport + experience + industry + customerFacing));
    const category: Fit['category'] = total >= 90 ? 'exceptional' : total >= 80 ? 'strong' : total >= 70 ? 'possible' : 'exclude';

    const missing = gaps.map((g) => g.name);
    if (yearsRequired != null && yearsRequired > yrs) missing.push(`Asks for ${yearsRequired}+ years (profile: ${yrs})`);

    const concernList = concerns.filter((c) => c.re.some((r) => r.test(d))).map((c) => c.label);
    if (isStaff) concernList.push('Staff/principal level — likely expects deeper specialisation');
    if (isJunior) concernList.push('Junior/associate level — may be below your experience and pay target');
    if (matched.length < 4) concernList.push('Few of your core skills are named in the posting');

    const strongestMatch = matched.slice(0, 3).map((s) => s.evidence);
    const topGroups = input.responsibilityGroups.filter((g) => ['api_debugging', 'production_investigation', 'escalations', 'developer_customers', 'bug_reproduction'].includes(g)).slice(0, 3).map((g) => input.groupLabel(g));
    const whyFit = matched.length
      ? `Names ${matched.length} of your core skills (${matched.slice(0, 5).map((s) => s.name).join(', ')})${topGroups.length ? ` and the work centres on: ${topGroups.join('; ')}` : ''}.`
      : 'Title matches, but the posting names few of your specific skills.';
    const worthApplying = [
      isSenior ? 'Senior-level title fits your escalation and mentoring experience.' : null,
      input.family === 'developer_support' ? 'Developer-facing support is the closest match to your FlutterFlow work.' : null,
      ind.length ? `Domain overlap: ${ind.map((i) => i.name).slice(0, 2).join(', ')}.` : null,
      matched[0] ? `Lead with: ${matched[0].evidence}.` : null,
    ].filter(Boolean).join(' ');

    return {
      score: total,
      category,
      breakdown: { technical, devSupport, experience, industry, customerFacing },
      matchedSkills: matched.map((s) => s.name),
      strongestMatch,
      missing,
      concerns: uniq(concernList),
      whyFit,
      worthApplying: worthApplying || 'Review the posting — limited overlap detected automatically.',
      yearsRequired,
    };
  }

  return { score, techStack };
}
