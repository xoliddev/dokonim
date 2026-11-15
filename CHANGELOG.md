# Changelog

## 1.0.0 — 2026-11-15

- Multi-tenant store builder as a Telegram Mini App: seller side (create-store wizard with live preview, dashboard,
  categories of any depth, products with a variant matrix, collections, promo codes, orders, theme editor, payments,
  shipping, staff) and buyer storefront (home, catalogue, search with filters, product page, cart, checkout, receipt,
  live order tracking, wishlist).
- Payme, Click, Uzum, Telegram Payments, Telegram Stars and cash on delivery, each with a sandbox simulator that calls
  the real webhook handlers.
- PostgreSQL schema with ltree categories, pg_trgm search and row-level security for tenant isolation.
- Fastify API generated from a shared zod route table (126 methods); grammY bot for notifications and invoices.
- Browser-only demo: the same services on PGlite in a Web Worker, loaded from a pre-baked snapshot (first visit ~2.5 s).
- Uzbek, Russian and English.
- 477 vitest tests, Playwright e2e at 1440 px and 375 px, CI and GitHub Pages deploy.
