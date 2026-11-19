import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateInvitations, calculateSurveySize } from '../assets/survey.mjs';

const survey = { confidence: 95, percent: 50, margin: 5 };
const invites = { target: 385, returnedPercent: 60, usablePercent: 90 };

test('large-population case matches the R 4.6.0 reference calculation', () => {
  const result = calculateSurveySize(survey);
  assert.equal(result.sample, 385);
  assert.ok(Math.abs(result.raw - 384.14588206941215) < 1e-10);
  assert.ok(result.achievedMargin < 5);
  assert.ok(result.z * Math.sqrt(0.25 / (result.sample - 1)) > 0.05);
  assert.equal(result.smallExpectedClass, false);
  assert.equal(result.intervalAtBoundary, false);
  assert.equal(calculateInvitations({ ...invites, target: result.sample }).invitations, 713);
});

test('finite SRS uses the N−1 variance correction and rounds only the final result', () => {
  const result = calculateSurveySize({ ...survey, population: 1000 });
  assert.equal(result.sample, 278);
  assert.ok(Math.abs(result.raw - 277.73345317318751) < 1e-10);
  assert.ok(result.achievedMargin <= 5);
  const previousMargin = result.z * Math.sqrt(0.25 / 277 * (1000 - 277) / 999);
  assert.ok(previousMargin > 0.05);
  const census = calculateSurveySize({ ...survey, margin: 0.1, population: 10 });
  assert.equal(census.sample, 10);
  assert.equal(census.census, true);
  assert.equal(census.achievedMargin, 0);
});

test('flags near-census designs with too few expected items remaining', () => {
  const nearCensus = calculateSurveySize({ ...survey, percent: 10, margin: 0.54, population: 110 });
  assert.equal(nearCensus.sample, 109);
  assert.equal(nearCensus.smallExpectedClass, false);
  assert.equal(nearCensus.smallRemainingClass, true);
});

test('confidence level and rare events change the estimate', () => {
  assert.equal(calculateSurveySize({ ...survey, confidence: 90 }).sample, 271);
  assert.equal(calculateSurveySize({ ...survey, confidence: 99 }).sample, 664);
  const rare = calculateSurveySize({ ...survey, percent: 1 });
  assert.equal(rare.sample, 16);
  assert.equal(rare.smallExpectedClass, true);
  assert.equal(rare.intervalAtBoundary, true);
});

test('rejects invalid proportions, precision, confidence and finite population', () => {
  for (const overrides of [
    { percent: '' }, { percent: 100 }, { percent: -1 }, { margin: 0 }, { margin: Infinity },
    { confidence: 96 }, { population: 1 }, { population: 15.5 }, { margin: 1e-10 },
  ]) {
    assert.throws(() => calculateSurveySize({ ...survey, ...overrides }), RangeError);
  }
});

test('decimal rates preserve exact whole-person boundaries with one final ceiling', () => {
  assert.equal(calculateInvitations({ ...invites, target: 54 }).invitations, 100);
  assert.equal(calculateInvitations({ target: 6, returnedPercent: '30', usablePercent: '20' }).invitations, 100);
  assert.equal(calculateInvitations({ target: 6, returnedPercent: 37.5, usablePercent: 80 }).invitations, 20);
  assert.equal(calculateInvitations({ target: 8, returnedPercent: 100, usablePercent: 100 }).invitations, 8);
});

test('feasibility compares invitation workload against a distinct invitation capacity', () => {
  assert.equal(calculateInvitations(invites).feasible, null);
  assert.equal(calculateInvitations({ ...invites, capacity: 712 }).feasible, false);
  assert.equal(calculateInvitations({ ...invites, capacity: 713 }).feasible, true);
  assert.equal(calculateInvitations({ ...invites, capacity: 0 }).feasible, false);
});

test('rejects invalid invitation counts, capacities and rates', () => {
  for (const overrides of [
    { target: 0 }, { target: 1.5 }, { target: '' }, { returnedPercent: 0 },
    { usablePercent: 110 }, { capacity: -1 }, { capacity: 30.1 }, { usablePercent: 1e-13 },
  ]) {
    assert.throws(() => calculateInvitations({ ...invites, ...overrides }), RangeError);
  }
});
