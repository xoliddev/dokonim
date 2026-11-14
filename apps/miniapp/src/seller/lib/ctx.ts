/**
 * Seller-side helpers shared by every dashboard screen.
 *
 *   const { storeId, slug, store, role, loading, error } = useSeller();
 *   const go = sellerPath(slug);  go('products')  →  /m/<slug>/products
 */
import { useCurrentStore, useSession } from '../../shell/session';

export function useSeller() {
  const { slug } = useSession();
  const q = useCurrentStore();
  const store = q.data?.store;
  return {
    slug: slug ?? '',
    store,
    storeId: store?.id as string | undefined,
    role: (q.data?.role ?? null) as string | null,
    theme: q.data?.theme,
    loading: q.loading && !q.data,
    error: q.data ? undefined : q.error,
    reload: q.reload,
  };
}

export const sellerPath = (slug: string) => (sub = '') => `/m/${slug}${sub ? `/${sub}` : ''}`;

/** RFC 4122 v4 id for client-generated rows (options, values, variants). */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "125 000" / "125000" / "125 000,50" → integer tiyin (null when empty or invalid). */
export function parseSom(input: string): number | null {
  const s = input.replace(/[\s  ]/g, '').replace(',', '.');
  if (!s) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Integer tiyin → editable so'm string with thin grouping ("125 000"). */
export function somText(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return '';
  const whole = Math.round(minor / 100);
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Downscales a picked image file to a JPEG/PNG data URL (≤ maxSide px) so it fits the media limits. */
export async function fileToDataUrl(file: File, maxSide = 1200, quality = 0.85): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml') return raw;
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = raw;
  });
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality);
}
