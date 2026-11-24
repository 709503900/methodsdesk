import { copyText, downloadText } from './ui.mjs';

// stats::qnorm(c(.95, .975, .995)), R 4.6.0, for two-sided intervals.
const criticalValues = new Map([
  [90, 1.6448536269514715],
  [95, 1.9599639845400534],
  [99, 2.5758293035488999],
]);

const people = new Intl.NumberFormat('zh-CN');
const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });

const labels = {
  confidence: '置信水平',
  percent: '预估总体比例',
  margin: '允许误差',
  population: '总体人数',
  target: '目标有效样本量',
  returnedPercent: '预估回收比例',
  usablePercent: '回收中预估可用比例',
  capacity: '最多可邀请人数',
  comparisonReturnedPercent: '对照情景的回收比例',
  comparisonUsablePercent: '对照情景的回收中可用比例',
};

class SurveyInputError extends RangeError {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

function positiveInteger(value, field, minimum = 1) {
  const count = Number(value);
  if (value == null || String(value).trim() === '' || !Number.isSafeInteger(count) || count < minimum) {
    throw new SurveyInputError(field, `请为${labels[field]}输入不小于 ${minimum} 的整数。`);
  }
  return count;
}

function optionalCount(value, field, minimum = 1) {
  return value == null || value === '' ? null : positiveInteger(value, field, minimum);
}

function proportion(value, field, allowFull = false) {
  const percent = Number(value);
  const fraction = percent / 100;
  if (!(fraction > 0 && (allowFull ? fraction <= 1 : fraction < 1))) {
    const upper = allowFull ? '不超过' : '小于';
    throw new SurveyInputError(field, `${labels[field]}应大于 0 且${upper} 100。`);
  }
  return fraction;
}

export function calculateSurveySize({ confidence, percent, margin, population }) {
  const z = criticalValues.get(Number(confidence));
  if (z === undefined) throw new SurveyInputError('confidence', '请选择 90%、95% 或 99% 置信水平。');
  const p = proportion(percent, 'percent');
  const d = proportion(margin, 'margin');
  const N = optionalCount(population, 'population', 2);
  const variance = p * (1 - p);
  const unadjusted = (z * Math.sqrt(variance) / d) ** 2;
  const raw = N === null ? unadjusted : N / (1 + (N - 1) / unadjusted);
  const sample = Math.max(1, Math.ceil(raw));
  if (!Number.isSafeInteger(sample)) {
    throw new SurveyInputError('margin', '该精度对应的样本量超出可精确表示的整数范围。请检查允许误差。');
  }

  const census = sample === N;
  const correction = N === null ? 1 : (N - sample) / (N - 1);
  const achievedMargin = 100 * z * Math.sqrt(variance / sample * correction);
  const smallExpectedClass = !census && sample * Math.min(p, 1 - p) < 10;
  const smallRemainingClass = N !== null && !census && (N - sample) * Math.min(p, 1 - p) < 10;
  const intervalAtBoundary = !census && achievedMargin / 100 >= Math.min(p, 1 - p);
  return { sample, N, raw, z, p, d, achievedMargin, census, smallExpectedClass, smallRemainingClass, intervalAtBoundary };
}

function exactRate(percent) {
  // Express the entered decimal percentage as an integer fraction for upward rounding.
  const [decimalValue, exponent = '0'] = String(Number(percent)).split('e');
  const [whole, digits = ''] = decimalValue.split('.');
  const shift = Number(exponent) - digits.length - 2;
  const significant = BigInt(whole + digits);
  if (shift >= 0) return [significant * 10n ** BigInt(shift), 1n];
  return [significant, 10n ** BigInt(-shift)];
}

function evaluateInvitationScenario(goal, available, returnedPercent, usablePercent, returnedField, usableField) {
  const returnedRate = proportion(returnedPercent, returnedField, true);
  const usableRate = proportion(usablePercent, usableField, true);
  const [responseNumerator, responseDenominator] = exactRate(returnedPercent);
  const [usableNumerator, usableDenominator] = exactRate(usablePercent);
  const numerator = BigInt(goal) * responseDenominator * usableDenominator;
  const denominator = responseNumerator * usableNumerator;
  const required = (numerator + denominator - 1n) / denominator;
  if (required > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SurveyInputError(returnedField, '发放量超出可精确表示的整数范围。请检查这组回收与可用比例。');
  }

  const invitations = Number(required);
  const yieldRate = returnedRate * usableRate;
  return {
    goal,
    invitations,
    returnedRate,
    usableRate,
    yieldRate,
    available,
    expectedAtCapacity: available === null ? null : available * yieldRate,
    feasible: available === null ? null : invitations <= available,
  };
}

export function calculateInvitations({ target, returnedPercent, usablePercent, capacity }) {
  const goal = positiveInteger(target, 'target');
  const available = optionalCount(capacity, 'capacity', 0);
  return evaluateInvitationScenario(goal, available, returnedPercent, usablePercent, 'returnedPercent', 'usablePercent');
}

export function calculateInvitationPlan(values, linkedPopulation = null) {
  const listedCapacity = optionalCount(values.capacity, 'capacity', 0);
  const available = linkedPopulation === null ? listedCapacity : Math.min(listedCapacity ?? linkedPopulation, linkedPopulation);
  const base = calculateInvitations({ ...values, capacity: available });
  const { comparisonReturnedPercent, comparisonUsablePercent } = values;
  const compare = [comparisonReturnedPercent, comparisonUsablePercent].some((value) => value != null && value !== '');
  const comparison = compare ? evaluateInvitationScenario(base.goal, available, comparisonReturnedPercent,
    comparisonUsablePercent, 'comparisonReturnedPercent', 'comparisonUsablePercent') : null;
  return { base, comparison, linkedPopulation, listedCapacity };
}

const surveyNotes = `
  <details class="method-notes">
    <summary>公式、算例与来源</summary>
    <p>本工具用于简单随机抽样下估计单个二分类比例。大总体近似为 <code>n₀ = z²p(1 − p) / d²</code>。已知有限总体人数 <code>N</code> 且不放回抽样时，使用 <code>n = N n₀ / (N − 1 + n₀)</code>。样本量计算结果向上取整。</p>
    <p><code>p</code> 表示预估总体比例，<code>d</code> 表示绝对误差。<code>z</code> 是双侧标准正态临界值。90%、95% 和 99% 的临界值来自 R 4.6.0 的 <code>stats::qnorm</code>。</p>
    <p>以 95% 置信水平、预估比例 50% 和允许误差 5 个百分点为例，大总体下所需样本量约为 384.146，向上取整为 385。已知总体为 1,000 人时，修正后约为 277.733，向上取整为 278。</p>
    <p>该精度仅指抽样误差。便利样本或公开链接的自愿填答无法沿用此抽样精度。分层、整群和加权调查需依据实际设计估计精度。接近全查时，即使已抽样本量较大，未抽取部分的某一类人数仍可能过少，导致正态近似失准。本站以预期人数低于 10 作为提醒。</p>
    <p><a href="https://www.wiley-vch.de/en/areas-interest/mathematics-statistics/sampling-techniques-978-0-471-16240-7">Cochran（1977），《Sampling Techniques》第 3、4 章</a> · <a href="https://online.stat.psu.edu/stat506/Lesson02">Penn State STAT 506 抽样方差与样本量</a> · <a href="https://online.stat.psu.edu/stat500/Lesson04">Penn State STAT 500 正态近似筛查</a> · <a href="https://profiles.wustl.edu/en/publications/normal-approximation-to-the-hypergeometric-distribution-in-nonsta/">Lahiri 等，有限总体的正态近似</a> · <a href="https://aapor.org/standards-and-ethics/disclosure-standards/">AAPOR 抽样方法披露标准</a></p>
  </details>`;

const invitationNotes = `
  <details class="method-notes">
    <summary>公式、算例与来源</summary>
    <p>预计有效产出比例等于预估回收比例乘以回收中的预估可用比例。每位受邀对象最多计入一份答卷。将目标有效样本量除以预计有效产出比例，再向上取整。实际发放应依据可邀请名单、预算与回收进度调整。</p>
    <p>目标为 385 份有效问卷，预计邀请对象中有 60% 回收，回收问卷中有 90% 可用。预计有效产出比例为 54%，据此至少计划邀请 713 人。</p>
    <p>这是基于预估比例的发放预算。实际回收存在波动，增加邀请也无法消除无应答偏差。正式报告 AAPOR 回应率时，应使用调查类型适用的样本处置分类和分母。公开链接的邀请分母通常未知。</p>
    <p><a href="https://aapor.org/standards-and-ethics/standard-definitions/">AAPOR《Standard Definitions》第十版</a> · <a href="https://www.census.gov/about/policies/quality/standards/appendixd3a.html">美国人口普查局调查结果率定义</a></p>
  </details>`;

function renderField(prefix, name, options = {}) {
  const id = `${prefix}-${name}`;
  const { label = labels[name], help = '', integer = false, optional = false } = options;
  const reference = help ? ` aria-describedby="${id}-help"` : '';
  const input = name === 'confidence'
    ? `<select name="${name}" id="${id}" required>
         <option value="">选择置信水平</option>
         <option value="90">90%</option>
         <option value="95">95%</option>
         <option value="99">99%</option>
       </select>`
    : `<input name="${name}" id="${id}" type="number" step="${integer ? '1' : 'any'}"
         inputmode="${integer ? 'numeric' : 'decimal'}"${optional ? '' : ' required'}${reference}>`;
  return `<div class="field">
    <label for="${id}">${label}</label>
    ${input}
    ${help ? `<small id="${id}-help">${help}</small>` : ''}
    <small class="field-error error" id="${id}-error" role="alert" hidden></small>
  </div>`;
}

const surveyFields = `
  <div class="field-grid">
    ${renderField('survey', 'confidence')}
    ${renderField('survey', 'percent', {
      label: '预估总体比例（%）', help: '比例未知时可用 50% 作保守估计。',
    })}
    ${renderField('survey', 'margin', {
      label: '允许误差（百分点）', help: '输入 5 表示目标精度为 ±5 个百分点。',
    })}
    ${renderField('survey', 'population', {
      label: '总体人数（选填）', help: '填入有限总体人数后，按不放回抽样修正。', integer: true, optional: true,
    })}
  </div>`;

const invitationFields = `
  <div class="field-grid">
    ${renderField('invites', 'target', { integer: true })}
    ${renderField('invites', 'returnedPercent', {
      label: '预估回收比例（%）', help: '用交回答卷的人数除以全部受邀人数。两者均按人去重。全部受邀人数包括未送达的对象。',
    })}
    ${renderField('invites', 'usablePercent', {
      label: '回收中预估可用比例（%）', help: '用有可分析答卷的人数除以交回答卷的人数。两者均按人去重。',
    })}
    ${renderField('invites', 'capacity', {
      label: '最多可邀请人数（选填）', help: '填去重后的可邀请人数或预算可支持的人数。', integer: true, optional: true,
    })}
  </div>
  <div class="callout" data-linked-survey hidden>
    <p data-link-description></p>
    <button class="button secondary" type="button" data-detach-survey>解除样本量关联</button>
  </div>
  <details class="method-notes" data-invitation-comparison>
    <summary>比较另一组回收假设</summary>
    <p>保留目标样本量和邀请上限。填写另一组比例后查看所需邀请人数的变化。</p>
    <div class="field-grid">
      ${renderField('invites', 'comparisonReturnedPercent', { label: '对照情景的回收比例（%）', optional: true })}
      ${renderField('invites', 'comparisonUsablePercent', { label: '对照情景的回收中可用比例（%）', optional: true })}
    </div>
  </details>`;

function toolTemplate({ name, fields, action, heading, placeholder, notes }) {
  return `<div class="tool-grid">
    <form class="tool-form" data-${name}-form novalidate>
      ${fields}
      <div class="form-actions">
        <button class="button" type="submit">${action}</button>
        <button class="button secondary" type="button" data-example>载入演示参数</button>
      </div>
      <p class="error" data-form-error role="alert" hidden></p>
    </form>
    <div class="tool-result" data-${name}-result>
      <h2 tabindex="-1">${heading}</h2>
      <p data-result-status role="status">${placeholder}</p>
      <div data-output hidden></div>
    </div>
  </div>${notes}`;
}

function surveyWarnings(estimate) {
  const warnings = [];
  if (estimate.census) {
    warnings.push('达到所设精度需要全查。抽样误差为零的前提是取得总体中每个人的有效回答。');
  }
  if (estimate.smallExpectedClass) {
    warnings.push('样本中较少一类的预期人数低于 10。请用适合稀有比例或小样本的区间方法核查精度。');
  }
  if (estimate.smallRemainingClass) {
    warnings.push('未抽取部分中较少一类的预期人数低于 10。请核查基于超几何分布的精度，或考虑全查。');
  }
  if (estimate.intervalAtBoundary) {
    warnings.push('正态近似区间触及或跨出 0% 至 100%。请用适合边界比例的方法核查精度。');
  }
  return warnings;
}

function formatEstimate(value) {
  return value > 0 && value < 0.000001 ? value.toExponential(3) : decimal.format(value);
}

export function buildSurveyRecord(values, estimate) {
  const population = estimate.N === null
    ? '采用大总体近似。'
    : `总体为 ${estimate.N} 人，使用有限总体修正。`;
  return [
    'MethodsDesk 问卷样本量记录',
    '按简单随机抽样估计单个总体比例，采用双侧正态近似。',
    `置信水平 ${Number(values.confidence)}%，预估总体比例 ${values.percent}%，允许误差 ±${values.margin} 个百分点。`,
    population,
    estimate.N === null ? '使用 n₀ = z²p(1 − p) / d²。' : '使用 n₀ = z²p(1 − p) / d²，再用 n = N n₀ / (N − 1 + n₀) 修正。',
    `正态临界值为 ${estimate.z}。连续解为 ${estimate.raw}，向上取整需要 ${estimate.sample} 份有效答卷。`,
    `取整后按所设总体比例计算的误差半宽为 ${estimate.achievedMargin} 个百分点。`,
    ...surveyWarnings(estimate),
    '此精度计算只计入简单随机抽样的抽样误差。',
    '公式依据为 Cochran（1977），《Sampling Techniques》第 3、4 章。https://www.wiley-vch.de/en/areas-interest/mathematics-statistics/sampling-techniques-978-0-471-16240-7',
    '临界值由 R 4.6.0 的 stats::qnorm 计算。',
  ].join('\n');
}

function scenarioRecord(label, scenario, returnedPercent, usablePercent) {
  const lines = [
    `${label}假设回收 ${returnedPercent}%，其中 ${usablePercent}% 可用。预计有效产出为 ${formatEstimate(100 * scenario.yieldRate)}%。`,
    `按该情景预算需邀请 ${scenario.invitations} 人。`,
  ];
  if (scenario.available !== null) {
    lines.push(scenario.feasible ? '当前上限可覆盖该情景的邀请量。' : '当前上限低于该情景所需邀请量。');
    lines.push(`用满 ${scenario.available} 个邀请名额时，预计取得 ${formatEstimate(scenario.expectedAtCapacity)} 份有效答卷。`);
  }
  return lines;
}

export function buildInvitationRecord(values, plan, linked = null) {
  const { base, comparison, linkedPopulation, listedCapacity } = plan;
  const lines = ['MethodsDesk 问卷发放量记录', `目标为 ${base.goal} 份有效答卷。`];
  if (linked && base.goal === linked.estimate.sample) {
    lines.push(`目标取自问卷样本量工具。置信水平 ${linked.values.confidence}%，预估总体比例 ${linked.values.percent}%，允许误差 ±${linked.values.margin} 个百分点。`);
  } else if (linked) {
    lines.push(`当前目标由用户编辑。所关联的问卷样本量计算为 ${linked.estimate.sample} 份。`);
  }
  if (linkedPopulation !== null) lines.push(`所关联的抽样总体为 ${linkedPopulation} 人。`);
  if (listedCapacity !== null) lines.push(`名单或预算上限为 ${listedCapacity} 人。`);
  lines.push(...scenarioRecord('基准情景', base, values.returnedPercent, values.usablePercent));
  if (comparison) {
    lines.push(...scenarioRecord('对照情景', comparison, values.comparisonReturnedPercent, values.comparisonUsablePercent));
  }
  lines.push(
    '计算时用目标样本量除以预计回收比例和回收中可用比例的乘积，再向上取整。',
    '邀请人数按预估比例预算。实际回收取决于执行过程与回收波动。这些规划比例与 AAPOR 报告的正式调查回应率各有定义。',
    '回应率的报告标准参见 AAPOR《Standard Definitions》第十版。https://aapor.org/standards-and-ethics/standard-definitions/',
  );
  return lines.join('\n');
}

function surveyOutput(values, estimate) {
  const context = estimate.N === null ? '大总体近似' : `有限总体 ${people.format(estimate.N)} 人`;
  return `<p class="result-value">${people.format(estimate.sample)} <span>份</span></p>
    <p>${Number(values.confidence)}% 置信水平，预估比例 ${formatEstimate(100 * estimate.p)}%，允许误差 ±${formatEstimate(100 * estimate.d)} 个百分点。</p>
    <p>${context}。取整后估计误差半宽为 ${formatEstimate(estimate.achievedMargin)} 个百分点。</p>
    ${surveyWarnings(estimate).map((warning) => `<p class="callout">${warning}</p>`).join('')}`;
}

function invitationOutput({ base, comparison }) {
  const comparisonRow = comparison === null ? '' : `
    <div class="table-wrap" role="region" aria-label="两组回收假设的邀请量" tabindex="0">
      <table>
        <caption>两组回收假设的邀请量</caption>
        <thead><tr><th scope="col">情景</th><th scope="col">有效产出</th><th scope="col">邀请人数</th></tr></thead>
        <tbody>
          <tr><th scope="row">基准</th><td>${formatEstimate(100 * base.yieldRate)}%</td><td>${people.format(base.invitations)}</td></tr>
          <tr><th scope="row">对照</th><td>${formatEstimate(100 * comparison.yieldRate)}%</td><td>${people.format(comparison.invitations)}</td></tr>
        </tbody>
      </table>
    </div>
    <p>对照情景假设回收 ${formatEstimate(100 * comparison.returnedRate)}%，其中 ${formatEstimate(100 * comparison.usableRate)}% 可用。</p>`;

  let feasibility = '';
  if (base.available !== null) {
    const status = base.feasible ? '当前上限可覆盖基准情景的邀请量。' : '当前上限低于基准情景所需邀请量。';
    const comparisonEstimate = comparison === null ? '' : `当前上限${comparison.feasible ? '可覆盖' : '低于'}对照情景的邀请量。对照情景下预计取得 ${formatEstimate(comparison.expectedAtCapacity)} 份。`;
    feasibility = `<p class="callout">${status}发满 ${people.format(base.available)} 个名额，基准情景下预计取得 ${formatEstimate(base.expectedAtCapacity)} 份有效答卷。${comparisonEstimate}</p>`;
  }
  return `<p class="result-value">${people.format(base.invitations)} <span>人</span></p>
    <p>目标 ${people.format(base.goal)} 份有效答卷。基准情景假设回收 ${formatEstimate(100 * base.returnedRate)}%，其中 ${formatEstimate(100 * base.usableRate)}% 可用。预计有效产出为 ${formatEstimate(100 * base.yieldRate)}%。</p>
    ${comparisonRow}
    ${feasibility}
    <p>邀请人数按预估比例计算。实际有效回收可能在目标上下波动。</p>`;
}

function clearFieldError(field) {
  if (field.getAttribute('aria-invalid') !== 'true') return;
  const id = `${field.id}-error`;
  const describedBy = (field.getAttribute('aria-describedby') ?? '').split(' ').filter((value) => value && value !== id);
  if (describedBy.length) field.setAttribute('aria-describedby', describedBy.join(' '));
  else field.removeAttribute('aria-describedby');
  field.removeAttribute('aria-invalid');
  field.ownerDocument.getElementById(id).hidden = true;
}

function showFormError(form, error) {
  const field = form.elements.namedItem(error.field ?? '');
  if (field) {
    const warning = field.ownerDocument.getElementById(`${field.id}-error`);
    const details = field.closest('details');
    if (details) details.open = true;
    const describedBy = field.getAttribute('aria-describedby');
    field.setAttribute('aria-describedby', describedBy ? `${describedBy} ${warning.id}` : warning.id);
    field.setAttribute('aria-invalid', 'true');
    warning.textContent = error.message;
    warning.hidden = false;
    field.focus();
    return;
  }
  const warning = form.querySelector('[data-form-error]');
  warning.textContent = error instanceof RangeError ? error.message : '计算未完成。请检查参数后重试。';
  warning.hidden = false;
}

function formValues(form) {
  const invalid = [...form.elements].find((field) => field.validity?.badInput);
  if (invalid) throw new SurveyInputError(invalid.name, `请检查${labels[invalid.name]}的数字格式。`);
  return Object.fromEntries(new FormData(form));
}

function renderRecordActions(output, record, status, filename, handoff) {
  const doc = output.ownerDocument;
  const actions = doc.createElement('div');
  actions.className = 'form-actions result-actions';
  function addButton(label, handler) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.textContent = label;
    button.addEventListener('click', handler);
    actions.append(button);
  }

