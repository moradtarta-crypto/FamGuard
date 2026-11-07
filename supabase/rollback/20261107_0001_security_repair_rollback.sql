-- FamGuard — rollback for 20261107_0001_security_repair.sql.
--
-- IMPORTANT:
--   This restores the exact audited pre-migration ACL baseline, including some broad
--   authenticated table grants that RLS currently blocks. It is a rollback, not a
--   recommended security posture. Re-run the security repair after diagnosing any issue.
--
--   The migration replaces the existing "family members read each other profiles"
--   policy with a SECURITY DEFINER-backed expression. The exact previous policy body
--   must be restored from the saved output of audit/capture_current_definitions.sql.
--   This file drops the replacement but cannot safely guess the previous expression.
--   Restore that captured CREATE POLICY statement before allowing users back into the app.
--
--   Never grant table-wide SELECT on family_invites or subscriptions: token_hash and
--   payment identifiers remain protected by the audited column-only grants.
--
-- Run only after reviewing the captured audit output.

begin;

-- Remove only the replacement policy that references the helper being removed.
drop policy if exists "family members read each other profiles" on public.profiles;

-- Restore the audited baseline for families: authenticated had table CRUD grants.
grant delete, insert, select, update on table public.families to authenticated;
grant insert (id, name, created_by, created_at) on table public.families to authenticated;
grant select (id, name, created_by, created_at) on table public.families to authenticated;
grant update (id, name, created_by, created_at) on table public.families to authenticated;

-- Restore the audited baseline for conversations: authenticated had table CRUD grants.
grant delete, insert, select, update on table public.conversations to authenticated;
grant insert (id, family_id, created_at) on table public.conversations to authenticated;
grant select (id, family_id, created_at) on table public.conversations to authenticated;
grant update (id, family_id, created_at) on table public.conversations to authenticated;

-- Restore the audited baseline for profiles: own-row RLS still governs the rows.
grant delete, insert, select, update on table public.profiles to authenticated;
grant insert (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles to authenticated;
grant select (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles to authenticated;
grant update (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles to authenticated;

-- Restore the audited baseline for location_updates. RLS still limits INSERT to a child's
-- own family row; the baseline also granted all insert columns.
grant insert, select on table public.location_updates to authenticated;
grant insert (id, family_id, child_user_id, latitude, longitude, accuracy_m,
              battery_percent, recorded_at, received_at)
  on table public.location_updates to authenticated;
grant select (id, family_id, child_user_id, latitude, longitude, accuracy_m,
              battery_percent, recorded_at, received_at)
  on table public.location_updates to authenticated;

-- Restore the audited baseline for messages: INSERT/SELECT table grants, all insert/select
-- columns, and read_at-only UPDATE. The RLS policies still apply.
grant insert, select on table public.messages to authenticated;
grant insert (id, conversation_id, sender_user_id, kind, body,
              media_object_path, created_at, read_at)
  on table public.messages to authenticated;
grant select (id, conversation_id, sender_user_id, kind, body,
              media_object_path, created_at, read_at)
  on table public.messages to authenticated;
revoke update on table public.messages from public;
revoke update on table public.messages from anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

-- Restore the audited SOS acknowledgement column privilege only.
revoke update on table public.sos_events from public;
revoke update on table public.sos_events from anon, authenticated;
grant update (acknowledged_at, acknowledged_by) on table public.sos_events to authenticated;

-- Keep family-invite and subscription reads column-scoped; no token_hash/payment identifiers.
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
