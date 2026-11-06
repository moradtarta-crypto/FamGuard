import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { FamGuardStore } from '../server/store.js';

function freshApp(seed = false) {
  const store = new FamGuardStore({ file: null, seed });
  return { app: createApp(store), store };
}

describe('FamGuard API', () => {
  let app: ReturnType<typeof createApp>;
  let store: FamGuardStore;

  before(() => {
    const created = freshApp();
    app = created.app;
    store = created.store;
  });

  it('reports health', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.status, 'ok');
  });

  it('rejects a member without a name', async () => {
    const response = await request(app).post('/api/members').send({ role: 'child' }).expect(400);
    assert.match(response.body.error, /name/);
  });

  it('rejects an unsupported member role', async () => {
    const response = await request(app)
      .post('/api/members')
      .send({ name: 'Test Person', role: 'neighbour' })
      .expect(400);
    assert.match(response.body.error, /role/);
  });

  it('creates a member and lists it', async () => {
    const created = await request(app)
      .post('/api/members')
      .send({ name: 'Ava Stone', role: 'child' })
      .expect(201);

    assert.equal(created.body.member.name, 'Ava Stone');
    assert.equal(created.body.member.role, 'child');
    assert.equal(created.body.member.status, 'unknown');
    assert.equal(created.body.member.lastCheckIn, null);

    const list = await request(app).get('/api/members').expect(200);
    assert.equal(list.body.members.length, 1);
    assert.equal(list.body.members[0].openAlerts, 0);
  });

  it('records a check-in and marks the member safe', async () => {
    const member = store.listMembers()[0];
    assert.ok(member);

    const response = await request(app).patch(`/api/members/${member.id}/checkin`).expect(200);
    assert.equal(response.body.member.status, 'safe');
    assert.ok(response.body.member.lastCheckIn);
    assert.ok(!Number.isNaN(Date.parse(response.body.member.lastCheckIn)));

    const overview = await request(app).get('/api/overview').expect(200);
    assert.equal(overview.body.safeMembers, 1);
  });

  it('returns 404 when checking in an unknown member', async () => {
    await request(app).patch('/api/members/does-not-exist/checkin').expect(404);
  });

  it('rejects an alert for an unknown member', async () => {
    await request(app)
      .post('/api/alerts')
      .send({ memberId: 'nope', type: 'sos', message: 'Help' })
      .expect(404);
  });

  it('rejects an unsupported alert type', async () => {
    const member = store.listMembers()[0];
    assert.ok(member);
    const response = await request(app)
      .post('/api/alerts')
      .send({ memberId: member.id, type: 'fire', message: 'Smoke' })
      .expect(400);
    assert.match(response.body.error, /type/);
  });

  it('creates an SOS alert that raises the member to needs_attention', async () => {
    const member = store.listMembers()[0];
    assert.ok(member);

    const created = await request(app)
      .post('/api/alerts')
      .send({ memberId: member.id, type: 'sos', message: 'Feeling unsafe walking home.' })
      .expect(201);

    assert.equal(created.body.alert.status, 'open');
    assert.equal(created.body.alert.type, 'sos');

    const members = await request(app).get('/api/members').expect(200);
    assert.equal(members.body.members[0].status, 'needs_attention');
    assert.equal(members.body.members[0].openAlerts, 1);

    const overview = await request(app).get('/api/overview').expect(200);
    assert.equal(overview.body.openAlerts, 1);
    assert.equal(overview.body.needsAttention, 1);
    assert.equal(overview.body.safeMembers, 0);

    const open = await request(app).get('/api/alerts?status=open').expect(200);
    assert.equal(open.body.alerts.length, 1);
  });

  it('acknowledges the last open alert and restores the member to safe', async () => {
    const openAlert = store.listAlerts({ status: 'open' })[0];
    assert.ok(openAlert);

    const response = await request(app).patch(`/api/alerts/${openAlert.id}/acknowledge`).expect(200);
    assert.equal(response.body.alert.status, 'acknowledged');
    assert.ok(response.body.alert.acknowledgedAt);

    const member = store.getMember(openAlert.memberId);
    assert.equal(member?.status, 'safe');

    const overview = await request(app).get('/api/overview').expect(200);
    assert.equal(overview.body.openAlerts, 0);

    const open = await request(app).get('/api/alerts?status=open').expect(200);
    assert.equal(open.body.alerts.length, 0);
  });

  it('keeps a member in needs_attention while other alerts stay open', async () => {
    const member = store.listMembers()[0];
    assert.ok(member);

    const first = await request(app)
      .post('/api/alerts')
      .send({ memberId: member.id, type: 'geofence', message: 'Left the safe zone.' })
      .expect(201);
    await request(app)
      .post('/api/alerts')
      .send({ memberId: member.id, type: 'low_battery', message: 'Battery at 4%.' })
      .expect(201);

    await request(app).patch(`/api/alerts/${first.body.alert.id}/acknowledge`).expect(200);
    assert.equal(store.getMember(member.id)?.status, 'needs_attention');

    const remaining = store.listAlerts({ status: 'open' });
    for (const alert of remaining) {
      await request(app).patch(`/api/alerts/${alert.id}/acknowledge`).expect(200);
    }
    assert.equal(store.getMember(member.id)?.status, 'safe');
  });

  it('returns 404 for unknown alert acknowledgements and endpoints', async () => {
    await request(app).patch('/api/alerts/missing/acknowledge').expect(404);
    await request(app).get('/api/unknown-endpoint').expect(404);
  });

  it('supports explicit status updates', async () => {
    const member = store.listMembers()[0];
    assert.ok(member);
    const response = await request(app)
      .patch(`/api/members/${member.id}/status`)
      .send({ status: 'unknown' })
      .expect(200);
    assert.equal(response.body.member.status, 'unknown');
  });
});

describe('FamGuard persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'famguard-test-'));
  const file = join(dir, 'famguard.json');

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('survives a restart by reloading the JSON database', () => {
    const first = new FamGuardStore({ file, seed: false });
    const member = first.addMember({ name: 'Kai Rivers', role: 'parent' });
    first.checkIn(member.id);
    first.createAlert({ memberId: member.id, type: 'missed_checkin', message: 'No check-in at 18:00.' });

    const reloaded = new FamGuardStore({ file, seed: false });
    const members = reloaded.listMembers();
    assert.equal(members.length, 1);
    assert.equal(members[0]?.name, 'Kai Rivers');
    assert.equal(members[0]?.status, 'needs_attention');
    assert.equal(reloaded.listAlerts().length, 1);
  });

  it('seeds a demo family only once', () => {
    const seeded = new FamGuardStore({ file: null, seed: true });
    assert.equal(seeded.listMembers().length, 4);
    assert.equal(seeded.overview().openAlerts, 1);
  });
});
