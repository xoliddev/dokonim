-- Do'konim schema v1. Runs unchanged on PostgreSQL 17 and PGlite (ltree + pg_trgm ship with both).
-- Money: bigint minor units (tiyin). IDs: UUIDv7 generated in core. Every tenant table: store_id first.

create extension if not exists ltree;
create extension if not exists pg_trgm;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'dokonim_app') then
    create role dokonim_app nologin;
  end if;
end $$;

create or replace function app_store() returns uuid language sql stable as
  $$ select nullif(current_setting('app.store_id', true), '')::uuid $$;
create or replace function app_user() returns uuid language sql stable as
  $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ── Platform ────────────────────────────────────────────────────────────────
create table users (
  id uuid primary key,
  telegram_id bigint not null unique,
  first_name text not null,
  last_name text,
  username text,
  language_code text not null default 'uz',
  photo_url text,
  phone text,
  phone_verified boolean not null default false,
  is_platform_admin boolean not null default false,
  notify jsonb not null default '{"orders": true, "marketing": false}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table refresh_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on refresh_tokens (family_id);

create table processed_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create table stores (
  id uuid primary key,
  slug text not null,
  name jsonb not null,
  tagline jsonb not null default '{}',
  status text not null default 'active' check (status in ('draft','active','suspended','closed')),
  owner_user_id uuid not null references users(id),
  business_type text not null,
  default_locale text not null default 'uz',
  locales text[] not null default '{uz,ru,en}',
  currency char(3) not null default 'UZS',
  timezone text not null default 'Asia/Tashkent',
  plan text not null default 'free',
  plan_flags jsonb not null default '{"productLimit": 500, "removeBadge": false, "customBot": false}',
  logo_url text,
  settings jsonb not null default '{}',
  installments jsonb not null default '[]',
  published_theme_id uuid,
  order_seq int not null default 1000,
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index stores_slug_key on stores (lower(slug));

create table store_members (
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references users(id),
  role text not null check (role in ('owner','admin','manager','catalog_editor','order_operator','viewer')),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index on store_members (user_id);

create table invites (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  token_hash text not null unique,
  role text not null,
  created_by uuid not null references users(id),
  expires_at timestamptz not null,
  used_by uuid references users(id),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table customers (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  user_id uuid references users(id),
  name text not null,
  phone text,
  tags text[] not null default '{}',
  note text not null default '',
  is_blocked boolean not null default false,
  orders_count int not null default 0,
  total_spent bigint not null default 0,
  last_order_at timestamptz,
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create table addresses (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  label text not null default '',
  region_code text not null,
  district text not null default '',
  line1 text not null,
  line2 text not null default '',
  landmark text not null default '',
  lat double precision,
  lng double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index on addresses (store_id, customer_id);

-- ── Media ───────────────────────────────────────────────────────────────────
create table media (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  kind text not null default 'image' check (kind in ('image','video')),
  url text not null,          -- CDN url, seed asset path or data: URL (demo)
  width int, height int,
  dominant_color text,
  bytes int,
  mime text,
  created_at timestamptz not null default now()
);

-- ── Catalog ─────────────────────────────────────────────────────────────────
create table categories (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  parent_id uuid references categories(id) on delete restrict,
  path ltree not null,
  depth int generated always as (nlevel(path)) stored,
  slug text not null,
  name jsonb not null,
  description jsonb not null default '{}',
  image_url text,
  icon text,
  position int not null default 0,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_sibling_slug on categories (store_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index categories_path_gist on categories using gist (path);
create index on categories (store_id, parent_id, position);

create table products (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  short_id text not null,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  title jsonb not null,
  slug text not null,
  description jsonb not null default '{}',   -- {uz: RichText, ru: RichText, en: RichText}
  category_id uuid references categories(id) on delete set null,
  tags text[] not null default '{}',
  attributes jsonb not null default '[]',    -- [{name: L10n, value: L10n}]
  is_digital boolean not null default false,
  brand text not null default '',
  vendor_code text not null default '',
  size_guide jsonb,
  seo jsonb not null default '{}',
  rating_avg numeric(2,1) not null default 0,
  rating_count int not null default 0,
  sold_count int not null default 0,
  view_count int not null default 0,
  min_price bigint not null default 0,
  max_price bigint not null default 0,
  max_compare_at bigint,
  in_stock boolean not null default false,
  cover_url text,
  search_doc text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, short_id)
);
create index on products (store_id, status, category_id);
create index on products (store_id, created_at desc);
create index products_search_trgm on products using gin (search_doc gin_trgm_ops);

create table product_options (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  position int not null check (position between 1 and 3),
  name jsonb not null,
  display text not null default 'chips' check (display in ('chips','swatch','image')),
  unique (product_id, position) deferrable initially deferred
);

create table option_values (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  option_id uuid not null references product_options(id) on delete cascade,
  position int not null,
  label jsonb not null,
  swatch_hex text,
  swatch_url text
);
create index on option_values (store_id, option_id, position);

create table product_variants (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  option_value_ids uuid[] not null default '{}',
  sku text not null default '',
  barcode text not null default '',
  price bigint not null check (price >= 0),
  compare_at_price bigint,
  cost_price bigint,
  weight_g int not null default 0,
  ikpu_code text,
  package_code text,
  vat_percent numeric(4,1),
  is_default boolean not null default false,
  position int not null default 0,
  media_url text,
  track_inventory boolean not null default true,
  allow_backorder boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, option_value_ids)
);
create index on product_variants (store_id, product_id);
create index on product_variants (store_id, sku);

create table inventory_levels (
  store_id uuid not null references stores(id) on delete cascade,
  variant_id uuid primary key references product_variants(id) on delete cascade,
  on_hand int not null default 0,
  reserved int not null default 0 check (reserved >= 0),
  low_stock_threshold int not null default 3,
  check (on_hand >= 0)
);

create table inventory_movements (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  variant_id uuid not null references product_variants(id) on delete cascade,
  delta int not null,
  reason text not null check (reason in ('purchase','sale','return','adjustment','import','reservation','reservation_release','cancel_restock','initial')),
  ref_type text, ref_id uuid,
  note text not null default '',
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index on inventory_movements (store_id, variant_id, created_at desc);

create table inventory_reservations (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  variant_id uuid not null references product_variants(id) on delete cascade,
  order_id uuid not null,
  qty int not null check (qty > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on inventory_reservations (store_id, order_id);
create index on inventory_reservations (expires_at);

create table product_media (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  kind text not null default 'image',
  url text not null,
  position int not null default 0,
  alt jsonb not null default '{}',
  dominant_color text,
  width int, height int
);
create index on product_media (store_id, product_id, position);

create table collections (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  title jsonb not null,
  slug text not null,
  description jsonb not null default '{}',
  kind text not null check (kind in ('manual','automated')),
  rules jsonb not null default '{"match":"all","rules":[]}',
  sort text not null default 'manual',
  image_url text,
  is_hidden boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, slug)
);

create table product_collections (
  store_id uuid not null references stores(id) on delete cascade,
  collection_id uuid not null references collections(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, product_id)
);
create index on product_collections (store_id, product_id);

create table co_purchases (
  store_id uuid not null references stores(id) on delete cascade,
  product_a uuid not null references products(id) on delete cascade,
  product_b uuid not null references products(id) on delete cascade,
  count int not null default 0,
  primary key (store_id, product_a, product_b)
);

-- ── Carts & orders ──────────────────────────────────────────────────────────
create table carts (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  user_id uuid not null references users(id),
  status text not null default 'active' check (status in ('active','converted','abandoned')),
  promo_code text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index carts_active_per_user on carts (store_id, user_id) where status = 'active';

create table cart_items (
  store_id uuid not null references stores(id) on delete cascade,
  cart_id uuid not null references carts(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  qty int not null check (qty > 0 and qty <= 99),
  added_price bigint not null,
  added_at timestamptz not null default now(),
  primary key (cart_id, variant_id)
);

create table shipping_methods (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  type text not null check (type in ('courier','pickup_point','post','self_pickup')),
  name jsonb not null,
  processing_days int not null default 0,
  cutoff_time text not null default '14:00',
  working_days int[] not null default '{1,2,3,4,5,6}',
  holidays text[] not null default '{}',
  pickup_points jsonb not null default '[]',
  cod_allowed boolean not null default true,
  enabled boolean not null default true,
  position int not null default 0
);

create table shipping_zones (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  name text not null,
  regions text[] not null default '{}',
  districts text[] not null default '{}'
);

create table shipping_rates (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  zone_id uuid not null references shipping_zones(id) on delete cascade,
  method_id uuid not null references shipping_methods(id) on delete cascade,
  calc text not null check (calc in ('flat','weight','free_over')),
  amount bigint not null default 0,
  per_kg bigint,
  free_over bigint,
  transit_days_min int not null default 1,
  transit_days_max int not null default 2,
  unique (zone_id, method_id)
);

create table discounts (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  kind text not null check (kind in ('code','automatic','flash_sale')),
  title text not null default '',
  code text,
  value_type text not null check (value_type in ('percent','fixed','free_shipping','bxgy')),
  value bigint not null default 0,
  bxgy jsonb,
  applies_to jsonb not null default '{"type":"all"}',
  conditions jsonb not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit int,
  per_customer_limit int,
  used_count int not null default 0,
  combines jsonb not null default '{"order":false,"product":false,"shipping":true}',
  priority int not null default 0,
  status text not null default 'active' check (status in ('active','disabled','archived')),
  created_at timestamptz not null default now()
);
create unique index discounts_code_key on discounts (store_id, lower(code)) where code is not null;

create table orders (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  number int not null,
  short_id text not null,
  user_id uuid references users(id),
  customer_id uuid references customers(id),
  status text not null,
  payment_status text not null default 'unpaid',
  fulfillment_status text not null default 'unfulfilled',
  fulfilment_kind text not null default 'delivery',
  payment_method text not null,
  currency char(3) not null default 'UZS',
  subtotal bigint not null,
  discount_total bigint not null default 0,
  shipping_total bigint not null default 0,
  total bigint not null,
  pricing jsonb not null default '{}',
  contact jsonb not null,
  shipping_address jsonb,
  shipping_method_id uuid,
  shipping_method_name jsonb,
  delivery_promise jsonb,
  pickup_code_hash text,
  pickup_code_last text,
  pickup_code text,          -- shown to the buyer only (buyer-scoped read); hashed copy is verified
  note text not null default '',
  source text,
  locale text not null default 'uz',
  idempotency_key text,
  placed_at timestamptz not null default now(),
  paid_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  unique (store_id, number),
  unique (store_id, short_id)
);
create unique index orders_idem on orders (store_id, user_id, idempotency_key) where idempotency_key is not null;
create index on orders (store_id, status, placed_at desc);
create index on orders (store_id, user_id, placed_at desc);

create table order_items (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid,
  product_id uuid,
  title text not null,
  variant_title text not null default '',
  sku text not null default '',
  image_url text,
  unit_price bigint not null,
  qty int not null,
  line_total bigint not null,
  discount_allocations jsonb not null default '[]',
  ikpu_code text, package_code text, vat_percent numeric(4,1),
  reviewed boolean not null default false
);
create index on order_items (store_id, order_id);

create table order_events (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  type text not null,
  from_status text, to_status text,
  actor text not null,
  actor_user_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on order_events (store_id, order_id, created_at);

create table shipments (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  method text not null,
  carrier text not null default '',
  tracking_number text not null default '',
  shipped_at timestamptz,
  delivered_at timestamptz
);

create table discount_redemptions (
  store_id uuid not null references stores(id) on delete cascade,
  discount_id uuid not null references discounts(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  customer_id uuid,
  amount bigint not null,
  primary key (discount_id, order_id)
);

-- ── Payments ────────────────────────────────────────────────────────────────
create table payment_provider_configs (
  store_id uuid not null references stores(id) on delete cascade,
  provider text not null,
  mode text not null default 'sandbox' check (mode in ('sandbox','live')),
  enabled boolean not null default false,
  credentials_enc text,
  public_config jsonb not null default '{}',
  last_verified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (store_id, provider)
);

create table payments (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null,
  mode text not null,
  status text not null default 'created',
  amount bigint not null,
  currency char(3) not null,
  provider_txn_id text,
  provider_state int,
  provider_time timestamptz,
  opened_at timestamptz,
  performed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason int,
  redirect_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create unique index payments_provider_txn on payments (provider, provider_txn_id) where provider_txn_id is not null;
create index on payments (store_id, order_id);

create table payment_events (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  provider text not null,
  kind text not null,
  payload_hash text not null,
  payload text not null,
  signature_ok boolean not null,
  response text not null,
  created_at timestamptz not null default now()
);
create index on payment_events (store_id, created_at desc);

create table refunds (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  payment_id uuid not null references payments(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  amount bigint not null,
  reason text not null default '',
  status text not null default 'pending',
  provider_ref text,
  created_at timestamptz not null default now()
);

create table payouts (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  period text not null,
  gross bigint not null default 0,
  fees bigint not null default 0,
  net bigint not null default 0,
  status text not null default 'placeholder'
);

-- ── Social ──────────────────────────────────────────────────────────────────
create table reviews (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  variant_title text not null default '',
  order_item_id uuid not null unique references order_items(id) on delete cascade,
  user_id uuid references users(id),
  author_name text not null,
  rating int not null check (rating between 1 and 5),
  text text not null default '',
  pros text not null default '',
  cons text not null default '',
  photos text[] not null default '{}',
  status text not null default 'published' check (status in ('pending','published','hidden')),
  helpful_count int not null default 0,
  owner_reply text,
  owner_reply_at timestamptz,
  created_at timestamptz not null default now()
);
create index on reviews (store_id, product_id, status, created_at desc);

create table review_votes (
  store_id uuid not null references stores(id) on delete cascade,
  review_id uuid not null references reviews(id) on delete cascade,
  user_id uuid not null references users(id),
  primary key (review_id, user_id)
);

create table questions (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  product_id uuid not null references products(id) on delete cascade,
  user_id uuid references users(id),
  author_name text not null,
  text text not null,
  status text not null default 'published' check (status in ('published','hidden')),
  created_at timestamptz not null default now()
);
create index on questions (store_id, product_id, created_at desc);

create table answers (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  question_id uuid not null references questions(id) on delete cascade,
  user_id uuid references users(id),
  author_name text not null,
  text text not null,
  is_official boolean not null default true,
  created_at timestamptz not null default now()
);

create table wishlists (
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references users(id),
  product_id uuid not null references products(id) on delete cascade,
  price_at_save bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id, product_id)
);

create table stories (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  title jsonb not null,
  cover_url text,
  is_highlight boolean not null default false,
  position int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table story_frames (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  story_id uuid not null references stories(id) on delete cascade,
  position int not null default 0,
  media_url text not null,
  duration_ms int not null default 5000,
  link jsonb not null default '{"type":"none"}',
  cta_label jsonb not null default '{}'
);

-- ── Theme, ops ──────────────────────────────────────────────────────────────
create table store_themes (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  version int not null,
  status text not null check (status in ('draft','published','archived')),
  tokens jsonb not null,
  sections jsonb not null,
  preset text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (store_id, version)
);
create unique index store_themes_one_draft on store_themes (store_id) where status = 'draft';
create unique index store_themes_one_published on store_themes (store_id) where status = 'published';

create table audit_log (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  actor_user_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id text,
  diff jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index on audit_log (store_id, created_at desc);

create table outbox (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  topic text not null,
  recipient jsonb not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index on outbox (status, next_attempt_at);

create table analytics_events (
  store_id uuid not null references stores(id) on delete cascade,
  id uuid primary key,
  session_id text not null,
  user_id uuid,
  name text not null,
  props jsonb not null default '{}',
  source text,
  ts timestamptz not null default now()
);
create index on analytics_events (store_id, name, ts);

create table reports (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete cascade,
  reporter_user_id uuid references users(id),
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- ── Row-level security ──────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'invites','customers','addresses','media','categories','products','product_options','option_values',
    'product_variants','inventory_levels','inventory_movements','inventory_reservations','product_media',
    'collections','product_collections','co_purchases','carts','cart_items','shipping_methods','shipping_zones',
    'shipping_rates','discounts','orders','order_items','order_events','shipments','discount_redemptions',
    'payment_provider_configs','payments','payment_events','refunds','payouts','reviews','review_votes',
    'questions','answers','wishlists','stories','story_frames','store_themes','audit_log','outbox',
    'analytics_events','reports'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (store_id = app_store()) with check (store_id = app_store())', t);
  end loop;
end $$;

alter table stores enable row level security;
alter table stores force row level security;
-- Store rows are public (storefront resolves by slug); writes only inside that store's context.
create policy stores_read on stores for select using (true);
create policy stores_insert on stores for insert with check (id = app_store());
create policy stores_update on stores for update using (id = app_store()) with check (id = app_store());

alter table store_members enable row level security;
alter table store_members force row level security;
create policy members_isolation on store_members
  using (store_id = app_store() or user_id = app_user())
  with check (store_id = app_store());

grant usage on schema public to dokonim_app;
grant select, insert, update, delete on all tables in schema public to dokonim_app;
-- Audit log is append-only for the application role.
revoke update, delete on audit_log from dokonim_app;
grant execute on function app_store() to dokonim_app;
grant execute on function app_user() to dokonim_app;

-- ── Security-definer helpers for the few legitimate cross-tenant reads ──────
create or replace function public_product_search(q text, lim int)
returns table (id uuid, short_id text, store_id uuid, store_slug text, store_name jsonb, title jsonb, min_price bigint, currency char(3), cover_url text)
language sql stable security definer set search_path = public as $$
  select p.id, p.short_id, p.store_id, s.slug, s.name, p.title, p.min_price, s.currency, p.cover_url
  from products p join stores s on s.id = p.store_id
  where p.status = 'active' and s.status = 'active' and (p.search_doc like '%' || q || '%' or word_similarity(q, p.search_doc) > 0.45)
  order by word_similarity(q, p.search_doc) desc, p.sold_count desc
  limit least(lim, 50)
$$;

create or replace function claim_outbox(lim int)
returns setof outbox language sql volatile security definer set search_path = public as $$
  update outbox set attempts = attempts + 1, next_attempt_at = now() + interval '1 minute' * least(attempts + 1, 30)
  where id in (select id from outbox where status = 'pending' and next_attempt_at <= now() order by created_at limit lim)
  returning *
$$;

create or replace function mark_outbox(msg_id uuid, ok boolean, err text)
returns void language sql volatile security definer set search_path = public as $$
  update outbox set status = case when ok then 'sent' when attempts >= 8 then 'failed' else 'pending' end, last_error = err where id = msg_id
$$;

create or replace function expired_reservation_orders(at timestamptz)
returns table (store_id uuid, order_id uuid) language sql stable security definer set search_path = public as $$
  select distinct r.store_id, r.order_id from inventory_reservations r where r.expires_at <= at
$$;

create or replace function deliverable_orders_due(before timestamptz)
returns table (store_id uuid, order_id uuid) language sql stable security definer set search_path = public as $$
  select o.store_id, o.id from orders o where o.status = 'delivered' and o.delivered_at <= before
$$;

create or replace function admin_payment_errors(lim int)
returns table (store_id uuid, store_slug text, provider text, kind text, response text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.store_id, s.slug, e.provider, e.kind, e.response, e.created_at
  from payment_events e join stores s on s.id = e.store_id
  where e.signature_ok = false or e.response like '%"error"%' or e.response like '%"error":-%'
  order by e.created_at desc limit least(lim, 200)
$$;

create or replace function admin_store_stats()
returns table (store_id uuid, products bigint, orders bigint, revenue bigint)
language sql stable security definer set search_path = public as $$
  select s.id,
    (select count(*) from products p where p.store_id = s.id and p.status <> 'archived'),
    (select count(*) from orders o where o.store_id = s.id),
    (select coalesce(sum(o.total), 0)::bigint from orders o where o.store_id = s.id and o.payment_status = 'paid')
  from stores s
$$;

create or replace function payment_store_for_txn(p_provider text, p_txn text)
returns uuid language sql stable security definer set search_path = public as $$
  select store_id from payments where provider = p_provider and provider_txn_id = p_txn limit 1
$$;

revoke all on function public_product_search(text, int) from public;
revoke all on function claim_outbox(int) from public;
revoke all on function mark_outbox(uuid, boolean, text) from public;
revoke all on function expired_reservation_orders(timestamptz) from public;
revoke all on function deliverable_orders_due(timestamptz) from public;
revoke all on function admin_payment_errors(int) from public;
revoke all on function admin_store_stats() from public;
grant execute on function public_product_search(text, int) to dokonim_app;
grant execute on function claim_outbox(int) to dokonim_app;
grant execute on function mark_outbox(uuid, boolean, text) to dokonim_app;
grant execute on function expired_reservation_orders(timestamptz) to dokonim_app;
grant execute on function deliverable_orders_due(timestamptz) to dokonim_app;
grant execute on function admin_payment_errors(int) to dokonim_app;
grant execute on function admin_store_stats() to dokonim_app;
grant execute on function payment_store_for_txn(text, text) to dokonim_app;

create or replace function invite_store(p_hash text)
returns uuid language sql stable security definer set search_path = public as $$
  select store_id from invites where token_hash = p_hash limit 1
$$;
revoke all on function invite_store(text) from public;
grant execute on function invite_store(text) to dokonim_app;
