// GENERATED from migrations/0003_store_status_before_suspend.sql by `npm run gen:migrations` — do not edit by hand.
export default String.raw`-- Remembers the status a store had when it was suspended, so unsuspending restores it (draft stays draft).
alter table stores add column if not exists status_before_suspend text check (status_before_suspend in ('draft','active'));
`;
