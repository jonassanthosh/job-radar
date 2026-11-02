# Job Radar

A daily scanner and dashboard for **remote technical support / developer support engineering roles that can be done from India**, at international employers, with pay evidence and verifiable contacts.

Every job on the dashboard was read from the employer's **official ATS** (Greenhouse, Lever, Ashby or Workday). Aggregators and search engines are only used to discover new employers. Location, pay and dedup decisions are deterministic, unit-tested rules, and every claim carries the quoted evidence and a source link.

---

## How a job is judged

| Gate | Rule | Result |
|---|---|---|
| **Role** | Title is in the target list (developer support, technical/product support engineer, customer/developer success engineer…) and the description shows at least 4 of 9 technical-support responsibilities. Customer Engineer / Solutions / DX titles need 5 and must not read like quota-carrying presales. Managers, sales, helpdesk and IT support are excluded. | Not stored if it fails |
| **India** | `eligible` only if the posting says remote **and** names India (location field or a quoted sentence such as "we can hire in … India"). APAC / worldwide / bare "Remote" → `verification_required`. Hybrid, office, relocation, ≥20% travel, region-locked remote, US work authorization, or explicit India exclusion → `ineligible`. | Ineligible jobs are not stored |
| **Pay** | `verified` only when the range is in INR, labelled for India, or the posting states location-independent pay (then FX-converted with a dated ECB rate). A US/EU range is recorded but **never** assumed to apply to India. | `verified` ≥ ₹60L, `below_target`, or `unverified` ("Not disclosed — verify with recruiter") |
| **Fit** | 0–100: technical skills 30, developer-facing support 25, experience 20, industry 15, customer-facing 10. Location and pay never change the score. | Explained per job, with gaps and concerns |

Then each job lands in exactly one list:

- **Recommended**: India-eligible, pay verified ≥ ₹60L, fit ≥ 70
- **Pay unverified**: India-eligible, pay not disclosed for India, fit ≥ 80
- **Check India eligibility**: eligibility ambiguous, fit ≥ 75
- **Excluded**: everything else (kept in History with the reason)

Thresholds live in `config/profile.json`.

---

## Setup (about 10 minutes)

1. **Create a repository** on GitHub, e.g. `job-radar`. Public is simplest: GitHub Pages on a private repo needs a paid plan. Nothing private is ever committed (see Privacy below).
2. **Push this project:**
   ```bash
   cd job-radar
   git remote add origin https://github.com/<you>/job-radar.git
   git push -u origin main
   ```
