# FamGuard

Family safety and protection app. React + Vite client, Express 5 server, and a
**live Supabase backend** (auth, database and row level security) — there is no
local JSON store and no seeded demo data.

## Status: stage 1 of 3

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Supabase configuration, email/password auth, session handling, role resolution, demo data removal | **implemented** |
| 2 | Parent/child dashboards, family creation, invite/join, member list, chat, SOS, location, zones | pending schema verification |
| 3 | Full verification and deployment | pending approval |

Stage 1 deliberately ships no family, chat, SOS, location or zone queries: those
land in stage 2 once the existing table columns, relationships, enum values and
RPC signatures are confirmed.

## Configuration

The app needs exactly two environment variables. Both are browser-safe.

| Variable | Example | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://gglslcqrkurpxwkvjvek.supabase.co` | Your existing project. |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Publishable (anon) key. **Required.** |

`PORT` (default `3000`) is optional.

**Never set a `service_role` or secret key.** `server/app.ts` refuses to serve a
configuration whose key is an `sb_secret_` key or a JWT with `role: service_role`,
and the UI shows a configuration error instead of starting. Access control is
your existing Supabase row level security, evaluated against each signed-in
user's own JWT.

Locally, copy `.env.example` to `.env` and fill in the values.

## How configuration reaches the browser

`GET /api/config` returns `{ supabaseUrl, supabasePublishableKey }` at runtime
(`Cache-Control: no-store`). The client never uses `VITE_*` inlining, so rotating
the publishable key does not require a rebuild. Nothing else is exposed by the
server: `/api/health` and `/api/config` are the only API routes.

## Architecture

```
server/
  app.ts        Express app: /api/health, /api/config, key safety guard
  index.ts      Static hosting for dist/public + API + SPA fallback
client/
  lib/supabase.ts   runtime config fetch, createClient (session persistence + auto refresh)
  lib/roles.ts      role normalization, tolerant column lookups
  lib/account.ts    own profile + family_members read, role resolution
  auth/AuthProvider.tsx  session bootstrap, auth state subscription, account loading
  auth/AuthScreen.tsx    email/password sign-in and sign-up
  App.tsx           loading / config-error / signed-out / signed-in phases
```

### Role resolution

`client/lib/account.ts` reads only the signed-in user's own rows:

1. `profiles` filtered by `id = auth.uid()` (optional row — a profile may not exist yet).
2. `family_members` filtered by the first matching owner column of
   `user_id`, `profile_id`, `member_id`, `account_id`. The next column is tried
   **only** when PostgREST reports a missing column (`42703`); any other error —
   including a row level security denial — is surfaced to the user unchanged.
3. Role comes from the membership (`role`, `member_role`, `relationship`, `type`),
   falling back to the profile role, and is normalized to `parent` or `child`.

If a policy blocks a read, the UI reports the error and offers a retry. The app
never changes database objects.

## UI states

Loading (skeletons), configuration error (with the exact server problems and a
retry), signed out (auth form), signed in (account + family panels), account load
error (message + retry), and empty (`You are not part of a family yet`). No
placeholder members, alerts or coordinates are ever rendered.

## Scripts

```bash
npm run dev:server   # API + static host on PORT
npm run dev:client   # Vite dev server (proxies /api)
npm test             # server tests (node --test)
npm run typecheck    # server + client
npm run build        # tsc + vite build
npm start            # production server
```

## Database policy

No migrations, DDL, policy changes, function changes or data writes are part of
this repository. Any operation that existing RLS blocks is reported, not worked
around.
