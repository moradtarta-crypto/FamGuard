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
| 1 | `audit/capture_current_definitions.sql` | **Read-only backup.** Records current policies, function definitions, attributes and grants. Save the output for manual rollback. |
| 2 | `migrations/20261107_0002_helper_function_hardening.sql` | **Read-only verification.** Displays the three membership helper definitions and security attributes. Inspect them before proceeding. |
| 3 | `migrations/20261107_0003_helper_function_hardening_apply.sql` | Changes helper attributes only, and is blocked until the operator explicitly confirms that the bodies were reviewed. |
| 4 | `migrations/20261107_0001_security_repair.sql` | Conversation RPC, column-level write privileges, invite/profile visibility; preserves existing parent-only SOS and subscription access. |
| 5 | `audit/verify_after_security_repair.sql` | **Read-only verification.** Confirms RLS, column grants, parent-only visibility and helper attributes after both migrations. |

Run `0003_helper_function_hardening_apply.sql` and then `0001_security_repair.sql` in the Supabase SQL editor as separate transactions. Finally, run `audit/verify_after_security_repair.sql` and save its read-only output.
The `0002` verification file is SELECT-only and must be run separately first. Do not apply 0003
until its three helper bodies have been reviewed and the confirmation line deliberately enabled.

## What each change does

`20261107_0001`

1. `famguard_shares_family_with(uuid)` — new helper used by the co-member profile policy.
2. `ensure_family_conversation(uuid)` — validates membership, locks the family row and
   creates the canonical conversation only when absent. The client no longer attempts a
   direct INSERT that RLS is designed to reject.
3. **Least-privilege writes**:
   - `families` and `conversations`: authenticated clients are read-only; creation stays in
     their SECURITY DEFINER RPCs.
   - `profiles`: own-row upsert is limited to `user_id`, `display_name` and
     `preferred_language`.
   - `location_updates`: child inserts are limited to measured location/battery fields;
     `id` and `received_at` remain database-controlled.
   - `messages`: text-only insert columns; `read_at` is the only UPDATE column.
4. `sos_events`: `acknowledged_at` and `acknowledged_by` are the only UPDATE columns.
   A parent cannot rewrite the child's identity, coordinates or note.
5. `family_invites`: preserves the parent-only SELECT policy and safe column grants;
   `token_hash` stays unreadable.
6. `zones`: preserves the already-audited family-member read and parent-only write policies.
7. SOS history remains parent-only. A child SELECT policy was explicitly declined.
8. `profiles`: replaces the co-member read policy with a SECURITY DEFINER-backed
   same-family check to avoid recursive RLS.
9. `subscriptions`: preserves the parent-owned SELECT policy and safe column grants;
   payment identifiers remain unavailable to authenticated clients.

`20261107_0002` is read-only: it displays the exact membership helper definitions and
security attributes. Inspect the bodies before proceeding.

`20261107_0003` sets `SECURITY DEFINER`, `STABLE` and
`search_path = public, pg_temp` on the exact three helper signatures after the explicit
review gate is enabled. It does not change function bodies or owners.

## Verify after applying

Run `audit/verify_after_security_repair.sql` and save its output. It checks RLS state,
policy definitions, table/column grants, and helper security attributes. Confirm that
there are no `anon` grants, no child SOS SELECT policy, and no family-wide subscription
SELECT policy before testing the app as a parent and child.

## Rollback

`rollback/20261107_0001_security_repair_rollback.sql` restores the audited pre-migration
ACL baseline for families, conversations, profiles, location updates and messages. That
baseline includes broad authenticated table grants; RLS still applies, but this is a
rollback-only state, not the recommended steady-state security posture. The rollback
keeps family-invite and subscription reads column-scoped and keeps message/SOS UPDATE
columns restricted.

The migration replaces the co-member profile policy, so restore its exact prior
`CREATE POLICY` statement from the saved audit output before users return.
`rollback/20261107_0003_helper_hardening_rollback.sql` is intentionally a manual note
file: restore exact captured SECURITY mode, volatility and search_path values. Neither
rollback may be guessed or run blindly.

## Application behaviour before the migrations are applied

| Feature | Without the migration |
| --- | --- |
| Family chat | `ensure_family_conversation` is missing, so the chat screen explains that the required database function is not installed; it does not attempt a blocked direct INSERT. |
| Location sharing / SOS | Works — the app no longer asks for the row back, so there is no false `PGRST116` failure. |
| Invite history | Shows "invite history could not be confirmed" rather than "no invites yet". |
| Child SOS history | Remains parent-only; the child can submit an alert but cannot read family SOS history. |
| Child zones | Uses the existing family-member read policy; no migration change is needed. |
| Subscription | Renders for the parent who owns the subscription; child access remains denied. |
