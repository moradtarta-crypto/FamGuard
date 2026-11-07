-- FamGuard — READ-ONLY post-migration verification.
--
-- Run after the helper hardening and security repair migrations. Save the output and
-- compare it with the expected boundaries below. This script performs SELECTs only.

-- 1. RLS state for every FamGuard table.
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
order by c.relname;

-- Expected: rls_enabled = true on all ten tables.

-- 2. RLS policies. SOS history and subscription rows must remain parent-only.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
order by tablename, policyname;

-- Expected: no child SELECT policy on sos_events; no family-wide subscription SELECT policy.

-- 3. Table-level grants.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- Expected highlights:
--   families: authenticated SELECT only
--   conversations: authenticated SELECT only
--   profiles: authenticated SELECT only (INSERT/UPDATE are column-scoped)
--   location_updates: authenticated SELECT only (INSERT is column-scoped)
--   messages: authenticated SELECT only (INSERT is column-scoped; UPDATE read_at is column-scoped)
--   zones: authenticated SELECT only
--   family_invites/subscriptions: no table-level SELECT (safe columns only)
--   no anon grants on any FamGuard table.

-- 4. Column-level grants.
select table_name, column_name, grantee, privilege_type
from information_schema.role_column_grants
where table_schema = 'public'
  and table_name in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, column_name, grantee, privilege_type;

-- Expected highlights:
--   profiles INSERT/UPDATE: user_id, display_name, preferred_language only.
--   location_updates INSERT: family_id, child_user_id, latitude, longitude,
--     accuracy_m, battery_percent, recorded_at only.
--   messages INSERT: conversation_id, sender_user_id, kind, body only.
--   messages UPDATE: read_at only.
--   sos_events INSERT: family_id, child_user_id, latitude, longitude, note only.
--   sos_events UPDATE: acknowledged_at, acknowledged_by only.
--   zones INSERT: family_id, created_by, label, kind, center_lat, center_lng,
--     radius_m, alerts_on_entry, alerts_on_exit, enabled only; UPDATE: enabled only.
--   family_invites SELECT excludes token_hash.
--   subscriptions SELECT excludes payment_network and transaction_id.
--   no anon grants.

-- 5. Security attributes for membership helpers and the canonical chat RPC.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_family_member', 'is_parent_in_family', 'is_child_in_family',
    'famguard_shares_family_with', 'ensure_family_conversation'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- Expected: all listed helpers/RPCs are SECURITY DEFINER with a pinned search_path.
-- Confirm function owners are trusted (normally postgres) before relying on this state.
