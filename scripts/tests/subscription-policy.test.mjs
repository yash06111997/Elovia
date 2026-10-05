import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStoredSubscription, TRIAL_DURATION_DAYS } from '../../artifacts/api-server/src/lib/subscriptionPolicy.ts';
const now = new Date('2026-10-05T12:00:00Z');
const end = new Date('2026-10-12T12:00:00Z');
const sub = { entitlementActive: true, entitlementId: 'Elovia Pro', status: 'in_trial', productId: 'elovia_pro_yearly', trialEndsAt: end, currentPeriodEndsAt: end, lastEvent: { period_type: 'TRIAL' } };
test('new accounts get no app-created trial; store trial duration is fourteen days', () => {
  assert.equal(TRIAL_DURATION_DAYS, 14);
  assert.equal(resolveStoredSubscription(undefined, now).hasProAccess, false);
});
test('only a verified active yearly trial grants trial access', () => {
  assert.equal(resolveStoredSubscription(sub, now).tier, 'trial');
  assert.equal(resolveStoredSubscription({ ...sub, productId: 'elovia_pro_monthly' }, now).hasProAccess, false);
  assert.equal(resolveStoredSubscription({ ...sub, entitlementActive: false }, now).hasProAccess, false);
  assert.equal(resolveStoredSubscription({ ...sub, currentPeriodEndsAt: new Date('2026-10-01') }, now).hasProAccess, false);
});
test('cancelling a yearly trial retains access until its store expiry', () => {
  assert.equal(resolveStoredSubscription({ ...sub, status: 'cancelled' }, now).tier, 'trial');
  assert.equal(resolveStoredSubscription({ ...sub, status: 'cancelled' }, new Date('2026-10-13')).hasProAccess, false);
});
test('renewed monthly paid plans and coaching still work without a trial', () => {
  const paid = { ...sub, status: 'active', productId: 'elovia_pro_monthly', trialEndsAt: null, lastEvent: { period_type: 'NORMAL' } };
  assert.equal(resolveStoredSubscription(paid, now).tier, 'premium');
  assert.equal(resolveStoredSubscription({ ...paid, entitlementId: 'Elovia Coaching' }, now).tier, 'coaching');
});
