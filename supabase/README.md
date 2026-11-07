# FamGuard database migrations

These files repair the Row Level Security gaps found in the audit of commit `fea4b185`.
They are **additive and reversible**: no table, row, column, index, enum or existing policy
is dropped, renamed or rewritten, and no statement in them performs DML.

Nothing here has been applied yet. The application only holds the Supabase publishable
(anon) key, which cannot run DDL, and no database password or service key exists in this
environment — so the owner applies these files. Until then the app keeps working and
reports the affected features honestly instead of pretending they succeed.

## Order

| Step | File | Purpose |
| --- | --- | --- |
| 1 | `audit/capture_current_definitions.sql` | **Read-only backup.** Records the current policies, function definitions, attributes and grants. Save the output. This is what makes rollback exact. |
| 2 | `migrations/20261107_0001_security_repair.sql` | Conversation RPC, column-level write privileges, member-read policies, subscription/profile visibility. |
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
5. `family_invites` — parent-only `SELECT` policy plus `REVOKE SELECT` / `GRANT SELECT
   (safe columns)`, so `token_hash` is never readable.
6. `zones` — children gain read access through a member policy; the existing parent-only
   `ALL` policy is untouched, so only parents can write.
7. `sos_events` — a child may read the alerts it raised itself (acknowledgement feedback).
8. `profiles` — co-members can read each other's display names within a shared family.
9. `subscriptions` — every member of the family can read the family subscription row, while
   `REVOKE`/column grants keep `payment_network` and `transaction_id` with the paying parent.

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
  and policyname in ('family members read family subscription',
                     'family members read each other profiles',
                     'child reads own sos','zones readable by family members',
                     'parents read family invites')
order by tablename;
```

Then sign in as a parent and as a child and confirm: the family chat opens, sending an SOS
reports success, a child sees its own SOS acknowledgement, the invite list shows history,
and the subscription panel renders.

## Rollback

`rollback/20261107_0001_security_repair_rollback.sql` and
`rollback/20261107_0002_helper_hardening_rollback.sql` undo the corresponding step: they
drop only the policies and functions those migrations created and restore table-level
`SELECT`/`UPDATE` to the API roles. No existing policy, row or table is affected in either
direction. If section C of the helper migration was used to replace a body, paste the
captured definition back first — the rollback only resets attributes.

## Application behaviour before the migrations are applied

| Feature | Without the migration |
| --- | --- |
| Family chat | `ensure_family_conversation` is missing, so the chat screen shows "the database has not had the FamGuard security repair applied" instead of a raw error. |
| Location sharing / SOS | Works — the app no longer asks for the row back, so there is no false `PGRST116` failure. |
| Invite history | Shows "invite history could not be confirmed" rather than "no invites yet". |
| Child SOS / zones lists | Show an honest empty state instead of implying nothing exists. |
| Subscription | Renders for the paying parent only. |
