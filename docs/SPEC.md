# Do'konim — Product & Technical Specification

> **Do'konim** (Uzbek: *"my shop"*, official Latin spelling **Doʻkonim** with U+02BB) is a multi-tenant
> store builder that runs as a **Telegram Mini App**. Anyone can open a store, run it and sell from it
> without leaving Telegram. Think *Shopify, but native to Telegram and built for Uzbekistan first*.
>
> Author: xoliddev · Status: **v1.0 spec (portfolio flagship)** · Date: 2026-11-13
> Research was done in November 2026. Every external claim is linked in [§22 Sources](#22-sources).
> Vendor-claimed numbers are labelled as vendor claims.

---

## Table of contents

1. [Vision & positioning](#1-vision--positioning)
2. [Market research: what the giants win at](#2-market-research-what-the-giants-win-at)
3. [Competitive advantages we copy](#3-competitive-advantages-we-copy)
4. [Personas](#4-personas)
5. [Feature list — MVP-for-portfolio vs Later](#5-feature-list--mvp-for-portfolio-vs-later)
6. [Information architecture & screens](#6-information-architecture--screens)
7. [Architecture & stack](#7-architecture--stack)
8. [Data model](#8-data-model)
9. [Order, payment & inventory state machines](#9-order-payment--inventory-state-machines)
10. [API surface](#10-api-surface)
11. [Payment-provider interface](#11-payment-provider-interface)
12. [Theming system](#12-theming-system)
13. [Motion system & signature interactions](#13-motion-system--signature-interactions)
14. [Telegram platform integration](#14-telegram-platform-integration)
15. [i18n](#15-i18n)
16. [Security & multi-tenant isolation](#16-security--multi-tenant-isolation)
17. [Performance budget](#17-performance-budget)
18. [Testing strategy](#18-testing-strategy)
19. [Demo mode (GitHub Pages, real logic in the browser)](#19-demo-mode-github-pages-real-logic-in-the-browser)
20. [Milestones](#20-milestones)
21. [Open questions & risks](#21-open-questions--risks)
22. [Sources](#22-sources)

---

## 1. Vision & positioning

### 1.1 The problem
- Telegram reaches **76% of Uzbekistan's internet audience, about 25M users**, and it is where small
  businesses already sell, through channels, DMs and manual "send me your address" flows
  ([UzDaily, Oct 2025][uzdaily-tg]). The US Commercial Guide says Uzbeks use Telegram "to communicate
  and do business" ([trade.gov][tradegov]).
- Online sales in Uzbekistan grew **1.5× to 22.7 trillion so'm in 2025**, rising from 3.7% to 4.6% of retail.
  The number of e-commerce platforms went **from 36 to 115** ([UzDaily, Feb 2026][uzdaily-sales]). The market is
  growing fast, but most small sellers still run their business through chat threads and screenshots.
- Uzum Market has taught buyers to expect **next-day delivery, installment prices, photo reviews and
  pickup codes** ([Uzum media][uzum-15]). A Telegram channel seller can't offer any of that today.

### 1.2 The product
Do'konim gives every seller a **real store inside Telegram** in under 3 minutes:
- A **storefront** that feels like Uzum or Ozon. It has a catalog, filters, variants, reviews,
  installments display, delivery-date promises and a 2-tap checkout.
- An **owner dashboard** inside the same Mini App for products, nested categories, orders, inventory,
  discounts, shipping, payments, staff, analytics and theme.
- A **bot** that sends order notifications with action buttons, plus status updates to buyers.
- **Pluggable payments.** Payme, Click, Uzum, Paynet, Telegram Payments, Telegram Stars, Stripe,
  cash/card on delivery and a **sandbox** that runs the real protocol code without real keys.

### 1.3 Positioning
| | Do'konim | Uzum Market seller | Telegram channel + DMs | Generic TG shop builders |
|---|---|---|---|---|
| Own brand & customer relationship | ✅ own store, own theme | ❌ marketplace brand | ✅ but no tooling | ⚠️ templated look |
| Commission | none (SaaS plan) | marketplace fee | none | varies |
| Checkout | 2-tap native | app | manual | basic |
| Local payments (Payme/Click/Uzum) | ✅ pluggable | ✅ | manual card transfer | ⚠️ partial |
| Design quality | **signature motion & theming** | high | n/a | generic |

**Tagline (uz):** *"Do'koningiz — Telegramda. 3 daqiqada."* ("Your shop is in Telegram. In 3 minutes.")

### 1.4 Portfolio goals (why this project exists)
1. Show **full-stack depth**: multi-tenant data model, payment protocols, state machines, RLS, bot,
   Mini App, offline-capable demo.
2. Show **design and motion craft** with a recognisable signature that isn't another Tailwind template.
3. Be **demo-able by anyone in 10 seconds** through a GitHub Pages link that runs the real domain core in the browser
   ([§19](#19-demo-mode-github-pages-real-logic-in-the-browser)).

### 1.5 Non-goals for v1
Marketplace aggregation across stores, a native mobile app, warehouse/WMS, POS hardware, and
fiscal-receipt submission to the tax authority (we store the fields and defer integration; see §8.6).

---

## 2. Market research: what the giants win at

### 2.1 Local context that shapes design
- **Device reality.** Android holds about 80% and iOS about 20% of mobile OS share in Uzbekistan
  ([StatCounter][statcounter-os]). Xiaomi (incl. Redmi) and Samsung lead vendors ([StatCounter][statcounter-vendor]).
  Uzbekistan imported **3.2M phones worth $370.8M in Jan–Sep 2025**, about **$115 average import value**
  ([Kun.uz][kun-phones]). → **We design for a ~$120 Android phone first.**
- **Payments.** Payme, Click and Paynet are large, profitable players. Payme also runs QR acceptance
  (Payme GO / Tez QR) ([Kun.uz, May 2026][kun-pay]). Cash/card on delivery is still a common expectation.
- **Installments are a buying mode in their own right.** Uzum says **more than 48% of Uzum Market GMV is paid via
  Uzum Nasiya** ([Sacra][sacra-nasiya]). Uzum shows **monthly amounts for 3/6/12 months up front, with "no
  hidden fees"** ([Uzum media][uzum-nasiya]).

### 2.2 Uzum Market (Uzbekistan's leader)
Sources: [Uzum media "15 fishka"][uzum-15], [Uzum Nasiya explainer][uzum-nasiya], [Uzum 2024 results][uzum-2024], [Sacra][sacra-uzum].
- **One-day delivery nationwide** plus **1,500+ pickup points**. Orders placed before 13:59 reach Tashkent pickup points the same day.
- **Installments as a first-class price**: 3/6/12-month plans with monthly amounts shown.
- **Reserve for 30 minutes** while the buyer arranges installment payment.
- **Order tracking stages** in "My orders", from awaiting payment through received or returned.
- **Pickup by barcode or order number + code.** A family member can pick up.
- **Wishlist heart with price-drop watching.**
- **Ask the seller** (Q&A), with answers usually within hours.
- **Free pickup delivery, and free courier delivery above a threshold** (1M so'm).
- Promo codes and giveaways announced through social channels.

### 2.3 Wildberries & Ozon
- WB: **photo search**, including recognising article numbers in images ([www1.ru][wb-photo]);
  **AI review summaries**, **animated listings** and virtual try-on ([RetailTech, Feb 2026][wb-ai]);
  **Wibes** short-video social commerce ([Vietnam News][wb-wibes]).
- Ozon: **Stories** (since 2019) ([New Retail][ozon-stories]); **video on product cards**, which Ozon claims
  lifts add-to-cart by up to 150% (vendor claim, [Saby][saby-cards]); **wishlists & curated collections**
  (July 2025, [Oborot][ozon-wishlist]); **review points** that reward reviews.

### 2.4 Amazon (via Baymard research)
- Show **a concrete delivery date, not a shipping speed**. 41% of sites still get this wrong
  ([Baymard][baymard-date]).
- Average documented **cart abandonment is 70.22%**, and checkout usability fixes can lift conversion substantially
  ([Baymard][baymard-abandon], [Baymard checkout][baymard-checkout]).
- Patterns we copy: **Buy again / one-tap reorder**, **recently viewed**, **"Frequently bought together"**,
  and a review histogram with filter by star and "with photos".

### 2.5 AliExpress / Temu
- **Flash deals, countdowns and gamified rewards** work. Critics also document **fake scarcity**, such as timers that
  restart ([Retail Insight Network][temu-rin], [Daily Dot][temu-dd]).
  → We copy urgency but **only with honest data**: countdowns use real `ends_at`, stock counters use real stock,
  and no timer ever restarts. This is a deliberate trust differentiator.

### 2.6 Shopify (storefront + builder)
- **Shop Pay** accelerated checkout. Shopify claims **up to 50% higher conversion vs guest checkout** (vendor claim,
  [Shopify][shopify-shoppay]). → Our equivalent is a **2-tap checkout**: Telegram identity, `requestContact` phone,
  saved address and a remembered payment method.
- **Horizon themes**: block-based sections with **nested blocks (up to 8 levels)**, an AI store builder that
  proposes 3 layouts, and **2,048 variants per product** ([GemPages][shopify-horizon], [Shopify Editions Winter '26][shopify-w26]).
- CSV import: up to **3 options per product**, and variant rows grouped by handle ([Shopify Help][shopify-csv]).

### 2.7 Ecwid / Tilda / Wix
- Ecwid CSV import **auto-creates nested categories from a "category path" column** ([Ecwid KB][ecwid-import]).
  We copy this exactly: `Kiyim / Ayollar / Ko'ylaklar`.

### 2.8 Instagram / TikTok shops
- TikTok: **product tags inside short videos with in-app checkout**. Live shopping drives large uplifts
  ([Moburst][tiktok-moburst]). Instagram removed native checkout and Live tagging, but shoppable posts and tags remain
  ([Inro][ig-live]). → We copy **shoppable Stories**: each story frame links to a product or collection.

### 2.9 Telegram shop builders (2025–2026)
LEADTEX (no-code Mini App store in ~15 min, [Leadteh][leadteh]), BotPapa (Stars payments, [Product Hunt][botpapa]),
ShopsBuilder ([Notion][shopsbuilder]), TGshop ([Workspace][tgshop]), MaviBot ([MaviBot][mavibot]).
**Their gap:** generic templated UI, shallow catalogs (flat categories, weak variants), and little local payment depth.
**Our wedge:** a marketplace-grade buyer UX, deep CRUD (arbitrary-depth categories and variant matrices),
native UZ payments, and signature motion.

---

## 3. Competitive advantages we copy

| # | Advantage | Who does it best | What Do'konim ships | Source |
|---|---|---|---|---|
| 1 | Installment price shown on card & PDP ("from X so'm/oy") | Uzum Market | Owner-configured 3/6/12 plans → "dan 412 000 so'm/oy" chip; real Uzum Nasiya later | [Uzum Nasiya][uzum-nasiya], [Sacra][sacra-nasiya] |
| 2 | Delivery **date** promise with cutoff | Amazon, Uzum | "Ertaga, 14-noyabr" computed from cutoff time, zone and working days | [Baymard][baymard-date], [Uzum][uzum-15] |
| 3 | Reserve stock during payment | Uzum (30 min) | Inventory reservation with TTL (default 30 min) | [Uzum][uzum-15] |
| 4 | Pickup code / barcode | Uzum | Order QR + 6-digit pickup code for self-pickup | [Uzum][uzum-15] |
| 5 | Stories & shoppable media | Ozon, Instagram, TikTok | Store Stories with product/collection links and highlights | [New Retail][ozon-stories], [Moburst][tiktok-moburst] |
| 6 | Video on product card | Ozon | Short MP4/WebM in gallery (≤15 s, muted autoplay on high tier) | [Saby][saby-cards] |
| 7 | Wishlists & collections | Ozon, Uzum | Heart-to-save, named lists (later), price-drop bot alert | [Oborot][ozon-wishlist], [Uzum][uzum-15] |
| 8 | Reviews with photos + summary | WB, Amazon | Verified-buyer reviews, photo filter, histogram; AI summary later | [RetailTech][wb-ai] |
| 9 | Ask the seller (Q&A) | Uzum | Public Q&A; owner gets a bot ping with an "Answer" button | [Uzum][uzum-15] |
| 10 | Accelerated checkout | Shopify Shop Pay | 2-tap checkout: Telegram identity + `requestContact` + saved address/method | [Shopify][shopify-shoppay] |
| 11 | Honest urgency (flash sales) | Temu (minus dark patterns) | Countdown to real `ends_at`, real "N left"; never resets | [RIN][temu-rin] |
| 12 | Nested blocks theme builder | Shopify Horizon | Home page = ordered sections with blocks; live preview | [GemPages][shopify-horizon] |
| 13 | CSV import with category paths | Ecwid | `category_path` column auto-builds the tree | [Ecwid][ecwid-import] |
| 14 | Photo search / article search | Wildberries | SKU/article search now; photo search later | [www1.ru][wb-photo] |
| 15 | Free-delivery threshold nudge | Uzum, AliExpress | "Yana 120 000 so'm — yetkazish bepul" progress bar in cart | [Uzum][uzum-15] |
| 16 | No-code setup in minutes | LEADTEX, Shopify AI builder | 3-minute onboarding wizard with business-type templates | [Leadteh][leadteh], [Shopify W26][shopify-w26] |

---

## 4. Personas

### 4.1 Dilnoza — store owner (primary)
29, Samarkand. Sells handmade national-pattern dresses through a 4k-subscriber Telegram channel and Instagram.
Today she takes orders in DMs, asks for card transfers to her Humo card, and keeps stock in a notebook.
**Wants:** a pretty store in her own colours, sizes and colours per dress, payment links that "just work",
and a bot ping when someone orders. **Fears:** complexity, fees and looking amateur.
**Device:** Redmi Note, Telegram in Uzbek.
**Success:** store live in under 3 minutes, first order paid via Click within the week.

### 4.2 Sardor — buyer
24, Tashkent, Samsung A-series, uses Uzum and Click daily. Opens the store from a channel post.
**Wants:** fast loading, clear prices (incl. monthly), real delivery date, photos from real buyers,
pay with Click/Payme in 2 taps, and order updates in Telegram. **Hates:** typing his address again and fake timers.

### 4.3 Kamola — store staff (order operator)
Works for a mid-size cosmetics shop. Invited by link. Can process orders and edit stock, but **can't** change
payments or delete products. Needs a fast order queue and bot notifications with inline actions.

### 4.4 Xolid — platform admin
Runs Do'konim. Needs a tenant list, plan flags, suspension, abuse reports, global health
(webhook failures, payment errors) and audit logs.

### 4.5 Visitor/recruiter (demo persona)
Opens the GitHub Pages link on a laptop. Sees a phone frame with a working store, flips to **Owner view**,
creates a store, places an order with **sandbox Payme**, and watches the **bot chat panel** receive the
notification. All of it in under 2 minutes, with no backend.

---

## 5. Feature list — MVP-for-portfolio vs Later

Legend: **MVP** = built now and complete · **MVP+** = built now if time allows (designed and stubbed) · **Later** = designed only.

### 5.1 Buyer storefront
| Feature | Tier | Notes |
|---|---|---|
| Store home from theme sections (hero, stories, category rail, collections, flash sale, product carousels, banner, text, FAQ, contacts) | MVP | Section renderer driven by theme JSON |
| Stories (24 h + pinned highlights), seen-state, product/collection links | MVP | Seen-state in DeviceStorage |
| Category drill-down (arbitrary depth) + breadcrumbs + "All in this category" (subtree) | MVP | ltree subtree query |
| Catalog grid/list toggle, infinite scroll (virtualised) | MVP | |
| Faceted filters: price range, option values (size, colour swatches), attributes, in stock, on sale, rating; counts per facet | MVP | Bottom-sheet filter UI |
| Sort: popular, new, price ↑↓, rating, discount | MVP | |
| Search: suggestions, history, typo tolerance (trigram), Latin↔Cyrillic transliteration, apostrophe normalisation, SKU search | MVP | |
| Product page: gesture gallery (swipe, pinch, drag-to-dismiss), video, variant picker with availability matrix, price/compare-at/discount badge, installment chips, delivery-date promise, stock indicator, description (safe rich text), specs table, size guide | MVP | Signature motion §13 |
| Reviews: histogram, filter (stars / with photos), photo reviews, helpful votes, owner reply; verified buyers only | MVP | |
| Q&A: ask, see answers | MVP | |
| Related ("same category"), "Frequently bought together" (co-purchase counts), recently viewed | MVP | Co-purchase table updated by job |
| Wishlist (heart) | MVP | Price-drop alert = Later |
| Share product: deep link, `shareToStory`, `shareMessage` (prepared inline message card) | MVP | §14 |
| Cart: persisted server-side + per-device, quantity steppers, variant edit in place, free-delivery progress, promo code, stock re-validation | MVP | |
| Checkout: 1 screen; contact via `requestContact`; address book + map pin (LocationManager); delivery method with date; payment method; order comment; summary; MainButton "To'lash 1 250 000 so'm" | MVP | |
| Payment: Payme / Click / Uzum redirect, Telegram invoice, Stars (digital goods), COD, sandbox | MVP (sandbox + Payme + Click + COD + Stars), MVP+ (Uzum, Telegram provider), Later (Paynet, Stripe live) | §11 |
| Order tracking timeline, pickup QR/code, cancel (when allowed), reorder ("Yana buyurtma"), invoice/receipt share | MVP | |
| Buyer notifications via bot (status changes) | MVP | |
| Profile: orders, addresses, wishlist, language, notifications toggle | MVP | |
| Flash sales with honest countdown | MVP | |
| Loyalty cashback points, referral links with reward | Later | Data model reserved |
| Photo search, AI review summary, live shopping | Later | |
| Back-in-stock / price-drop alerts | MVP+ | Bot message via outbox |

### 5.2 Owner dashboard (same Mini App, `/manage`)
| Area | Tier | Details |
|---|---|---|
| **Onboarding wizard** (≤ 3 min) | MVP | Name & slug → business type template (Clothing, Cosmetics, Food, Electronics, Handmade, Digital) → logo & brand colour (palette suggestion from logo) → first product (photo-first) → payments (sandbox on by default) → share sheet (link, QR, channel post template) |
| Home | MVP | Today: revenue, orders, conversion; action queue (to confirm, to ship, low stock, unanswered questions); 7-day sparkline |
| **Products CRUD** | MVP | Draft/active/archived; title/description per language; media (multi-upload, reorder by drag, alt text, cover); options (up to 3, e.g. Size × Colour × Material) → **variant matrix generator** with bulk edit (price, stock, SKU, barcode, weight); compare-at price; cost price (margin); category (primary) + collections; tags; attributes (key/value specs); IKPU/package code for fiscal (optional); digital product flag (Stars); duplicate; bulk actions (activate, archive, move category, adjust price %) |
| **Categories CRUD (nested, any depth)** | MVP | Tree view with drag-to-move/reorder (touch), create child, rename, image/icon, hide, delete with strategy (move children up / reassign products / cascade archive); cycle prevention; breadcrumbs; product counts incl. subtree |
| Collections | MVP | Manual (pick products) and **automated** (rules: tag = X, price < Y, category in subtree Z, on sale, new in N days) |
| Inventory | MVP | Stock per variant, adjustments with reason, movement ledger, low-stock threshold, reservations view |
| **Orders** | MVP | Queue with tabs per status; detail with timeline; transitions per state machine; internal notes; contact buyer (opens chat); print/share receipt; cancel & refund (provider refund where supported, else manual mark) |
| Customers | MVP | List, search, tags, notes, order history, LTV, blocklist |
| **Discounts** | MVP | Promo codes (% / fixed / free shipping / buy X get Y), automatic discounts, flash sales (schedule + product set), conditions (min subtotal, collections, first order, customer tags), limits (total uses, per customer), combinability flags |
| Shipping | MVP | Zones (Uzbekistan's 14 regions → districts), methods (courier, pickup point, post, own pickup), rates (flat, by weight, free over threshold), processing days, **cutoff time**, transit days per zone, working-day calendar |
| Payments settings | MVP | Enable providers; per-provider credential forms; **sandbox toggle**; "Test connection"; webhook URLs to copy; payout schedule placeholder |
| **Theme editor** | MVP | Live preview; brand colours; mode; radius; density; font pair; card style; motif; home sections & blocks (add, reorder, configure, hide); presets; draft → publish; version history (last 10) |
| Store settings | MVP | Languages, currency (UZS default), contacts, working hours, policies (returns, delivery, privacy), social links, legal info |
| Staff & roles | MVP | Invite link (one-time, expiring), roles (Owner, Admin, Manager, Catalog editor, Order operator, Viewer), custom permissions (Later) |
| Reviews & Q&A moderation | MVP | Approve/hide, reply, answer |
| Notifications | MVP | Bot alert toggles per event; daily summary time |
| Analytics | MVP | Revenue, orders, AOV, funnel (store view → product view → add to cart → checkout → paid), top products, traffic by link source (`startapp` campaign tag), repeat-buyer rate |
| Import / export | MVP | CSV/XLSX products (Shopify-compatible columns + `category_path`), dry-run preview with row errors; export orders CSV |
| Audit log | MVP | Who did what, when, with a before/after diff |
| Link builder | MVP | Campaign links `t.me/<bot>/shop?startapp=<slug>-c-<tag>` + QR |
| White-label bot per store (Managed Bots, Bot API 9.6) | Later | §14.6 |
| Abandoned-cart reminders via bot | MVP+ | Opt-in, one reminder after 3 h |
| Multi-warehouse, POS, wholesale price tiers, subscriptions | Later | |
| AI: description writer, photo background cleanup, theme from logo | Later | Theme-from-logo palette is MVP (algorithmic, no AI) |

### 5.3 Platform admin (`/admin`, platform role only)
MVP: tenant list and search, suspend/unsuspend, plan flags (product limit, custom bot, remove badge), webhook/payment
error feed, abuse reports queue, global audit log. Later: billing for plans (Payme subscribe API), impersonation with consent.

---

## 6. Information architecture & screens

### 6.1 Routing & entry
One Mini App, three surfaces, chosen by the launch param and the user's role:

```
t.me/dokonim_bot/shop?startapp=<payload>
payload grammar (≤ 64 chars, [A-Za-z0-9_-]):
  <slug>                      → store home
  <slug>-p-<productShortId>   → product page
  <slug>-c-<campaign>         → store home, attributed to campaign
  <slug>-o-<orderShortId>     → order tracking (from bot message / payment return)
  new                         → onboarding wizard
  m-<slug>                    → owner dashboard of that store
(no payload)                  → "My stores" hub (owned/staff stores + recently visited stores)
```
`startapp` arrives as `start_param` / `tgWebAppStartParam` ([Telegram Mini Apps][tg-webapps]).
Inside the app we use typed routes (TanStack Router):

```
/                         hub: my stores, recently visited, "Create store"
/s/:slug                  storefront home
/s/:slug/c/*path          category (path = slug chain)
/s/:slug/search?q=
/s/:slug/p/:productId     product page
/s/:slug/p/:productId/reviews
/s/:slug/cart
/s/:slug/checkout
/s/:slug/orders, /s/:slug/orders/:id
/s/:slug/wishlist, /s/:slug/profile
/new                      onboarding wizard (steps 1–6)
/m/:slug                  owner home
/m/:slug/products, /products/new, /products/:id
/m/:slug/categories       tree editor
/m/:slug/collections, /orders, /orders/:id, /customers, /customers/:id
/m/:slug/discounts, /shipping, /payments, /theme, /settings, /staff, /analytics, /import, /audit
/admin/*                  platform admin
```

### 6.2 Buyer storefront screens
1. **Home**: compact header (logo, store name, search pill, cart). Stories row. Then the theme sections.
   A bottom tab bar (Home · Catalog · Cart · Profile) sits in the content safe area. The Telegram MainButton is hidden on home.
2. **Catalog**: root categories as a large visual grid. Tap → child level slides in (shared-axis X).
   Each level has an "All products in X" chip and a breadcrumb that is scrollable horizontally.
3. **Listing**: sticky filter bar (Sort · Filters (n) · quick chips for top facet values). 2-column grid with a
   card style from the theme. Filters live in a full-height bottom sheet with facet counts and a live "Show 128 products" button.
4. **Search**: instant suggestions (products, categories, recent queries). Results reuse the listing.
5. **Product page (PDP)**: hero gallery (edge-to-edge, 4:5), then title, rating summary and SKU, price block
   (price, compare-at, −% badge, installment chips), variant pickers (swatches for colour, chips for size; unavailable
   combinations are dimmed with a strike, not hidden), delivery promise card ("Ertaga yetkazamiz · 14-noyabr" + method),
   stock note, description, specs, reviews preview, Q&A preview, frequently bought together, related.
   **MainButton**: "Savatga qo'shish". **SecondaryButton**: "Hozir sotib olish" (`position: left`).
6. **Cart**: line items with swipe-to-remove (undo toast), steppers, free-delivery progress bar, promo field,
   and a summary. MainButton: "Rasmiylashtirish · 1 250 000 so'm".
7. **Checkout**: a single scroll with 4 cards: Contact (prefilled from Telegram plus phone via `requestContact`), Delivery
   (method → address/pickup point with date), Payment (method tiles, installment info), Summary. MainButton:
   "To'lash 1 250 000 so'm" with `has_shine_effect` while valid ([Telegram BottomButton][tg-webapps]).
8. **Payment hand-off**: provider page via `openLink` or `openInvoice`, then a waiting screen that polls/SSEs payment status,
   then the success screen (confetti-free; see the §13 "receipt print" motion).
9. **Order detail**: status timeline, items, pickup QR + code, delivery address, payment, cancel/reorder, and a "Chat with shop" button.
10. **Profile**: orders, addresses, wishlist, language, notifications.

### 6.3 Owner dashboard screens
Navigation: bottom tabs **Bosh sahifa · Buyurtmalar · Mahsulotlar · Ko'proq**. The Telegram **SettingsButton** opens store settings.
- **Home**: KPI tiles (bento sized by importance: revenue big, orders, conversion), action queue cards, a quick-add FAB "+ Mahsulot".
- **Orders**: segmented status tabs with counters, swipe actions (Confirm / Mark shipped), bulk select.
- **Order detail**: big status header with the *next allowed action* as MainButton (e.g. "Jo'natildi deb belgilash").
- **Products**: list with thumbnail, stock and status; filters; bulk mode. **Product editor** is a sectioned form:
  Media → Basics → Pricing → Options & Variants (matrix table with sticky first column, bulk-edit drawer) →
  Inventory → Organisation (category picker = tree with search, collections, tags) → Attributes → Sharing preview →
  Advanced (IKPU, digital, weight). Autosaves drafts locally. MainButton is "Saqlash".
- **Categories tree editor**: indented tree with drag handles, long-press to drag (dnd-kit touch sensor), swipe for
  actions, a breadcrumb "move to…" picker for big trees, and product counts (subtree).
- **Theme editor**: split view. A live preview iframe-less render scaled to 0.85 sits on top, and the tokens/sections panel sits in a bottom sheet with snap points.
- **Payments**: provider cards with status (Not connected / Sandbox / Live), credential forms, and a webhook URL copy button.
- **Analytics**: date range chips, funnel chart, revenue line, top products list.

### 6.4 Onboarding wizard (target: store live in < 3 min)
| Step | Screen | Smart defaults |
|---|---|---|
| 1 | "Do'koningiz nomi?" plus a live slug check (`t.me/dokonim_bot/shop?startapp=dilnoza-atelier`) | Slug from name with transliteration |
| 2 | Business type (6 illustrated tiles) | Seeds category skeleton, attributes, shipping defaults, home sections |
| 3 | Brand: upload logo (optional) → 5 palette suggestions extracted from the logo (k-means in OKLCH) or pick a colour; font pair | Live-preview card morphs (§13 theme morph) |
| 4 | First product: take/choose photo → title → price → (optional) sizes/colours | Photo-first, as in marketplace seller apps |
| 5 | Payments: "Naqd/karta yetkazilganda" on; Sandbox Payme/Click on; "Connect real Payme/Click later" | No blocking credential forms |
| 6 | 🎉 Share: link, QR, a "Post to channel" template (image card + inline button), `shareToStory` | Celebration = §13 "stamp" motion |

---

## 7. Architecture & stack

### 7.1 Overview
```
                    ┌──────────────────────────── packages/core ─────────────────────────────┐
                    │ entities · value objects (Money, Slug, CategoryPath) · services          │
                    │ (Catalog, Cart, Pricing/Discounts, Checkout, Orders, Inventory,          │
                    │ Payments ledger, Reviews, Theme, Analytics) · state machines · policies │
                    │ PORTS: Repos(UnitOfWork), Clock, IdGen, PaymentGateway, Notifier,        │
                    │ MediaStore, Search, EventOutbox                                          │
                    └───────────────▲────────────────────────────▲─────────────────────────────┘
                                    │                            │
         server adapters            │                            │      browser adapters (demo)
 ┌──────────────────────────────────┴───┐            ┌───────────┴──────────────────────────────┐
 │ apps/api (Fastify) ── packages/db     │            │ miniapp LocalApi ── packages/db           │
 │   Drizzle → PostgreSQL 17 (+RLS)      │            │   Drizzle → PGlite (idb://) in a Worker   │
 │   pg-boss jobs, S3/R2 media, imgproxy │            │   media → OPFS/IndexedDB blobs            │
 │   packages/payments (real+sandbox)    │            │   packages/payments (sandbox adapters)    │
 │ apps/bot (grammY) via outbox          │            │   BotChatSimulator renders outbox         │
 └───────────────▲───────────────────────┘            └───────────────▲──────────────────────────┘
                 │ HTTPS (HttpApi)                                     │ comlink RPC (LocalApi)
                 └─────────────── apps/miniapp (React 19 + Vite) ──────┘
                        uses the `DokonimApi` interface from packages/api-contract
```
**Key idea:** all business rules live in `packages/core`, which is pure TypeScript with no Node or DOM APIs.
The API server and the browser demo are **two adapter sets around the same core**, and the DB schema is shared
(Drizzle supports both `node-postgres` and `pglite` drivers ([Drizzle PGlite][drizzle-pglite])).

### 7.2 Monorepo layout (pnpm workspaces + Turborepo)
```
dokonim/
  apps/
    api/            Fastify 5 HTTP API + webhooks + SSE
    bot/            grammY bot (webhook mode; can be mounted inside api in MVP)
    miniapp/        React 19 + Vite storefront/dashboard/onboarding/admin
  packages/
    core/           domain logic (no IO)
    db/             Drizzle schema, SQL migrations (incl. ltree, RLS), repository impls
    api-contract/   zod schemas, DokonimApi interface, HttpApi client, error codes
    payments/       provider adapters + protocol handlers + sandbox simulators
    ui/             design tokens, components, motion primitives, Telegram shim
    i18n/           message catalogs (uz, ru, en), formatters, transliteration
    seed/           deterministic demo data generator (seeded PRNG)
    config/         tsconfig, eslint (typescript-eslint strict), prettier
  docs/             SPEC.md, ADRs
```

### 7.3 Stack decisions (with justification)
| Concern | Choice | Why / rejected alternatives |
|---|---|---|
| Language | TypeScript 5.x strict everywhere | Shared types from DB to UI |
| API framework | **Fastify 5** + `fastify-type-provider-zod` | Light and fast, schema-first, great plugin model. NestJS rejected: its DI/decorator layer duplicates what `core` already does with ports, and it adds cold-start and bundle weight |
| DB | **PostgreSQL 17** | RLS, `ltree`, `pg_trgm`, jsonb, partial indexes |
| Query layer | **Drizzle ORM** (+ raw SQL for ltree/RLS) | Same schema for Postgres **and PGlite** (official driver), SQL-like, migrations via drizzle-kit. Kysely is also good, but Drizzle's PGlite path and schema-as-code win for the demo |
| Jobs | **pg-boss** (Postgres-backed queue) | No Redis to operate. Handles reservation expiry, outbox delivery, image jobs, auto-complete orders |
| Bot | **grammY** | Typed, modern, conversations & menus plugins, webhook adapter for Fastify |
| Mini App | **React 19 + Vite** | Ecosystem, concurrent rendering, Suspense; Vite for fast builds & code-splitting |
| Routing | **TanStack Router** | Type-safe params/search params, hash history for GH Pages, route-level code splitting |
| Server state | **TanStack Query** | Caching, optimistic cart updates, retries; works identically over HttpApi/LocalApi |
| Client state | Zustand (tiny) | UI-only state (sheets, motion tier) |
| Styling | **CSS Modules + CSS custom properties** generated from TS tokens | Zero runtime, theme switch = swap variables. Tailwind avoided to keep a bespoke design language and tiny CSS |
| Motion | **Motion for React** (`LazyMotion` + `m`, `domAnimation`) + **View Transitions API** + **WAAPI** | See §13.1 |
| Gestures/DnD | Motion drag + **dnd-kit** (touch sensor) for tree & media reorder | |
| Forms | react-hook-form + zod resolvers (schemas from api-contract) | |
| Lists | @tanstack/react-virtual | Long catalogs on low-end phones |
| Telegram SDK | **@tma.js/sdk-react** (+ `mockTelegramEnv` for demo) | Maintained successor of `@telegram-apps/sdk` ([tma.js docs][tmajs]) |
| i18n | Lingui (compile-time ICU, ~2 KB runtime) | Small runtime, extracted catalogs, plural rules |
| Charts | Hand-rolled SVG sparklines; uPlot lazy for analytics page | Tiny |
| Media | S3-compatible (Cloudflare R2/MinIO) + **imgproxy** (AVIF/WebP, resize, strip EXIF) | |
| Observability | pino logs, OpenTelemetry traces, Sentry (frontend+api) | |
| Realtime | **SSE** with polling fallback | Some PaaS hosts block WebSockets. Payment status and order queue only need server→client |

---

## 8. Data model

All monetary amounts are **`bigint` minor units** (tiyin for UZS, 1 so'm = 100 tiyin; Payme also uses tiyin
([Payme guide][payme-flow])), with `currency char(3)`. IDs are **UUIDv7** generated in `core` (time-sortable, same in
browser and server). Every tenant-owned table has `store_id uuid not null` as the **first column of every index**.
`created_at/updated_at timestamptz`; soft delete via `archived_at` where business-meaningful.

### 8.1 Entity overview
```
users ─┬─< store_members >─ stores ─┬─ store_themes (versions)
       │                           ├─< categories (tree) ─< products ─< product_variants ─< inventory_levels
       │                           │                     │          └─< product_options ─< option_values
       │                           │                     ├─< product_media, product_collections >─ collections
       │                           ├─< customers ─< addresses
       │                           ├─< carts ─< cart_items
       │                           ├─< orders ─< order_items, order_events, shipments
       │                           │        └─< payments ─< payment_events, refunds
       │                           ├─< discounts ─< discount_redemptions
       │                           ├─< shipping_zones ─< shipping_rates >─ shipping_methods
       │                           ├─< payment_provider_configs (encrypted)
       │                           ├─< reviews ─< review_media ; questions ─< answers
       │                           ├─< stories ─< story_frames
       │                           ├─< wishlists, inventory_movements, inventory_reservations
       │                           ├─< payouts (placeholder), audit_log, outbox, analytics_events
       └─< invites
```

### 8.2 Tenancy, users & staff
| Table | Key columns |
|---|---|
| `users` | `id`, `telegram_id bigint unique`, `first_name`, `last_name`, `username`, `language_code`, `photo_url`, `phone` (from requestContact, verified flag), `is_platform_admin bool` |
| `stores` | `id`, `slug citext unique` (3–32, `[a-z0-9-]`), `name jsonb {uz,ru,en}`, `status` (`draft/active/suspended/closed`), `owner_user_id`, `business_type`, `default_locale`, `locales text[]`, `currency` (`UZS`), `timezone` (`Asia/Tashkent`), `plan` (`free/pro`), `settings jsonb` (contacts, hours, policies, social), `published_theme_id`, `managed_bot_id` (Later) |
| `store_members` | `store_id`, `user_id`, `role` (`owner/admin/manager/catalog_editor/order_operator/viewer`), `permissions text[]` (overrides, Later), unique(store_id,user_id) |
| `invites` | `store_id`, `token_hash`, `role`, `expires_at`, `used_by`, `used_at` |
| `customers` | `store_id`, `user_id` (nullable for guest/manual), `name`, `phone`, `tags text[]`, `note`, `is_blocked`, `orders_count`, `total_spent` (denormalised), `last_order_at` |
| `addresses` | `store_id`, `customer_id`, `label`, `region_code` (UZ-TK…), `district_code`, `line1`, `line2`, `landmark` ("mo'ljal", which matters in UZ), `lat`, `lng`, `is_default` |

### 8.3 Nested categories: decision
**Decision: adjacency list (`parent_id`) + materialised path in a Postgres `ltree` column.**

| Option | Reads (subtree, breadcrumbs) | Moves | Storage | Verdict |
|---|---|---|---|---|
| Adjacency only + recursive CTE | slower with depth, a join per level | O(1) | minimal | Good for writes, poor for subtree product listing |
| Closure table | fast | O(subtree × depth) row churn | O(n·depth) | More rows and harder moves, no benefit over ltree here |
| Nested sets | fast | rewrites half the table | minimal | Bad for frequent owner edits |
| **Adjacency + ltree path** | **fast, GiST index, `<@` / `@>` operators** | **one `UPDATE … SET path = new || subpath(path, nlevel(old))`** | small | ✅ |

Rationale: category trees are **shallow and read-heavy**. Storefront listing "all products under Clothing" is the hot path,
and ltree makes it a single indexed predicate. Keeping `parent_id` gives referential integrity and simple child listing.
This "parent_id for writes, path for subtree reads" hybrid is a known pattern ([dev.to comparison][tree-devto]).
**Crucially, `ltree` ships in PGlite's main package** ([PGlite extensions][pglite-ext]), so the browser demo runs the exact same SQL.

```sql
create extension if not exists ltree;
create table categories (
  id          uuid primary key,
  store_id    uuid not null references stores(id),
  parent_id   uuid null references categories(id) on delete restrict,
  path        ltree not null,            -- labels = 'c' || replace(id::text,'-','') (stable under renames)
  depth       int  generated always as (nlevel(path)) stored,
  slug        text not null,             -- unique among siblings
  name        jsonb not null,            -- {uz, ru, en}
  description jsonb, image_media_id uuid, icon text,
  position    int not null default 0,    -- sibling order (gap-based, 1024 steps)
  is_hidden   bool not null default false,
  product_count_subtree int not null default 0,  -- maintained by job/trigger
  unique (store_id, parent_id, slug)
);
create index on categories using gist (path);
create index on categories (store_id, parent_id, position);
```
Rules (enforced in `core.CategoryService` and re-checked in SQL):
- **Arbitrary depth.** No hard limit; the UI soft-warns beyond 8 levels (mirrors Shopify's 8-level block nesting).
- **Cycle prevention.** Moving node N under P is rejected if `P.path <@ N.path`.
- **Move** = one transaction: update `parent_id`, then rewrite `path` for the subtree with a single statement, then re-number `position`.
- **Delete strategies:** `reparent_children` (children and products go to the parent), `reassign_products(targetId)`, `archive_subtree`.
- Products reference **one primary category** (`products.category_id`). Listing a category shows products where
  `category.path <@ :path` (subtree). Cross-cutting groupings use **collections**.
- Category **slug path** for URLs (`/c/kiyim/ayollar/koylaklar`) is resolved by walking sibling slugs. It is cached.

### 8.4 Catalog
| Table | Key columns |
|---|---|
| `products` | `store_id`, `id`, `short_id` (base36 for deep links), `status` (`draft/active/archived`), `title jsonb`, `slug`, `description jsonb` (sanitised rich text AST, not HTML), `category_id`, `tags text[]`, `attributes jsonb` (spec list), `is_digital bool`, `brand`, `vendor_code`, `rating_avg numeric(2,1)`, `rating_count`, `sold_count`, `published_at`, `search_doc text` (normalised, transliterated), `search_tsv tsvector`, `seo jsonb` (share title/desc/image) |
| `product_options` | `store_id`, `product_id`, `position (1..3)`, `name jsonb` ("O'lcham"), `display` (`chips/swatch/image`) |
| `option_values` | `store_id`, `option_id`, `position`, `label jsonb`, `swatch_hex`, `swatch_media_id` |
| `product_variants` | `store_id`, `id`, `product_id`, `option_value_ids uuid[]` (ordered by option position; unique per product), `sku`, `barcode`, `price bigint`, `compare_at_price bigint`, `cost_price bigint`, `weight_g`, `ikpu_code` (MXIK), `package_code`, `vat_percent`, `is_default`, `position`, `media_id` (variant image), `track_inventory bool`, `allow_backorder bool` |
| `inventory_levels` | `store_id`, `variant_id` PK, `on_hand int`, `reserved int`, `low_stock_threshold`; `available = on_hand − reserved` |
| `inventory_movements` | ledger: `store_id`, `variant_id`, `delta`, `reason` (`purchase/sale/return/adjustment/import/reservation_release`), `ref_type/ref_id`, `actor_id`, `created_at` |
| `inventory_reservations` | `store_id`, `variant_id`, `cart_id/order_id`, `qty`, `expires_at` (default 30 min, like Uzum) |
| `product_media` | `store_id`, `product_id`, `media_id`, `position`, `alt jsonb`, `is_cover` |
| `media` | `store_id`, `id`, `kind` (`image/video`), `storage_key`, `width`, `height`, `blurhash`, `dominant_color`, `bytes`, `mime` |
| `collections` | `store_id`, `title jsonb`, `slug`, `kind` (`manual/automated`), `rules jsonb` (`{all|any: [{field, op, value}]}`), `sort` , `image_media_id` |
| `product_collections` | manual membership + materialised membership for automated (refreshed by job on product change) |
| `co_purchases` | `store_id`, `product_a`, `product_b`, `count` (for "frequently bought together") |

Variants: **max 3 options per product, max 2,048 variants** (Shopify parity, [Shopify][shopify-w26]); the generator
creates the Cartesian product and lets owners delete combinations. A product with no options has exactly one
`is_default` variant, so cart and order logic always operate on variants.

### 8.5 Carts, orders, customers' social data
| Table | Key columns |
|---|---|
| `carts` | `store_id`, `id`, `customer_id`/`user_id`, `status` (`active/converted/abandoned`), `promo_code`, `currency`, `updated_at`; unique active cart per (store,user) |
| `cart_items` | `store_id`, `cart_id`, `variant_id`, `qty`, `added_price` (to show "price changed" notices) |
| `orders` | `store_id`, `id`, `number` (per-store sequence, e.g. `#1042`), `short_id`, `customer_id`, `status` (§9), `payment_status`, `fulfillment_status`, `currency`, `subtotal`, `discount_total`, `shipping_total`, `total`, `contact jsonb` (name, phone), `shipping_address jsonb` (snapshot), `shipping_method_id`, `delivery_promise jsonb` ({date_from,date_to}), `pickup_code` (6 digits, hashed + last digits), `note`, `source` (startapp campaign), `locale`, `placed_at`, `cancelled_at`, `cancel_reason` |
| `order_items` | snapshot: `variant_id`, `product_id`, `title`, `variant_title`, `sku`, `image_key`, `unit_price`, `qty`, `discount_allocations jsonb`, `ikpu_code`, `package_code`, `vat_percent` |
| `order_events` | timeline/audit: `type` (`status_changed/note/payment/refund/notification`), `from`, `to`, `actor` (`buyer/staff/system/provider`), `data jsonb` |
| `shipments` | `store_id`, `order_id`, `method`, `tracking_number`, `carrier`, `shipped_at`, `delivered_at` |
| `reviews` | `store_id`, `product_id`, `variant_id`, `order_item_id` (verified purchase, required), `customer_id`, `rating 1..5`, `text`, `pros`, `cons`, `status` (`pending/published/hidden`), `helpful_count`, `owner_reply`, `owner_reply_at` |
| `review_media` | `review_id`, `media_id`, `position` (≤ 6 photos) |
| `questions` / `answers` | `product_id`, `customer_id`, `text`, `status`; answers by staff (`is_official`) |
| `wishlists` | `store_id`, `user_id`, `product_id`, `variant_id?`, `created_at`, `price_at_save` (for price-drop alerts) |
| `stories` / `story_frames` | `story`: `title`, `cover_media_id`, `is_highlight`, `expires_at`; `frame`: `media_id`, `duration_ms`, `link {type: product/collection/url, id}`, `cta_label` |

### 8.6 Discounts, shipping, payments, payouts
| Table | Key columns |
|---|---|
| `discounts` | `store_id`, `kind` (`code/automatic/flash_sale`), `code citext` (unique per store), `value_type` (`percent/fixed/free_shipping/bxgy`), `value`, `bxgy jsonb`, `applies_to jsonb` (all / products / collections / category subtree), `conditions jsonb` (min_subtotal, first_order, customer_tags), `starts_at`, `ends_at`, `usage_limit`, `per_customer_limit`, `used_count`, `combines_with {order, product, shipping}`, `priority`, `status` |
| `discount_redemptions` | `discount_id`, `order_id`, `customer_id`, `amount` |
| `shipping_methods` | `store_id`, `type` (`courier/pickup_point/post/self_pickup`), `name jsonb`, `processing_days`, `cutoff_time` (local, e.g. 14:00), `working_days int[]`, `holidays date[]`, `pickup_points jsonb` |
| `shipping_zones` | `store_id`, `name`, `regions text[]` (ISO 3166-2:UZ), `districts text[]` |
| `shipping_rates` | `zone_id`, `method_id`, `calc` (`flat/weight/free_over`), `amount`, `per_kg`, `free_over`, `transit_days_min/max` |
| `payment_provider_configs` | `store_id`, `provider` (`payme/click/uzum/paynet/telegram/stars/stripe/cod/bank_transfer/sandbox_*`), `mode` (`sandbox/live`), `enabled`, `credentials_enc bytea` (AES-256-GCM envelope; never returned to clients), `public_config jsonb` (merchant_id, service_id…), `webhook_secret_hash`, `last_verified_at` |
| `payments` | `store_id`, `id`, `order_id`, `provider`, `mode`, `status` (§9.2), `amount`, `currency`, `provider_txn_id` (unique per provider), `provider_state`, `idempotency_key`, `redirect_url`, `expires_at`, `paid_at`, `raw jsonb` (last provider payload, PII-scrubbed) |
| `payment_events` | append-only log of every webhook/callback (`kind`, `payload_hash`, `signature_ok`, `response`) for debugging & replay |
| `refunds` | `payment_id`, `amount`, `reason`, `status`, `provider_ref` |
| `payouts` | **placeholder**: `store_id`, `period`, `gross`, `fees`, `net`, `status`. In the MVP, money goes **directly to each merchant's own Payme/Click account**, so the platform never holds funds |

**Fiscal note (UZ).** Payme exposes a `SetFiscalData` method ([Payme methods index][payme-methods]), and fiscal receipt lines in Uzbekistan are keyed by IKPU (MXIK) and package codes plus VAT (exact receipt `detail` schema to be verified against Payme docs during M4).
We therefore store `ikpu_code/package_code/vat_percent` on variants and snapshot them on order items, even though fiscal submission is Later.

### 8.7 Theme, platform & ops
| Table | Key columns |
|---|---|
| `store_themes` | `store_id`, `id`, `version`, `status` (`draft/published/archived`), `tokens jsonb` (§12), `sections jsonb` (ordered home blocks), `preset`, `created_by`; one published per store |
| `audit_log` | `store_id?`, `actor_user_id`, `actor_role`, `action` (`product.update` …), `entity_type`, `entity_id`, `diff jsonb` (JSON Patch), `ip_hash`, `ua_hash`, `created_at`; append-only (no UPDATE/DELETE grants) |
| `outbox` | transactional outbox for notifications/webhooks/analytics: `store_id`, `topic`, `payload`, `status`, `attempts`, `next_attempt_at` |
| `analytics_events` | `store_id`, `session_id`, `user_id?`, `name` (`store_view/product_view/add_to_cart/begin_checkout/purchase/search`), `props jsonb`, `source`, `ts`; partitioned monthly; daily rollups in `analytics_daily` |
| `reports` (platform) | abuse reports on stores/products |

---

## 9. Order, payment & inventory state machines

Implemented in `core` as **typed transition tables** with guards and effects, not a heavy library. They are
unit-tested exhaustively and also rendered as a diagram in the docs.

### 9.1 Order status
```
              ┌──────────── cancel (buyer/staff/timeout) ─────────────┐
              │                                                       ▼
 [checkout] ──┼─▶ pending_payment ──payment.paid──▶ paid ──auto/staff──▶ confirmed
              │        │ ttl 30m → cancelled                              │
              └─▶ awaiting_confirmation (COD/bank) ──staff.confirm──▶ confirmed
                                                                           │
                         confirmed ──▶ packing ──┬──▶ shipped ──▶ delivered ──(+N days)──▶ completed
                                                 └──▶ ready_for_pickup ──pickup code ok──▶ delivered
 cancellable from: pending_payment, awaiting_confirmation, paid, confirmed, packing  → cancelled
   (if paid → refund flow starts; reservations released; stock restored)
 delivered|completed ──buyer.return_request──▶ return_requested ──staff.accept──▶ returned ──▶ (refund)
```
| Transition | Actor | Guards | Effects |
|---|---|---|---|
| `place` → `pending_payment` | buyer | stock available, totals re-computed server-side, method enabled | reserve stock (TTL), create Payment, outbox `order.placed` |
| `place` → `awaiting_confirmation` | buyer | COD/bank allowed for zone | reserve stock, notify owner with inline buttons |
| `payment.paid` | provider/system | amount == order.total, payment not already applied | convert reservation → sale movement, `paid_at`, notify both |
| `confirm` | staff (`orders.manage`) | — | notify buyer |
| `ship` | staff | method ∈ courier/post | tracking optional; notify buyer with date |
| `ready_for_pickup` | staff | method ∈ pickup | generate/show pickup code; notify |
| `deliver` | staff / pickup-code scan | for pickup: code matches | `delivered_at` |
| `complete` | system job | `delivered_at + return_window` | review request message to buyer |
| `cancel` | buyer (only before `confirmed`), staff, system (TTL) | not shipped | release reservation / restock, refund if paid |

`payment_status`: `unpaid → pending → paid → partially_refunded | refunded`, plus `failed`.
`fulfillment_status`: `unfulfilled → packing → shipped|ready → delivered → returned`. It is derived from the order status, but stored for filtering.

### 9.2 Payment status
`created → pending (redirected / invoice sent) → paid | failed | cancelled | expired`, then `paid → refund_pending → refunded|partially_refunded`.
Provider-native states map to ours (Payme `1/2/-1/-2` → `pending/paid/cancelled/refunded`, [Payme flow][payme-flow]).
**Every transition is idempotent** and keyed by `(provider, provider_txn_id)`.

### 9.3 Inventory
`available = on_hand − reserved`. On place: `reserved += qty` with an `inventory_reservations` row. On pay: `on_hand −= qty`,
`reserved −= qty` plus a ledger row. On TTL expiry (pg-boss job) or cancel: `reserved −= qty`. All of this runs with
`SELECT … FOR UPDATE` on `inventory_levels` rows in variant-id order, which avoids deadlocks. Oversell is impossible unless
`allow_backorder`.

### 9.4 Pricing pipeline (pure function in core, same in browser)
```
lines(unit price × qty)
 → automatic product-level discounts (flash sales; best single per line unless combinable)
 → order-level automatic discounts
 → promo code (validate conditions/limits; respects combines_with)
 → shipping rate (zone × method × weight/subtotal) → shipping discounts (free_shipping)
 → rounding: UZS totals rounded to whole so'm (display), stored in tiyin
 → allocation of order-level discounts back to lines (largest-remainder) for refunds & fiscal lines
```
Output includes `explanations[]` (why each discount applied or not) so the UI can say *"Promo-kod faqat 300 000 so'mdan
yuqori buyurtmalarga"* ("Promo code only applies to orders above 300,000 so'm").

### 9.5 Delivery-date promise (pure function)
`promise(now, method, zone, calendar)`: if `now < cutoff` on a working day, processing starts today; otherwise it starts on the next working day.
Then `+processing_days`, then `+transit_min..max` working days, giving a date range. The UI phrases it relatively ("Bugun", "Ertaga", "Payshanba, 14-noyabr").
This follows the Baymard guidance to show dates, not speeds ([Baymard][baymard-date]).

### 9.6 Installment display (informational in MVP)
The owner configures plans `{months: 3|6|12, markup_percent}`. The card shows `ceil(total × (1+markup)/months)` as "dan X so'm/oy",
and the PDP shows a breakdown with the **total payable** ("no hidden fees" transparency, as Uzum does ([Uzum][uzum-nasiya])).
It is labelled "Muddatli to'lov — do'kon shartlari" (store's terms) until a real BNPL adapter (Uzum Nasiya Partner API, Later) is connected.

---

## 10. API surface

### 10.1 Conventions
- REST + JSON under `/v1`. Request and response schemas are zod definitions in `packages/api-contract`, and OpenAPI 3.1 is generated from them.
- The same contract defines the **`DokonimApi` TypeScript interface**, which has two implementations: `HttpApi` (fetch) and `LocalApi` (worker → core).
- Auth: `Authorization: Bearer <access JWT>` (15 min), plus a refresh token (30 d, rotating, httpOnly not possible in TMA → stored in
  memory and in SecureStorage when available, else DeviceStorage).
- Tenancy: the **store is always explicit** in the path (`/v1/stores/:storeId/...` for admin, `/v1/s/:slug/...` for public).
- Pagination: cursor-based (`?cursor=&limit=`); filtering via typed query params; `ETag`/`If-None-Match` on catalog reads.
- Idempotency: `Idempotency-Key` header required on `POST /orders`, payment intents and refunds.
- Errors: `{ error: { code: 'CART_ITEM_OUT_OF_STOCK', message, details } }` with stable codes, localised on the client.

### 10.2 Endpoints
**Auth & me**
```
POST   /v1/auth/telegram            { initData } → { accessToken, refreshToken, user }
POST   /v1/auth/refresh
GET    /v1/me                       profile, stores (owned/staff), recent stores
PATCH  /v1/me                       language, notification prefs
POST   /v1/me/phone                 phone from requestContact (verified via bot-received contact)
```
**Public storefront** (`:slug`, anonymous allowed for reads)
```
GET    /v1/s/:slug                          store, published theme, nav (root categories), locales
GET    /v1/s/:slug/categories?parent=&depth= tree slice (with counts)
GET    /v1/s/:slug/categories/by-path/*path  resolve slug path → category + breadcrumbs
GET    /v1/s/:slug/products?category=&collection=&q=&sort=&price_min=&price_max=&opt[<optionName>]=&attr[k]=&in_stock=&on_sale=&rating_gte=&cursor=
GET    /v1/s/:slug/products/facets?<same filters>   facet counts
GET    /v1/s/:slug/products/:id             product, options, variants, availability, media, delivery promise, installments
GET    /v1/s/:slug/products/:id/related     related + frequently bought together
GET    /v1/s/:slug/search/suggest?q=
GET    /v1/s/:slug/collections/:slug
GET    /v1/s/:slug/stories
GET    /v1/s/:slug/products/:id/reviews?rating=&with_media=&cursor=
POST   /v1/s/:slug/products/:id/reviews     (verified purchase)
POST   /v1/s/:slug/reviews/:id/helpful
GET    /v1/s/:slug/products/:id/questions ; POST …/questions
GET    /v1/s/:slug/shipping/quote?region=&district=&cart=   methods + prices + dates
```
**Buyer (auth)**
```
GET    /v1/s/:slug/cart ; PUT /v1/s/:slug/cart/items/:variantId {qty} ; DELETE …
POST   /v1/s/:slug/cart/promo {code} ; DELETE /v1/s/:slug/cart/promo
POST   /v1/s/:slug/checkout/quote           full priced quote incl. explanations
POST   /v1/s/:slug/orders                   (Idempotency-Key) → order + next action {type: redirect|invoice|none, url}
GET    /v1/s/:slug/orders ; GET /v1/s/:slug/orders/:id ; GET /v1/s/:slug/orders/:id/events (SSE)
POST   /v1/s/:slug/orders/:id/cancel ; POST …/reorder ; POST …/return-request
POST   /v1/s/:slug/orders/:id/payments      retry/switch method → intent
GET/PUT/DELETE /v1/s/:slug/wishlist[/:productId]
GET/POST/PATCH/DELETE /v1/me/addresses
POST   /v1/s/:slug/events                   analytics batch (sendBeacon)
POST   /v1/share/prepared-message           → savePreparedInlineMessage id for shareMessage
```
**Owner/staff admin** (`/v1/stores/:storeId/...`, permission-checked)
```
POST   /v1/stores                           create (onboarding) ; GET/PATCH /v1/stores/:id ; POST …/publish ; DELETE (close)
GET    /v1/stores/:id/slug-available?slug=
CRUD   /products  (+ POST /products/:id/duplicate, POST /products/bulk {action, ids, params})
CRUD   /products/:id/options ; POST /products/:id/variants/generate ; PATCH /products/:id/variants/bulk
CRUD   /categories ; POST /categories/:id/move {parentId, position} ; DELETE /categories/:id?strategy=
CRUD   /collections ; POST /collections/:id/preview-rules
GET    /inventory?low_stock= ; POST /inventory/adjust {variantId, delta, reason} ; GET /inventory/movements
GET    /orders?status=&q=&from=&to= ; GET /orders/:id ; POST /orders/:id/transition {to, data} ; POST /orders/:id/notes ; POST /orders/:id/refunds
GET    /customers ; GET/PATCH /customers/:id
CRUD   /discounts ; POST /discounts/validate
CRUD   /shipping/methods, /shipping/zones, /shipping/rates
GET    /payments/providers ; PUT /payments/providers/:provider {mode, credentials, enabled} ; POST /payments/providers/:provider/test
GET/PUT /theme/draft ; POST /theme/publish ; GET /theme/versions ; POST /theme/versions/:v/restore
CRUD   /stories
GET/PATCH /reviews, /questions (moderate, reply)
GET    /staff ; POST /staff/invites ; PATCH/DELETE /staff/:userId
GET    /analytics/summary?range= ; /analytics/funnel ; /analytics/top-products ; /analytics/sources
POST   /media/uploads → presigned PUT ; POST /media/:id/complete
POST   /import/products (multipart) → job {dryRun} ; GET /import/:jobId ; GET /export/products.csv ; /export/orders.csv
GET    /audit?entity=&actor=
```
**Webhooks** (no JWT; provider-specific auth, §11, §16)
```
POST /hooks/payme/:storeId                     JSON-RPC 2.0 (Basic auth)
POST /hooks/click/:storeId/prepare | /complete  form-encoded (md5 sign_string)
POST /hooks/uzum/:storeId/{check,create,confirm,reverse,status}
POST /hooks/stripe                              Stripe-Signature
POST /hooks/telegram/:botId                     X-Telegram-Bot-Api-Secret-Token (pre_checkout_query, successful_payment, messages)
```
**Platform admin**: `GET /v1/admin/stores`, `POST /v1/admin/stores/:id/suspend`, `GET /v1/admin/webhook-failures`, `GET /v1/admin/reports`.

---

## 11. Payment-provider interface

### 11.1 Provider landscape (researched)
| Provider | Model | Auth / integrity | Notes | Source |
|---|---|---|---|---|
| **Payme** (Merchant API) | Hosted checkout (`checkout.paycom.uz`, base64 params `m=…;ac.order_id=…;a=<tiyin>`), then **Payme calls us** via JSON-RPC 2.0: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`, `SetFiscalData` | HTTP Basic (`Paycom:<key>`), IP allowlist; always reply HTTP 200; amounts in tiyin | States 1/2/−1/−2; unperformed txn expires after **12 h (43,200,000 ms)**; errors −31001 amount, −31003 not found, −31008 state, −31050…−31099 account | [Payme methods][payme-methods], [Payme errors][payme-errors], [Payme protocol][payme-protocol], [guide][payme-flow] |
| **Click** (SHOP-API) | Payment link `my.click.uz/services/pay?service_id&merchant_id&amount&transaction_param&return_url`, then **Click calls us**: `Prepare` (action 0) and `Complete` (action 1) | `sign_string = md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + [merchant_prepare_id] + amount + action + sign_time)` | Errors: 0 ok, −1 sign failed, −2 amount, −4 already paid, −5 order not found, −6 txn not found, −8 request error, −9 cancelled; must be idempotent on `click_trans_id` | [Click request][click-req], [Click errors][click-err] |
| **Uzum Bank** | (a) **Merchant API**: Uzum calls partner webhooks `check / create / confirm / reverse / status`; (b) **Checkout** acquiring with `X-Terminal-Id` + `X-API-Key`; (c) **Uzum Nasiya Partner API** (BNPL) | headers / webhook auth issued by Uzum | Onboarding via account manager | [apis.io Uzum][uzum-apis] |
| **Paynet** | No public merchant API docs found. Community SDK shows payment links `app.paynet.uz?m=&c=&a=` | — | Adapter **Later**, via partnership | [PayTechUz][paytechuz] |
| **Telegram Payments** (physical goods) | `sendInvoice`/invoice link → `openInvoice` → `pre_checkout_query` (**answer within 10 s**) → `successful_payment` | bot token + provider token from BotFather | UZS is a supported currency; which UZ providers BotFather offers must be verified per bot | [TG payments][tg-payments] |
| **Telegram Stars** (digital goods) | currency `XTR`, empty `provider_token`; `refundStarPayment`; must handle `/paysupport` | bot | **Digital goods must use Stars** | [TG Stars][tg-stars] |
| **Stripe** | Checkout Session + webhook (`Stripe-Signature`, HMAC-SHA256 with timestamp) | secret key | For international sellers/portfolio. Verify UZ merchant eligibility | [stripe.com/global][stripe-global] |
| **COD / bank transfer** | offline | — | `awaiting_confirmation` path | — |
| **Sandbox-*** | simulators of Payme/Click/Uzum/Telegram that exercise the **real protocol handlers** | demo keys | default in demo & new stores | §11.4 |

### 11.2 Two integration shapes
1. **Push (we call them)**: Stripe, Uzum Checkout, Telegram invoices. We create an intent, then redirect or open the invoice, then receive a webhook.
2. **Pull/callback protocols (they call us and ask questions)**: Payme and Click (and the Uzum Merchant API). The provider
   asks *"is this order payable for this amount?"*, then *"lock it"*, then *"perform it"*. Our handler must answer from our DB,
   be idempotent, and map to our payment state machine.

### 11.3 Interfaces (packages/payments + ports in core)
```ts
// core/ports/payments.ts
export type ProviderId =
  | 'payme' | 'click' | 'uzum' | 'paynet' | 'telegram' | 'stars' | 'stripe'
  | 'cod' | 'bank_transfer';

export interface ProviderCapabilities {
  currencies: string[];                 // ['UZS'] | ['XTR'] | ...
  goods: Array<'physical' | 'digital'>; // stars → ['digital'] only
  refunds: 'full' | 'partial' | 'none' | 'manual';
  flow: 'redirect' | 'invoice' | 'offline';
  fiscalReceipts: boolean;              // Payme detail/SetFiscalData
}

export interface CreateIntentInput {
  store: StoreRef; order: OrderSnapshot; payment: PaymentRecord;
  returnUrl: string;                    // t.me/<bot>/shop?startapp=<slug>-o-<orderShortId>
  locale: 'uz' | 'ru' | 'en';
}
export type NextAction =
  | { type: 'redirect'; url: string; openWith: 'openLink' | 'openTelegramLink' }
  | { type: 'invoice'; invoiceLink: string }        // WebApp.openInvoice
  | { type: 'none'; message: string };              // COD / bank transfer instructions

export interface PaymentProviderAdapter {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  validateConfig(cfg: ProviderConfig): Promise<ConfigCheck>;          // "Test connection"
  createIntent(input: CreateIntentInput, cfg: ProviderConfig): Promise<NextAction>;
  refund?(p: PaymentRecord, amount: bigint, cfg: ProviderConfig): Promise<RefundResult>;
  fetchStatus?(p: PaymentRecord, cfg: ProviderConfig): Promise<ProviderStatus>;
}

/** For pull/callback protocols (Payme, Click, Uzum Merchant) and push webhooks alike */
export interface WebhookHandler {
  readonly id: ProviderId;
  /** Verify auth/signature using the store's config. MUST be constant-time. */
  authenticate(req: RawWebhookRequest, cfg: ProviderConfig): AuthResult;
  /** Translate the provider message into ledger commands and build the provider-specific response. */
  handle(req: RawWebhookRequest, ctx: PaymentLedgerPort): Promise<RawWebhookResponse>;
}

/** Narrow port the handlers use — all money logic stays in core */
export interface PaymentLedgerPort {
  findPayableOrder(ref: { orderId?: string; paymentId?: string }): Promise<PayableOrder | null>;
  checkPayable(orderId: string, amount: bigint): Promise<CheckResult>;          // amount & state & stock
  openTransaction(input: { provider: ProviderId; providerTxnId: string; orderId: string;
                           amount: bigint; providerTime: Date }): Promise<TxnView>;  // idempotent
  confirmTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView>; // idempotent → order.paid
  cancelTransaction(provider: ProviderId, providerTxnId: string, reason: number): Promise<TxnView>;
  getTransaction(provider: ProviderId, providerTxnId: string): Promise<TxnView | null>;
  statement(provider: ProviderId, from: Date, to: Date): Promise<TxnView[]>;
}
```
Rules:
- **Amounts always come from our DB**, never from the client. The provider's amount must equal `payments.amount`.
- **Per-store credentials.** Webhook URLs embed `storeId` (`/hooks/payme/:storeId`), and the config is looked up before authentication.
  Credentials are AES-256-GCM encrypted with a key-encryption key from env. Secrets are never sent to the Mini App.
- **Raw-body capture** for signatures. Every call is logged to `payment_events` with a payload hash and the response sent.
- Mapping tables (e.g. Payme state ↔ ours, Click error ↔ ours) are pure functions with fixture-driven tests.
- **Telegram constraint.** Since Bot API 10.2, Mini App methods are restricted to the Mini App's origin ([changelog][tg-changelog]),
  so provider pages are opened with `WebApp.openLink` (external browser or in-app browser). They return via a
  `t.me/…?startapp=<slug>-o-<id>` link, and the app also polls/SSEs the payment status.
- **Digital goods** (`products.is_digital`) are only offered Stars at checkout, as Telegram's rules require ([TG Stars][tg-stars]).

### 11.4 Sandbox adapters (demo works with no real keys)
Each sandbox adapter is a **simulator of the provider side** that drives our **real** handler:
- `SandboxPayme`: `createIntent` returns `{redirect: 'sandbox://payme?...'}`. The Mini App shows a **Sandbox checkout sheet**
  that looks like a neutral card form (clearly labelled "SANDBOX — real pul yechilmaydi", "no real money is charged") with test cards: *success*, *insufficient funds*, *timeout*.
  On "Pay", the simulator sends genuine JSON-RPC requests (`CheckPerformTransaction` → `CreateTransaction` →
  `PerformTransaction`) with a correct `Basic Paycom:<sandboxKey>` header to `PaymeWebhookHandler`. The handler is the exact
  code used in production.
- `SandboxClick`: computes real `md5` `sign_string`s with the sandbox secret and calls `Prepare` → `Complete`.
  It can also replay **duplicate Complete** and **bad signature** scenarios from a debug menu, which shows idempotency live.
- `SandboxTelegramInvoice`: simulates `pre_checkout_query` (with the 10 s deadline) → `successful_payment`.
- On the server, sandbox mode is per store (`mode: 'sandbox'`), and simulators run in-process behind `/v1/sandbox/*`
  (disabled when `NODE_ENV=production` unless the store is in sandbox).

---

## 12. Theming system

### 12.1 Token layers
1. **Reference tokens** are generated, not hand-picked. From one **brand colour** we build tonal ramps in **OKLCH**
   (perceptually even: L 98→12 in 12 steps; chroma clamped to the sRGB gamut). We also build a neutral ramp tinted 4% toward the brand hue
   and a fixed set of semantic hues (success, warning, danger, info) that are hue-shifted toward the brand for harmony.
2. **System tokens** (semantic): `surface`, `surface-raised`, `surface-sunken`, `on-surface`, `on-surface-muted`, `outline`,
   `accent`, `on-accent`, `accent-soft`, `price`, `price-old`, `sale`, `rating`, `focus`, plus elevation `e0–e3`
   (borders first, then soft shadows; no heavy blur).
3. **Component tokens**: `card.radius`, `card.padding`, `button.radius`, `chip.height`, `sheet.radius`, `image.aspect`…

All tokens compile to **CSS custom properties** on `:root[data-store]`. Switching a store or editing the theme only rewrites
variables, with no re-render of components.

### 12.2 Owner-editable theme (stored as `store_themes.tokens`)
```jsonc
{
  "brand": "#B4442E",            // or picked from logo (k-means in OKLCH, 5 suggestions)
  "accent2": null,               // optional secondary
  "mode": "telegram",            // telegram | light | dark | brand (brand-tinted dark)
  "radius": "soft",              // sharp(4) | soft(14) | round(22) | pill
  "density": "comfortable",      // compact | comfortable
  "fontPair": "unbounded-onest", // 5 curated pairs (Latin + Cyrillic + U+02BB/U+02BC verified)
  "cardStyle": "gallery",        // gallery(4:5) | catalog(1:1 compact) | editorial | ticket
  "motif": "ikat",               // ikat | suzani-dots | none | custom(svg ≤ 4 KB, sanitised)
  "buttonShape": "soft",         // soft | pill | sharp
  "imageFit": "cover",           // cover | contain-on-tint
  "motion": "expressive"         // expressive | calm  (caps the tier, see §13)
}
```
**Sections (home layout)** form an ordered array of `{type, id, hidden, settings, blocks[]}`. Section types: `hero` (image/video,
headline, CTA), `stories`, `category_rail`, `category_grid`, `collection_grid`, `product_carousel` (source: collection/
category/new/bestsellers/on_sale), `flash_sale` (countdown + products), `banner`, `bento` (2–5 tiles with **size = importance**),
`text`, `image_text`, `testimonials` (from reviews), `faq`, `contacts_map`, `instagram_like_lookbook`. Blocks can nest
(e.g. bento → tile → button). The UI soft-limits depth to 3; the schema allows deeper nesting (Horizon-style, [GemPages][shopify-horizon]).

### 12.3 Guards
- **Contrast guard.** `on-accent` is auto-chosen (white or ink) to reach WCAG 2.2 AA 4.5:1. If the brand colour fails as a text
  colour on surface, the system shifts `accent-text` lightness until it passes and shows the owner a ⓘ notice.
- **Telegram harmony.** In `mode: telegram`, neutrals come from `themeParams` (`bg_color`, `secondary_bg_color`,
  `text_color`, `hint_color`, `section_separator_color`…), while the store accent stays. We also set `setHeaderColor`,
  `setBackgroundColor` and `setBottomBarColor` to match ([Telegram Mini Apps][tg-webapps]).
- **Presets.** 8 presets per business type ("Atlas" for textiles, "Choyxona" for food, "Lab" for cosmetics…), each a full token+section set.

### 12.4 Visual direction: "Bozor Modern"
A deliberate alternative to generic glassmorphism or Tailwind UI:
- **Material: paper and ink.** Warm off-white surfaces (`oklch(97% 0.01 80)`) and deep ink text. Depth comes from crisp 1px
  outlines and offset "print" shadows (`2px 2px 0 ink/8%`) instead of blur. Blur is cheap to design but expensive for low-end GPUs.
- **Motif: ikat (abr).** Uzbek ikat's signature *blurred-edge* dye pattern, rendered as one small SVG pattern tinted with
  `currentColor`. It appears in the hero edge, empty states, pull-to-refresh, and **skeleton loaders** (a slow ikat stripe drift
  instead of the grey shimmer every app uses).
- **Type.** A wide display face for prices and headings (e.g. *Unbounded*) and a neutral grotesk for UI (e.g. *Onest*/*Inter*).
  Both have Latin + Cyrillic, and the glyphs `ʻ` (U+02BB) and `ʼ` (U+02BC) are verified. **Prices are the hero typographic element**:
  tabular numerals and a thin-space group separator (`1 250 000 so'm`).
- **Bento with meaning.** Tile size encodes importance (trend sources caution that uniform bento flattens hierarchy, [CommerceV3][bento]).
- **Iconography.** A 1.75px stroke icon set with rounded joins, with a filled state for active tabs.

---

## 13. Motion system & signature interactions

### 13.1 Library decision
**Motion for React** (motion.dev), loaded with `LazyMotion` + the `m` component + `domAnimation` features. The initial cost is about **5 KB**
vs about 43 KB for the full `motion` component ([Motion LazyMotion][motion-lazy], [Motion bundle][motion-bundle]). We use it for:
springs with **velocity hand-off** (interruptible gestures), `drag` with elastic constraints, `layoutId` shared-element fallback,
`AnimatePresence` exits, and `MotionConfig reducedMotion="user"`.
- **View Transitions API** for route-level morphs where `document.startViewTransition` exists and the tier is `full`. Same-document
  transitions are Baseline as of Oct 2025 ([web.dev][vt-baseline]; Chrome 111+, [Chrome docs][vt-chrome]). Telegram Android uses
  the system WebView (Chromium) and iOS uses WKWebView, so we feature-detect and never assume.
- **WAAPI** (`element.animate`) for fire-and-forget compositor animations (the add-to-cart arc), with no React re-renders per frame.
- Rejected: **GSAP** (imperative, bigger, no React layout projection), **react-spring** (no layout animations),
  **CSS-only** (no gesture-driven interruptible springs).

### 13.2 Tokens
| Token | Value | Use |
|---|---|---|
| `dur.xs` | 90 ms | press feedback, chip select |
| `dur.sm` | 140 ms | fades, icon swaps |
| `dur.md` | 220 ms | sheets content, list enter |
| `dur.lg` | 320 ms | page transitions |
| `dur.xl` | 480 ms | celebratory, arc flight (full tier: 520) |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | most |
| `ease.decel` (emphasized) | `cubic-bezier(0.05, 0.7, 0.1, 1)` | entering |
| `ease.accel` | `cubic-bezier(0.3, 0, 1, 1)` | exiting |
| `spring.snappy` | stiffness 520, damping 38, mass 1 | buttons, toggles |
| `spring.bouncy` | stiffness 380, damping 18, mass 1 | cart icon, badges |
| `spring.sheet` | stiffness 300, damping 32, mass 1 | bottom sheets |
| `spring.morph` | stiffness 420, damping 40, mass 1 | shared-element morph |
| `stagger` | 24 ms, max 8 items, then batch | lists |

**Properties allowed to animate:** `transform`, `opacity`; `clip-path` only in the `full` tier. Never animate `width`, `height`,
`top`, `box-shadow`, `filter: blur` or `backdrop-filter`. Shadows animate via opacity of a pre-rendered pseudo-element.

### 13.3 Motion tiers (low-end Android first)
| Tier | Detection | Behaviour |
|---|---|---|
| `full` | Telegram Android UA performance class `HIGH`, iOS, or desktop; `hardwareConcurrency ≥ 6`; FPS probe ≥ 55 | All signature motions, VT API morphs, parallax hero, video autoplay |
| `lite` | class `AVERAGE`, `deviceMemory ≤ 4`, or probe 40–55 fps | No flight arcs (pulse instead), morph without corner-radius animation, crossfade routes, no parallax |
| `minimal` | class `LOW`, `prefers-reduced-motion`, Data Saver, probe < 40 | Opacity-only ≤ 140 ms, haptics carry the feedback |

Telegram tells Mini Apps to read the **Android performance class from the User-Agent and reduce animations on
low-performance devices** ([Telegram Mini Apps][tg-webapps]). The FPS probe runs in the first idle second (rAF deltas) and can
only **downgrade** the tier. The owner's `motion: calm` caps a store at `lite`.

### 13.4 Signature interaction 1: **"Savat yoyi"** (The Arc), physics add-to-cart
- **Trigger:** "Savatga qo'shish" (MainButton or card quick-add).
- **Full tier:** a token clone of the product image (a 56px circle with the image) launches from the image centre and follows a
  **ballistic parabola** to the cart tab icon. Keyframes are **pre-sampled from a projectile solution** (16 samples; apex 120px above the
  higher of start/end; constant horizontal velocity, gravity-like vertical), so motion is physically believable and
  runs as one WAAPI animation on the compositor. Duration 520 ms. Scale 1 → 0.32, rotate −14° → 0°.
- **Landing:** the cart icon does **squash and stretch** (scaleX 1.18 / scaleY 0.84 → `spring.bouncy` back), and the badge counter
  **odometer-rolls** to the new number (digits translateY in a 1-em mask, 260 ms).
- **Haptics:** `impactOccurred('light')` at launch, `impactOccurred('soft')` at landing, `notificationOccurred('error')` with a shake (3 × 6px, 240 ms)
  if out of stock.
- **Lite tier:** no flight; the image pulses (scale 0.96 → 1, 140 ms) and the icon bounces.
- **Minimal:** badge number swap plus haptics.
- **Accessibility:** a live region announces "Savatga qo'shildi: Atlas ko'ylak, M, qizil".

### 13.5 Signature interaction 2: **"Uzluksiz"** (Continuity), grid ↔ product morph with drag-to-dismiss
- **Open:** tapping a card captures its image rect. The PDP mounts with the hero image at that rect and morphs to its final rect
  (`spring.morph`, about 360 ms). Corner radius goes 14 → 0 and a scrim fades 0 → 1 over 160 ms. PDP content enters with stagger
  (y 16 → 0, opacity 0 → 1, starting at +120 ms, 24 ms stagger). In the full tier with VT support, this uses `view-transition-name:
  product-<id>`; otherwise it uses a Motion `layoutId`.
- **Dismiss by gesture:** dragging the hero down follows the finger 1:1, the page scales `1 − dy/1200` (min 0.82) and the radius grows.
  Release with `dy > 120px` **or** velocity > 800 px/s and the page flies back **into the exact grid card**, using the release velocity as
  the spring's initial velocity. Otherwise it snaps back. Swiping from the left edge does the same horizontally (iOS-like).
- **Telegram conflict handling:** vertical swipes close/minimise the Mini App, so the PDP calls `disableVerticalSwipes()` on
  enter and `enableVerticalSwipes()` on leave. Telegram recommends disabling only when gestures conflict, and they do here
  ([Telegram Mini Apps][tg-webapps]). The Telegram **BackButton** runs the same reverse morph.
- **Gallery inside the PDP:** horizontal swipe with rubber-band at the ends, pinch-zoom (transform only, max 3×), double-tap zoom
  at the tap point, and dots that morph into a progress pill for > 6 images.

### 13.6 Signature interaction 3: **"Bo'lib to'lash"** (The Split), the installment price morph
A motion that is specific to the Uzbek market:
- The price block has chips **[To'liq] [3 oy] [6 oy] [12 oy]**. Selecting "6 oy" makes the big price **split**: the full price
  shrinks and fades to 40% opacity on a line above, while **6 segment pills fan out** from its position (30 ms stagger) into a segmented bar,
  and the monthly amount odometer-rolls in as the new hero number ("412 000 so'm/oy"). The total payable
  stays visible ("Jami: 2 472 000 so'm"). Duration 300 ms.
- `selectionChanged()` haptic on each chip ([HapticFeedback][tg-webapps]).
- **Lite/minimal:** crossfade of numbers only.

### 13.7 Supporting motions
- **Theme morph (owner).** Theme tokens are registered as typed custom properties (`@property --brand-l { syntax: '<number>' }` etc.),
  so when the owner drags the hue or picks a radius, **the whole preview interpolates** in 400 ms. It feels like changing paint, not reloading.
- **Receipt stamp (success).** On paid orders, the order card "prints" out of the top edge (translateY −100% → 0 with
  `ease.decel` 420 ms), then a round store-coloured **stamp** lands with scale 1.3 → 1, rotate −8°, and `notificationOccurred('success')`.
  There's no confetti: it is quieter and cheaper.
- **Bottom sheets:** `spring.sheet` with snap points, velocity-aware, with a 1:1 rubber-band overscroll.
- **Category drill-down:** a shared-axis X transition (outgoing −24px with fade, incoming +24px), 220 ms.
- **Skeletons:** the ikat stripe drifts 0 → 40px over 1.6 s linear, infinitely, and is paused when offscreen (`content-visibility`).
- **Honest countdown:** digits flip only when they change (no per-second full re-render). At < 1 h the timer turns accent-coloured; it never restarts.

### 13.8 Haptics map
| Event | Haptic |
|---|---|
| Tap primary CTA | `impactOccurred('light')` |
| Variant/option chip, filter toggle, tab switch | `selectionChanged()` |
| Add to cart landing | `impactOccurred('soft')` |
| Error (OOS, invalid promo) | `notificationOccurred('error')` |
| Payment success, order placed | `notificationOccurred('success')` |
| Destructive confirm | `impactOccurred('rigid')` |
| Drag pickup (tree/media reorder) | `impactOccurred('medium')` |

---

## 14. Telegram platform integration

### 14.1 Feature usage (current WebApp API, [Telegram Mini Apps][tg-webapps], [changelog][tg-changelog])
| API | Since | Our use |
|---|---|---|
| `requestFullscreen` / `safeAreaInset` / `contentSafeAreaInset` (+ `--tg-*safe-area*` CSS vars) | 8.0 | Fullscreen storefront on high tier; layout pads with content safe area |
| `MainButton` / `SecondaryButton` (`color`, `text_color`, `has_shine_effect`, `position`, `icon_custom_emoji_id`) | 7.10 / 9.5 | Primary CTAs (add to cart, checkout, pay, save); shine while checkout is valid |
| `BackButton` | 6.1 | Mirrors router history; triggers reverse morphs |
| `SettingsButton` | 7.0 | Opens store settings (owner) / language & notifications (buyer) |
| `HapticFeedback` | 6.1 | §13.8 |
| `CloudStorage` (1,024 keys × 4,096 chars) | 6.9 | Cross-device: last store, cart pointer, language, recently viewed IDs (compact) |
| `DeviceStorage` (5 MB) | 9.0 | Query cache snapshot for instant warm start, story seen-state, drafts |
| `SecureStorage` (10 items, Keychain/Keystore) | 9.0 | Refresh token |
| `BiometricManager` | 7.2 | Optional owner lock for dashboard ("Face ID bilan kirish") |
| `requestContact` | 6.9 | Checkout phone in one tap (server verifies via the contact message the bot receives) |
| `LocationManager` | 8.0 | "Use my location" in address form → reverse geocode → region/district |
| `addToHomeScreen` / `checkHomeScreenStatus` | 8.0 | Owners: "Do'konni bosh ekranga qo'shish" after onboarding |
| `shareToStory` | 7.8 | Share product/store card image + widget link |
| `savePreparedInlineMessage` → `shareMessage` | 8.0 | Rich product card with "Ochish" button shared into any chat |
| `downloadFile` | 8.0 | Export CSV, receipts |
| `openInvoice` | 6.1 | Telegram Payments & Stars |
| `disableVerticalSwipes` | 7.7 | PDP drag-to-dismiss and tree drag only |
| `setHeaderColor` / `setBackgroundColor` / `setBottomBarColor` | 6.x / 7.10 | Theme harmony |
| `hideKeyboard` | 9.1 | Dismiss keyboard on scroll in forms/search |
| `isActive` / `activated` / `deactivated` | 8.0 | Pause video, countdowns and polling when minimised |
| Loading screen customisation (BotFather) | 8.0 | Store-agnostic Do'konim icon + colours |

### 14.2 Bot (grammY)
- `/start` → welcome with a "Do'konni ochish" (Open store) WebApp button and a "Do'kon yaratish" (Create store) button. `/start <payload>` routes like `startapp`.
- **Owner notifications** (from the outbox): new order with inline buttons **[✅ Tasdiqlash] [📞 Qo'ng'iroq] [Ochish]** (confirm, call, open), payment received,
  low stock, new review/question **[Javob berish]** (answer), daily summary at the owner's chosen time.
- **Buyer notifications:** order placed, paid, shipped (with date), ready for pickup (with code), delivered → review request.
- **Inline mode:** `@dokonim_bot <store> <query>` returns product cards to share in chats.
- **Payments:** handles `pre_checkout_query` (re-validates stock and amount in < 10 s) and `successful_payment`; `/paysupport`.
- **Contact verification:** `requestContact` makes Telegram send a contact message to the bot. The bot stores the phone against `telegram_id`, which proves it.
- Webhook mode with `secret_token`; updates are deduplicated by `update_id`.

### 14.3 initData auth
Server-side validation follows the documented algorithm: `secret = HMAC_SHA256("WebAppData", bot_token)`, data-check-string =
sorted `key=value` lines without `hash`, compare hex HMAC in **constant time**, then **reject if `auth_date` > 24 h** for
session creation ([Telegram Mini Apps][tg-webapps]). `initDataUnsafe` is never trusted. (The Ed25519 third-party
validation path is supported in `core` for the Later white-label bots, which validate with the bot id and Telegram's public key.)

### 14.4 Deep links & sharing
- Product share link: `https://t.me/dokonim_bot/shop?startapp=<slug>-p-<shortId>`.
- Share card images (1080×1920 story and 1200×630 message) are rendered server-side with Satori + resvg from the theme tokens
  and cached in R2. `shareToStory` requires an HTTPS media URL ([Telegram Mini Apps][tg-webapps]).

### 14.5 Platform constraints to respect
- **Origin restriction (Bot API 10.2, enforced since 2026-07-20):** Mini App methods only work from the Mini App's own origin
  ([changelog][tg-changelog]). Everything stays on one origin, and external pages (payment) open via `openLink`.
- **Digital goods → Stars only** ([TG Stars][tg-stars]).

### 14.6 Later: white-label store bots via Managed Bots (Bot API 9.6)
Bot API 9.6 added **managed bots**: a manager bot can request creation of a bot (`t.me/newbot/{manager}/{suggested}` links,
`KeyboardButtonRequestManagedBot`) and obtain its token (`getManagedBotToken`) ([changelog][tg-changelog]).
→ **"Your shop, your bot"**: each Pro store gets `@dilnoza_atelier_bot`, with its own Main Mini App pointing at the same
deployment (`?store=<id>` resolved server-side), its own notifications and, importantly, **its own Telegram Payments provider
token** connected by the owner in BotFather. One deployment, N bots, with webhook routing by `botId`.
Also Later: **Bot API 10.4 widgets** (`sendWidget`) for an order-status card that updates live in the buyer's private chat ([changelog][tg-changelog]).

---

## 15. i18n

- **Locales:** `uz` (Latin, default), `ru`, `en`. The architecture allows `uz-Cyrl` later.
- **UI strings:** Lingui with ICU MessageFormat, CLDR plurals (uz: one/other; ru: one/few/many/other), and catalogs per surface
  (storefront, dashboard, onboarding) so a buyer never downloads dashboard strings.
- **Content translations:** translatable fields are `jsonb {uz, ru, en}`. The store chooses its enabled locales. Fallback order is
  user locale → store default → first non-empty. The dashboard shows per-field "missing translation" dots.
- **Uzbek orthography:** the canonical apostrophe letters are `oʻ gʻ` (U+02BB) and the tutuq `ʼ` (U+02BC). Input is normalised
  (`'`, `` ` ``, `‘`, `’` → canonical) for storage-side search keys, while the owner's original text is preserved for display.
- **Search normalisation** (shared function in `core`, used by server and demo): lower-case → apostrophe fold →
  **Latin↔Cyrillic transliteration** (so "кўйлак", "ko'ylak" and "koylak" all match) → trigram + `simple` tsvector.
- **Formatting:** `Intl.NumberFormat` with a custom UZS formatter (`1 250 000 so'm` / `1 250 000 сум`), with a fallback when
  Intl locale data is missing in old WebViews. Dates use relative phrases ("Ertaga", "Payshanba, 14-noyabr").
  The time zone for business rules is always the **store timezone**.
- **Bot messages** use the recipient's language (buyer: `users.language_code`; owner: dashboard language).

---

## 16. Security & multi-tenant isolation

### 16.1 Identity & sessions
- initData HMAC validation (§14.3) → short-lived JWT (15 min, `sub=user_id`, `tg=telegram_id`), with refresh rotation and reuse
  detection (a reused refresh token revokes the family).
- Platform admin and store owner actions that are destructive (delete store, change payment credentials) require a
  **fresh initData** (< 5 min), plus BiometricManager if enabled.

### 16.2 Tenant isolation (defence in depth)
1. **Explicit `TenantContext` in core.** Every repository method takes `ctx: {storeId, actor, permissions}`. There is no
   repository method without a store scope (enforced by a lint rule and types: `StoreScoped<T>`).
2. **Authorization policies in core:** `can(actor, 'orders.transition', order)` is checked by command handlers, not routes.
3. **Postgres Row-Level Security** on every tenant table:
   ```sql
   alter table products enable row level security;
   alter table products force row level security;
   create policy tenant_isolation on products
     using (store_id = current_setting('app.store_id', true)::uuid)
     with check (store_id = current_setting('app.store_id', true)::uuid);
   ```
   The API connects as the role `dokonim_app` (**no** `BYPASSRLS`, not the owner). Each request runs in a transaction with
   `select set_config('app.store_id', $1, true)`. Public cross-store reads (the hub's "recent stores") use a dedicated
   `security definer` function that returns only public fields.
4. **IDs are UUIDv7 + store-scoped lookups**, so IDOR also fails at the SQL level.
5. **Tests:** a dedicated "tenant breach" suite tries every admin endpoint with another store's IDs (§18).

### 16.3 Roles & permissions
| Permission | Owner | Admin | Manager | Catalog editor | Order operator | Viewer |
|---|---|---|---|---|---|---|
| store.settings / theme | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| payments.configure | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| staff.manage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| catalog.write (products, categories, collections) | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| inventory.adjust | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| orders.manage / refunds | ✅ | ✅ | ✅ / ✅ | ❌ | ✅ / ❌ | ❌ |
| discounts.manage | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| analytics.read / audit.read | ✅ | ✅ | ✅ / ❌ | ❌ | ❌ | ✅ / ❌ |

### 16.4 Webhooks & payments
- Payme: Basic-auth check (constant time) plus an IP allowlist from Payme's docs (community guides cite `185.234.113.1–15`; verify
  against official docs before relying on it, [skill guide][payme-skill]). The handler always returns HTTP 200 with a JSON-RPC error body.
- Click: md5 `sign_string` verification (constant time), `sign_time` freshness window, idempotency on `click_trans_id`.
- Telegram: `X-Telegram-Bot-Api-Secret-Token` check.
- Stripe: signature with timestamp tolerance of 5 min.
- Every webhook is rate-limited per store, raw-logged (with PII scrubbed), and replayable from the admin console.

### 16.5 Content & app security
- **Owner content is untrusted.** Descriptions are stored as a restricted rich-text AST (paragraphs, bold, italic, lists, links
  with `rel="noopener nofollow ugc"`). No raw HTML is ever rendered. Custom motif SVGs are sanitised (no scripts, no
  external refs, ≤ 4 KB).
- **Strict CSP:** `default-src 'self'`; `img-src` limited to our CDN; no inline scripts.
- **Uploads:** presigned PUT with content-length and MIME constraints, server-side magic-byte sniffing, EXIF/GPS stripping
  via imgproxy, max 10 MB per image and 30 MB per video.
- **Secrets:** provider credentials are AES-256-GCM encrypted with per-store data keys wrapped by a KEK from env/secret manager,
  and decrypted only inside payment adapters.
- **Rate limits:** auth 10/min/IP, checkout 20/min/user, search 60/min/user, webhooks 300/min/store.
- **Abuse:** a platform report flow, a prohibited-goods keyword screen at publish, and a suspension switch.
- **Audit log:** append-only (DB grants deny UPDATE/DELETE) for all admin mutations and payment config changes.
- **Privacy:** phones are visible only to the store owner and staff with `orders.manage`. Analytics events carry no PII.
  Data export/delete for buyers comes via profile → request.

---

## 17. Performance budget

Target device: **~$120 Android (4 GB RAM, octa-core A55-class), Telegram Android WebView, throttled 4G (≈ 9 Mbps / 150 ms RTT)**,
reflecting Uzbekistan's device mix (§2.1).

| Metric | Budget (storefront cold) | Budget (warm, DeviceStorage snapshot) |
|---|---|---|
| JS initial (storefront route) | **≤ 110 KB gz** (React+DOM ≈ 45, router+query ≈ 20, app ≈ 40, motion ≈ 5) | — |
| CSS initial | ≤ 18 KB gz | — |
| Fonts | ≤ 2 files, ≤ 70 KB total (subset Latin-Ext + Cyrillic, `font-display: swap`) | cached |
| LCP (hero/first product image) | **≤ 2.0 s** | ≤ 1.0 s |
| INP | ≤ 200 ms | ≤ 150 ms |
| CLS | ≤ 0.05 | ≤ 0.05 |
| Animation | 60 fps on `full`; no long task > 50 ms during transitions | |
| API p95 (catalog read / checkout quote / order place) | 120 ms / 200 ms / 350 ms | |
| Owner dashboard chunk | ≤ 150 KB gz, lazy | |
| Demo (GitHub Pages) extra | PGlite worker lazy-loaded after first paint (~3 MB gz wasm+data, verify per version) | |

Techniques:
- Route-level code splitting (storefront / dashboard / onboarding / admin), and preloading the PDP chunk on card `pointerdown`.
- **Instant warm start:** the TanStack Query cache is persisted to DeviceStorage (or localStorage) and hydrated before network.
- Images from imgproxy: AVIF → WebP → JPEG via `<picture>`, `srcset` 240/480/960, `sizes` per card style, a blurhash/dominant-colour
  placeholder, and `fetchpriority="high"` on LCP only.
- Virtualised grids beyond 60 items, `content-visibility: auto` for below-the-fold sections, no layout thrash
  (Motion's `layout` used only on small subtrees).
- No `backdrop-filter`. Shadows come from pseudo-elements. Video autoplays only on the `full` tier and only while `isActive`.
- Server: ETag on catalog endpoints, CDN cache for public reads (`s-maxage=30, stale-while-revalidate=300`), denormalised listing
  columns (min price, in-stock, rating) for index-only scans, GiST on `path`, GIN on `search_tsv` and trigram on `search_doc`.
- Lighthouse CI with these budgets fails the PR when exceeded.

---

## 18. Testing strategy

| Layer | Tooling | What |
|---|---|---|
| Core unit | **Vitest** | Pricing pipeline (golden cases + explanations), discount stacking, delivery promise (cutoffs, holidays, TZ), state machines (every allowed/forbidden transition), category tree ops, transliteration/normalisation, slug rules |
| Property-based | **fast-check** | Tree moves never create cycles and keep `path` consistent with `parent_id`; cart totals = Σ allocated lines; inventory never negative under random place/pay/cancel/expire sequences |
| Payment protocols | Vitest + **recorded fixtures** | Payme JSON-RPC request/response pairs for every method & error (−31001, −31003, −31008, −31050, −32504), timeout cancel after 12 h; Click Prepare/Complete with known md5 vectors, duplicate Complete, bad sign, amount mismatch; Telegram pre_checkout deadline |
| **Adapter parity** | Same repository test suite run against **PostgreSQL (Testcontainers)** and **PGlite (Node)** | Guarantees the demo is "real logic", not a mock |
| Tenant isolation | API integration | Cross-tenant ID fuzzing on every admin route; RLS tests with `set role dokonim_app` and a wrong `app.store_id` must return 0 rows |
| API integration | Fastify `inject` + Testcontainers | Contract (zod) validation, idempotency keys, rate limits |
| Bot | grammY test harness (fake API) | Notification rendering, inline button callbacks, pre_checkout handling |
| UI components | Vitest + Testing Library | Variant picker availability logic, filters, forms |
| E2E | **Playwright** on the **demo build** (mobile emulation, CPU 4× throttle) | Buyer: browse → filter → PDP → add → checkout → sandbox Payme → order tracked. Owner: onboarding → product with variants → nested category move → discount → order transition. Staff permissions |
| Visual regression | Playwright screenshots | 4 card styles × light/dark × 3 presets; RTL not needed |
| Motion | Playwright + Performance API | Long tasks during PDP morph < 50 ms on `lite` |
| Accessibility | axe-core in E2E | Contrast (incl. generated themes), labels, focus order, reduced motion |
| Performance | Lighthouse CI, bundle-size check (size-limit) | Budgets in §17 |
| Load | k6 | Catalog 300 RPS p95 < 120 ms; checkout 30 RPS |

CI (GitHub Actions): lint → typecheck → unit → integration (Postgres service) → parity → build → E2E (demo) → Lighthouse →
deploy demo to GitHub Pages on `main`.

---

## 19. Demo mode (GitHub Pages, real logic in the browser)

### 19.1 Goals
- Anyone can open `https://xoliddev.github.io/dokonim/` on a laptop or phone and use the full product, buyer and owner, with
  **no backend and no Telegram**.
- Visitors can **create their own store**, and it persists in their browser.
- **It runs the same `packages/core` business logic and the same Drizzle schema/SQL**, so it is real software, not a clickable mock.

### 19.2 Build & hosting
- `pnpm --filter miniapp build:demo` sets `VITE_TARGET=demo` with base `/dokonim/` and **hash history** (GitHub Pages has no SPA
  rewrites). The output goes to GitHub Pages via Actions.
- The `apiFactory()` picks `LocalApi` when `VITE_TARGET=demo` and `HttpApi` otherwise. Tree-shaking removes the other.

### 19.3 Telegram mock ("TelegramShim")
- Outside Telegram, `mockTelegramEnv` from `@tma.js/sdk` ([tma.js docs][tmajs]) injects launch params with a **demo user** and
  **initData signed with a demo bot token** using the same HMAC algorithm. `LocalApi` then validates it with `core.auth.validateInitData`,
  so even auth runs real code.
- On desktop the app renders inside a **phone frame** with a faux Telegram header. A `TelegramShim` component implements the
  WebApp surface we use: MainButton/SecondaryButton (rendered as native-looking bottom bar buttons, with shine effect),
  BackButton, SettingsButton, `HapticFeedback` → `navigator.vibrate` where available plus a subtle visual tick in the frame,
  `CloudStorage`/`DeviceStorage`/`SecureStorage` → IndexedDB, `requestContact` → a demo sheet, `openInvoice` → the sandbox invoice
  sheet, `shareToStory` → a preview modal, and theme params → a light/dark toggle in the frame.
- **Inside Telegram:** a separate demo bot (`@dokonim_demo_bot`) whose Mini App URL is the GitHub Pages build. The real WebApp is
  detected, the shim is skipped, and the data is still local. Because it's the same origin, the 10.2 origin rule is satisfied.

### 19.4 In-browser backend (`LocalApi`)
```
Main thread (React) ──comlink──▶ Web Worker
                                   ├─ PGlite (idb://dokonim-demo), extensions: ltree, pg_trgm, (uuid in app)
                                   ├─ Drizzle (drizzle-orm/pglite) + same migrations as server
                                   ├─ packages/core services (same code as API)
                                   ├─ packages/payments sandbox simulators + real webhook handlers
                                   ├─ Outbox processor → BotChatSimulator events
                                   └─ Job runner (setTimeout-based) for reservation TTL, auto-complete
```
- PGlite supports IndexedDB persistence (`idb://`) and has an official Drizzle driver ([PGlite][pglite-repo], [Drizzle][drizzle-pglite]).
  `ltree` and `pg_trgm` ship in its main package ([PGlite extensions][pglite-ext]).
- **RLS in the demo:** migrations create the `dokonim_app` role, and the worker runs `SET ROLE dokonim_app` + `set_config('app.store_id')`
  per command, so tenant isolation is exercised in the browser too (to be verified on the chosen PGlite version; if role switching
  is unsupported, core-level scoping still applies and the parity test flags it).
- **Fast first paint:** the seeded demo store also ships as a pre-baked **JSON snapshot** (≈ 150 KB gz) that renders the storefront
  immediately (read-only) while PGlite boots in the worker. Writes queue until the DB is ready, typically about 1–2 s on mid-range phones.
- **Fallbacks:** if IndexedDB is unavailable (private mode), PGlite runs in-memory (`memory://`) with a "won't persist" banner.
  If WebAssembly is unavailable, a read-only snapshot mode is shown.
- **Media:** visitor uploads are stored as Blobs in IndexedDB/OPFS, client-side resized to 960px WebP via `OffscreenCanvas`/
  `createImageBitmap`, and served by object URLs. Seed images are pre-optimised (480/960 WebP, total ≤ 4 MB, licence-clean: own photos or CC0).

### 19.5 Seeded content
- **Demo store "Atlas & Adras"** (textiles/clothing): 64 products, **4-level category tree** (Kiyim → Ayollar → Ko'ylaklar → Atlas
  ko'ylaklar), 3-option variants (O'lcham × Rang × Mato), collections (manual + automated "Yangi kelganlar"), 2 flash sales
  (relative to now, honest), stories with product links, about 180 reviews with photos, Q&A, 3 shipping methods across zones,
  promo codes (`SALOM10`, `BEPULYETKAZISH`), and **120 historical orders over 60 days** so analytics charts look alive.
- A second small store, "Choyxona Market" (food), demonstrates a different preset, card style and motif.
- Data comes from a **seeded PRNG** (`packages/seed`), deterministic and also used by E2E tests.

### 19.6 Demo UX affordances
- A floating **Demo bar** (outside the phone frame on desktop, collapsible on mobile) with:
  **Role switcher** (Buyer · Owner · Staff · Platform admin), **Store switcher** (+ "Create your own store" → onboarding wizard),
  **Bot chat panel** (a Telegram-like chat showing the notifications that the real `NotificationService` produced via the outbox,
  with inline buttons that actually work, e.g. "✅ Tasdiqlash" transitions the order), **Payment debugger** (live log of
  the Payme JSON-RPC / Click Prepare-Complete messages exchanged by the sandbox, which is great for technical reviewers),
  **Language** (uz/ru/en), **Motion tier** override (full/lite/minimal) to show the low-end behaviour, and **Reset demo**.
- A first-visit 20-second guided tour (3 hotspots: Arc add-to-cart, morph, installment split).

---

## 20. Milestones

| # | Milestone | Exit criteria |
|---|---|---|
| M0 | Foundations | Monorepo, `core` skeleton with ports, Drizzle schema + migrations (ltree, RLS), parity test harness, TelegramShim, design tokens, motion primitives, CI |
| M1 | Catalog & storefront | Categories tree (CRUD + move), products/options/variants, media, storefront home/sections, listing + facets + search, PDP with gallery & Continuity morph |
| M2 | Cart → order | Cart, pricing pipeline, discounts, shipping & delivery promise, checkout, order state machine, inventory reservations, sandbox Payme/Click, COD, order tracking, Arc + Split motions |
| M3 | Owner dashboard | Onboarding wizard, dashboard home, orders queue, inventory, customers, discounts, shipping, payments settings, theme editor with live morph, staff & roles, reviews/Q&A, analytics, import/export, audit |
| M4 | Real backend | Fastify API + HttpApi, JWT/initData, R2 + imgproxy, pg-boss jobs, grammY bot notifications & inline mode, real Payme & Click handlers (merchant test env), Stars for digital goods, SSE |
| M5 | Demo & polish | Seed data, demo bar + bot chat + payment debugger, GitHub Pages deploy, performance budgets green, a11y pass, Playwright suite, README with GIFs |
| Later | Growth | Managed per-store bots, Uzum Merchant/Nasiya, Paynet, loyalty & referrals, price-drop alerts, widgets (10.4), AI helpers, custom-domain web storefront (SSR), fiscal receipts |

---

## 21. Open questions & risks

| Risk / question | Mitigation |
|---|---|
| Which UZ payment providers appear in BotFather for Telegram Payments is unverified | The design doesn't depend on it: direct Payme/Click/Uzum adapters are primary, and the Telegram provider adapter is generic |
| Payme/Click official docs are partially behind dynamic pages; some details (IP list, checkout URL encoding) come from community sources | Fixtures recorded from each provider's **test environment** before go-live; marked "verify" in code comments |
| Stripe availability for Uzbek merchants | Treated as international-seller/portfolio adapter only |
| PGlite size and boot time on low-end phones | Snapshot-first rendering, worker isolation, lazy load; the demo is primarily a desktop/recruiter experience |
| RLS/role switching inside PGlite | Parity test; core-level scoping is the primary guard anyway |
| Telegram WebView fragmentation (old Android WebViews) | Feature-detect everything (VT API, Intl, OPFS), motion tiers, a physical-device test matrix (Redmi 9A/A-series Samsung), Android < 9 support check (a known TMA issue, [Sostav][sostav-tma]) |
| Installment display is informational until BNPL is integrated | Clear labelling, and the total payable is always shown |
| Fiscalisation (IKPU) legal requirements for merchants | Fields stored now. Integration via Payme fiscal data Later; owners advised to consult their provider |
| Dark-pattern temptation in flash sales | Product rule: countdowns only to real `ends_at`, stock badges only from real stock, enforced in code (no client-side fake timers) |

---

## 22. Sources

**Uzbekistan market & devices**
- [uzdaily-tg]: https://www.uzdaily.uz/en/telegram-76-reach-youtube-no-1-e-commerce-on-the-rise-inside-uzbekistans-digital-landscape/ — Telegram 76% reach, ~25M (Oct 2025)
- [uzdaily-sales]: https://www.uzdaily.uz/en/online-sales-in-uzbekistan-reach-227-trillion-soums-in-2025/ — 22.7 trn so'm, 4.6% of retail, 36→115 platforms (Feb 2026)
- [tradegov]: https://www.trade.gov/country-commercial-guides/uzbekistan-ecommerce — Telegram used to do business
- [statcounter-os]: https://gs.statcounter.com/os-market-share/mobile-tablet/uzbekistan
- [statcounter-vendor]: https://gs.statcounter.com/vendor-market-share/mobile/uzbekistan
- [kun-phones]: https://kun.uz/en/news/2025/11/11/mobile-phone-imports-to-uzbekistan-rise-by-74-in-january-september — 3.2M phones / $370.8M
- [kun-pay]: https://kun.uz/en/news/2026/05/19/how-do-people-in-uzbekistan-pay-and-who-leads-the-market — Click/Payme/Paynet Q1 2026

**Uzum**
- [uzum-15]: https://uzum.uz/media/uz/uzum-marketda-vaqt-va-pulingizni-tejaydigan-15-ta-foydali-fishka/
- [uzum-nasiya]: https://uzum.uz/media/uz/uzum-nasiya-bolib-tolash-xizmati-qanday-ishlaydi/
- [uzum-2024]: https://uzum.com/en/press-center/news-and-press-releases/uzum-announces-financial-results-for-2024/
- [sacra-uzum]: https://sacra.com/c/uzum
- [sacra-nasiya]: https://sacra.com/chat/h/4a0ad775-5d0c-4eb6-a692-bc87e30bf6c2/
- [uzum-apis]: https://apis.io/providers/uzum/ — Uzum Merchant API / Checkout / Nasiya Partner API overview

**Wildberries, Ozon, Amazon/Baymard, Temu, social commerce**
- [wb-photo]: https://www1.ru/en/news/2025/09/20/novaia-era-poiska-wildberries-zapuskaet-unikalnuiu-funkciiu-raspoznavaniia-tovarov-po-risunkam-i-artik.html
- [wb-ai]: https://retailtechinnovationhub.com/home/2026/2/11/online-retailer-wildberries-rolls-out-ai-powered-tools-including-animated-product-listings
- [wb-wibes]: https://vietnamnews.vn/media-outreach/1718901/wildberries-expands-into-social-e-commerce-with-wibes-app.html
- [ozon-stories]: https://new-retail.ru/novosti/retail/ozon_zapustil_stories_v_prilozhenii3888/
- [ozon-wishlist]: https://oborot.ru/news/ozon-zapustil-funkciyu-vishlistov-i-podborok-tovarov-zachem-oni-nuzhny-i-kak-rabotayut-i249671.html
- [saby-cards]: https://saby.ru/articles/marketplaces/trendy_kontenta_na_marketpleysah
- [baymard-date]: https://baymard.com/research-articles/shipping-speed-vs-delivery-date
- [baymard-abandon]: https://baymard.com/lists/cart-abandonment-rate
- [baymard-checkout]: https://baymard.com/blog/current-state-of-checkout-ux
- [temu-rin]: https://www.retail-insight-network.com/analyst-comment/temu-shop-like-a-billionaire
- [temu-dd]: https://dailydot.com/temu-casino-tactics
- [tiktok-moburst]: https://www.moburst.com/blog/social-commerce-tiktok-shop-guide
- [ig-live]: https://www.inro.social/blog/instagram-live-shopping

**Store builders**
- [shopify-shoppay]: https://www.shopify.com/ca/solutions/shop-pay/enterprise
- [shopify-horizon]: https://gempages.net/blogs/shopify/top-shopify-horizon-themes
- [shopify-w26]: https://www.shopify.com/pk/editions/winter2026
- [shopify-csv]: https://help.shopify.com/manual/products/import-export/import-products
- [ecwid-import]: https://support.ecwid.com/hc/en-us/articles/8678710875164
- [leadteh]: https://help.leadteh.ru/en/bystryi-start/keisy-na-praktike/sozdanie-miniapp-magazina-v-telegram/
- [botpapa]: https://www.producthunt.com/products/botpapa
- [shopsbuilder]: https://shopsbuilder.notion.site/Create-a-Mini-App-for-Your-Shop-21f095cdaf9480fbb571ff0561462430
- [tgshop]: https://workspace.ru/cases/tgshop-konstruktor-magazinov-v-telegram-dlya-e-commerce-brendov/
- [mavibot]: https://mavibot.ai/posts/telegram-mini-apps-for-business

**Telegram**
- [tg-webapps]: https://core.telegram.org/bots/webapps
- [tg-changelog]: https://core.telegram.org/bots/api-changelog — 9.4–10.4 (2026), origin restriction, managed bots, widgets
- [tg-payments]: https://core.telegram.org/bots/payments
- [tg-stars]: https://core.telegram.org/bots/payments-stars
- [tmajs]: https://docs.telegram-mini-apps.com/packages/tma-js-sdk
- [sostav-tma]: https://www.sostav.ru/blogs/280723/59483 — TMA testing pitfalls (Android < 9)

**Payments**
- [payme-methods]: https://developer.help.paycom.uz/metody-merchant-api/
- [payme-errors]: https://developer.help.paycom.uz/metody-merchant-api/oshibki-errors
- [payme-protocol]: https://developer.help.paycom.uz/protokol-merchant-api/
- [payme-flow]: https://joyida.github.io/payme/guides/payment-flow.html — states 1/2/−1/−2, 12 h timeout (community)
- [payme-skill]: https://skillsmp.com/creators/ubranch/my-marketplace/plugins-payme-integration-skills-payme-integration — IP list (community, verify)
- [click-req]: https://docs.click.uz/en/?p=15
- [click-err]: https://docs.click.uz/en/?p=9
- [paytechuz]: https://github.com/PayTechUz
- [stripe-global]: https://stripe.com/global

**Engineering & design**
- [pglite-repo]: https://github.com/electric-sql/pglite
- [pglite-ext]: https://pglite.dev/extensions/
- [drizzle-pglite]: https://orm.drizzle.team/docs/connect-pglite
- [tree-devto]: https://dev.to/dowerdev/implementing-hierarchical-data-structures-in-postgresql-ltree-vs-adjacency-list-vs-closure-table-2jpb
- [motion-lazy]: https://motion.dev/motion/lazy-motion/
- [motion-bundle]: https://motion.dev/docs/react-reduce-bundle-size
- [vt-baseline]: https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
- [vt-chrome]: https://developer.chrome.com/docs/web-platform/view-transitions
- [bento]: https://commercev3.com/resources/blog/ecommerce-ui-trends-visual-design-patterns-guide

[uzdaily-tg]: https://www.uzdaily.uz/en/telegram-76-reach-youtube-no-1-e-commerce-on-the-rise-inside-uzbekistans-digital-landscape/
[uzdaily-sales]: https://www.uzdaily.uz/en/online-sales-in-uzbekistan-reach-227-trillion-soums-in-2025/
[tradegov]: https://www.trade.gov/country-commercial-guides/uzbekistan-ecommerce
[statcounter-os]: https://gs.statcounter.com/os-market-share/mobile-tablet/uzbekistan
[statcounter-vendor]: https://gs.statcounter.com/vendor-market-share/mobile/uzbekistan
[kun-phones]: https://kun.uz/en/news/2025/11/11/mobile-phone-imports-to-uzbekistan-rise-by-74-in-january-september
[kun-pay]: https://kun.uz/en/news/2026/05/19/how-do-people-in-uzbekistan-pay-and-who-leads-the-market
[uzum-15]: https://uzum.uz/media/uz/uzum-marketda-vaqt-va-pulingizni-tejaydigan-15-ta-foydali-fishka/
[uzum-nasiya]: https://uzum.uz/media/uz/uzum-nasiya-bolib-tolash-xizmati-qanday-ishlaydi/
[uzum-2024]: https://uzum.com/en/press-center/news-and-press-releases/uzum-announces-financial-results-for-2024/
[sacra-uzum]: https://sacra.com/c/uzum
[sacra-nasiya]: https://sacra.com/chat/h/4a0ad775-5d0c-4eb6-a692-bc87e30bf6c2/
[uzum-apis]: https://apis.io/providers/uzum/
[wb-photo]: https://www1.ru/en/news/2025/09/20/novaia-era-poiska-wildberries-zapuskaet-unikalnuiu-funkciiu-raspoznavaniia-tovarov-po-risunkam-i-artik.html
[wb-ai]: https://retailtechinnovationhub.com/home/2026/2/11/online-retailer-wildberries-rolls-out-ai-powered-tools-including-animated-product-listings
[wb-wibes]: https://vietnamnews.vn/media-outreach/1718901/wildberries-expands-into-social-e-commerce-with-wibes-app.html
[ozon-stories]: https://new-retail.ru/novosti/retail/ozon_zapustil_stories_v_prilozhenii3888/
[ozon-wishlist]: https://oborot.ru/news/ozon-zapustil-funkciyu-vishlistov-i-podborok-tovarov-zachem-oni-nuzhny-i-kak-rabotayut-i249671.html
[saby-cards]: https://saby.ru/articles/marketplaces/trendy_kontenta_na_marketpleysah
[baymard-date]: https://baymard.com/research-articles/shipping-speed-vs-delivery-date
[baymard-abandon]: https://baymard.com/lists/cart-abandonment-rate
[baymard-checkout]: https://baymard.com/blog/current-state-of-checkout-ux
[temu-rin]: https://www.retail-insight-network.com/analyst-comment/temu-shop-like-a-billionaire
[temu-dd]: https://dailydot.com/temu-casino-tactics
[tiktok-moburst]: https://www.moburst.com/blog/social-commerce-tiktok-shop-guide
[ig-live]: https://www.inro.social/blog/instagram-live-shopping
[shopify-shoppay]: https://www.shopify.com/ca/solutions/shop-pay/enterprise
[shopify-horizon]: https://gempages.net/blogs/shopify/top-shopify-horizon-themes
[shopify-w26]: https://www.shopify.com/pk/editions/winter2026
[shopify-csv]: https://help.shopify.com/manual/products/import-export/import-products
[ecwid-import]: https://support.ecwid.com/hc/en-us/articles/8678710875164
[leadteh]: https://help.leadteh.ru/en/bystryi-start/keisy-na-praktike/sozdanie-miniapp-magazina-v-telegram/
[botpapa]: https://www.producthunt.com/products/botpapa
[shopsbuilder]: https://shopsbuilder.notion.site/Create-a-Mini-App-for-Your-Shop-21f095cdaf9480fbb571ff0561462430
[tgshop]: https://workspace.ru/cases/tgshop-konstruktor-magazinov-v-telegram-dlya-e-commerce-brendov/
[mavibot]: https://mavibot.ai/posts/telegram-mini-apps-for-business
[tg-webapps]: https://core.telegram.org/bots/webapps
[tg-changelog]: https://core.telegram.org/bots/api-changelog
[tg-payments]: https://core.telegram.org/bots/payments
[tg-stars]: https://core.telegram.org/bots/payments-stars
[tmajs]: https://docs.telegram-mini-apps.com/packages/tma-js-sdk
[sostav-tma]: https://www.sostav.ru/blogs/280723/59483
[payme-methods]: https://developer.help.paycom.uz/metody-merchant-api/
[payme-errors]: https://developer.help.paycom.uz/metody-merchant-api/oshibki-errors
[payme-protocol]: https://developer.help.paycom.uz/protokol-merchant-api/
[payme-flow]: https://joyida.github.io/payme/guides/payment-flow.html
[payme-skill]: https://skillsmp.com/creators/ubranch/my-marketplace/plugins-payme-integration-skills-payme-integration
[click-req]: https://docs.click.uz/en/?p=15
[click-err]: https://docs.click.uz/en/?p=9
[paytechuz]: https://github.com/PayTechUz
[stripe-global]: https://stripe.com/global
[pglite-repo]: https://github.com/electric-sql/pglite
[pglite-ext]: https://pglite.dev/extensions/
[drizzle-pglite]: https://orm.drizzle.team/docs/connect-pglite
[tree-devto]: https://dev.to/dowerdev/implementing-hierarchical-data-structures-in-postgresql-ltree-vs-adjacency-list-vs-closure-table-2jpb
[motion-lazy]: https://motion.dev/motion/lazy-motion/
[motion-bundle]: https://motion.dev/docs/react-reduce-bundle-size
[vt-baseline]: https://web.dev/blog/same-document-view-transitions-are-now-baseline-newly-available
[vt-chrome]: https://developer.chrome.com/docs/web-platform/view-transitions
[bento]: https://commercev3.com/resources/blog/ecommerce-ui-trends-visual-design-patterns-guide