  const details = doc.createElement('details');
  details.className = 'method-notes';
  const summary = doc.createElement('summary');
  summary.textContent = '查看计算记录';
  const field = doc.createElement('textarea');
  field.setAttribute('aria-label', '计算记录');
  field.readOnly = true;
  field.rows = 8;
  field.value = record;
  details.append(summary, field);

  if (handoff) addButton('带入发放量工具', handoff);
  addButton('复制记录', async () => {
    const copied = await copyText(record);
    if (!output.contains(field)) return;
    if (copied) {
      status.textContent = '记录已复制。';
      return;
    }
    details.open = true;
    field.focus();
    field.select();
    status.textContent = '记录已选中。可使用键盘或系统菜单复制。';
  });
  addButton('下载 TXT', () => {
    downloadText(filename, record);
    status.textContent = '已发起 TXT 下载。';
  });
  output.append(actions, details);
}

function bindCalculator(container, options) {
  container.innerHTML = toolTemplate(options);
  const form = container.querySelector('form');
  const heading = container.querySelector('.tool-result h2');
  const status = container.querySelector('[data-result-status]');
  const output = container.querySelector('[data-output]');
  const formError = form.querySelector('[data-form-error]');
  const view = container.ownerDocument.defaultView;

  function invalidate(message) {
    output.hidden = true;
    output.replaceChildren();
    status.textContent = message;
    formError.hidden = true;
    form.querySelectorAll('[aria-invalid="true"]').forEach(clearFieldError);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    invalidate('');
    try {
      const { markup, record, handoff } = options.calculate(formValues(form));
      output.innerHTML = markup;
      renderRecordActions(output, record, status, options.filename, handoff);
      output.hidden = false;
      status.textContent = options.success;
      heading.focus();
    } catch (error) {
      status.textContent = options.placeholder;
      showFormError(form, error);
    }
  });

  form.addEventListener('input', (event) => {
    options.onInput?.(event);
    invalidate('参数已更改。请重新计算。');
  });

  form.querySelector('[data-example]').addEventListener('click', () => {
    options.reset?.();
    form.reset();
    for (const [name, value] of Object.entries(options.example)) form.elements.namedItem(name).value = value;
    form.requestSubmit();
  });

  return { form, invalidate, view };
}

