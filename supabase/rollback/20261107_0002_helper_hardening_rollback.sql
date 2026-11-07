-- FamGuard — rollback for 20261107_0002_helper_function_hardening.sql.
--
-- Restores the original attributes. If you applied a corrective body from section C of the
-- migration, paste the captured definition from
-- supabase/audit/capture_current_definitions.sql (section 3) back in place first — the
-- statements below only touch SECURITY DEFINER / volatility / search_path, not bodies.

begin;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_family_member', 'is_parent_in_family', 'is_child_in_family')
  loop
    execute format('alter function %s reset search_path', fn.signature);
    execute format('alter function %s security invoker', fn.signature);
    raise notice 'restored attributes on %', fn.signature;
  end loop;
end;
$$;

commit;
