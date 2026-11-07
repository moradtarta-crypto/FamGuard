# FamGuard

Family safety and protection app built with React, Vite, Express 5 and the existing Supabase project. The app uses the live Supabase Auth and database APIs; it has no local JSON store, seeded demo records or simulated alerts.

## Project status

| Stage | Scope | State |
| --- | --- | --- |
| 1 | Runtime Supabase configuration, email/password authentication, persistent sessions and account loading | Implemented |
| 2 | Parent/child dashboards, family creation and invite/join, members, family chat, SOS, location sharing and zones | Implemented in the `appjet` branch; live database dependencies are listed below |
| 3 | End-to-end verification, final security review and deployment | Not started; requires explicit approval |

The code in this branch is ahead of `main`. Work on `appjet` is not a production deployment.

## Configuration

The app needs two environment variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | URL of the existing Supabase project |
| `SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key |

`PORT` is optional (default `3000`). Never configure a `service_role` or `sb_secret_` key. The server rejects those key types before exposing configuration to the browser.

Locally, copy `.env.example` to `.env` and provide the two public settings.

## Runtime configuration

`GET /api/config` returns `supabaseUrl` and `supabasePublishableKey` at runtime with `Cache-Control: no-store`. The browser does not inline credentials through `VITE_*` variables. The only API routes are `/api/health` and `/api/config`.

## Architecture

```
server/
  app.ts             Express health and browser-safe config endpoints
  index.ts           Production static hosting and SPA fallback
client/
  auth/              Auth provider and email/password screen
  features/          Family, chat and safety panels
  hooks/             Resource loading and refresh behavior
  lib/
    account.ts       Signed-in user's profile and family memberships
    data.ts          Supabase reads, writes and existing RPC calls
    schema.ts        Verified database row shapes and selected columns
    supabase.ts      Runtime config fetch and Supabase client
    sos.ts           Bounded best-effort location lookup for SOS
  pages/             Dashboard and family onboarding
```

## Account and role resolution

`client/lib/account.ts` reads:

1. The signed-in user's profile from `profiles`, filtered by `user_id = auth.uid()`. A profile row is optional.
2. The signed-in user's memberships from `family_members`, filtered by `user_id = auth.uid()`.
3. The role for each family exclusively from `family_members.role`. Valid roles are `parent` and `child`; the app does not infer a role from profile metadata.

A database or row-level security error is shown to the user; it is not treated as an empty successful result.

## Installable PWA

- The web manifest and app icon prepare the site for installation on supported browsers, including Android Chrome, once deployed on HTTPS. Live installation has not yet been verified.
- The service worker caches only the static app shell, manifest, icon and built assets.
- `/api/*`, Supabase requests, authentication data, locations, messages and SOS records are never cached.
- Offline mode does not send SOS, share location or load family records; those actions require a network connection.
- There is no background location tracking or push notification support in this build.

## Implemented behavior and limits

- Authentication: email/password, session persistence and email confirmation handling.
- Families: explicit user-triggered calls to the existing `create_family`, `create_family_invite` and `accept_family_invite` RPCs.
- Family chat: text messages, bounded newest-message loading, polling and read receipts. A family with no conversation requires the `ensure_family_conversation(uuid)` RPC; if it is missing, the app explains the required migration and does not attempt a direct INSERT blocked by RLS.
- SOS: child accounts can submit alerts even if the browser cannot obtain coordinates; parents can read and acknowledge family alerts. Child accounts cannot read SOS history under the current policy. The UI warns when an alert was stored without location. Database write failures remain failures.
- Location: browser geolocation and manual/polling refresh. This is not background tracking.
- Zones: stored safe/danger zones and browser-side distance display. The database does not automatically evaluate entry/exit or generate geofence alerts.
- Notifications: no push, SMS or email notification service is configured.
- Media: image and voice messages are not enabled because no verified storage bucket is configured.
- Billing: the current subscription panel is read-only. No payment collection, receipt verification or automatic activation is implemented.
- Realtime: Supabase Realtime is not enabled for this project; screens use polling and manual refresh.

The UI must not show placeholder members, fake coordinates, simulated SOS alerts or fabricated payment states.

## Database and security boundary

The application uses the existing Supabase schema and row-level security. It does not apply migrations or change database objects automatically.

The SQL migration files in `supabase/migrations/` are proposals only; they are **not automatically applied** by this application. In particular, `ensure_family_conversation(uuid)` is a database dependency for creating a conversation when a family does not already have one. Do not apply a migration or rollback script without reviewing its exact statements and obtaining explicit approval.

Never bypass RLS, expose secret keys, create test accounts, or perform database writes outside an explicit user action.

## Scripts

```bash
npm run dev:server   # API + static host on PORT
npm run dev:client   # Vite dev server (proxies /api)
npm test             # all Node tests
npm run typecheck    # server + client TypeScript checks
npm run build        # TypeScript check + Vite production build
npm start            # production server
```

## Deployment

No deployment is performed by repository changes. Stage 3, production deployment and any live database operation require separate explicit approval.
