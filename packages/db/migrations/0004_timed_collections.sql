-- Automated collections whose rules depend on the clock (created_within_days), across tenants, for the refresh job.
create or replace function timed_collections()
returns table (store_id uuid, collection_id uuid) language sql stable security definer set search_path = public as $$
  select c.store_id, c.id from collections c
  where c.kind = 'automated' and c.rules -> 'rules' @> '[{"field":"created_within_days"}]'::jsonb
$$;
revoke all on function timed_collections() from public;
grant execute on function timed_collections() to dokonim_app;