export function mountSurvey(root = document) {
  const surveyContainer = root.querySelector('#survey-tool');
  const invitesContainer = root.querySelector('#invites-tool');
  let linked = null;
  let invitationTool;
  if (invitesContainer) {
    invitationTool = bindCalculator(invitesContainer, {
      name: 'invites',
      fields: invitationFields,
      notes: invitationNotes,
      action: '计算问卷发放量',
      heading: '预计需邀请',
      placeholder: '填写目标答卷数和预估比例后计算。',
      success: '发放量已计算。',
      filename: 'methodsdesk-invitations.txt',
      example: { target: 385, returnedPercent: 60, usablePercent: 90 },
      calculate(values) {
        const plan = calculateInvitationPlan(values, linked?.estimate.N ?? null);
        return { markup: invitationOutput(plan), record: buildInvitationRecord(values, plan, linked) };
      },
      onInput(event) {
        if (event.target.name === 'target' && linked) updateLinkedDescription();
      },
      reset: detachSurvey,
    });
    invitesContainer.querySelector('[data-detach-survey]').addEventListener('click', () => {
      detachSurvey();
      invitationTool.invalidate('已解除关联。请按当前参数重新计算。');
      invitationTool.form.elements.namedItem('target').focus();
    });
  }

  function detachSurvey() {
    linked = null;
    invitesContainer.querySelector('[data-linked-survey]').hidden = true;
  }

  function handoffSurvey(values, estimate) {
    linked = { values, estimate };
    invitationTool.form.elements.namedItem('target').value = estimate.sample;
    updateLinkedDescription();
    invitationTool.invalidate('已带入目标样本量。核对预计回收比例后计算。');
    invitationTool.view.location.hash = 'invites';
  }

  function updateLinkedDescription() {
    const { estimate } = linked;
    const target = invitationTool.form.elements.namedItem('target').value;
    const source = invitesContainer.querySelector('[data-linked-survey]');
    const origin = Number(target) === estimate.sample
      ? `已带入 ${people.format(estimate.sample)} 份有效答卷的目标。`
      : `当前目标由你填写。仍关联原先计算的 ${people.format(estimate.sample)} 份。`;
    const population = estimate.N === null ? ''
      : `抽样总体为 ${people.format(estimate.N)} 人。另填可邀请上限后，计算将采用两项上限中较小的值。`;
    source.querySelector('[data-link-description]').textContent = `${origin}${population}`;
    source.hidden = false;
  }

  if (surveyContainer) {
    bindCalculator(surveyContainer, {
      name: 'survey',
      fields: surveyFields,
      notes: surveyNotes,
      action: '计算有效样本量',
      heading: '所需有效样本量',
      placeholder: '选择置信水平并填写比例和允许误差后计算。',
      success: '样本量已计算。',
      filename: 'methodsdesk-survey-size.txt',
      example: { confidence: 95, percent: 50, margin: 5 },
      calculate(values) {
        const estimate = calculateSurveySize(values);
        const { smallExpectedClass, smallRemainingClass, intervalAtBoundary } = estimate;
        const mayTransfer = invitationTool && !smallExpectedClass && !smallRemainingClass && !intervalAtBoundary;
        return {
          markup: surveyOutput(values, estimate),
          record: buildSurveyRecord(values, estimate),
          handoff: mayTransfer ? () => handoffSurvey(values, estimate) : null,
        };
      },
    });
  }
}
