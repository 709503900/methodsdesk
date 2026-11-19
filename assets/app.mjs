import { POWER_LIMITS, planPower } from './power.mjs';
import { mountSurvey } from './survey.mjs';
import { mountQual } from './qual.mjs';

const homeTitle = 'MethodsDesk 研究方法工具箱';
const views = [...document.querySelectorAll('.view')];
const navigation = [...document.querySelectorAll('[data-nav]')];
let currentView;

function showView(focusHeading = false) {
  const id = location.hash.slice(1);
  const view = views.find((item) => item.id === id) ?? views[0];
  if (view === currentView) return;
  views.forEach((item) => { item.hidden = item !== view; });
  const heading = view.querySelector('h1');
  document.title = view.id === 'home' ? homeTitle : `${heading.textContent} | MethodsDesk`;
  for (const link of navigation) {
    const active = link.dataset.nav === (view.id === 'about' ? 'about' : 'home');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (focusHeading) {
    window.scrollTo(0, 0);
    heading.focus({ preventScroll: true });
  }
  currentView = view;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function mountPower() {
  const form = document.querySelector('#power-form');
  const result = document.querySelector('#power-result');
  const error = document.querySelector('#power-error');
  const designField = form.elements.design;
  const tailsField = form.elements.tails;
  const effectHelp = document.querySelector('#power-effect-help');
  const directionHelp = document.querySelector('#power-direction');
  const example = document.querySelector('#power-example');
  const numbers = new Intl.NumberFormat('zh-CN');
  const probabilities = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 5, minimumFractionDigits: 5 });
  const { minEffectSize, maxEffectSize, minAlpha, maxAlpha, minTargetPower, maxTargetPower, maxSampleSize } = POWER_LIMITS;
  const limits = [
    ['effectSize', minEffectSize, maxEffectSize, '标准化效应量'],
    ['alpha', minAlpha, maxAlpha, '显著性水平'],
    ['targetPower', minTargetPower, maxTargetPower, '目标功效'],
  ];

  function updateHints() {
    effectHelp.textContent = designField.value === 'paired'
      ? '配对差值的均值除以配对差值的标准差。'
      : '均值差除以共同组内标准差。';
    directionHelp.hidden = tailsField.value !== '1';
  }

  function resetResult() {
    error.hidden = true;
    for (const [name] of limits) form.elements[name].removeAttribute('aria-invalid');
    result.replaceChildren(element('h2', '样本量结果'), element('p', '填写设计参数后计算。'));
  }

  function showError(message, field) {
    error.textContent = message;
    error.hidden = false;
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.focus();
    }
  }

  form.noValidate = true;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    resetResult();
    for (const [name, min, max, label] of limits) {
      const field = form.elements[name];
      if (!Number.isFinite(field.valueAsNumber) || field.valueAsNumber < min || field.valueAsNumber > max) {
        showError(`请输入介于 ${min} 和 ${max} 之间的${label}。`, field);
        return;
      }
    }
    const design = designField.value;
    const effectSize = form.elements.effectSize.valueAsNumber;
    const alpha = form.elements.alpha.valueAsNumber;
    const targetPower = form.elements.targetPower.valueAsNumber;
    const tails = Number(tailsField.value);
    const basis = form.elements.basis.value.trim();
    let estimate;
    try {
      estimate = planPower({ design, effectSize, alpha, targetPower, tails });
    } catch (problem) {
      showError(problem instanceof RangeError
        ? `这组参数所需样本超过本工具上限 ${numbers.format(maxSampleSize)}。独立样本按每组计，配对样本按对计。`
        : '计算未完成，请检查参数后重试。');
      return;
    }
    const { sampleSize, totalSampleSize, achievedPower } = estimate;
    const independent = design === 'independent';
    const label = independent ? '等额独立样本 t 检验' : '配对 t 检验';
    const units = independent
      ? `每组 ${numbers.format(sampleSize)} 人`
      : `${numbers.format(sampleSize)} 对`;
    const total = independent ? `两组共 ${numbers.format(totalSampleSize)} 人。` : '';
    const achieved = `取整后，按所设效应量计算的功效为 ${probabilities.format(achievedPower)}。`;
    const parameters = `${tails === 2 ? '双侧' : '单侧'}检验，效应量 ${effectSize}，α = ${alpha}，目标功效 ${targetPower}。`;
    const evidence = basis ? `效应量依据为${basis}。` : '';
    const record = [`事前功效分析采用${label}。`, parameters, `所需样本为${units}。`, total, achieved, evidence,
      '方法出处为 Faul 等（2007），https://doi.org/10.3758/BF03193146 。', '计算实现为 MethodsDesk v0.1.0。']
      .filter(Boolean).join('\n');

    const download = element('button', '下载计算记录', 'button secondary');
    download.type = 'button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([record], { type: 'text/plain;charset=utf-8' }));
      const link = element('a');
      link.href = url;
      link.download = 'methodsdesk-power.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const actions = element('div', '', 'form-actions');
    actions.append(download);
    const description = element('p', `${total}${achieved}`);
    result.replaceChildren(element('h2', '所需样本'), element('strong', units, 'result-value'), description,
      element('p', parameters), actions);
  });

  form.addEventListener('input', () => {
    updateHints();
    resetResult();
  });
  example.addEventListener('click', () => {
    designField.value = 'independent';
    tailsField.value = '2';
    form.elements.effectSize.value = '0.50';
    form.elements.alpha.value = '0.05';
    form.elements.targetPower.value = '0.80';
    form.elements.basis.value = '演示算例';
    updateHints();
    form.requestSubmit();
  });
  updateHints();
}

mountPower();
mountSurvey();
mountQual();
showView();
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  document.querySelector('main').focus();
});
window.addEventListener('hashchange', () => showView(true));
