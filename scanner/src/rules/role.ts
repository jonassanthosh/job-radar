/**
 * Role relevance: title gate first (cheap, runs on every posting), then a responsibilities gate
 * on the full description. Customer Engineer / Solutions / DX titles are "strict": they must show
 * more support-style responsibilities and must not read like quota-carrying presales.
 */
import type { SearchConfig } from '../config.js';
import type { Job } from '../schema.js';
import { compileAll } from '../util/text.js';

export type JobFamily = Job['jobFamily'];

export interface TitleVerdict {
  include: boolean;
  family: JobFamily | null;
  strict: boolean;
  reason: string;
}

export interface RoleVerdict extends TitleVerdict {
  responsibilityGroups: string[];
  presalesHits: string[];
  genericHits: string[];
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(remote|india|apac|emea|global|worldwide|us|uk|hybrid)\b/g, ' ')
    .replace(/\bsr\b/g, 'senior')
    .replace(/\s+/g, ' ')
    .trim();
}

export function makeRoleRules(cfg: SearchConfig) {
  const families = cfg.titleFamilies.map((f) => ({ ...f, re: compileAll(f.patterns) }));
  const exclusions = compileAll(cfg.titleExclusions);
  const groups = cfg.responsibilityGroups.map((g) => ({ ...g, re: compileAll(g.patterns) }));
  const presales = compileAll(cfg.presalesSignals);
  const generic = compileAll(cfg.genericSupportSignals);

  function classifyTitle(title: string): TitleVerdict {
    const t = title.replace(/\s+/g, ' ');
    const fam = families.find((f) => f.re.some((r) => r.test(t)));
    if (!fam) return { include: false, family: null, strict: false, reason: 'Title not in target list' };
    const ex = exclusions.find((r) => r.test(t));
    // "Support Engineering Specialist" is explicitly allowed even though other "specialist" titles are not.
    if (ex) return { include: false, family: fam.family, strict: fam.strict, reason: `Excluded title term: ${ex.source}` };
    return { include: true, family: fam.family, strict: fam.strict, reason: `Title matches ${fam.family.replace('_', ' ')}` };
  }

  function classifyRole(title: string, description: string): RoleVerdict {
    const tv = classifyTitle(title);
    const responsibilityGroups = groups.filter((g) => g.re.some((r) => r.test(description))).map((g) => g.id);
    const presalesHits = presales.filter((r) => r.test(description)).map((r) => r.source);
    const genericHits = generic.filter((r) => r.test(description)).map((r) => r.source);
    const base = { ...tv, responsibilityGroups, presalesHits, genericHits };
    if (!tv.include) return base;

    const need = tv.strict ? cfg.minResponsibilityGroups.strict : cfg.minResponsibilityGroups.default;
    if (responsibilityGroups.length < need) {
      return { ...base, include: false, reason: `Only ${responsibilityGroups.length}/${need} technical-support responsibilities found in description` };
    }
    if (presalesHits.length > cfg.maxPresalesSignals) {
      return { ...base, include: false, reason: `Reads as quota-driven presales (${presalesHits.length} sales signals)` };
    }
    if (genericHits.length > cfg.maxGenericSupportSignals) {
      return { ...base, include: false, reason: `Reads as generic customer service / helpdesk (${genericHits.length} signals)` };
    }
    return { ...base, reason: `${tv.reason}; ${responsibilityGroups.length} technical-support responsibilities` };
  }

  return { classifyTitle, classifyRole, groupLabel: (id: string) => groups.find((g) => g.id === id)?.label ?? id };
}
