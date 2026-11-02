/**
 * Deterministic India-eligibility classifier.
 *
 * Contract: a job is `eligible` only when the official posting says, in words we can quote,
 * that the role is remote AND open to someone in India. Anything vaguer (APAC, worldwide,
 * "remote") is `verification_required`. Office/hybrid, relocation, heavy travel, region-locked
 * remote and explicit India exclusions are `ineligible`.
 */
import type { Location } from '../schema.js';
import { sentenceAround } from '../util/text.js';

export interface LocationInput {
  /** All location strings the ATS reports, joined with " | " */
  locationText: string;
  /** Structured workplace type from the ATS, if it has one */
  workplaceType?: 'remote' | 'hybrid' | 'onsite' | null;
  isRemote?: boolean | null;
  /** Plain-text description */
  description: string;
  url: string;
}

const INDIA = /\bindia\b|bengaluru|bangalore|chennai|hyderabad|\bpune\b|mumbai|new delhi|\bdelhi\b|gurugram|gurgaon|noida|kolkata|ahmedabad|\bkochi\b|coimbatore|thiruvananthapuram|trivandrum|jaipur/i;
const INDIA_CODE = /(?:[-,(|/]\s*)IN\b(?!\w)/; // "Remote - IN", "Chennai, IN" (case-sensitive)

const REMOTE = /\bremote\b|anywhere|work from home|\bwfh\b|distributed|home[- ]based/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /on-?site|in[- ]office|office[- ]based/i;

const DESC_REMOTE = /(?:this|the) (?:is a |role is |position is )?(?:fully |100% )?remote\b|fully remote|remote[- ]first|remote[- ]only|work (?:fully )?remotely|all (?:of )?our (?:roles|positions|jobs) are remote|all[- ]remote (?:company|team|organi[sz]ation)|we are (?:an? )?(?:fully |100% )?(?:distributed|remote) (?:company|team)/i;
const DESC_HYBRID = /(?:this|the) (?:role|position) is hybrid|\bhybrid (?:role|position|work(?:ing)? model|schedule)|\d+ days? (?:a|per) week (?:in|at) (?:the|our) office|in[- ]office \d+ days/i;
const DESC_ONSITE = /(?:this|the) (?:role|position) is (?:fully )?(?:on-?site|in[- ]office|office[- ]based)|must (?:work|be) (?:on-?site|in (?:the|our) office)/i;

/** Phrases in the description that explicitly open the role to India. */
const DESC_INDIA_OK = [
  /remote[^.\n]{0,40}\bindia\b/i, // "remote (India)", "remote in India", "remotely from anywhere in India"
  /\bindia\b[^.\n]{0,20}\(?remote\)?/i, // "India (Remote)"
  /(?:based|located|living|reside|residing) (?:anywhere )?in india/i,
  /(?:hire|hiring|employ|open to candidates?)[^.\n]{0,60}\bindia\b/i, // "we can hire in India, ...", "open to candidates in India"
  /(?:countries|locations)[^.\n]{0,80}\bindia\b/i, // "Eligible countries: ..., India, ..."
];

const DESC_INDIA_EXCLUDED = [
  /(?:excluding|except(?: for)?|other than|outside of)\s+[^.\n]{0,40}\bindia\b/i,
  /(?:cannot|can't|can not|unable to|not able to|do not|don't|are not able to)\s+(?:currently\s+)?(?:hire|employ|consider|accept)[^.\n]{0,60}\bindia\b/i,
  /\bindia\b[^.\n]{0,30}(?:not eligible|is excluded|are excluded)/i,
];

const RELOCATION = /(?:must|required to|need to|will need to|expected to) relocate|relocation (?:is )?required/i;
const TRAVEL = /(?:travel|on-?site (?:customer|client) visits?)[^.\n]{0,40}?\b([2-9]\d)\s?%|frequent (?:customer|client) (?:visits|travel)|travel (?:frequently|extensively) to customer/i;

const US = /\b(?:united states|usa|u\.s\.a?\.?|us|north america|americas|canada|us[- ]based)\b|,\s?(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b|san francisco|new york|seattle|austin|boston|chicago|toronto|vancouver/i;
const EUROPE = /\b(?:emea|europe|european union|\beu\b|uk|united kingdom|england|ireland|germany|france|spain|portugal|netherlands|poland|italy|sweden|denmark|norway|finland|switzerland|austria|belgium|czech|romania|london|berlin|amsterdam|dublin|paris|lisbon|barcelona|madrid|warsaw)\b/i;
const LATAM = /\b(?:latam|latin america|south america|brazil|mexico|argentina|colombia|chile)\b/i;
const OTHER_COUNTRY = /\b(?:singapore|australia|new zealand|japan|korea|philippines|indonesia|vietnam|malaysia|thailand|israel|uae|dubai|south africa|nigeria|kenya|egypt|pakistan|bangladesh|sri lanka|china|hong kong|taiwan)\b/i;
const APAC = /\bapac\b|asia[- ]pacific|\basia\b|\bapj\b/i;
const WORLDWIDE = /worldwide|world[- ]wide|global(?:ly)?|anywhere|any location|international/i;
const US_AUTH = /(?:authori[sz]ed|eligible|legally able) to work in the (?:u\.?s\.?a?|united states)|(?:must|need to) (?:be )?(?:located|based|resid(?:e|ing)|live) in the (?:u\.?s\.?a?|united states)|u\.?s\.? work authori[sz]ation|requires? (?:u\.?s\.? )?citizenship|security clearance/i;

function find(text: string, re: RegExp): { match: string; index: number } | null {
  const m = re.exec(text);
  return m ? { match: m[0], index: m.index } : null;
}

function regionOf(loc: string): string {
  if (INDIA.test(loc) || INDIA_CODE.test(loc)) return 'India';
  if (APAC.test(loc)) return 'APAC';
  if (WORLDWIDE.test(loc)) return 'Worldwide';
  if (US.test(loc)) return 'US / North America';
  if (EUROPE.test(loc)) return 'Europe / EMEA';
  if (LATAM.test(loc)) return 'LATAM';
  if (OTHER_COUNTRY.test(loc)) return 'Other country';
  if (!loc.trim() || /^remote$/i.test(loc.trim())) return 'Unspecified';
  return 'Other';
}

export function classifyLocation(input: LocationInput): Location {
  const loc = input.locationText.trim();
  const desc = input.description;
  const base = { raw: loc || '(not stated)', evidenceSource: input.url };

  // 1. Remote type: structured data wins; then the location string; then the description.
  let remoteType: Location['remoteType'] = 'unknown';
  if (input.workplaceType) remoteType = input.workplaceType;
  else if (input.isRemote === true) remoteType = 'remote';
  else if (HYBRID.test(loc)) remoteType = 'hybrid';
  else if (ONSITE.test(loc)) remoteType = 'onsite';
  else if (REMOTE.test(loc)) remoteType = 'remote';
  else if (DESC_HYBRID.test(desc)) remoteType = 'hybrid';
  else if (DESC_ONSITE.test(desc)) remoteType = 'onsite';
  else if (DESC_REMOTE.test(desc)) remoteType = 'remote';

  const region = regionOf(loc);
  const indiaInLocation = INDIA.test(loc) || INDIA_CODE.test(loc);

  // 2. Hard rejections, most explicit first.
  for (const re of DESC_INDIA_EXCLUDED) {
    const hit = find(desc, re) ?? find(loc, re);
    if (hit) {
      return { ...base, remoteType, region, india: 'ineligible', evidence: sentenceAround(desc.includes(hit.match) ? desc : loc, hit.index), reason: 'Posting explicitly excludes India' };
    }
  }
  if (remoteType === 'hybrid' || remoteType === 'onsite') {
    const hit = find(loc, remoteType === 'hybrid' ? HYBRID : ONSITE) ?? find(desc, remoteType === 'hybrid' ? DESC_HYBRID : DESC_ONSITE);
    return {
      ...base, remoteType, region, india: 'ineligible',
      evidence: hit ? (loc.includes(hit.match) ? loc : sentenceAround(desc, hit.index)) : `Workplace type: ${remoteType}`,
      reason: remoteType === 'hybrid' ? 'Hybrid role (remote only)' : 'Office-based role (remote only)',
    };
  }
  const reloc = find(desc, RELOCATION);
  if (reloc) return { ...base, remoteType, region, india: 'ineligible', evidence: sentenceAround(desc, reloc.index), reason: 'Requires relocation' };
  const travel = find(desc, TRAVEL);
  if (travel) return { ...base, remoteType, region, india: 'ineligible', evidence: sentenceAround(desc, travel.index), reason: 'Requires frequent in-person customer travel' };

  // 3. Explicit India in the official location field.
  if (indiaInLocation) {
    if (remoteType === 'remote') {
      return { ...base, remoteType, region: 'India', india: 'eligible', evidence: loc, reason: 'Official location lists India and the role is remote' };
    }
    return { ...base, remoteType, region: 'India', india: 'verification_required', evidence: loc, reason: 'India location listed, but the posting does not say the role is remote' };
  }

  // 4. Explicit India in the description.
  for (const re of DESC_INDIA_OK) {
    const hit = find(desc, re);
    if (hit && remoteType !== 'unknown') {
      return { ...base, remoteType, region: region === 'Unspecified' ? 'India' : region, india: 'eligible', evidence: sentenceAround(desc, hit.index), reason: 'Description explicitly opens the remote role to India' };
    }
    if (hit && /remote/i.test(hit.match)) {
      return { ...base, remoteType: 'remote', region: 'India', india: 'eligible', evidence: sentenceAround(desc, hit.index), reason: 'Description explicitly says remote in India' };
    }
  }

  // 5. Region-locked remote / US-only requirements.
  if (region === 'US / North America' || region === 'Europe / EMEA' || region === 'LATAM' || region === 'Other country' || region === 'Other') {
    return { ...base, remoteType, region, india: 'ineligible', evidence: loc, reason: `Limited to ${region === 'Other' ? loc : region}` };
  }
  const auth = find(desc, US_AUTH);
  if (auth) return { ...base, remoteType, region, india: 'ineligible', evidence: sentenceAround(desc, auth.index), reason: 'Requires US residence or work authorization' };

  // 6. Ambiguous: APAC / worldwide / bare "Remote".
  return {
    ...base,
    remoteType,
    region,
    india: 'verification_required',
    evidence: loc || null,
    reason:
      region === 'APAC' ? 'APAC listing does not name India — confirm with recruiter'
      : region === 'Worldwide' ? 'Worldwide listing does not confirm India — confirm with recruiter'
      : 'Remote listing with no stated country — confirm India eligibility',
  };
}