3. **Enable Pages:** *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
4. **Allow the workflow to commit data:** *Settings → Actions → General → Workflow permissions → **Read and write permissions** → Save*.
5. **Run it once:** *Actions → Daily scan → Run workflow*. The first run is the 30-day backfill. When it finishes, the dashboard URL appears on the deploy job (`https://<you>.github.io/job-radar/`).
6. *(Optional, recommended)* **More employer discovery:** create a free [Brave Search API](https://brave.com/search/api/) key and add it as a repository secret named `BRAVE_SEARCH_API_KEY` (*Settings → Secrets and variables → Actions → New repository secret*). Without it, discovery uses Remotive, Remote OK and Himalayas only.

After that it runs every day at **01:30 UTC (07:00 IST)**. GitHub may start scheduled runs late at busy times. Also note GitHub disables schedules in repositories with no activity for 60 days. The daily data commit normally counts as activity, but if the schedule ever stops, re-enable it from the Actions tab.

### Required credentials

| What | Needed? | Where |
|---|---|---|
| `GITHUB_TOKEN` | Automatic | Provided by Actions; needs the "Read and write" setting above |
| `BRAVE_SEARCH_API_KEY` | Optional | Repository secret; used only server-side in Actions |

No key is ever placed in frontend code or in `data/`.

---

## Everyday use

**Dashboard sections:** Overview, Recommended, Pay unverified, Check eligibility, All active (with filters for title family, company, minimum pay, pay evidence, region, posting date, fit, employment type, new/seen, your status, plus search and sorting), Applications, Contacts, History, Scan health.

**Application tracker.** Statuses (New, Saved, Applied, Recruiter responded, Interview, Rejected, Not interested), notes and application dates are stored **only in your browser's localStorage**. They are not in the repository and do not sync between devices or browsers. Use *Applications → Export backup* regularly; *Import backup* restores or merges on another device.

**Never see an applied job again.** Import a list of jobs you already applied to or dismissed:
```bash
npm run import -- examples/applied.csv        # columns: url, company, title
npm run import -- applications-2026-11-02.json  # a dashboard export works too
git add data/suppressed.json data/jobs.json && git commit -m "import applied" && git push
```
Only one-way SHA-256 hashes are stored, so the public repo does not reveal where you applied.

**Add a verified contact.** The scanner automatically picks up people explicitly named in a posting ("Your recruiter for this role is …"). For anyone else, verify them yourself (current company and role, from a public page) and add them to `data/contacts.json`:
```json
{
  "schemaVersion": 1,
  "contacts": [
    {
      "name": "Full Name",
      "role": "Manager, Support Engineering",
      "company": "GitLab",
      "linkedinUrl": "https://www.linkedin.com/in/…",
      "sourceUrl": "https://… page that shows their current role",
      "type": "potential_team_contact",
      "confidence": "medium",
      "reason": "Leads the APAC support team",
      "verifiedAt": "2026-11-02",
      "jobIds": []
    }
  ]
}
```
`type` is one of `confirmed_hiring_manager`, `confirmed_recruiter`, `potential_team_contact`, `potential_recruiting_contact`. A contact with an empty `jobIds` applies to every job at that company and is **never** shown as "confirmed" for a specific opening; add the job id (shown in each card's details) to mark a confirmed relationship. Contacts older than 120 days are flagged for re-verification. Every job also has prefilled public search links.

**Add an employer by hand.** Append to `data/boards.json` with `"origin": "manual"`. The slug is the part of the job-board URL after the host: `job-boards.greenhouse.io/<slug>`, `jobs.lever.co/<slug>`, `jobs.ashbyhq.com/<slug>`. Workday boards also need `"workday": {"host": "acme.wd5.myworkdayjobs.com", "tenant": "acme", "site": "External"}`.

---

## Running locally

```bash
npm install
npm test                 # 59 rule + end-to-end tests, fully offline
npm run scan:fixtures    # full pipeline against recorded API responses (writes to data/! use JOB_RADAR_DATA=/tmp/x to avoid)
npm run scan             # the real scan (needs internet)
npm run validate         # schema + invariant checks on data/
npm run dev:web          # dashboard at http://localhost:5173
```

---

## Repository structure

```
config/
  profile.json        your skills (with the evidence line each one cites), thresholds, pay target
  search.json         titles, exclusions, responsibility signals, presales/helpdesk signals, discovery queries
data/                 the database, committed by the workflow; every file schema-validated on read and write
  jobs.json           all job records with history/audit trail
  boards.json         employers being scanned (seed, discovered, manual) and their health
  runs.json           last 120 scan records (scan health)
  contacts.json       hand-verified contacts
  suppressed.json     hashes of jobs you applied to / dismissed
  fx.json             dated FX rates (INR per unit)
scanner/src/
  run.ts              daily orchestrator
  schema.ts           zod data model (shared with the dashboard)
  rules/              location, salary, role, score, dedup, status, feed, contacts (pure, unit-tested)
  sources/            greenhouse, lever, ashby, workday adapters; discovery.ts (aggregators + search)
  import.ts validate.ts store.ts fx.ts util/
scanner/test/         unit tests + two-day end-to-end test on fixtures
web/                  React + TypeScript + Vite + Tailwind dashboard
.github/workflows/daily-scan.yml
```

## Deduplication

Identity is, in order: ATS + board + ATS job id → canonical URL (tracking params, alternate Greenhouse hosts, `/apply` suffixes and `?gh_jid=` embeds normalised) → company + title + location + requisition id. A re-post with a new ATS id but identical company, title, location and description is folded into the original record **only if the original is no longer live**; if both are live, or their requisition ids differ, they are separate positions. A job is marked closed only when its board was fetched successfully and the job was gone; a failed fetch marks it "Could not re-check".

## Troubleshooting

| Symptom | Fix |
|---|---|
| Workflow fails at "Commit data updates" with 403 | Workflow permissions are read-only. See setup step 4. |
| Deploy job fails with "Pages not enabled" | Setup step 3: Source must be **GitHub Actions**, not a branch. |
| Dashboard says it could not load data | No scan has run yet. Run the workflow manually. |
| A board appears in Scan health failures every day | Wrong slug: it is auto-disabled after 3 consecutive 404s. Fix the slug in `data/boards.json` and set `disabled: false`. |
| A job you know is India-remote shows "Check eligibility" | The posting doesn't say so in words the rules can quote. Confirm with the recruiter. If a phrasing should count, add it to `DESC_INDIA_OK` in `scanner/src/rules/location.ts` with a test. |
| Too many / too few jobs | Adjust `thresholds` in `config/profile.json` or the title and signal lists in `config/search.json`. |

## Known limitations

- **Pay for India is rarely published.** Expect "Recommended" (verified ₹60L+) to be small or empty on most days; the "Pay unverified" list is where most real opportunities will be.
- **Contacts are not discovered automatically** beyond people named in postings. Identifying a hiring manager reliably needs LinkedIn, which this system deliberately does not scrape. The search links make manual checking quick.
- **Company headquarters is not auto-verified**; `companyInfo` stays empty unless you fill it in `data/boards.json`.
- **Discovery depends on free public feeds**; without the optional Brave key it finds fewer new employers.
- **Fit scoring is keyword-based.** It is transparent and repeatable but cannot judge nuance; read the gaps and concerns before applying.
- **Workday** is scanned only for tenants listed in `data/boards.json`, via keyword search.
- Seed board slugs marked "not yet confirmed" may be wrong; wrong ones disable themselves.
