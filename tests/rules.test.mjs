// Tests of the shared game rules (www/js/rules.js), no server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../www/js/rules.js';
const R = globalThis.AMR;
const env = (now, rng = Math.random) => ({ now, rng, tz: 0, online: true, user: { username: 'unit' } });

test('merchant demand follows the clock: settling in steps or at once comes out (almost) the same', () => {
  const t0 = 1.8e12, a = R.newChar('x', 'war', t0, Math.random), b = structuredClone(a);
  for (let t = t0; t <= t0 + 600e3; t += 7000) R.settleDemand(a, t);
  R.settleDemand(a, t0 + 600e3); R.settleDemand(b, t0 + 600e3);
  for (const k of R.TK) assert.ok(Math.abs(a.demand[k] - b.demand[k]) < 1e-3, k);
  assert.ok(R.TK.some((k) => b.demand[k] > 1), 'merchants clamoured for something');
});

test('upgrading a save twice changes nothing the second time', () => {
  const S = R.upgradeSave(null, 1e12); R.runAction(S, 'createSmith', {}, env(1e12));
  const once = structuredClone(S); R.upgradeSave(S, 2e12);
  assert.deepEqual(R.diff(once, S), []);
});

test('tidying a big save keeps Armory progress, records and blades on the rack', () => {
  let n = 0; const rng = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const S = R.upgradeSave(null, 1e12); R.runAction(S, 'createSmith', {}, env(1e12, rng)); const c = S.slots[0];
  for (let i = 0; i < 400; i++) { const b = R.makeBlade({ S, c, rng, now: 1e12, tz: 0 }, R.TK[i % 100], 0, 50 + (i % 50), false); b.status = i % 3 ? 'sold' : 'salvaged'; c.blades.push(b); }
  c.blades[5].status = 'owned';
  const before = R.armoryProgress(S), longest = Math.max(...c.blades.filter(R.exists).map((b) => b.len));
  R.compact(S);
  assert.ok(c.blades.length < 200, 'smaller: ' + c.blades.length);
  assert.deepEqual(R.armoryProgress(S), before);
  assert.ok(c.blades.some((b) => b.len === longest), 'the longest blade is kept');
  assert.ok(c.blades.some((b) => b.id === 6 && b.status === 'owned'), 'blades on the rack are kept');
});

test('a patch turns the old save into the new one exactly', () => {
  const S = R.upgradeSave(null, 1e12); R.runAction(S, 'createSmith', {}, env(1e12));
  const old = structuredClone(S); R.runAction(S, 'buy', { m: 'iron', n: 2 }, env(1e12 + 1000, null));
  assert.deepEqual(R.applyPatch(structuredClone(old), R.diff(old, S)), S);
});
