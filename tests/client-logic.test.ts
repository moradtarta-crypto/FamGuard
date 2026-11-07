import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDbError, errorCode } from '../client/lib/errors.js';
import {
  distanceMeters,
  formatBattery,
  formatDistance,
  formatCoordinates,
  initials,
} from '../client/lib/format.js';
import {
  isAccountRole,
  isMessageKind,
  isSubscriptionStatus,
  isZoneKind,
  COLUMNS,
} from '../client/lib/schema.js';
import { roleForFamily, resolveDisplayName } from '../client/lib/account.js';
import { roleLabel, ROLE_LABEL } from '../client/lib/roles.js';

test('enum guards accept only the verified database labels', () => {
  assert.equal(isAccountRole('parent'), true);
  assert.equal(isAccountRole('child'), true);
  assert.equal(isAccountRole('guardian'), false);
  assert.equal(isAccountRole(null), false);

  assert.equal(isZoneKind('safe'), true);
  assert.equal(isZoneKind('danger'), true);
  assert.equal(isZoneKind('warning'), false);

  assert.equal(isMessageKind('text'), true);
  assert.equal(isMessageKind('video'), false);

  assert.equal(isSubscriptionStatus('cancelled'), true);
  assert.equal(isSubscriptionStatus('trial'), false);
});

test('column maps match the verified schema and never include unknown fields', () => {
  assert.equal(
    COLUMNS.profile,
    'user_id, display_name, preferred_language, created_at, updated_at',
  );
  assert.equal(COLUMNS.familyMember, 'family_id, user_id, role, linked_at');
  assert.equal(COLUMNS.family, 'id, name, created_by, created_at');
  // profiles has no role column: role comes from family_members only.
  assert.equal(COLUMNS.profile.includes('role'), false);
  assert.equal(COLUMNS.message.includes('kind'), true);
  // The invite hash is never requested by the client.
  assert.equal(COLUMNS.familyInvite.includes('token_hash'), false);
  assert.equal(COLUMNS.sosEvent.includes('acknowledged_by'), true);
});

test('RLS and privilege errors are reported as blocked by policy', () => {
  const rls = describeDbError(
    {
      code: '42501',
      message: 'permission denied for table sos_events',
      hint: 'Grant the required privileges to the current role',
    },
    'Loading SOS alerts',
  );
  assert.equal(rls.blockedByPolicy, true);
  assert.equal(rls.code, '42501');
  assert.match(rls.message, /Loading SOS alerts/);
  assert.match(rls.message, /refused by your Supabase row level security policies/);
  // The raw Postgres text is kept for diagnostics, and no RLS change is offered.
  assert.match(rls.message, /permission denied for table sos_events/);
  assert.match(rls.message, /does not change your database/);
  assert.doesNotMatch(rls.message, /service_role/i);

  const filtered = describeDbError({ code: 'PGRST301', message: 'JWT expired' }, 'Loading');
  assert.equal(filtered.blockedByPolicy, false);
  assert.match(filtered.message, /session is no longer valid/);

  const missing = describeDbError({ code: '42P01', message: 'relation does not exist' }, 'Loading');
  assert.equal(missing.blockedByPolicy, false);
  assert.match(missing.message, /missing from the public schema/i);
});

test('describeDbError never leaks a service-role hint or invents a success', () => {
  const described = describeDbError(null, 'Loading members');
  assert.equal(described.blockedByPolicy, false);
  assert.equal(described.code, null);

  const unknown = describeDbError({ code: 'XX000', message: 'boom' }, 'Saving profile');
  assert.match(unknown.message, /Saving profile/);
  assert.match(unknown.message, /boom/);
});

test('errorCode reads a code from unknown throwables only', () => {
  assert.equal(errorCode({ code: '42501' }), '42501');
  assert.equal(errorCode(new Error('plain')), null);
  assert.equal(errorCode(null), null);
});

test('distanceMeters is a real haversine over the given coordinates', () => {
  const berlin = { latitude: 52.52, longitude: 13.405 };
  const potsdam = { latitude: 52.3906, longitude: 13.0645 };
  const metres = distanceMeters(berlin, potsdam);
  assert.ok(metres > 27000 && metres < 30000, `unexpected distance ${metres}`);

  assert.equal(Math.round(distanceMeters(berlin, berlin)), 0);
  assert.match(formatDistance(metres), /km/);
  assert.match(formatDistance(120), /m/);
  assert.equal(formatDistance(null), '—');
});

test('format helpers render honest placeholders instead of fake values', () => {
  assert.equal(formatBattery(null), 'battery unknown');
  assert.equal(formatBattery(undefined), 'battery unknown');
  assert.equal(formatBattery(87), 'battery 87%');
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('   '), '?');
  assert.equal(formatCoordinates(52.52, 13.405), '52.52000, 13.40500');
});

test('roleForFamily resolves the role from the selected membership only', () => {
  const memberships = [
    { family_id: 'family-a', user_id: 'user-1', role: 'parent' as const, linked_at: null },
    { family_id: 'family-b', user_id: 'user-1', role: 'child' as const, linked_at: null },
  ];

  assert.equal(roleForFamily(memberships, 'family-a'), 'parent');
  assert.equal(roleForFamily(memberships, 'family-b'), 'child');
  assert.equal(roleForFamily(memberships, 'family-c'), null);
  assert.equal(roleForFamily([], 'family-a'), null);
});

test('role labels come from the account_role enum', () => {
  assert.equal(roleLabel('parent'), 'Parent');
  assert.equal(roleLabel('child'), 'Child');
  assert.equal(roleLabel(null), 'Role not assigned');
  assert.deepEqual(Object.keys(ROLE_LABEL).sort(), ['child', 'parent']);
});

test('display name falls back to the account email, never to demo data', () => {
  const user = { email: 'parent@example.com', user_metadata: {} } as never;
  assert.equal(resolveDisplayName(null, user), 'parent@example.com');
  assert.equal(
    resolveDisplayName({ display_name: 'Ada' } as never, user),
    'Ada',
  );
});
