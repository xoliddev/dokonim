/**
 * Theming (§12): owner-editable tokens → generated ramps → semantic system tokens → CSS custom properties.
 * Pure; the same compile runs in the dashboard preview, the storefront, and server-side share cards.
 */
import { contrast, ensureContrast, hexToOklch, isHex, mixHue, neutralRamp, oklchToHex, onColor, tonalRamp } from './color';
import type { L10n } from './locale';

export const RADII = { sharp: 4, soft: 14, round: 22, pill: 999 } as const;
export type RadiusToken = keyof typeof RADII;

export const FONT_PAIRS = {
  'unbounded-onest': { display: "'Unbounded Variable', 'Onest Variable', system-ui, sans-serif", ui: "'Onest Variable', system-ui, sans-serif", label: 'Unbounded · Onest' },
  'onest-onest': { display: "'Onest Variable', system-ui, sans-serif", ui: "'Onest Variable', system-ui, sans-serif", label: 'Onest' },
  'serif-onest': { display: "Georgia, 'Times New Roman', serif", ui: "'Onest Variable', system-ui, sans-serif", label: 'Serif · Onest' },
  'unbounded-system': { display: "'Unbounded Variable', system-ui, sans-serif", ui: 'system-ui, -apple-system, Roboto, sans-serif', label: 'Unbounded · System' },
  'system-system': { display: 'system-ui, -apple-system, Roboto, sans-serif', ui: 'system-ui, -apple-system, Roboto, sans-serif', label: 'System' },
} as const;
export type FontPairId = keyof typeof FONT_PAIRS;

export interface ThemeTokens {
  brand: string;
  accent2: string | null;
  mode: 'telegram' | 'light' | 'dark' | 'brand';
  radius: RadiusToken;
  density: 'compact' | 'comfortable';
  fontPair: FontPairId;
  cardStyle: 'gallery' | 'catalog' | 'editorial' | 'ticket';
  motif: 'ikat' | 'suzani' | 'none';
  buttonShape: 'soft' | 'pill' | 'sharp';
  imageFit: 'cover' | 'contain';
  motion: 'expressive' | 'calm';
}

export const DEFAULT_TOKENS: ThemeTokens = {
  brand: '#1f4fa8',
  accent2: null,
  mode: 'light',
  radius: 'soft',
  density: 'comfortable',
  fontPair: 'unbounded-onest',
  cardStyle: 'gallery',
  motif: 'ikat',
  buttonShape: 'soft',
  imageFit: 'cover',
  motion: 'expressive',
};

/** Coerce untrusted input into valid tokens (unknown keys dropped, bad values defaulted). */
export function sanitizeTokens(input: unknown): ThemeTokens {
  const i = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
  return {
    brand: isHex(i.brand) ? normHex(i.brand) : DEFAULT_TOKENS.brand,
    accent2: isHex(i.accent2) ? normHex(i.accent2) : null,
    mode: oneOf(i.mode, ['telegram', 'light', 'dark', 'brand'] as const, DEFAULT_TOKENS.mode),
    radius: oneOf(i.radius, ['sharp', 'soft', 'round', 'pill'] as const, DEFAULT_TOKENS.radius),
    density: oneOf(i.density, ['compact', 'comfortable'] as const, DEFAULT_TOKENS.density),
    fontPair: oneOf(i.fontPair, Object.keys(FONT_PAIRS) as FontPairId[], DEFAULT_TOKENS.fontPair),
    cardStyle: oneOf(i.cardStyle, ['gallery', 'catalog', 'editorial', 'ticket'] as const, DEFAULT_TOKENS.cardStyle),
    motif: oneOf(i.motif, ['ikat', 'suzani', 'none'] as const, DEFAULT_TOKENS.motif),
    buttonShape: oneOf(i.buttonShape, ['soft', 'pill', 'sharp'] as const, DEFAULT_TOKENS.buttonShape),
    imageFit: oneOf(i.imageFit, ['cover', 'contain'] as const, DEFAULT_TOKENS.imageFit),
    motion: oneOf(i.motion, ['expressive', 'calm'] as const, DEFAULT_TOKENS.motion),
  };
}

function normHex(h: string): string {
  let x = h.trim().replace('#', '').toLowerCase();
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  return `#${x}`;
}

/** Telegram themeParams subset we harmonise with. */
export interface TelegramThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  section_separator_color?: string;
  section_bg_color?: string;
}

export interface CompiledTheme {
  vars: Record<string, string>;
  scheme: 'light' | 'dark';
  notices: Array<'accent_text_adjusted' | 'low_contrast_brand'>;
  headerColor: string;
  bottomBarColor: string;
}

