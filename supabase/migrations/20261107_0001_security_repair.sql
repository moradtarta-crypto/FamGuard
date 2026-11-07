-- FamGuard — security and functionality repair migration.
--
-- WHAT THIS DOES
--   Adds two SECURITY DEFINER helpers, narrows write/read privileges, and replaces
--   the co-member profile policy with a non-recursive membership check. It performs
--   no DML and does not alter any stored application records.
--
-- WHAT THIS DOES NOT DO
--   * It does not touch the existing UPDATE policies on messages / sos_events. Those keep
--     their current USING and WITH CHECK clauses; the column privileges added below are what
--     stop a recipient from rewriting a message body or an incident's coordinates.
--   * It does not add child SOS history access or broaden subscription visibility.
--   * Existing family-invite, zone and parent-owned subscription policies are preserved.
--   * The existing co-member profile policy is replaced; its previous definition must
--     be captured before applying so it can be restored manually if rollback is needed.
--
-- PREREQUISITES
--   1. supabase/audit/capture_current_definitions.sql has been run and its output saved.
--   2. Run 20261107_0002_helper_function_hardening.sql (read-only) and inspect all three
--      helper bodies. If they are correct, apply 20261107_0003_helper_function_hardening_apply.sql
--      after explicitly confirming the review gate in that file.
--   3. create_family_invite / accept_family_invite are SECURITY DEFINER (capture output).
--      The existing parent-only invite policy and safe column grants are preserved; verify
--      both before applying this repair.
--
-- ROLLBACK
--   supabase/rollback/20261107_0001_security_repair_rollback.sql
--
-- Everything runs in one transaction: if any statement fails, nothing is applied.

begin;

-- ---------------------------------------------------------------------------
-- 1. Membership helper for "do these two accounts share a family?"
--
--    Used to let members see each other's display name without exposing unrelated
--    accounts. SECURITY DEFINER so the check reads family_members directly instead of
--    re-entering that table's RLS policies (which is what causes 42P17 recursion errors),
--    with search_path pinned so the body cannot be redirected.
-- ---------------------------------------------------------------------------
create or replace function public.famguard_shares_family_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.family_members me
    join public.family_members them on them.family_id = me.family_id
    where me.user_id = auth.uid()
      and them.user_id = other_user
  );
$$;

comment on function public.famguard_shares_family_with(uuid) is
  'True when the signed-in account and other_user are members of the same family.';

