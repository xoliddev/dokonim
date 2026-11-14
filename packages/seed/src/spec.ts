/**
 * Declarative demo-store specs. A spec is plain data; `build.ts` turns it into real service calls
 * (`stores.create`, `admin.categories.create`, `admin.products.save`, …) so seeded data goes through
 * exactly the same validation, pricing and inventory code as anything a visitor creates.
 */
import type { BusinessType, L10n } from '@dokonim/core';
import type { StoreSettings } from '@dokonim/db';

export const L = (uz: string, ru: string, en: string): L10n => ({ uz, ru, en });

export interface CatSpec {
  name: L10n;
  icon?: string;
  children?: CatSpec[];
}

export const cat = (name: L10n, children?: CatSpec[], icon?: string): CatSpec => ({ name, children, icon });

export interface ColorSpec {
  label: L10n;
  hex: string;
}

export interface ProductSpec {
  /** Stable handle used by collections, promos and order generation. */
  key: string;
  title: L10n;
  desc: L10n;
  /** Category path by Uzbek names, e.g. "Kiyim/Ayollar/Koʻylaklar". */
  cat: string;
  /** Price in whole soʻm (converted to tiyin by the builder). */
  price: number;
  /** Compare-at ("was") price in soʻm. */
  was?: number;
  /** Art kind from art.ts plus optional pattern / colours. */
  art: { kind: string; p?: 'ikat' | 'suzani' | 'stripe' | 'none'; c?: string; c2?: string };
  /** First option (size, storage, weight…). */
  sizes?: { name?: L10n; values: string[]; delta?: number[] };
  /** Colour option — each colour re-tints the art for its variants. */
  colors?: ColorSpec[];
  /** Stock per variant (uniform number, or a list cycled across variants). */
  stock?: number | number[];
  tags?: string[];
  brand?: string;
  attrs?: Array<[L10n, L10n]>;
  weightG?: number;
  /** Days since the product was added (drives "Yangi kelganlar"). */
  ageDays?: number;
}

export interface PromoSpec {
  kind: 'code' | 'automatic' | 'flash_sale';
  title: string;
  code?: string;
  valueType: 'percent' | 'fixed' | 'free_shipping';
  /** Percent, or soʻm for fixed. */
  value: number;
  minSubtotal?: number;
  /** Product keys; omitted = whole store. */
  products?: string[];
  /** Flash sales: hours from now until the end (honest countdown). */
  endsInHours?: number;
  usageLimit?: number;
}

export interface CollectionSpec {
  title: L10n;
  kind: 'manual' | 'automated';
  products?: string[];
  newerThanDays?: number;
}

export interface StoreSpec {
  slug: string;
  name: string;
  nameL10n: L10n;
  tagline: L10n;
  businessType: BusinessType;
  preset: string;
  brand?: string;
  settings: StoreSettings;
  categories: CatSpec[];
  products: ProductSpec[];
  promos: PromoSpec[];
  collections: CollectionSpec[];
  /** Historical orders to generate. */
  orders: { count: number; days: number; seed: number };
  /** Short review texts used for delivered orders. */
  reviews: string[];
}
