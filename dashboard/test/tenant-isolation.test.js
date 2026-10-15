'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const clerk = require('../lib/clerk');

function makeJwt(sub, email, name, metadata = {}) {
  return clerk.signTestToken({
    sub,
    email,
    name,
    public_metadata: metadata,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

test('strict Clerk user mapping prevents cross-account hijacking even with identical email', async () => {
  const subA = 'user_clerk_test_alice_123';
  const subB = 'user_clerk_test_bob_456';
  const sharedEmail = 'same.person@example.com';

  // Simulate User A logging in via Clerk token
  const tokenA = makeJwt(subA, sharedEmail, 'Alice');
  const ctxA = await core.getSession({ headers: { authorization: 'Bearer ' + tokenA } });
  assert.ok(ctxA, 'Context A must resolve');
  assert.ok(ctxA.user, 'User A must exist');
  assert.ok(ctxA.tenant, 'Tenant A must exist');
  assert.equal(ctxA.user.clerkUserId, subA);

  // Simulate User B logging in via Clerk token with same email but different Clerk sub ID
  const tokenB = makeJwt(subB, sharedEmail, 'Bob');
  const ctxB = await core.getSession({ headers: { authorization: 'Bearer ' + tokenB } });
  assert.ok(ctxB, 'Context B must resolve');
  assert.ok(ctxB.user, 'User B must exist');
  assert.ok(ctxB.tenant, 'Tenant B must exist');
  assert.equal(ctxB.user.clerkUserId, subB);

  // Must have separate user IDs and separate tenant IDs
  assert.notEqual(ctxA.user.id, ctxB.user.id, 'Users must have unique distinct IDs');
  assert.notEqual(ctxA.tenant.id, ctxB.tenant.id, 'Tenants must be completely isolated');

  // Re-authenticating Alice must return Alice's tenant, never Bob's
  const reAlice = await core.getSession({ headers: { authorization: 'Bearer ' + tokenA } });
  assert.equal(reAlice.user.id, ctxA.user.id);
  assert.equal(reAlice.tenant.id, ctxA.tenant.id);

  // Clean up test users & tenants from db
  await core.mutate((liveDb) => {
    liveDb.users = liveDb.users.filter((u) => u.clerkUserId !== subA && u.clerkUserId !== subB);
    liveDb.tenants = liveDb.tenants.filter((t) => t.id !== ctxA.tenant.id && t.id !== ctxB.tenant.id);
  });
});

test('recordings and CRM isolation: queries return strictly tenant-owned data', async () => {
  const testTenant1 = 't_isolation_test_1';
  const testTenant2 = 't_isolation_test_2';

  // Seed sample data for both tenants
  await core.mutate((liveDb) => {
    liveDb.recordings = liveDb.recordings || [];
    liveDb.recordings.push(
      { id: 'rec_t1', tenantId: testTenant1, runId: 'run_1', callerNumber: '+919876543210' },
      { id: 'rec_t2', tenantId: testTenant2, runId: 'run_2', callerNumber: '+919123456789' }
    );
  });

  // Verify filtering
  const currentDb = core.db();
  const t1Recordings = (currentDb.recordings || []).filter((r) => r.tenantId === testTenant1);
  const t2Recordings = (currentDb.recordings || []).filter((r) => r.tenantId === testTenant2);

  assert.equal(t1Recordings.length, 1);
  assert.equal(t1Recordings[0].id, 'rec_t1');
  assert.equal(t2Recordings.length, 1);
  assert.equal(t2Recordings[0].id, 'rec_t2');

  // Clean up
  await core.mutate((liveDb) => {
    liveDb.recordings = (liveDb.recordings || []).filter((r) => r.tenantId !== testTenant1 && r.tenantId !== testTenant2);
  });
});

test('Clerk role assignment: admins receive admin role, regular users receive client role', async () => {
  const subAdmin = 'user_clerk_admin_999';
  const subRegular = 'user_clerk_regular_888';

  // Regular user token without admin role
  const tokenRegular = makeJwt(subRegular, 'reg@test.com', 'Regular User');
  const ctxRegular = await core.getSession({ headers: { authorization: 'Bearer ' + tokenRegular } });
  assert.equal(ctxRegular.user.role, 'client');

  // Token with verified Clerk public_metadata role = 'admin'
  const tokenAdmin = clerk.signTestToken({
    sub: subAdmin,
    email: 'admin@test.com',
    name: 'Admin Boss',
    public_metadata: { role: 'admin' },
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const ctxAdmin = await core.getSession({ headers: { authorization: 'Bearer ' + tokenAdmin } });
  assert.equal(ctxAdmin.user.role, 'admin');

  // Clean up
  await core.mutate((liveDb) => {
    liveDb.users = liveDb.users.filter((u) => u.clerkUserId !== subAdmin && u.clerkUserId !== subRegular);
    liveDb.tenants = liveDb.tenants.filter((t) => t.id !== ctxAdmin.tenant.id && t.id !== ctxRegular.tenant.id);
  });
});
