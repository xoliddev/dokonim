/**
 * A tiny ICU MessageFormat subset (§15): `{name}` interpolation and
 * `{count, plural, =0 {…} one {# item} few {…} many {…} other {# items}}` with `#` = the formatted count.
 * Plural categories follow CLDR (uz: one/other; ru: one/few/many/other; en: one/other). The rules are
 * hand-written so they work in old WebViews without Intl.PluralRules locale data.
 */
import type { Locale } from '@dokonim/core';

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type Params = Record<string, string | number | null | undefined>;

export function pluralCategory(locale: Locale, n: number): PluralCategory {
  const abs = Math.abs(n);
  if (!Number.isInteger(abs)) return 'other';
  if (locale === 'ru') {
    const m10 = abs % 10;
    const m100 = abs % 100;
    if (m10 === 1 && m100 !== 11) return 'one';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
    return 'many';
  }
  return abs === 1 ? 'one' : 'other';
}

type Node = string | { arg: string } | { arg: string; plural: Record<string, Node[]> };

/** Parses a message once; results are cached per string. */
function parse(src: string): Node[] {
  let i = 0;
  const parseNodes = (inPlural: boolean): Node[] => {
    const out: Node[] = [];
    let buf = '';
    while (i < src.length) {
      const ch = src[i]!;
      if (ch === '}' && inPlural) break;
      if (ch === '{') {
        if (buf) out.push(buf), (buf = '');
        i++;
        out.push(parseArg());
        continue;
      }
      if (ch === '#' && inPlural) {
        if (buf) out.push(buf), (buf = '');
        out.push({ arg: '#' });
        i++;
        continue;
      }
      buf += ch;
      i++;
    }
    if (buf) out.push(buf);
    return out;
  };
  const readUntil = (stops: string) => {
    const start = i;
    while (i < src.length && !stops.includes(src[i]!)) i++;
    return src.slice(start, i).trim();
  };
  const parseArg = (): Node => {
    const name = readUntil(',}');
    if (src[i] === '}') {
      i++;
      return { arg: name };
    }
    i++; // ,
    const kind = readUntil(',}');
    if (kind !== 'plural' || src[i] !== ',') throw new SyntaxError(`Unsupported argument "{${name}, ${kind}}"`);
    i++; // ,
    const plural: Record<string, Node[]> = {};
    for (;;) {
      const sel = readUntil('{}');
      if (src[i] === '}') {
        i++;
        break;
      }
      if (!sel) throw new SyntaxError(`Plural selector missing in "${src}"`);
      i++; // {
      plural[sel] = parseNodes(true);
      if (src[i] !== '}') throw new SyntaxError(`Unclosed plural branch in "${src}"`);
      i++; // }
    }
    if (!plural.other) throw new SyntaxError(`Plural without "other" in "${src}"`);
    return { arg: name, plural };
  };
  const nodes = parseNodes(false);
  if (i < src.length) throw new SyntaxError(`Unbalanced "}" in "${src}"`);
  return nodes;
}

const cache = new Map<string, Node[]>();
function compiled(src: string): Node[] {
  let n = cache.get(src);
  if (!n) {
    n = src.includes('{') || src.includes('#') ? parse(src) : [src];
    cache.set(src, n);
  }
  return n;
}

export function formatNumber(n: number, locale: Locale): string {
  const sep = locale === 'en' ? ',' : ' ';
  const [int, frac] = Math.abs(n).toString().split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const dec = frac ? (locale === 'en' ? '.' : ',') + frac : '';
  return (n < 0 ? '-' : '') + grouped + dec;
}

function render(nodes: Node[], params: Params, locale: Locale, hash: number | null): string {
  let s = '';
  for (const n of nodes) {
    if (typeof n === 'string') s += n;
    else if (n.arg === '#' && !('plural' in n)) s += hash === null ? '#' : formatNumber(hash, locale);
    else if ('plural' in n) {
      const v = Number(params[n.arg] ?? 0);
      const branch = n.plural[`=${v}`] ?? n.plural[pluralCategory(locale, v)] ?? n.plural.other!;
      s += render(branch, params, locale, v);
    } else {
      const v = params[n.arg];
      s += v === null || v === undefined ? '' : typeof v === 'number' ? formatNumber(v, locale) : v;
    }
  }
  return s;
}

export function formatMessage(src: string, params: Params = {}, locale: Locale = 'uz'): string {
  return render(compiled(src), params, locale, null);
}

/** Argument names a message uses (for catalogue consistency tests). */
export function messageArgs(src: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (typeof n === 'string' || n.arg === '#') continue;
      names.add(n.arg);
      if ('plural' in n) Object.values(n.plural).forEach(walk);
    }
  };
  walk(compiled(src));
  return [...names].sort();
}
