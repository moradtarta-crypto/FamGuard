-- FamGuard — rollback for 20261107_0001_security_repair.sql.
--
-- Reverses every statement in that migration and nothing else:
--   * drops only the policies the migration created (the project's own policies are
--     untouched by both directions),
--   * restores table-level UPDATE and SELECT to the API roles,
--   * drops the two functions it added.
--
-- No table, row, column, index or existing policy is affected. Run the whole file in one
-- transaction.

begin;

-- 10. subscriptions
drop policy if exists "family members read family subscription" on public.subscriptions;
grant select on table public.subscriptions to anon, authenticated;

-- 9. profiles
drop policy if exists "family members read each other profiles" on public.profiles;

-- 8. sos_events
drop policy if exists "child reads own sos" on public.sos_events;
grant update on table public.sos_events to authenticated;

-- 7. zones
drop policy if exists "zones readable by family members" on public.zones;

-- 6. family_invites
drop policy if exists "parents read family invites" on public.family_invites;
grant select on table public.family_invites to anon, authenticated;

-- 3 + 4. messages / sos_events write columns
grant update on table public.messages to authenticated;

-- 2. conversation RPC
drop function if exists public.ensure_family_conversation(uuid);

-- 1. membership helper
drop function if exists public.famguard_shares_family_with(uuid);

commit;
