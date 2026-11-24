import { copyText, downloadText } from './ui.mjs';
import {
  parseMigrationRecords, calculateResult, applyReviewDecisions, buildSummaryByMode, getCityuAcademicYear,
} from './travel/calculator.mjs';
import { HOLIDAY_COVERAGE } from './travel/holidays.mjs';
import { LocalPdfLimitError, localPdfMaxBytes, localPdfMaxPages, maxRecordTextLength, readLocalPdfText } from './travel/pdf-reader.mjs';

const academicMode = 'cityuAcademicYear';
const calendarMode = 'calendarYear';
const sampleRecords = [
  '1 入境 2026-08-27 往来港澳通行证 ******** 横琴口岸',
  '2 出境 2026-08-24 往来港澳通行证 ******** 横琴口岸',
  '3 入境 2026-08-22 往来港澳通行证 ******** 港珠澳大桥口岸',
  '4 出境 2026-08-20 往来港澳通行证 ******** 横琴口岸',
].join('\n');
const rules = [
  ['deductWeekend', '周末', true, false],
  ['deductGovHoliday', '公众假期', true, false],
  ['deductCompensatory', '补假', true, false],
  ['deductHalfDay', '澳门半日假（0.5 天）', false, true],
  ['deductSchoolBreak', '澳城大已收录寒假', false, true],
];
const summaryKeys = [
  'weekendDeductDays', 'govHolidayDeductDays', 'compensatoryDeductDays', 'halfDayDeductDays', 'schoolBreakDeductDays',
];
const dailyKeys = ['weekendDeduct', 'govHolidayDeduct', 'compensatoryDeduct', 'halfDayDeduct', 'schoolBreakDeduct'];
const deductionHeaders = rules.map(([, name]) => name + '扣除');
const tableLabels = ['时期', '有效离境天数', '自然离境天数', '合计扣除', ...deductionHeaders];

function makeElement(tag, content) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  return element;
}

function buildTableRow(values) {
  const row = makeElement('tr');
  const [first, ...rest] = values;
  const label = makeElement('th', first);
  label.scope = 'row';
  row.append(label, ...rest.map(value => makeElement('td', value)));
  return row;
}

