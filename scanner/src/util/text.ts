import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', rupee: '₹', euro: '€', pound: '£',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML (possibly entity-escaped HTML, as Greenhouse returns) -> readable plain text with line breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s); // escaped markup
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Stable fingerprint that ignores whitespace, punctuation and case so cosmetic edits do not count as changes. */
export function fingerprint(text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return sha256(norm).slice(0, 16);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function compileAll(patterns: string[]): RegExp[] {
  return patterns.map((p) => new RegExp(p, 'i'));
}

export function firstMatch(text: string, regexes: RegExp[]): RegExpExecArray | null {
  for (const r of regexes) {
    const m = r.exec(text);
    if (m) return m;
  }
  return null;
}

/** The sentence (or line) containing position `index`, trimmed to `max` chars. Used to record exact evidence. */
export function sentenceAround(text: string, index: number, max = 240): string {
  const boundary = /[.!?\n•]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !boundary.test(text[end])) end++;
  let s = text.slice(start, Math.min(end + 1, text.length)).trim();
  if (s.length > max) {
    const rel = index - start;
    const from = Math.max(0, rel - Math.floor(max / 2));
    s = (from > 0 ? '…' : '') + s.slice(from, from + max).trim() + '…';
  }
  return s;
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
