import { POWER_LIMITS, planPower, powerAtSample } from './power.mjs';
import { copyText, downloadText } from './ui.mjs';

const integer = new Intl.NumberFormat('zh-CN');
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 5 });
const METHOD_CITATION = 'Faul 等（2007），https://doi.org/10.3758/BF03193146';
const REFERENCE_IMPLEMENTATION = 'R stats::power.t.test，https://stat.ethz.ch/R-manual/R-devel/library/stats/html/power.t.test.html';

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function sampleLabel(sampleSize, paired) {
  return paired ? `${integer.format(sampleSize)} 对` : `每组 ${integer.format(sampleSize)} 人`;
}

function powerLabel(value) {
  const rounded = percent.format(value);
  return rounded === '100%' ? '接近 100%' : rounded;
}

function resultActions(record) {
  const actions = element('div', '', 'form-actions result-actions');
  const status = element('p', '', 'result-feedback');
  status.setAttribute('role', 'status');
  const manual = element('label', '计算记录', 'field');
  manual.hidden = true;
  const output = element('textarea');
  output.value = record;
  output.readOnly = true;
  output.rows = 6;
  manual.append(output);

  const copy = element('button', '复制记录', 'button secondary');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const copied = await copyText(record);
    if (!copy.isConnected) return;
    status.textContent = copied ? '已复制计算记录。' : '可选择下方文本手动复制。';
    manual.hidden = copied;
    if (!copied) {
      output.focus();
      output.select();
    }
  });

  const download = element('button', '下载记录', 'button secondary');
  download.type = 'button';
  download.addEventListener('click', () => downloadText('methodsdesk-power.txt', record));

  actions.append(copy, download);
  return [actions, status, manual];
}

function parameterDetails(parameters) {
  const list = element('dl', '', 'result-meta');
  for (const [label, value] of parameters) {
    const row = element('div');
    row.append(element('dt', label), element('dd', value));
    list.append(row);
  }
  return list;
}

function showResult(result, { mode, design, effectSize, alpha, tails, targetPower, basis }, estimate) {
  const paired = design === 'paired';
  const planning = mode === 'plan';
  const { sampleSize, totalSampleSize, achievedPower } = estimate;
  const sample = sampleLabel(sampleSize, paired);
  const power = powerLabel(achievedPower);
  const total = paired ? '' : `两组共 ${integer.format(totalSampleSize)} 人。`;
  const title = planning ? '所需最小样本量' : '给定样本量的预期功效';
  const description = planning
    ? `${total}按整数样本量计算，预期功效为 ${power}。`
    : `样本量为 ${sample}。${total}此功效以所填效应量为前提。`;
  const parameters = [
    ['研究设计', paired ? '配对 t 检验' : '独立样本等方差 t 检验，1∶1 分组'],
    ['检验方向', tails === 1 ? '单侧，效应沿预设方向' : '双侧'],
    ['标准化效应量', `${paired ? 'd_z' : 'd'} = ${effectSize}`],
    ['显著性水平 α', String(alpha)],
  ];
  if (planning) parameters.push(['目标功效', percent.format(targetPower)]);
  if (basis) parameters.push(['效应量依据', basis]);

  const record = [
    `MethodsDesk · ${planning ? '样本量规划' : '固定样本量的功效分析'}`,
    ...parameters.map(([label, value]) => `${label}  ${value}`),
    `样本量  ${sample}${paired ? '' : `，两组共 ${integer.format(totalSampleSize)} 人`}`,
    `预期功效  ${power}（计算值约为 ${achievedPower.toFixed(12)}）`,
    paired ? '效应量定义为配对差值的均值除以差值的标准差。' : '效应量定义为两组均值之差除以共同组内标准差。',
    `方法文献  ${METHOD_CITATION}`,
    `数值参照  ${REFERENCE_IMPLEMENTATION}`,
    '',
  ].join('\n');

  const header = element('div', '', 'result-header');
  const heading = element('h2', title);
  heading.tabIndex = -1;
  header.append(heading, element('strong', planning ? sample : power, 'result-value'));
  result.replaceChildren(header, element('p', description), parameterDetails(parameters), ...resultActions(record));
  heading.focus();
}