function downloadCsv(filename, rows) {
  const csv = '\ufeff' + rows.map(row => row.map(value => {
    const str = String(value ?? '');
    const safe = /^[=+\-@\t\r\n]/u.test(str) ? "'" + str : str;
    return '"' + safe.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
  downloadText(filename, csv, 'text/csv;charset=utf-8');
}

const template = `
  <div class="tool-grid">
    <form id="travel-form" class="tool-form" novalidate>
      <div class="field-grid">
        <div class="field"><label for="travel-region">适用地区</label>
          <select id="travel-region" name="region"><option value="macao">澳门</option><option value="hongkong">香港</option></select></div>
        <div class="field"><label for="travel-mode">统计口径</label>
          <select id="travel-mode" name="mode">
            <option value="cityuAcademicYear">澳门城市大学学年</option><option value="calendarYear">自然年</option>
          </select></div>
      </div>
      <div class="field"><label for="travel-source">记录输入方式</label>
        <select id="travel-source" name="source"><option value="pdf">选择 PDF</option><option value="text">粘贴表格文字</option></select></div>
      <div id="travel-pdf-input" class="field">
        <label for="travel-pdf">出入境记录 PDF</label>
        <input id="travel-pdf" name="pdf" type="file" accept=".pdf,application/pdf" aria-describedby="travel-pdf-help">
        <small id="travel-pdf-help">文件在本机解析。适用于可读取文字、无需密码的 PDF。文件须不超过 25 MB，页数须不超过 ${localPdfMaxPages} 页。</small>
      </div>
      <div id="travel-text-input" class="field" hidden>
        <label for="travel-text">出入境记录表格文字</label>
        <textarea id="travel-text" name="text" rows="5" autocomplete="off" spellcheck="false" aria-describedby="travel-text-help"></textarea>
        <small id="travel-text-help">保留原始序号、方向、日期、证件名称和口岸。可用星号遮盖证件号码。</small>
      </div>
      <details class="method-notes">
        <summary>设置扣除规则</summary>
        <div class="field-grid">
          ${rules.map(([name, title, checked]) =>
            '<label class="back-link"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + '> ' + title + '</label>',
          ).join('')}
        </div>
        <p>同一天命中多项规则时，只扣除其中最大值。学校假期仅收录澳城大部分寒假。</p>
      </details>
      <div class="form-actions">
        <button class="button" type="submit">计算离境天数</button>
        <button class="button secondary" type="button" data-travel-example>运行演示</button>
        <button class="button secondary" type="button" data-travel-clear disabled>清除输入和结果</button>
      </div>
      <p data-travel-status role="status"></p>
      <progress data-travel-progress max="100" value="0" aria-label="PDF 解析进度" hidden></progress>
      <p class="error" id="travel-error" role="alert" hidden></p>
    </form>
    <div class="tool-result">
      <h2 id="travel-result-heading" tabindex="-1">离境天数汇总</h2>
      <p data-travel-placeholder>计算后会显示所选地区的自然离境天数和扣除后的有效离境天数。</p>
      <div data-travel-output hidden>
        <p class="result-value" data-travel-total></p>
        <p data-travel-summary></p>
        <p class="callout" data-travel-warnings hidden></p>
        <div class="table-wrap" role="region" aria-label="分期汇总表" tabindex="0">
          <table><thead><tr>
            ${tableLabels.map(label => '<th scope="col">' + label + '</th>').join('')}
          </tr></thead><tbody data-travel-summary-rows></tbody></table>
        </div>
        <details class="method-notes" data-travel-anomalies hidden>
          <summary>核对无法配对的记录</summary><ul></ul>
        </details>
        <div class="form-actions">
          <button class="button secondary" type="button" data-travel-copy>复制汇总</button>
          <button class="button secondary" type="button" data-travel-summary-csv>下载汇总 CSV</button>
          <button class="button secondary" type="button" data-travel-daily-csv>下载每日 CSV</button>
        </div>
        <p data-travel-export-status role="status"></p>
        <label class="field" data-travel-copy-fallback hidden>手动复制汇总<textarea rows="6" readonly></textarea></label>
      </div>
    </div>
  </div>
  <details class="method-notes" data-travel-review hidden>
    <summary>复核口岸与行程</summary>
    <p>请按真实行程确认归属。待确认的行程暂不计入。</p>
    <div class="field-grid" data-travel-review-items></div>
  </details>
  <details class="method-notes">
    <summary>数据来源与统计范围</summary>
    <p>本工具由 LeeV李威的港澳出入境有效天数计算器整合而来。按中国内地出入境记录配对，离境与返境当天均计入自然离境天数，同日只计一次。</p>
    <p>汇总供个人核对。对于港澳实际停留时长、学校认定范围及正式用途，请查阅对应机构要求。</p>
    <p>公众假期数据覆盖 ${HOLIDAY_COVERAGE.start} 至 ${HOLIDAY_COVERAGE.end}。澳城大学年按开学日至次年开学日前一天统计。2027 年学年交界日期暂定为 8 月 23 日。校历未覆盖的日期归入「未覆盖学年」，也可切换自然年查看。</p>
    <p><a href="https://s.nia.gov.cn/index.html">国家移民管理局记录查询</a> ·
      <a href="https://www.cityu.edu.mo/zh/%E5%A4%A7%E5%AD%B8%E6%A0%A1%E6%9B%86-2/">澳门城市大学校历</a> ·
      <a href="https://www.gov.mo/zh-hant/public-holidays/year-2027/">澳门政府公众假期</a> ·
      <a href="https://www.info.gov.hk/gia/general/202605/15/P2026051400304p.htm">香港政府公众假期</a></p>
  </details>
`;

export function mountTravel(root = document) {
  const container = root.querySelector('#travel-tool');
  if (!container) return;
  container.innerHTML = template;

  const query = selector => container.querySelector(selector);
  const form = query('form');
  const field = name => form.elements.namedItem(name);
  const status = query('[data-travel-status]');
  const progress = query('[data-travel-progress]');
  const error = query('#travel-error');
  const output = query('[data-travel-output]');
  const placeholder = query('[data-travel-placeholder]');
  const outputHeading = query('#travel-result-heading');
  const review = query('[data-travel-review]');
  const clear = query('[data-travel-clear]');
  const demo = query('[data-travel-example]');
  const exports = [query('[data-travel-copy]'), query('[data-travel-summary-csv]'), query('[data-travel-daily-csv]')];
  const exportStatus = query('[data-travel-export-status]');
  const fallback = query('[data-travel-copy-fallback]');
  const decisions = new Map();
  const region = () => field('region').value;
  const mode = () => field('mode').value;
  const isAcademic = () => mode() === academicMode;
  const modeName = () => isAcademic() ? '澳城大学年' : '自然年';
  let preferredMacaoMode = academicMode;
  let busy = false;
  let records = [];
  let skipped = 0;
  let base;
  let result;
  let statistics = [];

  function updateControls() {
    const usePdf = field('source').value === 'pdf';
    query('#travel-pdf-input').hidden = !usePdf;
    query('#travel-text-input').hidden = usePdf;
    for (const name of ['source', 'pdf', 'text']) field(name).disabled = busy;
    form.querySelector('button[type="submit"]').disabled = busy;
    demo.disabled = busy;
    clear.disabled = busy || !(field('pdf').files.length || field('text').value || result);
    const supportsAcademic = region() === 'macao';
    field('mode').querySelector('option[value="' + academicMode + '"]').disabled = !supportsAcademic;
    field('mode').value = supportsAcademic ? preferredMacaoMode : calendarMode;
    for (const [name, , , macaoOnly] of rules) field(name).disabled = macaoOnly && !supportsAcademic;
  }

  function changeInput() {
    records = [];
    skipped = 0;
    base = undefined;
    result = undefined;
    statistics = [];
    decisions.clear();
    output.hidden = true;
    placeholder.hidden = false;
    review.hidden = true;
    review.open = false;
    for (const selector of [
      '[data-travel-review-items]', '[data-travel-summary-rows]', '[data-travel-total]',
      '[data-travel-summary]', '[data-travel-warnings]', '[data-travel-anomalies] ul',
    ]) query(selector).replaceChildren();
    fallback.querySelector('textarea').value = '';
    clearError();
    status.textContent = '';
    updateControls();
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    for (const name of ['pdf', 'text']) {
      field(name).removeAttribute('aria-invalid');
      field(name).setAttribute('aria-describedby', 'travel-' + name + '-help');
    }
  }

  function showError(message, focusedField) {
    error.textContent = message;
    error.hidden = false;
    focusedField.setAttribute('aria-invalid', 'true');
    focusedField.setAttribute('aria-describedby', focusedField.id + '-help travel-error');
    focusedField.disabled = false;
    focusedField.focus();
  }

  function setProgress(message, percent) {
    status.textContent = message;
    progress.hidden = percent === undefined;
    if (percent !== undefined) progress.value = percent;
  }

  function resultNotes() {
    const notes = [];
    if (skipped) notes.push('有 ' + skipped + ' 条候选记录无法读取或存在序号冲突。请核对原件。');
    if (result.anomalies.length) notes.push('有 ' + result.anomalies.length + ' 项配对异常，相关行程未计入。');
    if (result.reviewEffect.unresolvedCount) notes.push('有 ' + result.reviewEffect.unresolvedCount + ' 个行程待复核，暂未计入。');
    const { start, end } = HOLIDAY_COVERAGE;
    if ((result.rules.deductGovHoliday || result.rules.deductCompensatory || result.rules.deductHalfDay) &&
        result.dailyRows.some(row => row.date < start || row.date > end)) {
      notes.push('部分日期超出公众假期数据覆盖范围（' + start + ' 至 ' + end + '）。这些日期的假期暂未扣除。');
    }
    if (result.rules.deductSchoolBreak) notes.push('学校假期仅扣除已收录的澳城大寒假。');
    if (statistics.some(row => row.periodKey === 'uncovered-academic-year')) {
      notes.push('校历未覆盖的日期单独汇总，可切换自然年查阅。');
    }
    if (isAcademic() && statistics.some(row => row.periodNote)) {
      notes.push('2027 年学年交界日期暂定。请核对澳门城市大学公布的校历。');
    }
    return notes;
  }

  function showResult() {
    statistics = buildSummaryByMode(result.dailyRows, mode());
    const notes = resultNotes();
    const days = statistics.reduce((sum, row) => sum + row.validDays, 0);
    query('[data-travel-total]').textContent = days + ' 天有效离境';
    const { firstDate, lastDate, recordCount, intervalCount, reviewEffect } = result;
    query('[data-travel-summary]').textContent =
      (region() === 'macao' ? '澳门' : '香港') + '方向，按' + modeName() + '汇总。' +
      '已识别 ' + recordCount + ' 条记录，日期为 ' + firstDate + ' 至 ' + lastDate +
      '。自动计入 ' + intervalCount + ' 个行程。' +
      (reviewEffect.selectedCount ? reviewEffect.message : '');
    const warnings = query('[data-travel-warnings]');
    warnings.textContent = notes.join(' ');
    warnings.hidden = !notes.length;

    const tableBody = query('[data-travel-summary-rows]');
    tableBody.replaceChildren(...statistics.map(row => buildTableRow([
      [row.periodLabel, ...(isAcademic() ? [row.periodRange, row.periodNote] : [])].filter(Boolean).join(' · '),
      row.validDays, row.naturalDays, row.totalDeductDays, ...summaryKeys.map(key => row[key]),
    ])));
    if (!statistics.length) {
      const row = tableBody.insertRow();
      const cell = row.insertCell();
      cell.colSpan = tableLabels.length;
      cell.textContent = '当前无可计入的离境日期。请核对原始记录、适用地区和行程复核。';
    }

    const anomalies = query('[data-travel-anomalies]');
    anomalies.hidden = !result.anomalies.length;
    anomalies.querySelector('ul').replaceChildren(...result.anomalies.map(item =>
      makeElement('li', '记录 ' + item.recordNo + ' · ' + item.date + ' · ' + item.type + ' · ' + item.portRaw),
    ));
    fallback.hidden = true;
    fallback.querySelector('textarea').value = '';
    exportStatus.textContent = '';
    exports.forEach(button => { button.disabled = !statistics.length; });
    output.hidden = false;
    placeholder.hidden = true;
  }

  function applyReview() {
    result = applyReviewDecisions(base, region(), Object.fromEntries(decisions));
    showResult();
  }

  function showReview() {
    review.hidden = !base.reviewItems.length;
    const items = base.reviewItems.map(item => {
      const group = makeElement('fieldset');
      group.className = 'field';
      const legend = makeElement('legend', '记录 ' + item.recordNo);
      const label = makeElement('label', '行程归属');
      const selector = makeElement('select');
      selector.id = 'travel-' + item.id;
      label.htmlFor = selector.id;
      for (const [value, name] of [
        ['pending', '待确认'], ['macao', '计入澳门'], ['hongkong', '计入香港'], ['exclude', '不计入'],
      ]) {
        const option = makeElement('option', name);
        option.value = value;
        selector.append(option);
      }
      selector.value = decisions.get(item.id) || 'pending';
      selector.addEventListener('change', () => {
        decisions.set(item.id, selector.value);
        applyReview();
        status.textContent = '已更新行程复核结果。';
      });
      group.append(legend, makeElement('p', item.date + ' · ' + item.portRaw + '。' + item.reason), label, selector);
      return group;
    });
    query('[data-travel-review-items]').replaceChildren(...items);
  }

  function recalculate() {
    if (!records.length) return;
    const enabledRules = Object.fromEntries(rules.map(([name]) => [name, !field(name).disabled && field(name).checked]));
    base = calculateResult(records, region(), enabledRules);
    applyReview();
    showReview();
  }

  function calculate(text, fromPdf) {
    const diagnostics = {};
    records = parseMigrationRecords(text, diagnostics);
    if (!records.length) {
      setProgress('');
      const message = fromPdf && !text.trim()
        ? '这份 PDF 没有可读取的文字。请使用可复制文字的原版 PDF。'
        : '未识别到出入境记录。请核对原始序号、方向、日期、证件和口岸。';
      showError(message, field(fromPdf ? 'pdf' : 'text'));
      return;
    }
    skipped = diagnostics.skipped;
    recalculate();
    setProgress('已识别 ' + records.length + ' 条记录。');
    outputHeading.focus();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    changeInput();
    const fromPdf = field('source').value === 'pdf';
    if (!fromPdf) {
      const text = field('text').value;
      if (!text.trim() || text.length > maxRecordTextLength) {
        showError(text.length > maxRecordTextLength ? '文字过长。可按日期范围分批计算。' : '请粘贴出入境记录的表格文字。', field('text'));
        return;
      }
      calculate(text, false);
      updateControls();
      return;
    }
    const file = field('pdf').files[0];
    if (!file || file.size > localPdfMaxBytes) {
      showError(file ? 'PDF 超过 25 MB。请改用粘贴表格文字。' : '请选择出入境记录 PDF。', field('pdf'));
      return;
    }
    busy = true;
    updateControls();
    let text;
    try {
      setProgress('正在载入本地 PDF 解析器。', 5);
      text = await readLocalPdfText(file, (page, total) => {
        setProgress('正在读取第 ' + page + ' 页，共 ' + total + ' 页。', 10 + (85 * page / total));
      });
    } catch (problem) {
      let message = 'PDF 无法读取。请核对格式和完整性，或改用粘贴表格文字。';
      if (problem instanceof LocalPdfLimitError) message = problem.message;
      else if (problem?.name === 'PasswordException') message = '这份 PDF 需要密码。请使用无需密码的版本，或改用粘贴表格文字。';
      showError(message, field('pdf'));
    } finally {
      setProgress('');
      busy = false;
      updateControls();
    }
    if (text !== undefined) calculate(text, true);
  });

  field('source').addEventListener('change', changeInput);
  field('pdf').addEventListener('change', changeInput);
  field('text').addEventListener('input', changeInput);
  field('region').addEventListener('change', () => {
    updateControls();
    recalculate();
  });
  field('mode').addEventListener('change', () => {
    preferredMacaoMode = mode();
    if (result) showResult();
  });
  rules.forEach(([name]) => field(name).addEventListener('change', recalculate));
  clear.addEventListener('click', () => {
    field('pdf').value = '';
    field('text').value = '';
    changeInput();
    field(field('source').value === 'pdf' ? 'pdf' : 'text').focus();
    status.textContent = '已清除本页的输入和结果。';
  });
  demo.addEventListener('click', () => {
    field('pdf').value = '';
    field('source').value = 'text';
    field('text').value = region() === 'macao' ? sampleRecords : sampleRecords.replaceAll('横琴口岸', '罗湖口岸');
    form.requestSubmit();
  });

  function exportNotes() {
    const { firstDate, lastDate } = result;
    const enabled = rules.filter(([name]) => result.rules[name]).map(([, label]) => label);
    return [
      (region() === 'macao' ? '澳门' : '香港') + '方向，按' + modeName() + '汇总。记录日期 ' + firstDate + ' 至 ' + lastDate + '。',
      enabled.length ? '启用扣除项为' + enabled.join('、') + '。' : '本次未启用任何扣除项。',
      ...resultNotes(),
      '各项扣除可重叠。同日按最大值扣除。',
      '结果供个人核对。正式用途请以学校或主管部门的要求为准。',
      '由 MethodsDesk 港澳出入境时长工具生成。原计算器作者为 LeeV李威。',
    ];
  }

  exports[0].addEventListener('click', async () => {
    const snapshot = statistics;
    const lines = snapshot.map(row =>
      [row.periodLabel, ...(isAcademic() ? [row.periodRange, row.periodNote] : [])].filter(Boolean).join(' · ') +
      '。有效离境 ' + row.validDays + ' 天，自然离境 ' + row.naturalDays + ' 天，合计扣除 ' + row.totalDeductDays + ' 天。',
    );
    const text = [...lines, '', ...exportNotes()].join('\n');
    const copied = await copyText(text);
    if (snapshot !== statistics) return;
    exportStatus.textContent = copied ? '已复制汇总。' : '请在下方手动复制汇总。';
    fallback.hidden = copied;
    if (!copied) {
      const area = fallback.querySelector('textarea');
      area.value = text;
      area.focus();
      area.select();
    }
  });
  exports[1].addEventListener('click', () => {
    const headers = [...(isAcademic() ? ['学年', '日期范围', '学年备注'] : ['年份']), ...tableLabels.slice(1)];
    const rows = statistics.map(row => [
      row.periodLabel, ...(isAcademic() ? [row.periodRange, row.periodNote] : []),
      row.validDays, row.naturalDays, row.totalDeductDays, ...summaryKeys.map(key => row[key]),
    ]);
    downloadCsv('港澳出入境' + modeName() + '汇总.csv', [headers, ...rows, [], ...exportNotes().map(note => ['说明', note])]);
    exportStatus.textContent = '已发起汇总 CSV 下载。';
  });
  exports[2].addEventListener('click', () => {
    const headers = [
      '日期', '年份', ...(isAcademic() ? ['澳城大学年', '学年备注'] : []),
      '自然离境天数', ...deductionHeaders, '合计扣除', '有效离境天数', '假期名称', '学校假期',
    ];
    const rows = result.dailyRows.map(row => {
      const year = isAcademic() ? getCityuAcademicYear(row.date) : null;
      return [
        row.date, row.year, ...(isAcademic() ? [year?.name || '未覆盖学年', year?.note || ''] : []),
        row.naturalDay, ...dailyKeys.map(key => row[key]), row.totalDeduct, row.validDay, row.holidayName, row.schoolEventName,
      ];
    });
    downloadCsv('港澳出入境每日明细.csv', [headers, ...rows, [], ...exportNotes().map(note => ['说明', note])]);
    exportStatus.textContent = '已发起每日明细 CSV 下载。';
  });
  updateControls();
}
