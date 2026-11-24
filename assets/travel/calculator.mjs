// Adapted from LeeV’s entry_exit_publish/core/calculator.js.
import { normalizePort } from './ports.mjs';
import { MACAO_HOLIDAYS, HONGKONG_HOLIDAYS, MACAO_SCHOOL_BREAKS, CITYU_ACADEMIC_YEARS } from './holidays.mjs';

function normalizeRules(rules) {
  return {
    deductWeekend: rules.deductWeekend !== false,
    deductGovHoliday: rules.deductGovHoliday !== false,
    deductCompensatory: rules.deductCompensatory !== false,
    deductHalfDay: rules.deductHalfDay === true,
    deductSchoolBreak: rules.deductSchoolBreak === true
  };
}

function parseMigrationRecords(text, diagnostics = {}) {
  const normalized = String(text || '').normalize('NFKC').replace(/[\u200b\ufeff]/g, '');
  const matches = Array.from(normalized.matchAll(/(?:^|\s)(\d{1,6})\s*(入境|出境)(?=[\s\d]|$)/g));
  const rows = new Map();
  let skipped = 0;

  for (const [i, match] of matches.entries()) {
    const recordNo = Number(match[1]);
    const direction = match[2];
    const body = normalized.slice(match.index + match[0].length, matches[i + 1]?.index).trim();
    const fields = body.match(/^((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?\s*[\p{Script=Han}()\s]{1,60}\s+[A-Z0-9*•●]{3,30}\s+([\s\S]+)/iu);
    const [, year, month, day, tail] = fields || [];
    const date = year ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';
    const portRaw = tail ? cleanPortSegment(tail) : '';
    if (!recordNo || !date || formatDate(parseDate(date)) !== date || !portRaw) {
      skipped += 1;
      continue;
    }

    const previous = rows.get(recordNo);
    if (previous === null || (previous && (previous.date !== date || previous.direction !== direction || previous.portRaw !== portRaw))) {
      skipped += previous === null ? 1 : 2;
      rows.set(recordNo, null);
    } else if (!previous) {
      rows.set(recordNo, { recordNo, direction, date, portRaw, portInfo: normalizePort(portRaw) });
    }
  }

  diagnostics.skipped = skipped;
  return [...rows.values()].filter(Boolean).sort((a, b) => a.recordNo - b.recordNo);
}

function cleanPortSegment(value) {
  return value
    .split(/第\s*(?:\d+\s*)?[页頁]|查[询詢]人姓名|[编編][号號]\s*:|制作时间|製作時間|(?:\d+[.、]\s*)?[本该該][电電]子文件|国家移民管理局|國家移民管理局|<IMAGE/i, 1)[0]
    .replace(/(口岸|机场|機場|港|码头|碼頭|Airport)?\s+(?:[A-Z0-9]{2}\d{2,5}|[-—]+|无|無)\s*$/i, '$1')
    .replace(/(口岸|机场|機場|港|码头|碼頭|Airport|MFM|HKG)[A-Z0-9]{2}\d{2,5}\s*$/i, '$1')
    .replace(/\s+/g, '')
    .slice(0, 60);
}

function calculateResult(records, selectedRegion, rawRules) {
  const rules = normalizeRules(rawRules || {});
  const numbered = [...records].sort((a, b) => a.recordNo - b.recordNo);
  const dateOrder = numbered.reduce((score, record, i) => (
    i ? score + record.date.localeCompare(numbered[i - 1].date) : score
  ), 0);
  const sequence = dateOrder > 0 ? 1 : -1;
  const chronological = numbered.sort((a, b) => a.date.localeCompare(b.date) || sequence * (a.recordNo - b.recordNo));
  const intervals = [];
  const anomalies = [];
  let pendingExit = null;

  for (const rec of chronological) {
    if (rec.direction === '出境') {
      if (pendingExit) {
        anomalies.push({ type: '连续出境未见入境', recordNo: pendingExit.recordNo, date: pendingExit.date, portRaw: pendingExit.portRaw });
      }
      pendingExit = rec;
      continue;
    }

    if (rec.direction === '入境') {
      if (!pendingExit) {
        anomalies.push({ type: '缺少前序出境', recordNo: rec.recordNo, date: rec.date, portRaw: rec.portRaw });
        continue;
      }
      if (rec.recordNo - pendingExit.recordNo !== sequence) {
        anomalies.push({ type: '出入境序号不连续', recordNo: `${pendingExit.recordNo}/${rec.recordNo}`, date: `${pendingExit.date} 至 ${rec.date}`, portRaw: `${pendingExit.portRaw} → ${rec.portRaw}` });
        pendingExit = null;
        continue;
      }

      intervals.push({
        id: `interval_${pendingExit.recordNo}_${rec.recordNo}`,
        exitRecord: pendingExit,
        entryRecord: rec,
        exitDate: pendingExit.date,
        entryDate: rec.date
      });
      pendingExit = null;
    }
  }

  if (pendingExit) {
    anomalies.push({ type: '缺少后续入境', recordNo: pendingExit.recordNo, date: pendingExit.date, portRaw: pendingExit.portRaw });
  }

  const includedIntervals = [];
  const reviewItems = [];

  for (const interval of intervals) {
    const exitRegion = interval.exitRecord.portInfo.region;
    const entryRegion = interval.entryRecord.portInfo.region;
    const hasReview = exitRegion === 'review' || entryRegion === 'review' || exitRegion !== entryRegion;
    const sameSelected = exitRegion === selectedRegion && entryRegion === selectedRegion;

    if (sameSelected) {
      includedIntervals.push(interval);
      continue;
    }

    if (hasReview) {
      const reviewDates = expandDateRange(interval.exitDate, interval.entryDate);
      reviewItems.push({
        id: interval.id,
        recordNo: `${interval.exitRecord.recordNo}/${interval.entryRecord.recordNo}`,
        date: `${interval.exitDate} 至 ${interval.entryDate}`,
        direction: '出境至入境',
        portRaw: `${interval.exitRecord.portRaw} → ${interval.entryRecord.portRaw}`,
        reason: buildReviewReason(interval),
        dailyRows: reviewDates.map(date => buildDailyDeductRow(date, selectedRegion, rules))
      });
    }
  }

  const dayMap = new Map();
  for (const interval of includedIntervals) {
    const dates = expandDateRange(interval.exitDate, interval.entryDate);
    for (const date of dates) {
      if (!dayMap.has(date)) {
        dayMap.set(date, { date, year: Number(date.slice(0, 4)) });
      }
    }
  }

  const dailyRows = [...dayMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(row => buildDailyDeductRow(row.date, selectedRegion, rules));

  return {
    recordCount: records.length,
    intervalCount: includedIntervals.length,
    reviewCount: reviewItems.length,
    summaryByYear: buildSummaryByYear(dailyRows),
    reviewItems,
    anomalies,
    dailyRows,
    rules,
    firstDate: chronological[0]?.date,
    lastDate: chronological[chronological.length - 1]?.date,
    selectedRegion
  };
}

function applyReviewDecisions(result, region, decisions) {
  const baseRows = Array.isArray(result.dailyRows) ? [...result.dailyRows] : [];
  const rows = [...baseRows];
  const reviewItems = Array.isArray(result.reviewItems) ? result.reviewItems : [];
  const baseDateSet = new Set(baseRows.filter(row => row && row.date).map(row => row.date));
  const addedDateSet = new Set();
  let selectedCount = 0;
  let unresolvedCount = 0;

  for (const item of reviewItems) {
    const decision = decisions?.[item.id];
    if (!decision || decision === 'pending') unresolvedCount += 1;
    if (decision !== region) continue;
    selectedCount += 1;

    for (const row of item.dailyRows) {
      if (row && row.date && !baseDateSet.has(row.date)) addedDateSet.add(row.date);
      rows.push(row);
    }
  }

  const dedupRows = deduplicateDailyRows(rows);
  return {
    ...result,
    dailyRows: dedupRows,
    summaryByYear: buildSummaryByYear(dedupRows),
    reviewEffect: {
      selectedCount,
      unresolvedCount,
      addedNaturalDays: addedDateSet.size,
      message: buildReviewEffectMessage(selectedCount, addedDateSet.size)
    }
  };
}

function buildReviewEffectMessage(selectedCount, addedNaturalDays) {
  if (selectedCount === 0) return '尚未有复核记录计入当前地区';
  if (addedNaturalDays === 0) return `已将 ${selectedCount} 条复核记录计入当前地区。这些日期已被同日去重规则覆盖，汇总结果未新增天数。`;
  return `已将 ${selectedCount} 条复核记录计入当前地区，新增 ${addedNaturalDays} 个自然离境日。`;
}

function deduplicateDailyRows(rows) {
  const map = new Map();

  for (const row of rows) {
    if (!row || !row.date) continue;
    const normalizedRow = {
      ...row,
      year: Number(row.year || String(row.date).slice(0, 4)),
      naturalDay: row.naturalDay || 1,
      weekendDeduct: row.weekendDeduct || 0,
      govHolidayDeduct: row.govHolidayDeduct || 0,
      compensatoryDeduct: row.compensatoryDeduct || 0,
      halfDayDeduct: row.halfDayDeduct || 0,
      schoolBreakDeduct: row.schoolBreakDeduct || 0,
      totalDeduct: row.totalDeduct || 0,
      validDay: row.validDay ?? 1
    };

    if (!map.has(normalizedRow.date)) {
      map.set(normalizedRow.date, normalizedRow);
      continue;
    }

    const oldRow = map.get(normalizedRow.date);
    const weekendDeduct = Math.max(oldRow.weekendDeduct || 0, normalizedRow.weekendDeduct || 0);
    const govHolidayDeduct = Math.max(oldRow.govHolidayDeduct || 0, normalizedRow.govHolidayDeduct || 0);
    const compensatoryDeduct = Math.max(oldRow.compensatoryDeduct || 0, normalizedRow.compensatoryDeduct || 0);
    const halfDayDeduct = Math.max(oldRow.halfDayDeduct || 0, normalizedRow.halfDayDeduct || 0);
    const schoolBreakDeduct = Math.max(oldRow.schoolBreakDeduct || 0, normalizedRow.schoolBreakDeduct || 0);
    const totalDeduct = Math.max(weekendDeduct, govHolidayDeduct, compensatoryDeduct, halfDayDeduct, schoolBreakDeduct);

    map.set(normalizedRow.date, {
      ...oldRow,
      weekendDeduct,
      govHolidayDeduct,
      compensatoryDeduct,
      halfDayDeduct,
      schoolBreakDeduct,
      totalDeduct,
      validDay: 1 - totalDeduct
    });
  }

  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildReviewReason(interval) {
  const reasons = [];
  if (interval.exitRecord.portInfo.needReview) reasons.push(`出境口岸 ${interval.exitRecord.portRaw} 需要复核`);
  if (interval.entryRecord.portInfo.needReview) reasons.push(`入境口岸 ${interval.entryRecord.portRaw} 需要复核`);
  return reasons.length ? reasons.join('；') : '出入境口岸分属澳门和香港方向，请按真实行程判断。';
}

function expandDateRange(startDate, endDate) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > end.getTime()) return [];

  const out = [];
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(formatDate(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function parseDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekday(dateStr) {
  return parseDate(dateStr).getUTCDay();
}

function getHoliday(region, date) {
  if (region === 'macao') return MACAO_HOLIDAYS[date] || null;
  if (region === 'hongkong') return HONGKONG_HOLIDAYS[date] || null;
  return null;
}

function getSchoolBreak(region, date) {
  if (region !== 'macao') return null;
  for (const item of MACAO_SCHOOL_BREAKS) {
    if (date >= item.start && date <= item.end) return item;
  }
  return null;
}

function buildDailyDeductRow(date, region, rules) {
  const weekday = getWeekday(date);
  const isWeekend = weekday === 0 || weekday === 6;
  const holiday = getHoliday(region, date);
  const schoolBreak = getSchoolBreak(region, date);

  const weekendDeduct = rules.deductWeekend && isWeekend ? 1 : 0;
  const govHolidayDeduct = rules.deductGovHoliday && holiday && holiday.type === 'gov' ? holiday.weight : 0;
  const compensatoryDeduct = rules.deductCompensatory && holiday && holiday.type === 'compensatory' ? holiday.weight : 0;
  const halfDayDeduct = rules.deductHalfDay && holiday && holiday.type === 'half' ? holiday.weight : 0;
  const schoolBreakDeduct = rules.deductSchoolBreak && schoolBreak ? 1 : 0;
  const totalDeduct = Math.max(weekendDeduct, govHolidayDeduct, compensatoryDeduct, halfDayDeduct, schoolBreakDeduct);

  return {
    date,
    year: Number(date.slice(0, 4)),
    weekday,
    isWeekend,
    holidayName: holiday ? holiday.name : '',
    schoolEventName: schoolBreak ? schoolBreak.name : '',
    naturalDay: 1,
    weekendDeduct,
    govHolidayDeduct,
    compensatoryDeduct,
    halfDayDeduct,
    schoolBreakDeduct,
    totalDeduct,
    validDay: 1 - totalDeduct
  };
}

function buildSummaryByYear(dailyRows) {
  return buildSummaryByMode(dailyRows, 'calendarYear').map(item => ({
    year: item.year,
    naturalDays: item.naturalDays,
    weekendDeductDays: item.weekendDeductDays,
    govHolidayDeductDays: item.govHolidayDeductDays,
    compensatoryDeductDays: item.compensatoryDeductDays,
    halfDayDeductDays: item.halfDayDeductDays,
    schoolBreakDeductDays: item.schoolBreakDeductDays,
    totalDeductDays: item.totalDeductDays,
    validDays: item.validDays
  }));
}

function buildSummaryByMode(dailyRows, summaryMode) {
  const mode = summaryMode === 'cityuAcademicYear' ? 'cityuAcademicYear' : 'calendarYear';
  const map = new Map();

  for (const row of dailyRows) {
    if (!row || !row.date) continue;
    const period = getSummaryPeriod(row, mode);

    if (!map.has(period.key)) {
      map.set(period.key, {
        periodKey: period.key,
        periodLabel: period.label,
        periodRange: period.range,
        periodStart: period.start,
        periodEnd: period.end,
        periodNote: period.note || '',
        sortKey: period.sortKey,
        year: period.year,
        naturalDays: 0,
        weekendDeductDays: 0,
        govHolidayDeductDays: 0,
        compensatoryDeductDays: 0,
        halfDayDeductDays: 0,
        schoolBreakDeductDays: 0,
        totalDeductDays: 0,
        validDays: 0
      });
    }

    const item = map.get(period.key);
    item.naturalDays += row.naturalDay || 1;
    item.weekendDeductDays += row.weekendDeduct || 0;
    item.govHolidayDeductDays += row.govHolidayDeduct || 0;
    item.compensatoryDeductDays += row.compensatoryDeduct || 0;
    item.halfDayDeductDays += row.halfDayDeduct || 0;
    item.schoolBreakDeductDays += row.schoolBreakDeduct || 0;
    item.totalDeductDays += row.totalDeduct || 0;
    item.validDays += row.validDay ?? 1;
  }

  return Array.from(map.values()).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey))).map(item => ({
    periodKey: item.periodKey,
    periodLabel: item.periodLabel,
    periodRange: item.periodRange,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    periodNote: item.periodNote,
    year: item.year,
    naturalDays: roundNumber(item.naturalDays),
    weekendDeductDays: roundNumber(item.weekendDeductDays),
    govHolidayDeductDays: roundNumber(item.govHolidayDeductDays),
    compensatoryDeductDays: roundNumber(item.compensatoryDeductDays),
    halfDayDeductDays: roundNumber(item.halfDayDeductDays),
    schoolBreakDeductDays: roundNumber(item.schoolBreakDeductDays),
    totalDeductDays: roundNumber(item.totalDeductDays),
    validDays: roundNumber(item.validDays)
  }));
}

function getSummaryPeriod(row, mode) {
  const date = String(row.date || '');

  if (mode === 'cityuAcademicYear') {
    const academicYear = getCityuAcademicYear(date);

    if (academicYear) {
      return {
        key: academicYear.id,
        label: academicYear.name || `${academicYear.id} 学年`,
        range: `${academicYear.start} 至 ${academicYear.end}`,
        start: academicYear.start,
        end: academicYear.end,
        note: academicYear.note,
        sortKey: academicYear.start
      };
    }

    return {
      key: 'uncovered-academic-year',
      label: '未覆盖学年',
      range: '',
      start: '',
      end: '',
      sortKey: '9999-12-31'
    };
  }

  const year = Number(row.year || date.slice(0, 4));
  return {
    key: String(year),
    label: `${year}年`,
    range: `${year}-01-01 至 ${year}-12-31`,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    sortKey: `${year}-01-01`,
    year
  };
}

function getCityuAcademicYear(date) {
  return CITYU_ACADEMIC_YEARS.find(item => date >= item.start && date <= item.end) || null;
}

function roundNumber(num) {
  return Math.round((Number(num) || 0) * 10) / 10;
}

export {
  parseMigrationRecords,
  calculateResult,
  applyReviewDecisions,
  buildSummaryByYear,
  buildSummaryByMode,
  deduplicateDailyRows,
  buildDailyDeductRow,
  expandDateRange,
  getCityuAcademicYear,
  normalizeRules
};
