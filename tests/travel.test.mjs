import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMigrationRecords, calculateResult, applyReviewDecisions,
  buildSummaryByMode, buildDailyDeductRow, expandDateRange, normalizeRules } from '../assets/travel/calculator.mjs';
import { normalizePort } from '../assets/travel/ports.mjs';
import { CITYU_ACADEMIC_YEARS, HOLIDAY_COVERAGE } from '../assets/travel/holidays.mjs';

// Regression cases from LeeV’s original entry/exit calculator.
const line = (number, direction, date, port = '横琴口岸') =>
  `${number} ${direction} ${date} 往来港澳通行证 ******** ${port}`;
const parse = (...lines) => parseMigrationRecords(lines.join('\n'));

test('parses NIA rows with redaction, wrapped fields, footer, and traditional ports', () => {
  const records = parse(
    '1 入境 2027- 02- 07 往來港澳通行\n證 •••• 港珠澳大橋口\n岸',
    '第1页/共2页',
    '2 出境 ２０２７/２/５ 旅行证 ab1234 橫琴口岸 G8123',
    '1.本电子文件原件为 PDF 格式'
  );
  assert.deepEqual(records.map(row => [row.date, row.portRaw, row.portInfo.region]), [
    ['2027-02-07', '港珠澳大橋口岸', 'review'],
    ['2027-02-05', '橫琴口岸', 'macao']
  ]);
  assert.equal(Object.hasOwn(records[1], 'documentNo'), false);
  assert.equal(normalizePort('HKG').region, 'hongkong');
  assert.equal(normalizePort('notmfm').region, 'review');
});

test('does not silently pair records across an invalid row or a sequence gap', () => {
  const diagnostics = {};
  const records = parseMigrationRecords([
    line(1, '入境', '2026-03-03'),
    line(2, '入境', '2026-02-30'),
    line(3, '出境', '2026-02-27')
  ].join('\n'), diagnostics);
  assert.equal(records.length, 2);
  assert.equal(diagnostics.skipped, 1);
  const result = calculateResult(records, 'macao');
  assert.equal(result.dailyRows.length, 0);
  assert.equal(result.anomalies[0].type, '出入境序号不连续');
  assert.deepEqual(expandDateRange('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
});

test('ignores duplicate rows and flags conflicting records with the same sequence number', () => {
  const diagnostics = {};
  const first = line(1, '入境', '2026-03-03');
  const records = parseMigrationRecords([first, first, line(1, '入境', '2026-03-04')].join('\n'), diagnostics);
  assert.equal(records.length, 0);
  assert.equal(diagnostics.skipped, 2);
});

test('pairs both numbering orders and counts repeated days once', () => {
  const ascending = parse(
    line(1, '出境', '2027-08-20'),
    line(2, '入境', '2027-08-23'),
    line(3, '出境', '2027-08-23'),
    line(4, '入境', '2027-08-24')
  );
  const descending = ascending.map(row => ({ ...row, recordNo: 5 - row.recordNo }));
  const result = calculateResult(ascending, 'macao');
  assert.equal(result.intervalCount, 2);
  assert.equal(result.dailyRows.length, 5);
  assert.deepEqual(calculateResult(descending, 'macao').dailyRows, result.dailyRows);
  const periods = buildSummaryByMode(result.dailyRows, 'cityuAcademicYear');
  assert.deepEqual(periods.map(row => [row.periodKey, row.naturalDays, row.validDays]), [
    ['2026-2027', 3, 1], ['2027-2028', 2, 2]
  ]);
  assert.ok(periods.every(row => row.periodNote));
  assert.equal(buildSummaryByMode(result.dailyRows, 'calendarYear')[0].naturalDays, 5);
});

test('keeps mixed-region and ambiguous trips out of totals until manually confirmed', () => {
  const records = parse(line(1, '入境', '2027-07-02', '羅湖口岸'), line(2, '出境', '2027-07-01'));
  const base = calculateResult(records, 'hongkong');
  assert.equal(base.reviewItems.length, 1);
  assert.equal(applyReviewDecisions(base, 'hongkong', {}).reviewEffect.unresolvedCount, 1);
  const included = applyReviewDecisions(base, 'hongkong', { [base.reviewItems[0].id]: 'hongkong' });
  assert.equal(included.reviewEffect.unresolvedCount, 0);
  assert.equal(included.reviewEffect.addedNaturalDays, 2);
  assert.equal(included.dailyRows[0].validDay, 0);
  assert.equal(included.dailyRows[1].validDay, 1);
});

test('applies optional half days without stacking overlapping deductions', () => {
  const row = (date, region, rules) => buildDailyDeductRow(date, region, normalizeRules(rules));
  assert.equal(row('2027-12-31', 'macao', {}).validDay, 1);
  assert.equal(row('2027-12-31', 'macao', { deductHalfDay: true }).validDay, 0.5);
  const both = row('2027-02-05', 'macao', { deductHalfDay: true, deductSchoolBreak: true });
  assert.equal(both.halfDayDeduct, 0.5);
  assert.equal(both.schoolBreakDeduct, 1);
  assert.equal(both.totalDeduct, 1);
  assert.equal(both.validDay, 0);
  assert.equal(row('2027-02-09', 'hongkong', {}).compensatoryDeduct, 1);
  assert.equal(row('2027-02-09', 'hongkong', { deductCompensatory: false }).validDay, 1);
});

test('maintains contiguous CityU periods and counts unclassified dates separately', () => {
  for (let i = 1; i < CITYU_ACADEMIC_YEARS.length; i++) {
    assert.equal(expandDateRange(CITYU_ACADEMIC_YEARS[i - 1].end, CITYU_ACADEMIC_YEARS[i].start).length, 2);
  }
  assert.equal(CITYU_ACADEMIC_YEARS.at(-1).end, HOLIDAY_COVERAGE.end);
  const result = calculateResult(parse(line(1, '入境', '2028-01-02'), line(2, '出境', '2027-12-31')), 'macao');
  assert.deepEqual(buildSummaryByMode(result.dailyRows, 'cityuAcademicYear').map(period => [period.periodKey, period.naturalDays]), [
    ['2027-2028', 1], ['uncovered-academic-year', 2]
  ]);
});
