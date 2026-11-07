import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DataError,
  acknowledgeSos,
  createConversation,
  loadConversation,
  loadInvites,
  loadLatestLocations,
  loadMessages,
  loadSubscription,
  markConversationRead,
  shareLocation,
} from '../client/lib/data.js';
import { SOS_POSITION_BUDGET_MS, withDeadline } from '../client/lib/geolocation.js';
import { loadShared, resetSharedCache } from '../client/lib/resourceCache.js';
import { SOS_WITHOUT_LOCATION_WARNING, sendSosAlert, submitSos } from '../client/lib/sos.js';

type Terminal = { data: unknown; error: unknown };
type Calls = Array<[string, unknown]>;

/**
 * Minimal stand-in for the Supabase query builder. It records the chained calls and
 * lets each test decide what the database would return, so the *shape* of the query
 * the app sends can be asserted without touching a real database.
 */
function makeClient(
  handlers: Record<string, (calls: Calls, op: string) => Terminal>,
  rpcHandlers: Record<string, (params: Record<string, unknown>) => Terminal> = {},
) {
  const log: Array<{ table: string; op: string; calls: Calls }> = [];
  const rpcLog: Array<{ name: string; params: Record<string, unknown> }> = [];

  const client = {
    from(table: string) {
      const calls: Calls = [];
      const entry = { table, op: 'select', calls };
      log.push(entry);

      const respond = (): Terminal =>
        handlers[table] ? handlers[table](calls, entry.op) : { data: null, error: null };

      const builder: Record<string, unknown> = {};

      builder.select = (columns?: string) => {
        calls.push(['select', columns ?? null]);
        return builder;
      };
      builder.insert = (values: unknown) => {
        entry.op = 'insert';
        calls.push(['insert', values]);
        return builder;
      };
      builder.update = (values: unknown) => {
        entry.op = 'update';
        calls.push(['update', values]);
        return builder;
      };
      builder.eq = (column: string, value: unknown) => {
        calls.push(['eq', [column, value]]);
        return builder;
      };
      builder.neq = (column: string, value: unknown) => {
        calls.push(['neq', [column, value]]);
        return builder;
      };
      builder.is = (column: string, value: unknown) => {
        calls.push(['is', [column, value]]);
        return builder;
      };
      builder.order = (column: string, options: unknown) => {
        calls.push(['order', [column, options]]);
        return builder;
      };
      builder.limit = (count: number) => {
        calls.push(['limit', count]);
        return builder;
      };
      builder.maybeSingle = async () => {
        calls.push(['maybeSingle', true]);
        return respond();
      };
      builder.single = async () => {
        calls.push(['single', true]);
        return respond();
      };
      builder.then = (
        resolve: (value: Terminal) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(respond()).then(resolve, reject);

      return builder;
    },

    /**
     * An unregistered RPC answers the way PostgREST does before the security migration is
     * applied, so a test never has to opt in to the "not migrated yet" behaviour.
     */
    rpc(name: string, params: Record<string, unknown> = {}) {
      rpcLog.push({ name, params });
      const handler = rpcHandlers[name];
      if (handler) return Promise.resolve(handler(params));
      return Promise.resolve({
        data: null,
        error: {
          code: 'PGRST202',
          message: `Could not find the function public.${name} in the schema cache`,
        },
      });
    },
  };

  return { client: client as never, log, rpcLog };
}

function recorded(calls: Calls, name: string): unknown {
  const entry = calls.find(([key]) => key === name);
  return entry ? entry[1] : undefined;
}

function eqValue(calls: Calls, column: string): unknown {
  const pair = calls.find(
    ([name, value]) => name === 'eq' && Array.isArray(value) && value[0] === column,
  );
  return pair ? (pair[1] as [string, unknown])[1] : undefined;
}

/** The value of a `neq(column, value)` filter. */
function neqValue(calls: Calls, column: string): unknown {
  const pair = calls.find(
    ([name, value]) => name === 'neq' && Array.isArray(value) && value[0] === column,
  );
  return pair ? (pair[1] as [string, unknown])[1] : undefined;
}

/** Every `order(...)` the query sent, in the order it was applied. */
function orders(calls: Calls): Array<[string, { ascending?: boolean }]> {
  return calls
    .filter(([name]) => name === 'order')
    .map(([, value]) => value as [string, { ascending?: boolean }]);
}

/* ------------------------------------------------------------------- H-1 */

function messageFixture(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${String(index + 1).padStart(3, '0')}`,
    conversation_id: 'conv-1',
    sender_user_id: 'user-parent',
    kind: 'text',
    body: `message ${index + 1}`,
    media_object_path: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    read_at: null,
  }));
}

test('H-1 loadMessages returns the newest window, in chronological order', async () => {
  const rows = messageFixture(250);

  const { client, log } = makeClient({
    messages: (calls) => {
      const order = recorded(calls, 'order') as [string, { ascending?: boolean }] | undefined;
      const ascending = Boolean(order?.[1]?.ascending);
      const limit = (recorded(calls, 'limit') as number | undefined) ?? rows.length;

      const sorted = [...rows].sort((a, b) =>
        ascending ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
      );
      return { data: sorted.slice(0, limit), error: null };
    },
  });

  const result = await loadMessages(client, 'conv-1');

  // The window must be the newest 200 rows, not the oldest 200.
  assert.equal(result.length, 200);
  assert.equal(result[result.length - 1]?.id, 'm-250');
  assert.equal(result[0]?.id, 'm-051');

  // ...but the caller still receives chronological order for rendering.
  const ids = result.map((row) => row.id);
  assert.deepEqual(ids, [...ids].sort());

  // The query itself must ask for descending order.
  const order = recorded(log[0]?.calls ?? [], 'order') as [string, { ascending: boolean }];
  assert.equal(order[0], 'created_at');
  assert.equal(order[1].ascending, false);

  // M-2: a second key on id makes ties deterministic, so neither the window boundary nor
  // the rendered order can change between two identical polls.
  assert.deepEqual(orders(log[0]?.calls ?? []), [
    ['created_at', { ascending: false }],
    ['id', { ascending: false }],
  ]);
});

/* ------------------------------------------------------------------- H-3 */

function locationFixture(overrides: Record<string, unknown>) {
  return {
    id: 'loc',
    family_id: 'fam-1',
    child_user_id: 'child',
    latitude: 1,
    longitude: 2,
    accuracy_m: 5,
    battery_percent: 50,
    recorded_at: '2026-01-01T00:00:00.000Z',
    received_at: null,
    ...overrides,
  };
}

test('H-3 a quiet child stays visible next to a child who shares constantly', async () => {
  const noisy = Array.from({ length: 200 }, (_, index) =>
    locationFixture({
      id: `loc-noisy-${index}`,
      child_user_id: 'child-noisy',
      recorded_at: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(),
    }),
  );
  // Older than every row the noisy child produced, so a family-wide window drops it.
  const quiet = locationFixture({
    id: 'loc-quiet-0',
    child_user_id: 'child-quiet',
    recorded_at: '2026-01-01T00:00:00.000Z',
  });

  const { client, log } = makeClient({
    family_members: () => ({
      data: [{ user_id: 'child-noisy' }, { user_id: 'child-quiet' }],
      error: null,
    }),
    location_updates: (calls) => {
      const child = eqValue(calls, 'child_user_id');
      if (child === 'child-noisy') {
        const newest = [...noisy].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
        return { data: newest, error: null };
      }
      if (child === 'child-quiet') return { data: quiet, error: null };
      return { data: null, error: null };
    },
  });

  const latest = await loadLatestLocations(client, 'fam-1');
  const rows = latest.rows;

  // The member list was readable here, so an empty result would have been trustworthy;
  // that is exactly what `verified` records.
  assert.equal(latest.membership, 'verified');
  assert.deepEqual(
    rows.map((row) => row.child_user_id).sort(),
    ['child-noisy', 'child-quiet'],
  );
  assert.equal(rows.find((row) => row.child_user_id === 'child-quiet')?.id, 'loc-quiet-0');

  // One bounded query per member, each limited to a single row.
  const locationQueries = log.filter((entry) => entry.table === 'location_updates');
  assert.equal(locationQueries.length, 2);
  for (const entry of locationQueries) {
    assert.equal(recorded(entry.calls, 'limit'), 1);
  }
});

test('H-3 a refused member read is reported, not turned into "no locations"', async () => {
  const { client } = makeClient({
    family_members: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table family_members' },
    }),
  });

  await assert.rejects(
    () => loadLatestLocations(client, 'fam-1'),
    (error: unknown) =>
      error instanceof DataError && error.code === '42501' && error.blockedByPolicy === true,
  );
});

test('H-3 a refused location read is reported instead of silently dropped', async () => {
  const { client } = makeClient({
    family_members: () => ({ data: [{ user_id: 'child-a' }], error: null }),
    location_updates: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table location_updates' },
    }),
  });

  await assert.rejects(
    () => loadLatestLocations(client, 'fam-1'),
    (error: unknown) => error instanceof DataError && error.code === '42501',
  );
});


test('child location history is marked restricted without querying parent-only rows', async () => {
  const { client, log } = makeClient({
    family_members: () => ({ data: [{ user_id: 'child-1' }], error: null }),
    location_updates: () => {
      throw new Error('child must not query parent-only location history');
    },
  });

  const latest = await loadLatestLocations(client, 'fam-1', 'child');

  assert.deepEqual(latest.rows, []);
  assert.equal(latest.membership, 'restricted');
  assert.equal(log.length, 0, 'a child must not query parent-only location history or the roster');
});

/* ------------------------------------------------------------------- H-4 */

test('H-4 concurrent conversation creation converges on one canonical conversation', async () => {
  const created: Array<{ id: string; family_id: string; created_at: string }> = [];

  const { client, log, rpcLog } = makeClient(
    {
      conversations: () => {
        const oldest = [...created].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
        return { data: oldest ?? null, error: null };
      },
    },
    {
      // The function locks the family row and creates at most one conversation, so both
      // callers receive the same id even though both passed the "no conversation" check.
      ensure_family_conversation: () => {
        if (created.length === 0) {
          created.push({ id: 'conv-1', family_id: 'fam-1', created_at: '2026-01-01T00:00:00.000Z' });
        }
        return { data: 'conv-1', error: null };
      },
    },
  );

  const [first, second] = await Promise.all([
    createConversation(client, 'fam-1'),
    createConversation(client, 'fam-1'),
  ]);

  assert.equal(first.id, 'conv-1');
  assert.equal(second.id, 'conv-1');
  assert.equal(first.id, second.id);

  // The family id is the only thing the client supplies: the row identity and the
  // duplicate check stay inside the database.
  assert.deepEqual(
    rpcLog.map((entry) => entry.name),
    ['ensure_family_conversation', 'ensure_family_conversation'],
  );
  assert.deepEqual(rpcLog[0]?.params, { target_family: 'fam-1' });

  // F1: no direct INSERT is attempted once the function is available, because
  // `conversations` has no INSERT policy.
  assert.equal(
    log.filter((entry) => entry.table === 'conversations' && entry.op === 'insert').length,
    0,
  );
});

/* ------------------------------------------------------------------- F1 */

test('F1 an unmigrated database explains the missing conversation function without direct INSERT', async () => {
  const { client, log, rpcLog } = makeClient({
    conversations: () => ({ data: null, error: null }),
  });

  await assert.rejects(
    () => createConversation(client, 'fam-1'),
    (error: unknown) =>
      error instanceof DataError &&
      /required database function is not installed/i.test(error.message) &&
      /20261107_0001_security_repair\.sql/.test(error.message),
  );

  assert.deepEqual(rpcLog.map((entry) => entry.name), ['ensure_family_conversation']);
  assert.equal(
    log.filter((entry) => entry.table === 'conversations' && entry.op === 'insert').length,
    0,
    'the client must not attempt an INSERT that RLS is designed to reject',
  );
});
test('F1 a non-missing RPC failure is reported as itself, not as a migration hint', async () => {
  const { client } = makeClient(
    { conversations: () => ({ data: null, error: null }) },
    {
      ensure_family_conversation: () => ({
        data: null,
        error: { code: '42501', message: 'permission denied for function ensure_family_conversation' },
      }),
    },
  );

  await assert.rejects(
    () => createConversation(client, 'fam-1'),
    (error: unknown) => error instanceof DataError && error.code === '42501',
  );
});

/* ------------------------------------------------------------------- H-2 */

test('H-2 withDeadline bounds a hanging lookup and passes a fast one through', async () => {
  const started = Date.now();
  await assert.rejects(
    () => withDeadline(new Promise<never>(() => {}), 60, 'location too slow'),
    /location too slow/,
  );
  assert.ok(Date.now() - started < 2000, 'the deadline must fire near its budget');

  const value = await withDeadline(Promise.resolve('position'), 60);
  assert.equal(value, 'position');
});

test('H-2 the SOS position budget stays at roughly three seconds', () => {
  assert.equal(SOS_POSITION_BUDGET_MS, 3000);
});

/* ----------------------------------------------------------------- H-3-a */

test('H-3-a an empty member list is unverified, never a confirmed "no updates"', async () => {
  const { client, log } = makeClient({
    // Row-level policies filter rows instead of raising, so an empty list is a legitimate
    // result and says nothing on its own about why it is empty.
    family_members: () => ({ data: [], error: null }),
  });

  const latest = await loadLatestLocations(client, 'fam-1');

  assert.deepEqual(latest.rows, []);
  assert.equal(latest.membership, 'unverified');
  // Nothing may be claimed about sharing without the member list, so no location query runs.
  assert.equal(log.length, 1);
});

/* ------------------------------------------------------------------- M-1 */

test('M-1 screens loading the same key share one request', async () => {
  resetSharedCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };

  const [first, second] = await Promise.all([
    loadShared('locations:fam-1', loader, 5000),
    loadShared('locations:fam-1', loader, 5000),
  ]);

  assert.equal(calls, 1, 'concurrent loads must join one in-flight request');
  assert.equal(first.ok && first.data, 1);
  assert.equal(second.ok && second.data, 1);

  // A later load inside the window reuses the rows and keeps their original fetch time,
  // so the UI cannot label them as fresher than they are.
  const third = await loadShared('locations:fam-1', loader, 5000);
  assert.equal(calls, 1);
  assert.equal(third.ok && third.updatedAt, first.ok && first.updatedAt);
});

test('M-1 a forced load bypasses sharing and a failure is never shared', async () => {
  resetSharedCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    return calls;
  };

  await loadShared('locations:fam-1', loader, 60000);
  // maxAge 0 is what refresh() uses, so a manual retry must always reach the database.
  await loadShared('locations:fam-1', loader, 0);
  assert.equal(calls, 2);

  resetSharedCache();
  let attempts = 0;
  const failing = async () => {
    attempts += 1;
    throw new Error('permission denied for table location_updates');
  };

  const failure = await loadShared('locations:fam-1', failing, 60000);
  assert.equal(failure.ok, false);
  assert.match(failure.ok ? '' : failure.error, /permission denied/);

  // Caching the error would keep replaying it and hide the retry, so it must not be kept.
  const retry = await loadShared('locations:fam-1', failing, 60000);
  assert.equal(attempts, 2);
  assert.equal(retry.ok, false);
});

test('M-1-2 an old in-flight request cannot remove a new session request after cache reset', async () => {
  resetSharedCache();
  let resolveOld!: (value: string) => void;
  const oldRequest = loadShared(
    'family-data',
    () => new Promise<string>((resolve) => { resolveOld = resolve; }),
    5000,
  );

  // Let the old request register itself before simulating an account/session change.
  await Promise.resolve();
  resetSharedCache();

  let resolveNew!: (value: string) => void;
  let unexpectedLoads = 0;
  const newRequest = loadShared(
    'family-data',
    () => new Promise<string>((resolve) => { resolveNew = resolve; }),
    5000,
  );
  await Promise.resolve();

  // The old request settles after the new one has claimed the same key.
  resolveOld('old account');
  const oldResult = await oldRequest;
  assert.equal(oldResult.ok && oldResult.data, 'old account');

  // A third caller must still join the new request, not start another database read.
  const joinedRequest = loadShared(
    'family-data',
    async () => {
      unexpectedLoads += 1;
      return 'unexpected duplicate';
    },
    5000,
  );
  assert.equal(unexpectedLoads, 0);

  resolveNew('new account');
  const [newResult, joinedResult] = await Promise.all([newRequest, joinedRequest]);
  assert.equal(newResult.ok && newResult.data, 'new account');
  assert.equal(joinedResult.ok && joinedResult.data, 'new account');
  assert.equal(unexpectedLoads, 0);
});

/* ------------------------------------------------------------------- M-2 */

test('M-2 loadMessages breaks a created_at tie by id, so the order is stable', async () => {
  const shared = '2026-01-01T00:00:00.000Z';
  const tied = [
    {
      id: 'm-b',
      conversation_id: 'conv-1',
      sender_user_id: 'user-parent',
      kind: 'text',
      body: 'b',
      media_object_path: null,
      created_at: shared,
      read_at: null,
    },
    {
      id: 'm-a',
      conversation_id: 'conv-1',
      sender_user_id: 'user-parent',
      kind: 'text',
      body: 'a',
      media_object_path: null,
      created_at: shared,
      read_at: null,
    },
  ];

  const { client, log } = makeClient({ messages: () => ({ data: tied, error: null }) });

  const result = await loadMessages(client, 'conv-1');

  assert.deepEqual(orders(log[0]?.calls ?? []), [
    ['created_at', { ascending: false }],
    ['id', { ascending: false }],
  ]);
  // The query asks for id DESC, so the reversal used for rendering yields id ASC.
  assert.deepEqual(
    result.map((row) => row.id),
    ['m-a', 'm-b'],
  );
});

/* ------------------------------------------------------------------- M-3 */

test('M-3 the canonical conversation is selected deterministically', async () => {
  const shared = '2026-01-01T00:00:00.000Z';
  const oldest = { id: 'conv-a', family_id: 'fam-1', created_at: shared };

  const { client, log } = makeClient({ conversations: () => ({ data: oldest, error: null }) });

  const conversation = await loadConversation(client, 'fam-1');

  assert.equal(conversation?.id, 'conv-a');
  assert.deepEqual(orders(log[0]?.calls ?? []), [
    ['created_at', { ascending: true }],
    ['id', { ascending: true }],
  ]);
});

/* ------------------------------------------------------------------- L-5 */

test('L-5 a recorded_at tie still yields one stable latest location per member', async () => {
  const tied = [
    locationFixture({ id: 'loc-2', child_user_id: 'child', recorded_at: '2026-01-01T00:00:00.000Z' }),
    locationFixture({ id: 'loc-1', child_user_id: 'child', recorded_at: '2026-01-01T00:00:00.000Z' }),
  ];

  const { client, log } = makeClient({
    family_members: () => ({ data: [{ user_id: 'child' }], error: null }),
    location_updates: () => ({ data: tied[0], error: null }),
  });

  const latest = await loadLatestLocations(client, 'fam-1');

  // log[0] is the member read; log[1] is the per-member location read.
  assert.deepEqual(orders(log[1]?.calls ?? []), [
    ['recorded_at', { ascending: false }],
    ['id', { ascending: false }],
  ]);
  assert.equal(latest.rows[0]?.id, 'loc-2');
});

/* ------------------------------------------------------------------- M-4 */

test('M-4 an SOS is recorded without coordinates when the position lookup fails', async () => {
  let inserted: Record<string, unknown> | null = null;

  const { client } = makeClient({
    sos_events: (calls) => {
      inserted = (recorded(calls, 'insert') as Record<string, unknown>) ?? null;
      return { data: { id: 'sos-1' }, error: null };
    },
  });

  const submission = await submitSos(
    client,
    { familyId: 'fam-1', childUserId: 'child-1', note: 'help' },
    // What a denied permission or a missing sensor produces.
    async () => {
      throw Object.assign(new Error('User denied Geolocation'), { code: 1 });
    },
  );

  assert.equal(submission.coordinates, null);
  // No row is read back (the child cannot SELECT sos_events), so the confirmation describes
  // what was written rather than quoting an id the writer is not allowed to see.
  assert.equal(submission.event.familyId, 'fam-1');
  assert.equal(submission.event.childUserId, 'child-1');
  assert.equal(submission.event.hasCoordinates, false);
  assert.equal(inserted?.latitude, null);
  assert.equal(inserted?.longitude, null);
  assert.equal(inserted?.note, 'help');
  assert.equal(inserted?.child_user_id, 'child-1');
  assert.equal(inserted?.family_id, 'fam-1');
});

test('M-4 an SOS keeps the coordinates when the position lookup succeeds', async () => {
  let inserted: Record<string, unknown> | null = null;

  const { client } = makeClient({
    sos_events: (calls) => {
      inserted = (recorded(calls, 'insert') as Record<string, unknown>) ?? null;
      return { data: { id: 'sos-2' }, error: null };
    },
  });

  const submission = await submitSos(
    client,
    { familyId: 'fam-1', childUserId: 'child-1', note: null },
    async () => ({ latitude: 12.5, longitude: -7.25, accuracy: 8 }),
  );

  assert.equal(submission.coordinates?.latitude, 12.5);
  assert.equal(inserted?.latitude, 12.5);
  assert.equal(inserted?.longitude, -7.25);
  assert.equal(inserted?.note, null);
});

test('M-4 a database failure is still reported instead of being swallowed', async () => {
  const { client } = makeClient({
    sos_events: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table sos_events' },
    }),
  });

  await assert.rejects(
    () =>
      submitSos(client, { familyId: 'fam-1', childUserId: 'child-1', note: null }, async () => ({
        latitude: 1,
        longitude: 2,
        accuracy: 3,
      })),
    (error: unknown) => error instanceof DataError && error.code === '42501',
  );
});

/* ------------------------------------------------------------------- L-7 */

/**
 * `sendSosAlert` is the function `SosPanel`'s submit handler calls, so running it with no
 * injected `submit` exercises the real `submitSos` -> `raiseSos` path the button uses.
 */
test('L-7 the panel handler stores the SOS through submitSos and warns when there is no position', async () => {
  let inserted: Record<string, unknown> | null = null;

  const { client } = makeClient({
    sos_events: (calls) => {
      inserted = (recorded(calls, 'insert') as Record<string, unknown>) ?? null;
      return { data: { id: 'sos-panel-1' }, error: null };
    },
  });

  // Nothing is injected here: this is the default production path, and Node exposes no
  // Geolocation API, so the lookup fails exactly like a denied permission would.
  const outcome = await sendSosAlert(client, {
    familyId: 'fam-1',
    childUserId: 'child-1',
    note: 'help',
  });

  if (!outcome.ok) throw new Error(`expected a stored alert, got: ${outcome.error}`);

  // The row really reached the database through submitSos — not skipped and not simulated.
  assert.equal(inserted?.family_id, 'fam-1');
  assert.equal(inserted?.child_user_id, 'child-1');
  assert.equal(inserted?.note, 'help');
  assert.equal(inserted?.latitude, null);
  assert.equal(inserted?.longitude, null);
  // The stored alert is confirmed by what was written, not by reading the row back: the
  // child has no SELECT policy on sos_events.
  assert.equal(outcome.submission.event.familyId, 'fam-1');
  assert.equal(outcome.submission.event.childUserId, 'child-1');
  assert.equal(outcome.submission.event.hasCoordinates, false);

  // A stored alert is a success, and the missing position is surfaced as a warning.
  assert.equal(outcome.warning, SOS_WITHOUT_LOCATION_WARNING);
  assert.match(outcome.warning ?? '', /location could not be read/i);
});

test('L-7 the panel handler reports success without a warning when coordinates are available', async () => {
  let inserted: Record<string, unknown> | null = null;

  const { client } = makeClient({
    sos_events: (calls) => {
      inserted = (recorded(calls, 'insert') as Record<string, unknown>) ?? null;
      return { data: { id: 'sos-panel-2' }, error: null };
    },
  });

  const outcome = await sendSosAlert(
    client,
    { familyId: 'fam-1', childUserId: 'child-1', note: null },
    // Only the position lookup is replaced; the row is still written by the real submitSos.
    (inner, request) =>
      submitSos(inner, request, async () => ({ latitude: 12.5, longitude: -7.25, accuracy: 8 })),
  );

  if (!outcome.ok) throw new Error(`expected a stored alert, got: ${outcome.error}`);

  assert.equal(outcome.warning, null);
  assert.equal(outcome.submission.coordinates?.latitude, 12.5);
  assert.equal(inserted?.latitude, 12.5);
  assert.equal(inserted?.longitude, -7.25);
});

test('L-7 a refused database write is reported as an error, never as a warning', async () => {
  const { client } = makeClient({
    sos_events: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table sos_events' },
    }),
  });

  const outcome = await sendSosAlert(client, {
    familyId: 'fam-1',
    childUserId: 'child-1',
    note: null,
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error('a refused write must not be reported as a stored alert');
  // The panel renders this text under "SOS not sent", so the database reason must survive.
  assert.match(outcome.error, /refused by your Supabase row level security policies/i);
  assert.match(outcome.error, /permission denied for table sos_events/i);
});

/* ------------------------------------------------------------------- F2 */

test('F2 marking messages read writes read_at and nothing else', async () => {
  const { client, log } = makeClient({ messages: () => ({ data: null, error: null }) });

  await markConversationRead(client, 'conv-1', 'user-me');

  const payload = recorded(log[0]?.calls ?? [], 'update') as Record<string, unknown>;
  // The column grant on `messages` allows UPDATE (read_at) only, so the payload must not
  // carry body, sender_user_id, kind, conversation_id or created_at.
  assert.deepEqual(Object.keys(payload), ['read_at']);
  assert.equal(typeof payload.read_at, 'string');
  assert.equal(eqValue(log[0]?.calls ?? [], 'conversation_id'), 'conv-1');
  // Only messages the caller did not send are touched, matching the policy's USING clause.
  assert.equal(neqValue(log[0]?.calls ?? [], 'sender_user_id'), 'user-me');
});

/* ------------------------------------------------------------------- F3 */

const locationInput = {
  familyId: 'fam-1',
  childUserId: 'child-1',
  latitude: 12.5,
  longitude: -7.25,
  accuracyM: 8,
  batteryPercent: 64,
};

/**
 * Reproduces the audited defect: the write is accepted, but any read of the stored row is
 * filtered by RLS, so `INSERT … RETURNING` yields no rows and PostgREST answers PGRST116.
 */
function insertRefusedOnReadBack(calls: Calls): Terminal {
  if (recorded(calls, 'single') || recorded(calls, 'maybeSingle')) {
    return {
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    };
  }
  return { data: null, error: null };
}

test('F3 a shared location is reported as saved although the row cannot be read back', async () => {
  const { client, log } = makeClient({ location_updates: (calls) => insertRefusedOnReadBack(calls) });

  const saved = await shareLocation(client, locationInput);

  assert.equal(saved.familyId, 'fam-1');
  assert.equal(saved.childUserId, 'child-1');
  assert.equal(typeof saved.recordedAt, 'string');

  // The insert must be bare: asking for the row back is what produced the false failure.
  const calls = log[0]?.calls ?? [];
  assert.equal(recorded(calls, 'select'), undefined);
  assert.equal(recorded(calls, 'single'), undefined);
  const inserted = recorded(calls, 'insert') as Record<string, unknown>;
  assert.equal(inserted.child_user_id, 'child-1');
  assert.equal(inserted.latitude, 12.5);
});

test('F3 a refused location write is still an error, not a success', async () => {
  const { client } = makeClient({
    location_updates: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table location_updates' },
    }),
  });

  await assert.rejects(
    () => shareLocation(client, locationInput),
    (error: unknown) => error instanceof DataError && error.code === '42501',
  );
});

test('F3 an SOS is confirmed from what was written, never from a read-back', async () => {
  const { client, log } = makeClient({ sos_events: (calls) => insertRefusedOnReadBack(calls) });

  const submission = await submitSos(
    client,
    { familyId: 'fam-1', childUserId: 'child-1', note: 'help' },
    async () => ({ latitude: 12.5, longitude: -7.25, accuracy: 8 }),
  );

  assert.equal(submission.event.hasCoordinates, true);
  assert.equal(submission.event.familyId, 'fam-1');

  const calls = log[0]?.calls ?? [];
  assert.equal(recorded(calls, 'select'), undefined);
  assert.equal(recorded(calls, 'single'), undefined);
});

/* ------------------------------------------------------------------- F4 */

test('F4 acknowledging an SOS writes only the acknowledgement columns', async () => {
  const { client, log } = makeClient({
    sos_events: () => ({
      data: {
        id: 'sos-1',
        family_id: 'fam-1',
        child_user_id: 'child-1',
        latitude: 1,
        longitude: 2,
        note: null,
        created_at: '2026-01-01T00:00:00.000Z',
        acknowledged_at: '2026-01-01T00:05:00.000Z',
        acknowledged_by: 'parent-1',
      },
      error: null,
    }),
  });

  const acknowledged = await acknowledgeSos(client, 'sos-1', 'parent-1');

  const payload = recorded(log[0]?.calls ?? [], 'update') as Record<string, unknown>;
  // The column grant allows UPDATE (acknowledged_at, acknowledged_by) only: the child's
  // identity, coordinates and note must not be writable by the acknowledging parent.
  assert.deepEqual(Object.keys(payload).sort(), ['acknowledged_at', 'acknowledged_by']);
  assert.equal(payload.acknowledged_by, 'parent-1');
  assert.equal(acknowledged.id, 'sos-1');
});

test('F4 a second acknowledgement attempt surfaces the database refusal', async () => {
  const { client } = makeClient({
    sos_events: () => ({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    }),
  });

  // The policy's USING clause only matches rows with acknowledged_at IS NULL, so an already
  // acknowledged alert matches nothing and must not be reported as acknowledged.
  await assert.rejects(() => acknowledgeSos(client, 'sos-1', 'parent-2'));
});

/* ------------------------------------------------------------------- F5 */

test('F5 an empty invite list is unverified rather than "no invites yet"', async () => {
  const { client } = makeClient({ family_invites: () => ({ data: [], error: null }) });

  const invites = await loadInvites(client, 'fam-1');

  assert.deepEqual(invites.rows, []);
  // RLS filters silently, so an empty list proves nothing about why it is empty.
  assert.equal(invites.visibility, 'unverified');
});

test('F5 readable invite history is reported as readable', async () => {
  const row = {
    id: 'inv-1',
    family_id: 'fam-1',
    created_by: 'parent-1',
    expires_at: '2026-02-01T00:00:00.000Z',
    consumed_by: null,
    consumed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const { client, log } = makeClient({ family_invites: () => ({ data: [row], error: null }) });

  const invites = await loadInvites(client, 'fam-1');

  assert.equal(invites.visibility, 'readable');
  assert.equal(invites.rows[0]?.id, 'inv-1');

  // The invite token is returned once by create_family_invite and only its hash is stored;
  // no screen may request that hash.
  const columns = String(recorded(log[0]?.calls ?? [], 'select') ?? '');
  assert.ok(!columns.includes('token_hash'), 'token_hash must never be selected');
});

test('F5 a refused invite read is reported instead of shown as an empty history', async () => {
  const { client } = makeClient({
    family_invites: () => ({
      data: null,
      error: { code: '42501', message: 'permission denied for table family_invites' },
    }),
  });

  await assert.rejects(
    () => loadInvites(client, 'fam-1'),
    (error: unknown) => error instanceof DataError && error.code === '42501',
  );
});

/* ------------------------------------------------------------------- F7 */

test('F7 the family subscription read never selects payment identifiers', async () => {
  const { client, log } = makeClient({ subscriptions: () => ({ data: null, error: null }) });

  await loadSubscription(client, 'fam-1');

  const columns = String(recorded(log[0]?.calls ?? [], 'select') ?? '');
  // Every family member may read the subscription row, so the payment columns stay out of
  // the projection: they are granted to the paying parent only.
  assert.ok(!columns.includes('payment_network'), 'payment_network must not be selected');
  assert.ok(!columns.includes('transaction_id'), 'transaction_id must not be selected');
  assert.ok(columns.includes('status') && columns.includes('plan_code'));
});
