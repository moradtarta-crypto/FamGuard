-- FamGuard — membership helper hardening (run only after reviewing 0002 output).
--
-- SAFETY GATE:
--   1. Run 20261107_0002_helper_function_hardening.sql by itself.
--   2. Inspect all three definitions and verify the exact role checks described there.
--   3. Save the audit output.
--   4. Only then uncomment the SET LOCAL line below and run this file.
--
-- This file changes function attributes only; it does not rewrite function bodies,
-- grants, policies, rows or tables. The function owner is not changed.
--
-- Rollback is manual because the exact previous attributes must be restored from
-- supabase/audit/capture_current_definitions.sql.

begin;

-- REQUIRED OPERATOR CONFIRMATION: uncomment only after reviewing all three function bodies.
-- SET LOCAL famguard.helper_bodies_verified = 'yes';

do $$
begin
  if current_setting('famguard.helper_bodies_verified', true) is distinct from 'yes' then
    raise exception
      'Helper hardening stopped: run the read-only 0002 verification and inspect all function bodies first.';
  end if;
end;
$$;

-- Each exact signature must exist. If one is missing, PostgreSQL aborts this transaction.
alter function public.is_family_member(uuid)
  security definer;
alter function public.is_family_member(uuid)
  stable;
alter function public.is_family_member(uuid)
  set search_path = public, pg_temp;

alter function public.is_parent_in_family(uuid)
  security definer;
alter function public.is_parent_in_family(uuid)
  stable;
alter function public.is_parent_in_family(uuid)
  set search_path = public, pg_temp;

alter function public.is_child_in_family(uuid, uuid)
  security definer;
alter function public.is_child_in_family(uuid, uuid)
  stable;
alter function public.is_child_in_family(uuid, uuid)
  set search_path = public, pg_temp;

commit;
