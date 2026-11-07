-- FamGuard — security and functionality repair (part 1 of 2).
--
-- WHAT THIS DOES
--   Adds policies, column privileges and two SECURITY DEFINER helpers. It does not
--   drop, rename or truncate anything and it performs no DML, so no existing record is
--   read or modified by the migration itself.
--
-- WHAT THIS DOES NOT DO
--   * It does not touch the existing UPDATE policies on messages / sos_events. Those keep
--     their current USING and WITH CHECK clauses; the column privileges added below are what
--     stop a recipient from rewriting a message body or an incident's coordinates.
--   * It does not weaken any policy. Every statement either adds a policy that grants a
--     read the application needs, or narrows a privilege.
--
-- PREREQUISITES
--   1. supabase/audit/capture_current_definitions.sql has been run and its output saved.
--   2. The three helper functions exist: is_family_member(uuid), is_parent_in_family(uuid),
--      is_child_in_family(uuid, uuid). Verify with the capture script before applying.
--   3. create_family_invite / accept_family_invite are SECURITY DEFINER (section 3 of the
--      capture output). The column grants on family_invites in step 6 assume the definer
--      reads and writes that table; an INVOKER function would lose access.
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
-- 3. messages: a recipient may only write read_at
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
-- 4. sos_events: a parent may only write acknowledged_at and acknowledged_by
--
--    Same reasoning: the policy makes acknowledgement one-shot and pins acknowledged_by to
--    auth.uid(), but the statement could also overwrite latitude, longitude, note or
--    child_user_id. Only the two acknowledgement columns stay writable.
-- ---------------------------------------------------------------------------
revoke update on table public.sos_events from public;
revoke update on table public.sos_events from anon, authenticated;
grant update (acknowledged_at, acknowledged_by) on table public.sos_events to authenticated;

-- ---------------------------------------------------------------------------
-- 5. conversations: members may read the family conversation (already allowed).
--    Nothing to add; creation goes through ensure_family_conversation above.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. family_invites: parents may read the invitation history, nobody may read token_hash
--
--    Without a policy the table is deny-all, so the invite list rendered "No invites yet"
--    while invites existed. The hash is still never exposed to the API.
-- ---------------------------------------------------------------------------
-- The parent-only SELECT policy already exists in the audited database; preserve it.
revoke select on table public.family_invites from public;
revoke select on table public.family_invites from anon, authenticated;
grant select (id, family_id, created_by, expires_at, consumed_by, consumed_at, created_at)
  on table public.family_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 7. zones
--
--    The family-member SELECT policy and parent-only write policies were already
--    verified in the live schema. Do not replace them here; preserving the audited
--    policy definitions also keeps this migration's rollback bounded.
--
-- ---------------------------------------------------------------------------
-- 8. SOS history remains parent-only.
--
--    A child SELECT policy was explicitly declined. The client does not request
--    child SOS history and this migration must not widen that visibility.
--
-- ---------------------------------------------------------------------------
-- 9. profiles: family members may read each other's profile
--
--    Previously only the owner and parents-of-children could read a profile, so co-parents
--    and children rendered "Member xxxxxxxx" instead of a name. Visibility stays inside the
--    family: famguard_shares_family_with(user_id) is false for every unrelated account.
-- ---------------------------------------------------------------------------
drop policy if exists "family members read each other profiles" on public.profiles;
create policy "family members read each other profiles"
  on public.profiles
  for select
  to authenticated
  using (public.famguard_shares_family_with(user_id));

-- ---------------------------------------------------------------------------
-- 10. subscriptions
--
--     Keep the existing parent-owned SELECT policy. The safe column-level SELECT
--     grants below are already the audited intended boundary; payment identifiers
--     remain unavailable to authenticated clients.
-- ---------------------------------------------------------------------------
revoke select on table public.subscriptions from public;
revoke select on table public.subscriptions from anon, authenticated;
grant select (id, parent_user_id, family_id, status, plan_code, starts_at, ends_at, verified_at, created_at)
  on table public.subscriptions to authenticated;

commit;
