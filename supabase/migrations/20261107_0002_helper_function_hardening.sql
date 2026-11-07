-- FamGuard — helper function hardening (part 2 of 2).
--
-- WHAT THIS DOES
--   Sets the security attributes of the three membership helpers used by every policy:
--   SECURITY DEFINER (so they read family_members as the owner instead of re-entering that
--   table's RLS policies, which is what produces "42P17 infinite recursion detected in
--   policy for relation family_members"), STABLE, and a pinned search_path so a caller
--   cannot shadow `family_members` or `auth.uid()` with an object of their own.
--
-- WHAT THIS DOES NOT DO
--   It does not rewrite the function bodies. ALTER FUNCTION addresses them by argument
--   types only, so this file works without knowing the parameter names your project used.
--   The bodies still have to be correct; section A verifies them and section B fixes a body
--   only if you find a problem.
--
-- ROLLBACK
--   supabase/rollback/20261107_0002_helper_hardening_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- A. Verify the current bodies before hardening.
--
--    Run this SELECT first. Each row must be true:
--      * is_family_member    → requires an actual family_members row for auth.uid()
--      * is_parent_in_family → requires that row to have role = 'parent'
--      * is_child_in_family  → requires role = 'child' for the SECOND argument
--    A helper that only checks membership where a role is required lets a child manage
--    zones or acknowledge SOS; a helper that ignores its second argument breaks the
--    "child submits its own location/SOS" guarantees.
-- ---------------------------------------------------------------------------
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_family_member', 'is_parent_in_family', 'is_child_in_family')
order by p.proname;

-- ---------------------------------------------------------------------------
-- B. Harden the attributes (non-destructive, no body change).
--    `if exists` keeps this file safe if a helper is named slightly differently; the
--    verification query above will then show the missing one.
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_family_member', 'is_parent_in_family', 'is_child_in_family')
  loop
    execute format('alter function %s security definer', fn.signature);
    execute format('alter function %s stable', fn.signature);
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
    raise notice 'hardened %', fn.signature;
  end loop;
end;
$$;

commit;

-- ---------------------------------------------------------------------------
-- C. Corrective body templates — apply ONLY if section A showed a wrong body.
--    Replace the argument name in the header with the name reported by section A
--    (`family_id` and `target_family` are the two names observed in this project's
--    RPC definitions), then run the block by itself. This changes one function body and
--    nothing else; the rollback file restores the captured definition.
-- ---------------------------------------------------------------------------
--
-- create or replace function public.is_family_member(family_id uuid)
-- returns boolean language sql stable security definer
-- set search_path = public, pg_temp as $$
--   select exists (
--     select 1 from public.family_members m
--     where m.family_id = is_family_member.family_id
--       and m.user_id = auth.uid()
--   );
-- $$;
--
-- create or replace function public.is_parent_in_family(family_id uuid)
-- returns boolean language sql stable security definer
-- set search_path = public, pg_temp as $$
--   select exists (
--     select 1 from public.family_members m
--     where m.family_id = is_parent_in_family.family_id
--       and m.user_id = auth.uid()
--       and m.role = 'parent'
--   );
-- $$;
--
-- create or replace function public.is_child_in_family(family_id uuid, target_user uuid)
-- returns boolean language sql stable security definer
-- set search_path = public, pg_temp as $$
--   select exists (
--     select 1 from public.family_members m
--     where m.family_id = is_child_in_family.family_id
--       and m.user_id = target_user
--       and m.role = 'child'
--   );
-- $$;
