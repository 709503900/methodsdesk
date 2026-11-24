import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvitationRecord, buildSurveyRecord, calculateInvitationPlan, calculateInvitations, calculateSurveySize,
} from '../assets/survey.mjs';

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

test('compares only a complete pair of explicitly provided alternative rates', () => {
  const plan = calculateInvitationPlan({ ...invites, capacity: 800, comparisonReturnedPercent: 50, comparisonUsablePercent: 80 });
  assert.equal(plan.base.invitations, 713);
  assert.equal(plan.comparison.invitations, 963);
  assert.equal(plan.base.feasible, true);
  assert.equal(plan.comparison.feasible, false);
  assert.equal(plan.comparison.expectedAtCapacity, 320);
  assert.equal(calculateInvitationPlan({ ...invites, comparisonReturnedPercent: '', comparisonUsablePercent: '' }).comparison, null);
  assert.throws(() => calculateInvitationPlan({ ...invites, comparisonReturnedPercent: 50, comparisonUsablePercent: '' }),
    { name: 'RangeError', field: 'comparisonUsablePercent' });
});

test('combines a linked finite population with a user-entered invitation limit', () => {
  const limitOnly = calculateInvitationPlan({ ...invites, capacity: 700 });
  assert.equal(limitOnly.base.available, 700);
  const populationOnly = calculateInvitationPlan(invites, 650);
  assert.equal(populationOnly.base.available, 650);
  assert.equal(populationOnly.base.feasible, false);
  const both = calculateInvitationPlan({ ...invites, capacity: 700 }, 650);
  assert.equal(both.base.available, 650);
  assert.equal(both.listedCapacity, 700);
  assert.equal(both.linkedPopulation, 650);
  assert.equal(calculateInvitationPlan({ ...invites, capacity: 0 }, 650).base.available, 0);
});

test('research records preserve inputs, result, caveats and the method source', () => {
  const values = { ...survey, population: 1000 };
  const estimate = calculateSurveySize(values);
  const surveyRecord = buildSurveyRecord(values, estimate);
  assert.match(surveyRecord, /总体为 1000 人/);
  assert.match(surveyRecord, /向上取整需要 278 份/);
  assert.match(surveyRecord, /Cochran（1977）/);
  const rare = { ...survey, percent: 1 };
  assert.match(buildSurveyRecord(rare, calculateSurveySize(rare)), /预期人数低于 10/);

  const inputs = { ...invites, target: estimate.sample, capacity: 600, comparisonReturnedPercent: 50, comparisonUsablePercent: 80 };
  const plan = calculateInvitationPlan(inputs, estimate.N);
  const invitationRecord = buildInvitationRecord(inputs, plan, { values, estimate });
  assert.match(invitationRecord, /取自问卷样本量工具/);
  assert.match(invitationRecord, /基准情景假设回收 60%/);
  assert.match(invitationRecord, /需邀请 515 人/);
  assert.match(invitationRecord, /对照情景假设回收 50%/);
  assert.match(invitationRecord, /需邀请 695 人/);
  assert.match(invitationRecord, /当前上限低于该情景所需邀请量/);
  assert.match(invitationRecord, /Standard Definitions/);

  const editedInputs = { ...inputs, target: 300 };
  const editedPlan = calculateInvitationPlan(editedInputs, estimate.N);
  const editedRecord = buildInvitationRecord(editedInputs, editedPlan, { values, estimate });
  assert.match(editedRecord, /目标为 300 份/);
  assert.match(editedRecord, /当前目标由用户编辑/);
  assert.match(editedRecord, /所关联的抽样总体为 1000 人/);
  assert.doesNotMatch(editedRecord, /目标取自问卷样本量工具/);
});
