/**
 * Contacts. Two sources only, both verifiable:
 *   1. People named in the official posting with an explicit label ("Hiring manager: Jane Doe").
 *   2. data/contacts.json — hand-verified entries with a public source URL and a verification date.
 * No guessed names, emails or LinkedIn URLs are ever generated. When nothing is verified the job gets
 * prefilled public web-search links instead.
 */
import type { Contact, Job } from '../schema.js';
import { slugify } from '../util/text.js';

const NAME = "([A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?:\\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?){1,2})";
const LABELLED: { re: RegExp; type: Contact['type']; role: string }[] = [
  { re: new RegExp(`[Hh]iring [Mm]anager(?: for this role)?\\s*(?:is|:|-|–)\\s*${NAME}`, 'g'), type: 'confirmed_hiring_manager', role: 'Hiring manager (named in posting)' },
  { re: new RegExp(`(?:[Rr]ecruiter|[Tt]alent [Pp]artner|[Rr]ecruiting [Pp]artner)(?: for this role)?\\s*(?:is|:|-|–)\\s*${NAME}`, 'g'), type: 'confirmed_recruiter', role: 'Recruiter (named in posting)' },
  { re: new RegExp(`(?:[Rr]eport(?:ing)? (?:directly )?to|[Ww]ork closely with)\\s+${NAME},\\s+(?:our\\s+|the\\s+)?((?:Head|Director|VP|Manager|Lead)[^.,\\n]{0,60})`, 'g'), type: 'potential_team_contact', role: '' },
];
const NOT_NAMES = /^(The|Our|This|Your|We|You|Head|Director|Manager|Senior|Support|Engineering|Customer|Team)\b/;

export function extractPostingContacts(description: string, company: string, sourceUrl: string, today: string): Contact[] {
  const out: Contact[] = [];
  for (const { re, type, role } of LABELLED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(description))) {
      const name = m[1].trim();
      if (NOT_NAMES.test(name)) continue;
      out.push({
        name,
        role: type === 'potential_team_contact' ? m[2].trim() : role,
        company,
        linkedinUrl: null,
        sourceUrl,
        type,
        confidence: type === 'potential_team_contact' ? 'medium' : 'high',
        reason: type === 'potential_team_contact' ? 'Posting names this person as who the role reports to / works with; not confirmed as the hiring manager' : 'Named for this opening in the official posting',
        verifiedAt: today,
        stale: false,
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

const TYPE_RANK: Record<Contact['type'], number> = {
  confirmed_hiring_manager: 0,
  confirmed_recruiter: 1,
  potential_team_contact: 2,
  potential_recruiting_contact: 3,
};

export function mergeContacts(
  job: Pick<Job, 'id' | 'company'>,
  fromPosting: Contact[],
  curated: (Contact & { jobIds: string[] })[],
  today: string,
  staleDays: number,
): Contact[] {
  const companyKey = slugify(job.company);
  const relevant = curated
    .filter((c) => slugify(c.company) === companyKey && (c.jobIds.length === 0 || c.jobIds.includes(job.id)))
    .map(({ jobIds, ...c }) => {
      const age = (Date.parse(today) - Date.parse(c.verifiedAt)) / 86_400_000;
      // A company-level contact is never "confirmed" for a specific opening unless it was tied to this job id.
      const type = jobIds.includes(job.id) ? c.type : c.type === 'confirmed_hiring_manager' ? 'potential_team_contact' : c.type === 'confirmed_recruiter' ? 'potential_recruiting_contact' : c.type;
      return { ...c, type, stale: age > staleDays };
    });
  const all = [...fromPosting, ...relevant];
  const seen = new Set<string>();
  return all
    .filter((c) => (seen.has(c.name.toLowerCase()) ? false : (seen.add(c.name.toLowerCase()), true)))
    .sort((a, b) => TYPE_RANK[a.type] - TYPE_RANK[b.type] || Number(a.stale) - Number(b.stale))
    .slice(0, 3);
}

export function contactSearchLinks(company: string): { label: string; url: string }[] {
  const g = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const c = `"${company}"`;
  return [
    { label: 'Support / developer-support leaders', url: g(`site:linkedin.com/in ${c} ("support engineering manager" OR "head of support" OR "director of support" OR "developer support" OR "customer engineering manager")`) },
    { label: 'Technical recruiters', url: g(`site:linkedin.com/in ${c} ("technical recruiter" OR "talent acquisition" OR "recruiting") (engineering OR technical)`) },
    { label: 'Company team / about page', url: g(`${c} team OR leadership "support"`) },
  ];
}
