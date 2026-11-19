import assert from 'node:assert/strict';
import test from 'node:test';
import { planPower, POWER_LIMITS, powerAtSample } from '../assets/power.mjs';

// R 4.6.0, stats::power.t.test with delta = effectSize, sd = 1,
// strict = TRUE, tol = 1e-12, type = "two.sample" or "paired",
// and alternative = "one.sided" or "two.sided".
const cases = [
  ['independent', 0.50, 0.05, 2, 0.80, 64, 0.801459557922285],
  ['paired', 0.50, 0.05, 2, 0.80, 34, 0.807777501279440],
  ['independent', 0.65, 0.05, 1, 0.90, 42, 0.904750189156095],
  ['paired', 0.35, 0.025, 1, 0.90, 88, 0.900930713910071],
  ['paired', 5, 0.20, 2, 0.50, 2, 0.971117027564210],
  ['paired', 5, 0.0001, 2, 0.999, 9, 0.999893655897470],
  ['independent', 0.015, 0.0001, 2, 0.999, 433177, 0.999000019382884],
  ['independent', 0.015, 0.20, 1, 0.80, 25186, 0.800008305513994],
];

function assertNear(actual, expected, tolerance = 2e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

for (const [design, effectSize, alpha, tails, targetPower, sampleSize, expectedPower] of cases) {
  test(`plans ${design} t power with d=${effectSize}, alpha=${alpha}, tails=${tails}, power=${targetPower}`, () => {
    const plan = { design, effectSize, alpha, tails, targetPower };
    const result = planPower(plan);
    assert.equal(result.sampleSize, sampleSize);
    assert.equal(result.totalSampleSize, design === 'independent' ? sampleSize * 2 : sampleSize);
    assertNear(result.achievedPower, expectedPower);
    assert.equal(result.achievedPower, powerAtSample({ ...plan, sampleSize }));
    assert.ok(result.achievedPower >= targetPower);
    if (sampleSize > POWER_LIMITS.minSampleSize) {
      assert.ok(powerAtSample({ ...plan, sampleSize: sampleSize - 1 }) < targetPower);
    }
  });
}

test('resolves both rejection tails close to the smallest allowed alpha and sample size', () => {
  const plan = { design: 'paired', effectSize: 0.01, alpha: 0.0001, sampleSize: 2 };
  assertNear(powerAtSample({ ...plan, tails: 2 }), 0.0001000100000702, 2e-12);
  assertNear(powerAtSample({ ...plan, tails: 1 }), 0.0001017824537487, 2e-12);
});

const standardPlan = { design: 'independent', effectSize: 0.50, alpha: 0.05, tails: 2, targetPower: 0.80 };

test('rejects unsupported designs and invalid parameters', () => {
  for (const invalid of [
    { design: 'welch' }, { ratio: 2 }, { alpha: 0 }, { alpha: 0.25 },
    { effectSize: NaN }, { effectSize: '0.50' }, { effectSize: 0 }, { effectSize: 6 },
    { tails: 3 }, { targetPower: 1 }, { targetPower: 0.49 },
  ]) {
    assert.throws(() => planPower({ ...standardPlan, ...invalid }), RangeError);
  }
  for (const sampleSize of [1, 2.1, '64', Infinity, POWER_LIMITS.maxSampleSize + 1]) {
    assert.throws(() => powerAtSample({ ...standardPlan, sampleSize }), RangeError);
  }
});

test('reports a target that would require more than the supported limit', () => {
  const options = { ...standardPlan, effectSize: 0.01, alpha: 0.0001, targetPower: 0.999 };
  assert.throws(() => planPower(options), /maximum supported sampleSize/);
});
