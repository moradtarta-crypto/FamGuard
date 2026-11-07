-- FamGuard — rollback for 20261107_0001_security_repair.sql.
--
-- IMPORTANT:
--   The migration replaces the existing "family members read each other profiles"
--   policy with a SECURITY DEFINER-backed expression. The exact previous policy body
--   must be restored from the saved output of audit/capture_current_definitions.sql.
--   This file drops the replacement but cannot safely guess the previous expression.
--   Restore that captured CREATE POLICY statement before allowing users back into the app.
--
--   This rollback deliberately does NOT grant table-wide SELECT or UPDATE. The audited
--   baseline uses safe column-level grants; restoring table-wide grants would expose
--   family_invites.token_hash / subscription payment identifiers and permit edits to
--   message or SOS fields outside their intended columns.
--
-- Run only after reviewing the captured audit output.

begin;

-- Remove only the replacement policy that references the helper being removed.
drop policy if exists "family members read each other profiles" on public.profiles;

-- Restore the audited column-scoped UPDATE boundary.
revoke update on table public.messages from public;
revoke update on table public.messages from anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

revoke update on table public.sos_events from public;
revoke update on table public.sos_events from anon, authenticated;
grant update (acknowledged_at, acknowledged_by) on table public.sos_events to authenticated;

-- Restore safe column-only reads; never grant table-wide access or access to secret columns.
revoke select on table public.family_invites from public;
revoke select on table public.family_invites from anon, authenticated;
grant select (id, family_id, created_by, expires_at, consumed_by, consumed_at, created_at)
  on table public.family_invites to authenticated;

revoke select on table public.subscriptions from public;
revoke select on table public.subscriptions from anon, authenticated;
grant select (id, parent_user_id, family_id, status, plan_code, starts_at, ends_at, verified_at, created_at)
  on table public.subscriptions to authenticated;

-- The family-invite parent-only policy, zone policies and parent-only subscription
-- policy were already present in the audited baseline and are intentionally untouched.
-- No child SOS read policy is created or dropped.

drop function if exists public.ensure_family_conversation(uuid);
drop function if exists public.famguard_shares_family_with(uuid);

commit;
