import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const Patterned = z.object({ name: z.string(), patterns: z.array(z.string()).min(1) });

export const ProfileConfig = z.object({
  name: z.string(),
  base: z.string(),
  yearsExperience: z.number().positive(),
  compensation: z.object({ minAnnualInr: z.number().positive(), targetMaxInr: z.number().positive() }),
  thresholds: z.object({
    recommendedMinScore: z.number(),
    reviewQueueMinScore: z.number(),
    locationCheckMinScore: z.number(),
    maxPostingAgeDays: z.number(),
    freshPostingDays: z.number(),
    contactStaleDays: z.number(),
  }),
  skills: z.array(Patterned.extend({ weight: z.number().positive(), evidence: z.string() })),
  unfamiliarSkills: z.array(Patterned),
  industries: z.array(Patterned.extend({ weight: z.number().positive() })),
});
export type ProfileConfig = z.infer<typeof ProfileConfig>;

export const SearchConfig = z.object({
  titleFamilies: z.array(
    z.object({
      family: z.enum(['developer_support', 'technical_support', 'customer_engineering', 'solutions_integration', 'developer_experience']),
      strict: z.boolean(),
      patterns: z.array(z.string()),
    }),
  ),
  titleExclusions: z.array(z.string()),
  responsibilityGroups: z.array(z.object({ id: z.string(), label: z.string(), patterns: z.array(z.string()) })),
  minResponsibilityGroups: z.object({ default: z.number(), strict: z.number() }),
  presalesSignals: z.array(z.string()),
  maxPresalesSignals: z.number(),
  genericSupportSignals: z.array(z.string()),
  maxGenericSupportSignals: z.number(),
  seniorityTitle: z.object({ senior: z.array(z.string()), staff: z.array(z.string()), junior: z.array(z.string()) }),
  concernSignals: z.array(z.object({ label: z.string(), patterns: z.array(z.string()) })),
  aggregatorQueries: z.array(z.string()),
  searchApiQueries: z.array(z.string()),
  workdaySearchTerms: z.array(z.string()),
  /** Staffing agencies / talent marketplaces whose real employer cannot be verified. */
  excludedCompanies: z.array(z.string()),
});
export type SearchConfig = z.infer<typeof SearchConfig>;

export interface Config {
  profile: ProfileConfig;
  search: SearchConfig;
}

export function loadConfig(root = process.cwd()): Config {
  const read = (f: string) => JSON.parse(readFileSync(join(root, 'config', f), 'utf8'));
  return { profile: ProfileConfig.parse(read('profile.json')), search: SearchConfig.parse(read('search.json')) };
}
