// GENERATED from migrations/0002_discount_code_archived.sql by `npm run gen:migrations` — do not edit by hand.
export default String.raw`-- An archived (deleted) promo no longer reserves its code: the seller can create the same code again.
drop index if exists discounts_code_key;
create unique index discounts_code_key on discounts (store_id, lower(code)) where code is not null and status <> 'archived';
`;
