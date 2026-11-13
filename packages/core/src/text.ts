/**
 * Uzbek-aware text normalisation shared by server search, the demo worker and slug generation.
 *  - canonical oʻ/gʻ use U+02BB, the tutuq belgisi is U+02BC
 *  - search keys fold every apostrophe variant away and transliterate Cyrillic to Latin,
 *    so "кўйлак", "ko'ylak", "koʻylak" and "koylak" all produce "koylak".
 */
export const OKINA = 'ʻ'; // ʻ  (oʻ, gʻ)
export const TUTUQ = 'ʼ'; // ʼ

const APOS = /['`‘’ʻʼ´ʹ]/g;

/** Display normalisation: keeps the owner's text, but fixes oʻ/gʻ to the canonical letter. */
export function normalizeUzbekApostrophes(s: string): string {
  return s.replace(/([oOgG])['`‘’ʼ´]/g, `$1${OKINA}`).replace(/([a-zA-Z])['`‘’´](?=[a-zA-Z])/g, `$1${TUTUQ}`);
}

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

export function cyrillicToLatin(s: string): string {
  let out = '';
  for (const ch of s) {
    const lower = ch.toLowerCase();
    const t = CYR[lower];
    if (t === undefined) out += ch;
    else out += ch === lower ? t : t.charAt(0).toUpperCase() + t.slice(1);
  }
  return out;
}

/** The search key: lower → Cyrillic→Latin → fold apostrophes → collapse whitespace. */
export function searchKey(s: string): string {
  return cyrillicToLatin(s.normalize('NFKC').toLowerCase())
    .replace(APOS, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Builds the denormalised `search_doc` column from all the strings that should be searchable. */
export function buildSearchDoc(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const w of searchKey(p).split(' ')) if (w) seen.add(w);
  }
  return [...seen].join(' ');
}

/** Escape LIKE wildcards in user input. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