export function compileTheme(t: ThemeTokens, opts: { prefersDark?: boolean; telegram?: TelegramThemeParams } = {}): CompiledTheme {
  const brandO = hexToOklch(t.brand);
  const ramp = tonalRamp(t.brand);
  const n = neutralRamp(t.brand);
  const notices: CompiledTheme['notices'] = [];
  const tg = opts.telegram;
  let scheme: 'light' | 'dark' =
    t.mode === 'dark' || t.mode === 'brand' ? 'dark' : t.mode === 'light' ? 'light' : opts.prefersDark ? 'dark' : 'light';
  let surface: string, raised: string, sunken: string, ink: string, muted: string, outline: string;
  if (t.mode === 'telegram' && tg?.bg_color && tg.text_color) {
    surface = tg.bg_color;
    raised = tg.section_bg_color ?? tg.bg_color;
    sunken = tg.secondary_bg_color ?? tg.bg_color;
    ink = tg.text_color;
    muted = tg.hint_color ?? n[6]!;
    outline = tg.section_separator_color ?? (scheme === 'dark' ? n[9]! : n[2]!);
    scheme = contrast('#ffffff', surface) > contrast('#000000', surface) ? 'dark' : 'light';
  } else if (scheme === 'light') {
    surface = n[1]!;
    raised = oklchToHex({ l: 0.995, c: 0.003, h: brandO.h });
    sunken = n[2]!;
    ink = oklchToHex({ l: 0.2, c: 0.02, h: brandO.h });
    muted = oklchToHex({ l: 0.48, c: 0.018, h: brandO.h });
    outline = n[3]!;
  } else if (t.mode === 'brand') {
    surface = oklchToHex({ l: 0.2, c: Math.min(0.05, brandO.c * 0.35), h: brandO.h });
    raised = oklchToHex({ l: 0.25, c: Math.min(0.055, brandO.c * 0.38), h: brandO.h });
    sunken = oklchToHex({ l: 0.16, c: Math.min(0.04, brandO.c * 0.3), h: brandO.h });
    ink = oklchToHex({ l: 0.96, c: 0.012, h: brandO.h });
    muted = oklchToHex({ l: 0.74, c: 0.03, h: brandO.h });
    outline = oklchToHex({ l: 0.34, c: Math.min(0.05, brandO.c * 0.3), h: brandO.h });
  } else {
    surface = n[10]!;
    raised = oklchToHex({ l: 0.27, c: 0.01, h: brandO.h });
    sunken = n[11]!;
    ink = n[0]!;
    muted = n[5]!;
    outline = n[9]!;
  }
  const accent = scheme === 'dark' && brandO.l < 0.45 ? ramp[5]! : t.brand;
  const onAccent = onColor(accent);
  if (contrast(accent, onAccent) < 4.5) notices.push('low_contrast_brand');
  const at = ensureContrast(accent, surface, 4.5);
  if (at.adjusted) notices.push('accent_text_adjusted');
  const accentSoft = scheme === 'dark' ? oklchToHex({ l: 0.3, c: Math.min(0.07, brandO.c * 0.5), h: brandO.h }) : ramp[1]!;
  const hueShift = (h: number) => mixHue(h, brandO.h, 0.12);
  const sem = (h: number, l: number, c: number) => oklchToHex({ l, c, h: hueShift(h) });
  const dark = scheme === 'dark';
  const success = ensureContrast(sem(150, dark ? 0.75 : 0.5, 0.13), surface, 4.5).hex;
  const warning = ensureContrast(sem(70, dark ? 0.8 : 0.55, 0.14), surface, 4.5).hex;
  const danger = ensureContrast(sem(25, dark ? 0.7 : 0.52, 0.18), surface, 4.5).hex;
  const sale = danger;
  const rating = dark ? '#f2b544' : '#c47f00';
  const radius = RADII[t.radius];
  const btnRadius = t.buttonShape === 'pill' ? 999 : t.buttonShape === 'sharp' ? 4 : Math.min(radius, 14);
  const fonts = FONT_PAIRS[t.fontPair];
  const comfy = t.density === 'comfortable';
  const vars: Record<string, string> = {
    '--c-surface': surface,
    '--c-surface-raised': raised,
    '--c-surface-sunken': sunken,
    '--c-ink': ink,
    '--c-ink-muted': ensureContrast(muted, surface, 4.5).hex,
    '--c-outline': outline,
    '--c-accent': accent,
    '--c-on-accent': onAccent,
    '--c-accent-soft': accentSoft,
    '--c-accent-text': at.hex,
    '--c-accent-2': t.accent2 ?? ramp[8]!,
    '--c-price': ink,
    '--c-price-old': ensureContrast(muted, surface, 3).hex,
    '--c-sale': sale,
    '--c-rating': rating,
    '--c-focus': at.hex,
    '--c-success': success,
    '--c-warning': warning,
    '--c-danger': danger,
    '--c-print': dark ? 'rgb(0 0 0 / 0.45)' : `color-mix(in oklab, ${ink} 9%, transparent)`,
    '--r-card': `${Math.min(radius, 28)}px`,
    '--r-media': `${Math.max(0, Math.min(radius, 28) - 4)}px`,
    '--r-btn': `${btnRadius}px`,
    '--r-chip': `${t.radius === 'sharp' ? 4 : 999}px`,
    '--r-sheet': `${Math.min(Math.max(radius, 14), 28)}px`,
    '--pad-card': comfy ? '14px' : '10px',
    '--gap': comfy ? '12px' : '8px',
    '--font-display': fonts.display,
    '--font-ui': fonts.ui,
    '--card-aspect': t.cardStyle === 'catalog' ? '1 / 1' : t.cardStyle === 'editorial' ? '3 / 4' : '4 / 5',
    '--image-fit': t.imageFit,
    '--brand-l': brandO.l.toFixed(3),
    '--brand-c': brandO.c.toFixed(3),
    '--brand-h': brandO.h.toFixed(1),
  };
  ramp.forEach((c, i) => (vars[`--ramp-${i}`] = c));
  return { vars, scheme, notices, headerColor: surface, bottomBarColor: raised };
}