revoke all on function public.famguard_shares_family_with(uuid) from public;
grant execute on function public.famguard_shares_family_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Canonical conversation creation
--
--    conversations has no INSERT policy, so the client cannot create the row directly and
--    the family chat never started. This function validates membership, serialises
--    concurrent callers on the family row, and returns the family's oldest conversation,
--    creating it only when the family has none. Two members pressing "start chat" at the
--    same moment therefore converge on one row.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_family_conversation(target_family uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to start a family conversation.'
      using errcode = '42501';
  end if;

  if not public.is_family_member(target_family) then
    raise exception 'You are not a member of this family.'
      using errcode = '42501';
  end if;

  -- Lock the family row so two callers cannot both observe "no conversation" and insert.
  perform 1 from public.families where id = target_family for update;
  if not found then
    raise exception 'This family does not exist.' using errcode = '42501';
  end if;

  select c.id
    into existing_id
  from public.conversations c
  where c.family_id = target_family
  order by c.created_at asc, c.id asc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.conversations (family_id)
  values (target_family)
  returning id into existing_id;

  return existing_id;
end;
$$;

comment on function public.ensure_family_conversation(uuid) is
  'Returns the canonical (oldest) conversation of a family, creating it if absent.';

revoke all on function public.ensure_family_conversation(uuid) from public;
grant execute on function public.ensure_family_conversation(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege direct writes for the existing client operations
--
--    Family and conversation creation already runs through SECURITY DEFINER RPCs.
--    The browser only reads those tables, so it must not have direct write privileges.
--    Profile upsert writes only the caller's own id/name/language. Location sharing writes
--    only child location fields; id and received_at remain database-controlled.
--    Family chat inserts only text fields; read receipts remain the sole UPDATE column.
-- ---------------------------------------------------------------------------

-- Families: reads only; creation is handled by create_family().
revoke insert, update, delete on table public.families from public;
revoke insert, update, delete on table public.families from anon, authenticated;
revoke insert (id, name, created_by, created_at) on table public.families from public;
revoke insert (id, name, created_by, created_at) on table public.families from anon, authenticated;
revoke update (id, name, created_by, created_at) on table public.families from public;
revoke update (id, name, created_by, created_at) on table public.families from anon, authenticated;

-- Conversations: reads only; creation is handled by ensure_family_conversation().
revoke insert, update, delete on table public.conversations from public;
revoke insert, update, delete on table public.conversations from anon, authenticated;
revoke insert (id, family_id, created_at) on table public.conversations from public;
revoke insert (id, family_id, created_at) on table public.conversations from anon, authenticated;
revoke update (id, family_id, created_at) on table public.conversations from public;
revoke update (id, family_id, created_at) on table public.conversations from anon, authenticated;

-- Profiles: preserve own-row upsert, but only allow the three client-supplied columns.
revoke insert, update, delete on table public.profiles from public;
revoke insert, update, delete on table public.profiles from anon, authenticated;
revoke insert (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles from public;
revoke insert (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles from anon, authenticated;
revoke update (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles from public;
revoke update (user_id, display_name, preferred_language, created_at, updated_at)
  on table public.profiles from anon, authenticated;
grant insert (user_id, display_name, preferred_language)
  on table public.profiles to authenticated;
grant update (user_id, display_name, preferred_language)
  on table public.profiles to authenticated;

-- Location updates: child inserts only the measured fields; server columns stay protected.
revoke insert, update, delete on table public.location_updates from public;
revoke insert, update, delete on table public.location_updates from anon, authenticated;
revoke insert (id, family_id, child_user_id, latitude, longitude, accuracy_m,
               battery_percent, recorded_at, received_at)
  on table public.location_updates from public;
revoke insert (id, family_id, child_user_id, latitude, longitude, accuracy_m,
               battery_percent, recorded_at, received_at)
  on table public.location_updates from anon, authenticated;
revoke update (id, family_id, child_user_id, latitude, longitude, accuracy_m,
               battery_percent, recorded_at, received_at)
  on table public.location_updates from public;
revoke update (id, family_id, child_user_id, latitude, longitude, accuracy_m,
               battery_percent, recorded_at, received_at)
  on table public.location_updates from anon, authenticated;
grant insert (family_id, child_user_id, latitude, longitude, accuracy_m,
              battery_percent, recorded_at)
  on table public.location_updates to authenticated;

-- Messages: text-only inserts and read_at-only updates.
revoke insert on table public.messages from public;
revoke insert on table public.messages from anon, authenticated;
revoke insert (id, conversation_id, sender_user_id, kind, body,
               media_object_path, created_at, read_at)
  on table public.messages from public;
revoke insert (id, conversation_id, sender_user_id, kind, body,
               media_object_path, created_at, read_at)
  on table public.messages from anon, authenticated;
revoke update (id, conversation_id, sender_user_id, kind, body,
               media_object_path, created_at, read_at)
  on table public.messages from public;
revoke update (id, conversation_id, sender_user_id, kind, body,
               media_object_path, created_at, read_at)
  on table public.messages from anon, authenticated;
grant insert (conversation_id, sender_user_id, kind, body)
  on table public.messages to authenticated;
grant update (read_at) on table public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 4. messages: a recipient may only write read_at
--
--    The existing UPDATE policy pins sender_user_id <> auth.uid() and read_at IS NOT NULL,
--    but RLS cannot restrict which columns a permitted UPDATE touches, so a recipient could
--    also rewrite body, kind, conversation_id or created_at (or hand authorship to a third
--    member). RLS cannot express "only this column", so the column privilege does:
--    table-level UPDATE is revoked and only read_at is granted.
-- ---------------------------------------------------------------------------
revoke update on table public.messages from public;
revoke update on table public.messages from anon, authenticated;
grant update (read_at) on table public.messages to authenticated;

-- ---------------------------------------------------------------------------
-- 5. sos_events: a parent may only write acknowledged_at and acknowledged_by
--
--    Same reasoning: the policy makes acknowledgement one-shot and pins acknowledged_by to
--    auth.uid(), but the statement could also overwrite latitude, longitude, note or
--    child_user_id. Only the two acknowledgement columns stay writable.
-- ---------------------------------------------------------------------------
revoke update on table public.sos_events from public;
revoke update on table public.sos_events from anon, authenticated;
revoke update (id, family_id, child_user_id, latitude, longitude, note, created_at,
               acknowledged_at, acknowledged_by)
  on table public.sos_events from public;
revoke update (id, family_id, child_user_id, latitude, longitude, note, created_at,
               acknowledged_at, acknowledged_by)
  on table public.sos_events from anon, authenticated;
grant update (acknowledged_at, acknowledged_by) on table public.sos_events to authenticated;

-- ---------------------------------------------------------------------------
-- 6. conversations: members may read the family conversation (already allowed).
--    Nothing to add; creation goes through ensure_family_conversation above.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. family_invites: parents may read the invitation history, nobody may read token_hash
--
--    The audited parent-only SELECT policy already exists. Reassert only the safe
--    column grants; the stored token_hash remains unreadable to authenticated clients.
-- ---------------------------------------------------------------------------
-- The parent-only SELECT policy already exists in the audited database; preserve it.
revoke select on table public.family_invites from public;
revoke select on table public.family_invites from anon, authenticated;
revoke select (id, family_id, created_by, token_hash, expires_at, consumed_by, consumed_at, created_at)
  on table public.family_invites from public;
revoke select (id, family_id, created_by, token_hash, expires_at, consumed_by, consumed_at, created_at)
  on table public.family_invites from anon, authenticated;
grant select (id, family_id, created_by, expires_at, consumed_by, consumed_at, created_at)
  on table public.family_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 8. zones
--
--    The family-member SELECT policy and parent-only write policies were already
--    verified in the live schema. Do not replace them here; preserving the audited
--    policy definitions also keeps this migration's rollback bounded.
--
-- ---------------------------------------------------------------------------
-- 9. SOS history remains parent-only.
--
--    A child SELECT policy was explicitly declined. The client does not request
--    child SOS history and this migration must not widen that visibility.
--
-- ---------------------------------------------------------------------------
-- 10. profiles: family members may read each other's profile
--
--    The previous membership policy could recurse through family_members RLS. Replace
--    only this named policy with a SECURITY DEFINER-backed same-family check. The saved
--    audit output is required to restore its exact prior expression.
-- ---------------------------------------------------------------------------
drop policy if exists "family members read each other profiles" on public.profiles;
create policy "family members read each other profiles"
  on public.profiles
  for select
  to authenticated
  using (public.famguard_shares_family_with(user_id));

-- ---------------------------------------------------------------------------
-- 11. subscriptions
--
--     Keep the existing parent-owned SELECT policy. The safe column-level SELECT
--     grants below are already the audited intended boundary; payment identifiers
--     remain unavailable to authenticated clients.
-- ---------------------------------------------------------------------------
revoke select on table public.subscriptions from public;
revoke select on table public.subscriptions from anon, authenticated;
revoke select (id, parent_user_id, family_id, status, plan_code, starts_at, ends_at,
               payment_network, transaction_id, verified_at, created_at)
  on table public.subscriptions from public;
revoke select (id, parent_user_id, family_id, status, plan_code, starts_at, ends_at,
               payment_network, transaction_id, verified_at, created_at)
  on table public.subscriptions from anon, authenticated;
grant select (id, parent_user_id, family_id, status, plan_code, starts_at, ends_at, verified_at, created_at)
  on table public.subscriptions to authenticated;

commit;
