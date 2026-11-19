// stats::qnorm(c(.95, .975, .995)), R 4.6.0, for two-sided intervals.
const criticalValues = new Map([
  [90, 1.6448536269514715],
  [95, 1.9599639845400534],
  [99, 2.5758293035488999],
]);

const people = new Intl.NumberFormat('zh-CN');
const decimal = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });

function positiveInteger(value, label, minimum = 1) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < minimum) {
    throw new RangeError(`${label}请输入不小于 ${minimum} 且可精确表示的整数。`);
  }
  return count;
}

function optionalCount(value, label, minimum = 1) {
  return value == null || value === '' ? null : positiveInteger(value, label, minimum);
}

function proportion(value, label, allowFull = false) {
  const percent = Number(value);
  const fraction = percent / 100;
  if (!(fraction > 0 && (allowFull ? fraction <= 1 : fraction < 1))) {
    const upper = allowFull ? '且不超过' : '且小于';
    throw new RangeError(`${label}请输入大于 0${upper} 100 的数值。`);
  }
  return fraction;
}

export function calculateSurveySize({ confidence, percent, margin, population }) {
  const z = criticalValues.get(Number(confidence));
  if (z === undefined) throw new RangeError('请选择 90%、95% 或 99% 置信水平。');
  const p = proportion(percent, '预估总体比例');
  const d = proportion(margin, '允许误差');
  const N = optionalCount(population, '总体人数', 2);
  const variance = p * (1 - p);
  const unadjusted = (z * Math.sqrt(variance) / d) ** 2;
  const raw = N === null ? unadjusted : N / (1 + (N - 1) / unadjusted);
  const sample = Math.max(1, Math.ceil(raw));
  if (!Number.isSafeInteger(sample)) {
    throw new RangeError('该精度对应的样本量超出可精确表示的整数范围。请检查允许误差。');
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

export function calculateInvitations({ target, returnedPercent, usablePercent, capacity }) {
  const goal = positiveInteger(target, '目标有效样本量');
  const returnedRate = proportion(returnedPercent, '预估回收比例', true);
  const usableRate = proportion(usablePercent, '回收中预估可用比例', true);
  const available = optionalCount(capacity, '最多可邀请人数', 0);
  const [responseNumerator, responseDenominator] = exactRate(returnedPercent);
  const [usableNumerator, usableDenominator] = exactRate(usablePercent);
  const numerator = BigInt(goal) * responseDenominator * usableDenominator;
  const denominator = responseNumerator * usableNumerator;
  const required = (numerator + denominator - 1n) / denominator;
  if (required > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('发放量超出可精确表示的整数范围。请检查两项比例。');
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
    feasible: available === null ? null : invitations <= available,
  };
}

const survey = `
  <div class="tool-grid">
    <form class="tool-form" data-survey-form novalidate>
      <div class="field-grid">
        <label class="field">置信水平
          <select name="confidence">
            <option value="90">90%</option>
            <option value="95" selected>95%</option>
            <option value="99">99%</option>
          </select>
        </label>
        <label class="field">预估总体比例（%）
          <input name="percent" type="number" step="any" inputmode="decimal" value="50" aria-describedby="survey-proportion-help" required>
          <small id="survey-proportion-help">比例未知时可用 50% 作保守估计。</small>
        </label>
        <label class="field">允许误差（百分点）
          <input name="margin" type="number" step="any" inputmode="decimal" value="5" aria-describedby="survey-margin-help" required>
          <small id="survey-margin-help">输入 5 表示目标精度为 ±5 个百分点。</small>
        </label>
        <label class="field">总体人数（选填）
          <input name="population" type="number" min="2" step="1" inputmode="numeric" aria-describedby="survey-population-help">
          <small id="survey-population-help">填入已界定的有限总体人数，启用有限总体修正。</small>
        </label>
      </div>
      <div class="form-actions"><button class="button" type="submit">计算有效样本量</button></div>
    </form>
    <div class="tool-result" data-survey-result aria-live="polite" aria-atomic="true"></div>
  </div>
  <details class="method-notes">
    <summary>公式、算例与来源</summary>
    <p>本工具用于简单随机抽样下估计单个二分类比例。大总体近似为 <code>n₀ = z²p(1 − p) / d²</code>。已知有限总体人数 <code>N</code> 且不放回抽样时，使用 <code>n = N n₀ / (N − 1 + n₀)</code>。最后将样本量向上取整。</p>
    <p><code>p</code> 表示预估总体比例，<code>d</code> 表示绝对误差。<code>z</code> 是双侧标准正态临界值。90%、95% 和 99% 的临界值来自 R 4.6.0 的 <code>stats::qnorm</code>。</p>
    <p>以 95% 置信水平、预估比例 50% 和允许误差 5 个百分点为例，大总体下所需样本量约为 384.146，向上取整为 385。已知总体为 1,000 人时，修正后约为 277.733，向上取整为 278。</p>
    <p>该精度仅指抽样误差。便利样本或公开链接的自愿填答无法沿用此抽样精度。分层、整群和加权调查需依据实际设计估计精度。接近全查时，即使已抽样本量较大，未抽取部分的某一类人数仍可能过少，导致正态近似失准。本站以预期人数低于 10 作为提醒。</p>
    <p><a href="https://www.wiley-vch.de/en/areas-interest/mathematics-statistics/sampling-techniques-978-0-471-16240-7">Cochran（1977），《Sampling Techniques》第 3、4 章</a> · <a href="https://online.stat.psu.edu/stat506/Lesson02">Penn State STAT 506 抽样方差与样本量</a> · <a href="https://online.stat.psu.edu/stat500/Lesson04">Penn State STAT 500 正态近似筛查</a> · <a href="https://profiles.wustl.edu/en/publications/normal-approximation-to-the-hypergeometric-distribution-in-nonsta/">Lahiri 等，有限总体的正态近似</a> · <a href="https://aapor.org/standards-and-ethics/disclosure-standards/">AAPOR 抽样方法披露标准</a></p>
  </details>`;

const invites = `
  <div class="tool-grid">
    <form class="tool-form" data-invites-form novalidate>
      <div class="field-grid">
        <label class="field">目标有效样本量
          <input name="target" type="number" min="1" step="1" inputmode="numeric" value="385" required>
        </label>
        <label class="field">预估回收比例（%）
          <input name="returnedPercent" type="number" step="any" inputmode="decimal" value="60" aria-describedby="invites-returned-help" required>
          <small id="invites-returned-help">以发出邀请的去重对象数为分母，计入未送达和未回收。</small>
        </label>
        <label class="field">回收中预估可用比例（%）
          <input name="usablePercent" type="number" step="any" inputmode="decimal" value="90" aria-describedby="invites-usable-help" required>
          <small id="invites-usable-help">以全部回收问卷为分母，按既定纳入规则估计。</small>
        </label>
        <label class="field">最多可邀请人数（选填）
          <input name="capacity" type="number" min="0" step="1" inputmode="numeric" aria-describedby="invites-capacity-help">
          <small id="invites-capacity-help">按去重后的可邀请名单或预算上限填写。</small>
        </label>
      </div>
      <div class="form-actions"><button class="button" type="submit">计算问卷发放量</button></div>
    </form>
    <div class="tool-result" data-invites-result aria-live="polite" aria-atomic="true"></div>
  </div>
  <details class="method-notes">
    <summary>公式、算例与来源</summary>
    <p>预计有效产出比例等于预估回收比例乘以回收中的预估可用比例。将目标有效样本量除以预计有效产出比例，再向上取整。实际发放应依据可邀请名单、预算与回收进度调整。</p>
    <p>目标为 385 份有效问卷，预计邀请对象中有 60% 回收，回收问卷中有 90% 可用。预计有效产出比例为 54%，据此至少计划邀请 713 人。</p>
    <p>这是基于预估比例的发放预算。实际回收存在波动，增加邀请也无法消除无应答偏差。正式报告 AAPOR 回应率时，应使用调查类型适用的样本处置分类和分母。公开链接的邀请分母通常未知。</p>
    <p><a href="https://aapor.org/standards-and-ethics/standard-definitions/">AAPOR《Standard Definitions》第十版</a> · <a href="https://www.census.gov/about/policies/quality/standards/appendixd3a.html">美国人口普查局调查结果率定义</a></p>
  </details>`;

function showError(result, error) {
  const message = result.ownerDocument.createElement('p');
  message.className = 'error';
  message.textContent = error.message;
  result.replaceChildren(message);
}

function formValues(form) {
  if (Array.from(form.elements).some((element) => element.validity?.badInput)) {
    throw new RangeError('请检查数字输入。');
  }
  return Object.fromEntries(new FormData(form));
}

export function mountSurvey(root = document) {
  const surveyContainer = root.querySelector('#survey-tool');
  const invitesContainer = root.querySelector('#invites-tool');
  if (invitesContainer) {
    invitesContainer.innerHTML = invites;
    const form = invitesContainer.querySelector('[data-invites-form]');
    const result = invitesContainer.querySelector('[data-invites-result]');
    const render = (event) => {
      event?.preventDefault();
      try {
        const { goal, invitations, returnedRate, usableRate, yieldRate, available, feasible } =
          calculateInvitations(formValues(form));
        const feasibility = available === null ? '' : feasible
          ? `<p>按当前预估，邀请量在 ${people.format(available)} 人的上限内。</p>`
          : `<p class="callout">当前上限为 ${people.format(available)} 人，少于预计所需的 ${people.format(invitations)} 人。按所填比例，现有名单的预期有效回收低于目标。</p>`;
        result.innerHTML = `<p>预计需邀请</p>
          <p class="result-value">${people.format(invitations)} <span>人</span></p>
          <p>目标 ${people.format(goal)} 份有效问卷。回收比例 ${decimal.format(100 * returnedRate)}%，其中可用比例 ${decimal.format(100 * usableRate)}%。预计有效产出比例为 ${decimal.format(100 * yieldRate)}%。</p>
          ${feasibility}`;
      } catch (error) {
        showError(result, error);
      }
    };
    form.addEventListener('submit', render);
    form.addEventListener('input', () => {
      const pending = result.ownerDocument.createElement('p');
      pending.textContent = '参数已更改，请重新计算。';
      result.replaceChildren(pending);
    });
    render();
  }

  if (surveyContainer) {
    surveyContainer.innerHTML = survey;
    const form = surveyContainer.querySelector('[data-survey-form]');
    const result = surveyContainer.querySelector('[data-survey-result]');
    const render = (event) => {
      event?.preventDefault();
      try {
        const values = formValues(form);
        const { sample, N, achievedMargin, census, smallExpectedClass, smallRemainingClass, intervalAtBoundary } =
          calculateSurveySize(values);
        const context = N === null ? '按大总体近似计算。' : `按 ${people.format(N)} 人的有限总体修正计算。`;
        const message = census
          ? '<p class="callout">达到所设精度需要全查。抽样误差为零的前提是取得总体中每个人的有效回答。</p>'
          : `<p>取整后，按模型估计的抽样误差为 ±${decimal.format(achievedMargin)} 个百分点。</p>`;
        const screen = smallExpectedClass
          ? '<p class="callout">较少一类的预期人数低于 10。正态近似可能失准，请依据适合小样本或稀有比例的区间方法重新规划。</p>'
          : '';
        const remaining = smallRemainingClass
          ? '<p class="callout">未抽取部分中较少一类的预期人数低于 10。接近全查时，正态近似可能失准，宜另核查基于超几何分布的精度或考虑全查。</p>'
          : '';
        const boundary = intervalAtBoundary
          ? '<p class="callout">近似区间触及或跨出 0% 至 100%。请考虑适合边界比例的估算方法。</p>'
          : '';
        const inviteForm = invitesContainer?.querySelector('[data-invites-form]');
        result.innerHTML = `<p>所需有效样本量</p>
          <p class="result-value">${people.format(sample)} <span>份</span></p>
          <p>${Number(values.confidence)}% 置信水平，预估比例 ${decimal.format(Number(values.percent))}%，目标误差 ±${decimal.format(Number(values.margin))} 个百分点。${context}</p>
          ${message}${screen}${remaining}${boundary}`;
        if (inviteForm && !smallExpectedClass && !smallRemainingClass && !intervalAtBoundary) {
          const button = result.ownerDocument.createElement('button');
          button.type = 'button';
          button.className = 'button secondary';
          button.textContent = '用此样本量估算发放量';
          button.addEventListener('click', () => {
            const target = inviteForm.elements.namedItem('target');
            target.value = sample;
            inviteForm.requestSubmit();
            result.ownerDocument.defaultView.location.hash = 'invites';
          });
          result.append(button);
        }
      } catch (error) {
        showError(result, error);
      }
    };
    form.addEventListener('submit', render);
    form.addEventListener('input', () => {
      const pending = result.ownerDocument.createElement('p');
      pending.textContent = '参数已更改，请重新计算。';
      result.replaceChildren(pending);
    });
    render();
  }
}
