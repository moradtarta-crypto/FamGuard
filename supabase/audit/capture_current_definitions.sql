-- FamGuard — READ-ONLY capture of the current database definitions.
--
-- Run this FIRST, in the Supabase SQL editor, and save the output (or "Download CSV")
-- next to this file. It records the policy expressions, function bodies, attributes,
-- grants and row counts needed for a reviewed manual rollback. Rollbacks are not all
-- automatic: see the matching rollback notes before applying any migration.
--
-- This script only SELECTs from the system catalogs. It performs no DDL and no DML.

-- ---------------------------------------------------------------------------
-- 1. Row level security policies (exact text)
-- ---------------------------------------------------------------------------
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 2. Is RLS actually enabled / forced on each table?
-- ---------------------------------------------------------------------------
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'families', 'family_members', 'family_invites', 'zones',
    'location_updates', 'conversations', 'messages', 'sos_events', 'subscriptions'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 3. Helper functions and RPCs: signatures, security attributes, search_path, body
-- ---------------------------------------------------------------------------
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_arguments(p.oid) as full_args,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_userbyid(p.proowner) as owner,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_family_member', 'is_parent_in_family', 'is_child_in_family',
    'create_family', 'create_family_invite', 'accept_family_invite', 'get_family_members'
  )
order by p.proname;

-- ---------------------------------------------------------------------------
-- 4. Table and column level grants (what the API roles may do)
-- ---------------------------------------------------------------------------
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

select table_name, column_name, grantee, privilege_type
from information_schema.role_column_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
order by table_name, column_name, grantee;

-- Function EXECUTE grants, including PUBLIC, anon and authenticated.
select routine_name, specific_name, grantee, privilege_type, is_grantable
from information_schema.routine_privileges
where specific_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by routine_name, specific_name, grantee;

-- ---------------------------------------------------------------------------
-- 5. Triggers on the FamGuard tables (confirm nothing rewrites rows behind RLS)
-- ---------------------------------------------------------------------------
select event_object_table as table_name, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- ---------------------------------------------------------------------------
-- 6. Enums actually present (compare with the values the client validates)
-- ---------------------------------------------------------------------------
select t.typname as enum_name, e.enumlabel as value, e.enumsortorder
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
order by t.typname, e.enumsortorder;

-- ---------------------------------------------------------------------------
-- 7. Row counts only — proof that the data you care about exists before/after.
--    No row content is read.
-- ---------------------------------------------------------------------------
select 'profiles' as table_name, count(*) from public.profiles
union all select 'families', count(*) from public.families
union all select 'family_members', count(*) from public.family_members
union all select 'family_invites', count(*) from public.family_invites
union all select 'zones', count(*) from public.zones
union all select 'location_updates', count(*) from public.location_updates
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'sos_events', count(*) from public.sos_events
union all select 'subscriptions', count(*) from public.subscriptions;