export function mountPower() {
  const form = document.querySelector('#power-form');
  const result = document.querySelector('#power-result');
  const error = document.querySelector('#power-error');
  const effectHelp = document.querySelector('#power-effect-help');
  const directionHelp = document.querySelector('#power-direction');
  const sizeLabel = document.querySelector('#power-size-label');
  const submit = document.querySelector('#power-submit');
  const example = document.querySelector('#power-example');
  const { design, tails, mode, effectSize, alpha, targetPower, sampleSize, basis } = form.elements;
  const limits = POWER_LIMITS;

  const fields = [
    [effectSize, limits.minEffectSize, limits.maxEffectSize, '标准化效应量'],
    [alpha, limits.minAlpha, limits.maxAlpha, '显著性水平'],
    [targetPower, limits.minTargetPower, limits.maxTargetPower, '目标功效'],
    [sampleSize, limits.minSampleSize, limits.maxSampleSize, '样本量'],
  ];
  const fieldErrors = new Map();
  for (const [field, min, max] of fields) {
    field.min = String(min);
    field.max = String(max);
    const feedback = element('p', '', 'field-error');
    feedback.id = `${field.id}-error`;
    feedback.hidden = true;
    field.parentElement.append(feedback);
    fieldErrors.set(field, feedback);
  }

  function clearFieldError(field) {
    const feedback = fieldErrors.get(field);
    if (!feedback || feedback.hidden) return;
    feedback.hidden = true;
    field.removeAttribute('aria-invalid');
    const descriptions = (field.getAttribute('aria-describedby') ?? '').split(/\s+/);
    const remaining = descriptions.filter((id) => id && id !== feedback.id);
    if (remaining.length) field.setAttribute('aria-describedby', remaining.join(' '));
    else field.removeAttribute('aria-describedby');
  }

  function showFieldError(field, text) {
    const feedback = fieldErrors.get(field);
    feedback.textContent = text;
    feedback.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    const description = field.getAttribute('aria-describedby') ?? '';
    field.setAttribute('aria-describedby', `${description} ${feedback.id}`.trim());
  }

  function updateForm() {
    const assess = mode.value === 'assess';
    const paired = design.value === 'paired';
    effectHelp.textContent = paired
      ? '使用配对差值的均值除以差值的标准差（d_z）。'
      : '使用两组均值之差除以共同组内标准差（Cohen’s d）。';
    directionHelp.hidden = tails.value !== '1';
    targetPower.disabled = assess;
    targetPower.closest('.field').hidden = assess;
    sampleSize.disabled = !assess;
    sampleSize.closest('.field').hidden = !assess;
    sizeLabel.textContent = paired ? '配对数' : '每组样本量';
    submit.textContent = assess ? '计算预期功效' : '计算样本量';
  }

  function prompt(rerun = false) {
    const heading = mode.value === 'assess' ? '预期功效' : '样本量结果';
    const instruction = rerun ? '参数已更新。请重新计算。' : '填写设计参数后计算。';
    result.replaceChildren(element('h2', heading), element('p', instruction));
  }

  function validate() {
    let firstInvalid;
    for (const [field, min, max, label] of fields) {
      clearFieldError(field);
      if (field.disabled) continue;
      const value = field.valueAsNumber;
      if (value >= min && value <= max && (field !== sampleSize || Number.isInteger(value))) continue;
      const message = field === sampleSize
        ? `请输入 ${integer.format(min)} 至 ${integer.format(max)} 之间的整数。`
        : `请输入 ${min} 至 ${max} 之间的${label}。`;
      showFieldError(field, message);
      firstInvalid ??= field;
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  let hasResult = false;
  form.noValidate = true;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!validate()) return;

    const inputs = {
      mode: mode.value,
      design: design.value,
      tails: Number(tails.value),
      effectSize: effectSize.valueAsNumber,
      alpha: alpha.valueAsNumber,
      targetPower: targetPower.valueAsNumber,
      basis: basis.value.trim(),
    };
    let estimate;
    try {
      if (inputs.mode === 'assess') {
        const count = sampleSize.valueAsNumber;
        const achievedPower = powerAtSample({ ...inputs, sampleSize: count });
        estimate = { sampleSize: count, totalSampleSize: inputs.design === 'paired' ? count : count * 2, achievedPower };
      } else {
        estimate = planPower(inputs);
      }
    } catch (failure) {
      const tooLarge = failure instanceof RangeError && inputs.mode === 'plan';
      error.textContent = tooLarge
        ? `达到目标功效需要超过 ${sampleLabel(limits.maxSampleSize, inputs.design === 'paired')}。可切换到给定样本量，查看可招募规模对应的预期功效。`
        : '计算未完成。请检查输入后重试。';
      error.hidden = false;
      error.tabIndex = -1;
      error.focus();
      return;
    }
    hasResult = true;
    showResult(result, inputs, estimate);
  });

  form.addEventListener('input', (event) => {
    error.hidden = true;
    if (event.target === mode) {
      clearFieldError(targetPower);
      clearFieldError(sampleSize);
    }
    if (event.target === design || event.target === tails || event.target === mode) updateForm();
    clearFieldError(event.target);
    if (hasResult || event.target === mode) {
      prompt(hasResult);
      hasResult = false;
    }
  });

  example.addEventListener('click', () => {
    const paired = design.value === 'paired';
    tails.value = '2';
    effectSize.value = '0.50';
    alpha.value = '0.05';
    targetPower.value = '0.80';
    sampleSize.value = paired ? '34' : '64';
    basis.value = '演示算例';
    updateForm();
    form.requestSubmit();
  });
  updateForm();
}
