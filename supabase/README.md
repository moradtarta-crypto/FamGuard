# FamGuard database migrations

These files repair the Row Level Security gaps found in the audit of commit `fea4b185`.
They perform no DML and do not alter stored records. The first migration replaces one
profile policy and narrows grants; its rollback requires the saved policy definition. The
helper-function rollback also requires the saved original function attributes.

Nothing here has been applied yet. The application only holds the Supabase publishable
(anon) key, which cannot run DDL, and no database password or service key exists in this
environment — so the owner applies these files. Until then the app keeps working and
reports the affected features honestly instead of pretending they succeed.

## Order

| Step | File | Purpose |
| --- | --- | --- |
| 1 | `audit/capture_current_definitions.sql` | **Read-only backup.** Records the current policies, function definitions, attributes and grants. Save the output. It is required to restore the exact prior policy and helper attributes manually. |
| 2 | `migrations/20261107_0001_security_repair.sql` | Conversation RPC, column-level write privileges, invite/profile visibility; preserves existing parent-only SOS and subscription access. |
| 3 | `migrations/20261107_0002_helper_function_hardening.sql` | Verifies `is_family_member` / `is_parent_in_family` / `is_child_in_family` bodies, then pins `SECURITY DEFINER` + `search_path` (fixes recursive-RLS risk). |

Run each migration in the Supabase SQL editor as a single transaction. Each file ends with
`commit;` and begins with `begin;`, so a syntax error aborts the whole step.

## What each change does

`20261107_0001`

1. `famguard_shares_family_with(uuid)` — new helper: does the caller share any family with
   that user? Used by the co-member profile policy.
2. `ensure_family_conversation(uuid)` — new `SECURITY DEFINER` function with a pinned
   `search_path`. Validates membership, locks the family row, returns the canonical
   conversation and creates it only when the family has none. This replaces the direct
   `INSERT` that `conversations` has no policy for.
3. `messages` — `REVOKE UPDATE` on the table, then `GRANT UPDATE (read_at)`. A recipient can
   therefore mark a message read and can no longer touch `body`, `sender_user_id`, `kind`,
   `conversation_id` or `created_at`.
4. `sos_events` — `REVOKE UPDATE` on the table, then `GRANT UPDATE (acknowledged_at,
   acknowledged_by)`. A parent can acknowledge once and cannot alter the child's identity,
   coordinates or note.
5. `family_invites` — preserves the already-audited parent-only `SELECT` policy and
   reasserts `REVOKE SELECT` / `GRANT SELECT (safe columns)`, so `token_hash` stays unreadable.
6. `zones` — the already-audited family-member read and parent-only write policies are
   preserved; this migration does not replace them.
7. `sos_events` — history remains parent-only. A child SELECT policy was explicitly declined,
   so the migration does not widen SOS visibility.
8. `profiles` — co-members can read each other's display names within a shared family. The
   prior policy expression is replaced with a SECURITY DEFINER-backed membership check.
9. `subscriptions` — the existing parent-owned SELECT policy is preserved. Safe column grants
   remain limited to status/plan/date metadata; payment identifiers are not exposed.

`20261107_0002`

10. Sets `SECURITY DEFINER`, `STABLE` and `search_path = public, pg_temp` on the three
    membership helpers so they no longer re-enter `family_members` RLS (which raises
    `42P17 infinite recursion` for an invoker helper) and cannot be shadowed by a caller.
    Bodies are only replaced if section A of that file shows a wrong role check.

## Verify after applying

```sql
-- 1. The new function exists and is definer-secured.
select proname, prosecdef, proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('ensure_family_conversation','famguard_shares_family_with',
   'is_family_member','is_parent_in_family','is_child_in_family');

-- 2. Write privileges are column-scoped, not table-wide.
select grantee, privilege_type,
       string_agg(column_name, ',' order by column_name) as columns
from information_schema.column_privileges
where table_schema = 'public' and table_name in ('messages','sos_events')
  and privilege_type = 'UPDATE'
group by grantee, privilege_type;

-- 3. The new policies are present.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and policyname in ('family members read each other profiles',
                     'parents read family invites')
order by tablename;
```

Then sign in as a parent and as a child and confirm: the family chat opens, a parent sees SOS
history and can acknowledge an alert, a child can submit SOS without reading family history,
the invite list shows history, and the parent subscription panel renders.

## Rollback

`rollback/20261107_0001_security_repair_rollback.sql` restores only audited column-level grants;
it never restores broad table-wide SELECT/UPDATE. It drops the replacement profile policy,
so restore the exact prior CREATE POLICY statement from the saved audit output before users
return. `rollback/20261107_0002_helper_hardening_rollback.sql` is intentionally a manual note
file: restore exact captured SECURITY mode, volatility and search_path values. Neither rollback
may be guessed or run blindly.

## Application behaviour before the migrations are applied

| Feature | Without the migration |
| --- | --- |
| Family chat | `ensure_family_conversation` is missing, so the chat screen explains that the required database function is not installed; it does not attempt a blocked direct INSERT. |
| Location sharing / SOS | Works — the app no longer asks for the row back, so there is no false `PGRST116` failure. |
| Invite history | Shows "invite history could not be confirmed" rather than "no invites yet". |
| Child SOS history | Remains parent-only; the child can submit an alert but cannot read family SOS history. |
| Child zones | Uses the existing family-member read policy; no migration change is needed. |
| Subscription | Renders for the parent who owns the subscription; child access remains denied. |
