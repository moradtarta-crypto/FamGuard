# FamGuard

Family safety and protection app — a small household dashboard for check-ins and
safety alerts.

## What it does

- **Family roster** — add parents, children and guardians; each member has a live
  safety status (`safe`, `needs_attention`, `unknown`) and a last check-in time.
- **Check-ins** — one tap marks a member safe and records the timestamp.
- **Safety alerts** — raise an SOS, geofence, missed check-in or low battery alert
  for a member; open alerts immediately flag that member as needing attention.
- **Acknowledgement** — resolving an alert clears it from the open queue and, once a
  member has no open alerts left, returns them to `safe`.
- **Overview** — headline counters for members, safe members, members needing
  attention and open alerts.

## Stack

- Node.js 26 (LTS) + Express 5 + TypeScript API (`server/`)
- React 19 + Vite single-page dashboard (`client/`) served by the same process
- JSON-file persistence, written atomically (`DATA_FILE`, default `./data/famguard.json`)

## Run locally

```bash
npm install
npm run build      # type-checks the server and bundles the dashboard into dist/public
npm start          # http://localhost:3000
```

For development, run the API and the Vite dev server (with `/api` proxying) in two
terminals:

```bash
npm run dev:server
npm run dev:client   # http://localhost:5173
```

## Tests

```bash
npm test        # node:test + supertest, in-memory store and JSON persistence
npm run typecheck
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness probe |
| GET | `/api/overview` | Counters for members, statuses and open alerts |
| GET | `/api/members` | Family roster with open alert counts |
| POST | `/api/members` | Create a member — `{ name, role }` |
| GET | `/api/members/:id` | Single member |
| PATCH | `/api/members/:id/checkin` | Record a check-in (sets `safe`) |
| PATCH | `/api/members/:id/status` | Set status — `{ status }` |
| GET | `/api/alerts?status=open&memberId=…` | Alerts, newest first |
| POST | `/api/alerts` | Raise an alert — `{ memberId, type, message }` |
| PATCH | `/api/alerts/:id/acknowledge` | Acknowledge an alert |

`role` is one of `parent`, `child`, `guardian`. `type` is one of `sos`, `geofence`,
`missed_checkin`, `low_battery`. `status` is one of `safe`, `needs_attention`, `unknown`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (bound to `0.0.0.0`) |
| `DATA_FILE` | `./data/famguard.json` | JSON database path |

The store seeds a demo family (two parents, two children, one open geofence alert)
the first time it starts empty. Delete the data file to re-seed.
