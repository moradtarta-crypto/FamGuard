-- FamGuard — read-only verification of membership helper functions.
--
-- Run this file by itself and inspect all three definitions before any hardening.
-- Required semantics:
--   * is_family_member(uuid): checks auth.uid() has a family_members row for that family.
--   * is_parent_in_family(uuid): also requires role = 'parent'.
--   * is_child_in_family(uuid, uuid): checks the SECOND argument has role = 'child'
--     in the supplied family.
--
-- If any body is missing or differs, do not run the hardening file. Correct the body
-- only after reviewing the saved audit output and the actual function signature.
-- This file is SELECT-only and changes no database state.

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer,
  p.provolatile as volatility,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_family_member', 'is_parent_in_family', 'is_child_in_family')
order by p.proname, pg_get_function_identity_arguments(p.oid);
