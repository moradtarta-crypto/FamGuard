import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataError, createConversation, loadLatestLocations, loadMessages } from '../client/lib/data.js';
import { SOS_POSITION_BUDGET_MS, withDeadline } from '../client/lib/geolocation.js';

type Terminal = { data: unknown; error: unknown };
type Calls = Array<[string, unknown]>;

/**
 * Minimal stand-in for the Supabase query builder. It records the chained calls and
 * lets each test decide what the database would return, so the *shape* of the query
 * the app sends can be asserted without touching a real database.
 */
function makeClient(handlers: Record<string, (calls: Calls, op: string) => Terminal>) {
  const log: Array<{ table: string; op: string; calls: Calls }> = [];

  const client = {
    from(table: string) {
      const calls: Calls = [];
      const entry = { table, op: 'select', calls };
      log.push(entry);

      const respond = (): Terminal =>
        handlers[table] ? handlers[table](calls, entry.op) : { data: null, error: null };

      const builder: Record<string, unknown> = {};

      builder.select = () => builder;
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
      builder.order = (column: string, options: unknown) => {
        calls.push(['order', [column, options]]);
        return builder;
      };
      builder.limit = (count: number) => {
        calls.push(['limit', count]);
        return builder;
      };
      builder.maybeSingle = async () => respond();
      builder.single = async () => respond();
      builder.then = (
        resolve: (value: Terminal) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(respond()).then(resolve, reject);

      return builder;
    },
  };

  return { client: client as never, log };
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

  const rows = await loadLatestLocations(client, 'fam-1');

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

/* ------------------------------------------------------------------- H-4 */

test('H-4 concurrent conversation creation converges on one canonical conversation', async () => {
  const created: Array<{ id: string; family_id: string; created_at: string }> = [];

  const { client } = makeClient({
    conversations: (calls, op) => {
      if (op === 'insert') {
        const index = created.length;
        created.push({
          id: `conv-${index + 1}`,
          family_id: 'fam-1',
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        });
        return { data: null, error: null };
      }
      const oldest = [...created].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return { data: oldest ?? null, error: null };
    },
  });

  const [first, second] = await Promise.all([
    createConversation(client, 'fam-1'),
    createConversation(client, 'fam-1'),
  ]);

  assert.equal(first.id, 'conv-1');
  assert.equal(second.id, 'conv-1');
  assert.equal(first.id, second.id);
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
