# Mini App architecture (read this before adding screens)

React 19 + Vite 8 + Motion. One app, two surfaces: **buyer** `/s/:slug/…` and **seller** `/m/:slug/…`.
`npm run build:demo` → base `/dokonim/`, LocalApi (PGlite in a Web Worker). Other modes → HttpApi.
Spec: `docs/SPEC.md` §6 (screens), §12 (theme), §13 (motion), §14 (Telegram), §19 (demo).

## Folder ownership
| Folder | Owner | Notes |
|---|---|---|
| `src/store/` | buyer agent | `index.tsx` exports `storeRoutes`; screens anywhere below `src/store/` |
| `src/seller/` | seller agent | `index.tsx` exports `sellerRoutes`; screens anywhere below `src/seller/` |
| everything else | shared (shell) | api, router, ui, motion, theme, telegram, i18n, shell: change only if truly shared |

Do not edit `src/app/routes.ts`; it already concatenates both arrays. Put surface-specific CSS in your own folder
(e.g. `src/store/store.css` imported from your screens) and prefix classes (`.st-…`, `.sl-…`).

## Adding a screen
```tsx
// src/store/index.tsx
const Cart = lazy(() => import('./screens/Cart'));
export const storeRoutes: RouteDef[] = [{ path: '/s/:slug/cart', component: Cart, surface: 'store' }, …];
// src/store/screens/Cart.tsx
export default function Cart({ params, query }: RouteProps) { … }   // params.slug, query.get('q')
```
Patterns: `:param`, trailing `*` splat (`params['*']`). The most specific match wins. Keep the `/s/:slug/*` placeholder
last-resort route until every path has a screen. Navigation: `navigate('/s/x/cart')`, `navigate(to, { replace: true })`,
`back(fallback)`, `<Link to="…">`. `useLocation()` gives `{ path, query, direction }`. Screens render inside a scroll
container with the page transition already applied; wrap content in `<div className="screen-pad">`.
The shell already wires Telegram **BackButton → history back** (store home → hub). Override with `useBackButton(fn)`.

## Calling the API
All 115 public contract methods, typed end to end (inputs = zod schemas in `packages/contract`, outputs = db services):
```ts
const { data, error, loading, reload } = useQuery('store.home', { slug });      // cached 30 s, null input = skip
const save = useMutation('admin.products.save', { invalidates: ['admin.products', 'store.'] });
await save.run(input);                       // throws ApiError { code, message, details.field }
const { api } = useApi(); await api['cart.setItem']({ slug, variantId, qty });  // imperative
invalidate('cart.');                          // refetch mounted queries whose method starts with the prefix
```
`useCurrentStore()` (from `shell/session`) = cached `store.get` for the slug in the URL: `{ store, theme, nav, role,
paymentMethods }`. Seller screens need `store.id` for every `admin.*` call. Money is **integer tiyin** (1 soʻm = 100).
Error codes come from `packages/core/src/errors.ts`; show `error.details?.field` next to the matching input.
In the demo the visitor is the seeded user **Dilnoza** (owner of all 3 stores, also a buyer with past orders).

## i18n
`const { t, money, l, relativeDay, dateTime, compact, number } = useI18n();`
- `t('store.addToCart')`, `t('common.products', { n: 3 })` (ICU-lite: `{x}` and `{n, plural, =0 {…} one {…} few {…} many {…} other {…}}`).
- Catalogues: `packages/i18n/src/catalog/{common,store,checkout,seller}.ts`. Add the key to `uz` first, then `ru`/`en`
  (the type fails until all three exist). Uzbek uses `oʻ gʻ` (U+02BB) and `ʼ` (U+02BC), never ASCII `'`.
- Existing groups: `common.*` actions/states/counts/demo; `store.*` catalogue/PDP/cart/installments; `checkout.*`
  delivery, payment (`pay_<provider>`), totals, `status_<orderStatus>`, `payment_<paymentStatus>`; `seller.*` nav, KPIs,
  product form, `act_<orderEvent>`, `role_<role>`, `status_<productStatus>`.
- `money(minor)` → `1 250 000 soʻm`; `l(product.title)` picks `{uz,ru,en}` with fallback; dates use the store time zone.