// ── Home sections (§12.2) ───────────────────────────────────────────────────

export const SECTION_TYPES = [
  'hero',
  'stories',
  'category_rail',
  'category_grid',
  'collection_grid',
  'product_carousel',
  'flash_sale',
  'banner',
  'bento',
  'text',
  'image_text',
  'testimonials',
  'faq',
  'contacts_map',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export type LinkTarget =
  | { type: 'product'; id: string }
  | { type: 'category'; id: string }
  | { type: 'collection'; id: string }
  | { type: 'url'; url: string }
  | { type: 'none' };

export interface Block {
  id: string;
  type: string;
  settings: Record<string, unknown>;
  blocks?: Block[];
}

export interface Section {
  id: string;
  type: SectionType;
  hidden?: boolean;
  settings: Record<string, unknown>;
  blocks: Block[];
}

export const UI_BLOCK_DEPTH = 3;

export function blockDepth(blocks: Block[] | undefined): number {
  if (!blocks?.length) return 0;
  return 1 + Math.max(...blocks.map((b) => blockDepth(b.blocks)));
}

export function sanitizeSections(input: unknown): Section[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const cleanBlocks = (bs: unknown, depth: number): Block[] =>
    Array.isArray(bs) && depth < 8
      ? bs
          .filter((b): b is Record<string, unknown> => typeof b === 'object' && !!b && typeof (b as Block).id === 'string')
          .slice(0, 50)
          .map((b) => ({
            id: String(b.id),
            type: String(b.type ?? 'item'),
            settings: (typeof b.settings === 'object' && b.settings) || {},
            blocks: cleanBlocks(b.blocks, depth + 1),
          })) as Block[]
      : [];
  return input
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && !!s && SECTION_TYPES.includes((s as Section).type))
    .filter((s) => {
      const id = String(s.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, 40)
    .map((s) => ({
      id: String(s.id),
      type: s.type as SectionType,
      hidden: !!s.hidden,
      settings: (typeof s.settings === 'object' && s.settings) || {},
      blocks: cleanBlocks(s.blocks, 0),
    })) as Section[];
}

export function moveSection(sections: Section[], id: string, toIndex: number): Section[] {
  const from = sections.findIndex((s) => s.id === id);
  if (from < 0) return sections;
  const next = [...sections];
  const [s] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, s!);
  return next;
}

// ── Business types & presets ───────────────────────────────────────────────

export const BUSINESS_TYPES = ['clothing', 'cosmetics', 'food', 'electronics', 'handmade', 'digital'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface Preset {
  id: string;
  name: string;
  for: BusinessType[];
  tokens: ThemeTokens;
}

const p = (id: string, name: string, forT: BusinessType[], t: Partial<ThemeTokens>): Preset => ({
  id,
  name,
  for: forT,
  tokens: { ...DEFAULT_TOKENS, ...t },
});

export const PRESETS: Preset[] = [
  p('atlas', 'Atlas', ['clothing', 'handmade'], { brand: '#a3195b', cardStyle: 'gallery', motif: 'ikat', radius: 'soft' }),
  p('choyxona', 'Choyxona', ['food'], { brand: '#1f6e5a', cardStyle: 'ticket', motif: 'suzani', radius: 'round', fontPair: 'serif-onest' }),
  p('lab', 'Lab', ['cosmetics'], { brand: '#6b4fd8', cardStyle: 'editorial', motif: 'none', radius: 'round', fontPair: 'onest-onest', buttonShape: 'pill' }),
  p('volt', 'Volt', ['electronics', 'digital'], { brand: '#0f6fd6', mode: 'dark', cardStyle: 'catalog', motif: 'none', radius: 'sharp', buttonShape: 'sharp', fontPair: 'unbounded-system' }),
  p('kashta', 'Kashta', ['handmade', 'clothing'], { brand: '#b5552b', cardStyle: 'editorial', motif: 'suzani', radius: 'soft', fontPair: 'serif-onest' }),
  p('registon', 'Registon', ['clothing', 'cosmetics', 'handmade'], { brand: '#0e7c86', motif: 'ikat', radius: 'round' }),
  p('tun', 'Tun', ['electronics', 'digital', 'cosmetics'], { brand: '#d9a21b', mode: 'brand', cardStyle: 'gallery', motif: 'none', fontPair: 'unbounded-onest' }),
  p('bozor', 'Bozor', ['food', 'electronics', 'clothing', 'cosmetics', 'handmade', 'digital'], { brand: '#1f4fa8', motif: 'ikat' }),
];

export function presetsFor(bt: BusinessType): Preset[] {
  return [...PRESETS.filter((x) => x.for.includes(bt)), ...PRESETS.filter((x) => !x.for.includes(bt))];
}

let secSeq = 0;
const sid = (t: string) => `${t}-${(++secSeq).toString(36)}`;

/** Default home layout for a new store of the given business type. */
export function defaultSections(bt: BusinessType, storeName: L10n): Section[] {
  secSeq = 0;
  const s = (type: SectionType, settings: Record<string, unknown> = {}, blocks: Block[] = []): Section => ({ id: sid(type), type, settings, blocks });
  const headline: Record<BusinessType, L10n> = {
    clothing: { uz: 'Yangi mavsum kolleksiyasi', ru: 'Новая коллекция сезона', en: 'New season collection' },
    cosmetics: { uz: 'Teringiz uchun gʻamxoʻrlik', ru: 'Забота о вашей коже', en: 'Care for your skin' },
    food: { uz: 'Bugun pishgan, bugun yetkaziladi', ru: 'Приготовлено сегодня, доставим сегодня', en: 'Made today, delivered today' },
    electronics: { uz: 'Rasmiy kafolat bilan texnika', ru: 'Техника с официальной гарантией', en: 'Electronics with official warranty' },
    handmade: { uz: 'Qoʻlda yasalgan, mehr bilan', ru: 'Сделано вручную, с любовью', en: 'Handmade with care' },
    digital: { uz: 'Darhol yuklab oling', ru: 'Скачайте сразу', en: 'Download instantly' },
  };
  return [
    s('hero', { headline: headline[bt], sub: storeName, ctaLabel: { uz: 'Katalogni koʻrish', ru: 'Смотреть каталог', en: 'Browse catalog' }, ctaLink: { type: 'none' } }),
    s('stories'),
    s('category_rail', { title: { uz: 'Kategoriyalar', ru: 'Категории', en: 'Categories' } }),
    s('flash_sale', { title: { uz: 'Chegirmalar', ru: 'Скидки', en: 'Deals' } }),
    s('product_carousel', { title: { uz: 'Yangi kelganlar', ru: 'Новинки', en: 'New arrivals' }, source: 'new', limit: 10 }),
    s('bento', { title: { uz: 'Tanlovlar', ru: 'Подборки', en: 'Picks' } }),
    s('product_carousel', { title: { uz: 'Eng koʻp sotilgan', ru: 'Хиты продаж', en: 'Bestsellers' }, source: 'bestsellers', limit: 10 }),
    s('testimonials', { title: { uz: 'Xaridorlar fikri', ru: 'Отзывы покупателей', en: 'What buyers say' } }),
    s('faq', { title: { uz: 'Koʻp soʻraladigan savollar', ru: 'Частые вопросы', en: 'FAQ' } }, [
      { id: 'faq-1', type: 'qa', settings: { q: { uz: 'Yetkazib berish qancha vaqt oladi?', ru: 'Сколько занимает доставка?', en: 'How long does delivery take?' }, a: { uz: 'Toshkent boʻylab 1 kun, viloyatlarga 2–4 kun.', ru: 'По Ташкенту 1 день, по регионам 2–4 дня.', en: '1 day in Tashkent, 2–4 days to regions.' } } },
      { id: 'faq-2', type: 'qa', settings: { q: { uz: 'Qaytarish mumkinmi?', ru: 'Можно ли вернуть товар?', en: 'Can I return an item?' }, a: { uz: '14 kun ichida, yorligʻi saqlangan boʻlsa.', ru: 'В течение 14 дней при сохранённых бирках.', en: 'Within 14 days with tags attached.' } } },
    ]),
    s('contacts_map'),
  ];
}
