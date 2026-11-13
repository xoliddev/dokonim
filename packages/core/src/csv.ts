/**
 * CSV import/export. Shopify-compatible product columns + Ecwid-style `category_path`
 * ("Kiyim / Ayollar / Koʻylaklar") that auto-builds the nested category tree.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') {
        if (src[i + 1] === '"') (field += '"'), i++;
        else q = false;
      } else field += ch;
    } else if (ch === '"' && field === '') q = true;
    else if (ch === d) row.push(field), (field = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function detectDelimiter(src: string): string {
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((c) => [c, first.split(c).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}\r\n`;
}

export function splitCategoryPath(p: string): string[] {
  return p
    .split(/\s*(?:\/|>|›|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ImportVariantRow {
  options: string[]; // values in option order
  sku: string;
  price: number; // minor
  compareAt: number | null;
  stock: number | null;
  barcode: string;
  weightG: number;
}

export interface ImportProduct {
  handle: string;
  title: string;
  description: string;
  vendor: string;
  tags: string[];
  status: 'active' | 'draft';
  categoryPath: string[];
  optionNames: string[];
  variants: ImportVariantRow[];
  images: string[];
  rows: number[];
}

export interface ImportRowError {
  row: number; // 1-based line number in the file (header = 1)
  column?: string;
  code: 'missing_title' | 'bad_price' | 'bad_stock' | 'duplicate_variant' | 'too_many_options' | 'missing_column' | 'option_mismatch';
  message: string;
}

export interface ImportPlan {
  products: ImportProduct[];
  errors: ImportRowError[];
  categoryPaths: string[][];
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, ' ');

function priceToMinor(v: string): number | null {
  const s = v.replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN;
}

export function planProductImport(text: string): ImportPlan {
  const rows = parseCsv(text);
  const errors: ImportRowError[] = [];
  if (rows.length === 0) return { products: [], errors: [{ row: 1, code: 'missing_column', message: 'Empty file' }], categoryPaths: [] };
  const header = rows[0]!.map(norm);
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const C = {
    handle: col('handle', 'url handle'),
    title: col('title', 'name', 'nomi'),
    body: col('body (html)', 'body', 'description', 'tavsif'),
    vendor: col('vendor', 'brand'),
    tags: col('tags'),
    status: col('status'),
    category: col('category path', 'category', 'kategoriya'),
    sku: col('variant sku', 'sku'),
    grams: col('variant grams', 'weight', 'grams'),
    qty: col('variant inventory qty', 'stock', 'qty', 'inventory'),
    price: col('variant price', 'price', 'narx'),
    compare: col('variant compare at price', 'compare at price'),
    barcode: col('variant barcode', 'barcode'),
    image: col('image src', 'image'),
    opt: [1, 2, 3].map((k) => ({ name: col(`option${k} name`), value: col(`option${k} value`) })),
  };
  if (C.title < 0 && C.handle < 0) errors.push({ row: 1, code: 'missing_column', column: 'Title', message: 'A Title or Handle column is required' });
  if (C.price < 0) errors.push({ row: 1, code: 'missing_column', column: 'Variant Price', message: 'A price column is required' });
  if (errors.length) return { products: [], errors, categoryPaths: [] };
  const byHandle = new Map<string, ImportProduct>();
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const title = cell(r, C.title);
    const handle = (cell(r, C.handle) || title).toLowerCase().replace(/\s+/g, '-');
    if (!handle) {
      errors.push({ row: line, code: 'missing_title', column: 'Title', message: 'Row has no title or handle' });
      return;
    }
    let p = byHandle.get(handle);
    if (!p) {
      if (!title) {
        errors.push({ row: line, code: 'missing_title', column: 'Title', message: 'First row of a product needs a title' });
        return;
      }
      p = {
        handle,
        title,
        description: cell(r, C.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        vendor: cell(r, C.vendor),
        tags: cell(r, C.tags).split(',').map((t) => t.trim()).filter(Boolean),
        status: /draft|false|no/i.test(cell(r, C.status)) ? 'draft' : 'active',
        categoryPath: splitCategoryPath(cell(r, C.category)),
        optionNames: C.opt.map((o) => cell(r, o.name)).filter(Boolean),
        variants: [],
        images: [],
        rows: [],
      };
      byHandle.set(handle, p);
    }
    p.rows.push(line);
    const img = cell(r, C.image);
    if (img && !p.images.includes(img)) p.images.push(img);
    const priceRaw = cell(r, C.price);
    if (!priceRaw && !cell(r, C.sku) && C.opt.every((o) => !cell(r, o.value))) return; // image-only row
    const price = priceToMinor(priceRaw);
    if (price === null || Number.isNaN(price)) {
      errors.push({ row: line, code: 'bad_price', column: 'Variant Price', message: `Price "${priceRaw}" is not a number` });
      return;
    }
    const stockRaw = cell(r, C.qty);
    const stock = stockRaw === '' ? null : Number(stockRaw);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      errors.push({ row: line, code: 'bad_stock', column: 'Variant Inventory Qty', message: `Stock "${stockRaw}" must be a whole number ≥ 0` });
      return;
    }
    const options = C.opt.map((o) => cell(r, o.value)).filter((_, i) => i < p!.optionNames.length);
    if (options.length !== p.optionNames.length || options.some((o) => !o)) {
      if (p.optionNames.length) {
        errors.push({ row: line, code: 'option_mismatch', message: `Expected values for ${p.optionNames.join(', ')}` });
        return;
      }
    }
    if (p.variants.some((v) => v.options.join('|') === options.join('|'))) {
      errors.push({ row: line, code: 'duplicate_variant', message: `Duplicate variant ${options.join(' / ') || '(default)'}` });
      return;
    }
    const compare = priceToMinor(cell(r, C.compare));
    p.variants.push({
      options,
      sku: cell(r, C.sku),
      price,
      compareAt: compare && !Number.isNaN(compare) && compare > price ? compare : null,
      stock,
      barcode: cell(r, C.barcode),
      weightG: Number(cell(r, C.grams)) || 0,
    });
  });
  const products = [...byHandle.values()].filter((p) => p.variants.length > 0);
  const seen = new Set<string>();
  const categoryPaths: string[][] = [];
  for (const p of products) {
    for (let k = 1; k <= p.categoryPath.length; k++) {
      const key = p.categoryPath.slice(0, k).join(' / ').toLowerCase();
      if (!seen.has(key)) seen.add(key), categoryPaths.push(p.categoryPath.slice(0, k));
    }
  }
  return { products, errors, categoryPaths };
}