## UI primitives (`src/ui`)
`Button` (variant primary|secondary|ghost|danger, size sm|md|lg, `loading`, `block`, `icon`), `Card` (`interactive`,
`raised`, `padding`), `Chip` (`selected`, `swatch`, `unavailable`), `Input` (`label`, `hint`, `error`, `prefix`,
`suffix`, `multiline`), `Sheet` (`open`, `onClose`, `title`, `footer`; claims BackButton, drag to close),
`Skeleton`/`SkeletonCard`/`Loading`, `toast.success|error|show`, `Icon name="cart"` (see `ICON_NAMES`),
`EmptyState`, `announce(text)` for screen readers. Haptics are built into Button/Chip.

## Theme ("Bozor Modern")
Use CSS variables only, never hex: `--c-surface|surface-raised|surface-sunken|ink|ink-muted|outline|accent|on-accent|
accent-soft|accent-text|price|price-old|sale|rating|success|warning|danger`, `--r-card|media|btn|chip|sheet`,
`--pad-card`, `--gap`, `--card-aspect`, `--font-display|ui`, elevations `--e0…--e3` (outline + offset print shadow, no
blur). Helpers: `.price` (display face, tabular numerals), `.price-old`, `.display`, `.muted`, `.ikat-band`, `.grid-2`.
The shell applies the current store's theme automatically; the seller theme editor can preview with
`useStoreTheme(tokens)` / `applyTheme(el, tokens, scheme)` from `src/theme/theme.ts`.

## Motion (`src/motion`, all respect tiers + prefers-reduced-motion)
- Tokens: `dur`, `ease`, `spring.{snappy,bouncy,sheet,morph}`, `staggerDelay(i)`. Animate only transform and opacity.
- `useMotionTier()` → `full | lite | minimal` (demo bar can override). Use `m.div` from `motion/react` (LazyMotion
  strict mode: `motion.div` throws).
- **The Arc**: `<span ref={useCartTarget()}>` on the cart icon; `await flyToCart({ from: imgEl, imageUrl })` on add;
  `shake(el)` on out-of-stock; `<Odometer value={count} />` for the badge; `announce(t('store.addedToCart', { title }))`.
- **Continuity**: `<MorphMedia id={p.id} src alt />` on both the grid card and the PDP hero, open with
  `morphNavigate(url)`, wrap the PDP in `<DismissablePage onDismiss={() => back(`/s/${slug}`)}>`, and stagger content with
  `<MorphContent index={i}>`.
- **The Split**: `<InstallmentSplit price={variant.price} plans={store.installments} />`.
- `Reveal`, `Stagger` for lists; `PageTransition` is already applied by the router.

## Telegram (`src/telegram/shim.ts`)
`useMainButton({ text, onClick, disabled, progress, shine })` declares the bottom button while mounted (stack: the
latest screen or sheet wins). `haptic.impact('light'|'soft'|'rigid'|…)`, `haptic.selection()`, `haptic.notify('success'|
'error')`. `tg.confirm(msg)`, `tg.setVerticalSwipes(false)`. In the demo these drive the faux header and bottom bar inside the
phone frame; inside Telegram they call the real WebApp API. Do not reach for `window.Telegram` directly.

## Demo backend
`src/api/local/worker.ts`: PGlite (`idb://dokonim-demo`, memory fallback) → `migrate` → `createBackend` → real initData
HMAC login. First visit: `seedDemo` runs in an in-memory PGlite, then the data dir is dumped once into IndexedDB
(about 15 s on an idle laptop, longer on a busy one; a progress screen is shown). Reloads take about 2 s.
`client.resetDemo()` wipes IndexedDB and re-seeds. Seed stores: `atlas-adras` (clothing, light), `texno-bozor`
(electronics, dark Volt preset), `choyxona-market` (food). Promo codes: SALOM10, BEPULYETKAZISH, TOY50, TEXNO5,
MINUS100, CHOY15. Flash sales are relative to now.

## Tests and checks
`npm run test:ui` (jsdom, `apps/miniapp/test/*.test.tsx`), `npm run typecheck`, `npm run lint`,
`npm run build:demo && npm run preview -w @dokonim/miniapp` → http://localhost:4173/dokonim/ (no console errors allowed).
