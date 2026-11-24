import { copyText, downloadText } from "./ui.mjs";

const informationPowerSource = "https://doi.org/10.1177/1049732315617444";
const saturationSource = "https://doi.org/10.1371/journal.pone.0232076";
const saturationFigure = "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232076#pone-0232076-g003";
const reflexiveSource = "https://doi.org/10.1080/2159676X.2019.1704846";

// Guest, Namey & Chen (2020), Fig. 3. New themes per interview.
export const guestFigure3 = Object.freeze([17, 8, 5, 7, 4, 3, 1, 0, 2, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);

const interviewFields = [
  { name: "aim", label: "研究目标", prompt: "这项研究准备回答哪个问题？涉及哪些情境？" },
  { name: "specificity", label: "样本特异性", prompt: "哪些纳入条件能找到熟悉该经验的人？哪些差异需要覆盖？" },
  { name: "theory", label: "既有理论", prompt: "现有概念如何帮助访谈和解释？探索性研究可记录理论尚待发展。" },
  { name: "dialogue", label: "访谈对话质量", prompt: "记录获取具体叙述的安排，并说明将如何通过试访或前期访谈复核。" },
  { name: "analysis", label: "分析策略", prompt: "准备深入分析个案、比较不同受访者的叙述，还是采用其他分析策略？" },
  { name: "plan", label: "初始招募计划", prompt: "填写你拟定的人数或范围。可记录各类参与者的招募安排。" },
  { name: "review", label: "复核节点与调整条件", prompt: "记录何时审阅资料，以及在哪些情况下继续、调整或结束招募。" },
];

export function interviewRecord(values) {
  const sections = interviewFields.map(({ name, label }) => {
    const value = values[name]?.trim();
    if (!value) throw new Error(`请填写「${label}」。`, { cause: name });
    return `${label}\n${value}`;
  });

  return [
    "访谈样本规划记录",
    ...sections,
    `方法依据\nMalterud, Siersma & Guassora（2016），Sample Size in Qualitative Interview Studies。\n${informationPowerSource}`,
  ].join("\n\n");
}

export function parseNewCodeCounts(input) {
  // Spreadsheet copies can end with one row terminator. Preserve every other
  // row and cell boundary so missing counts cannot shift interview numbers.
  const source = input.replace(/(?:\r\n|\r|\n)$/u, "")
    .replace(/[０-９]/gu, (digit) => String(digit.charCodeAt(0) - 0xff10));
  if (!source.trim()) throw new Error("请按顺序填写每次访谈的新增编码数。", { cause: "counts" });

  const tokens = source.split(/[,，、][ \t]*(?:\r?\n)?|\r\n?|\n|\t/u)
    .flatMap((part) => part.trim().split(/\s+/u));
  return tokens.map((token, index) => {
    if (!/^\d+$/u.test(token) || !Number.isSafeInteger(Number(token))) {
      throw new Error(`第 ${index + 1} 个位置须填写非负整数。无新增编码的访谈请填 0。`, { cause: "counts" });
    }
    return Number(token);
  });
}

export function assessSaturation(counts, baseSize, runLength, thresholdPercent) {
  if (!Number.isSafeInteger(baseSize) || baseSize < 1) {
    throw new Error("基准访谈数须为正整数。", { cause: "base" });
  }
  if (!Number.isSafeInteger(runLength) || runLength < 1) {
    throw new Error("窗口长度须为正整数。", { cause: "window" });
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
    throw new Error("新增信息阈值须介于 0% 和 100%。", { cause: "threshold" });
  }
  if (!Number.isSafeInteger(baseSize + runLength) || counts.length - baseSize < runLength) {
    throw new Error(`请提供基准访谈和至少一个完整窗口的编码数。当前共有 ${counts.length} 次访谈。`, { cause: "counts" });
  }
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("每次访谈的新增编码数须为非负整数。", { cause: "counts" });
  }
  if (!Number.isSafeInteger(counts.reduce((sum, count) => sum + count, 0))) {
    throw new Error("编码总数超出可精确计算的范围。", { cause: "counts" });
  }

  const baseCodes = counts.slice(0, baseSize).reduce((sum, count) => sum + count, 0);
  if (baseCodes === 0) {
    throw new Error("基准访谈的新增编码合计为 0，比例无法计算。请复核编码记录及基准访谈设置。", { cause: "counts" });
  }

  const windows = [];
  const threshold = thresholdPercent / 100;
  let newCodes = counts.slice(baseSize, baseSize + runLength).reduce((sum, count) => sum + count, 0);
  for (let start = baseSize; start <= counts.length - runLength; start += 1) {
    const end = start + runLength;
    const ratio = newCodes / baseCodes;
    windows.push({ start: start + 1, end, newCodes, ratio, meetsThreshold: ratio <= threshold });
    if (end < counts.length) newCodes = newCodes - counts[start] + counts[end];
  }

  const first = windows.find((window) => window.meetsThreshold);
  const notation = first ? `${first.start - 1}+${runLength}` : null;
  const exceedsAfterFirst = first ? windows.filter((window) => window.end > first.end && !window.meetsThreshold).length : 0;
  return {
    counts: [...counts], baseSize, runLength, thresholdPercent, baseCodes,
    windows, first: first ?? null, notation, exceedsAfterFirst,
  };
}

const percentFormat = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 });

function thresholdSummary(result) {
  return result.first
    ? `首次达阈值的窗口是第 ${windowLabel(result.first)} 次访谈。按原文记法为 ${result.notation}。`
    : "已提供的访谈窗口均高于设定阈值。";
}

function reboundSummary(result) {
  return result.exceedsAfterFirst > 0 ? `首次达阈值之后仍有 ${result.exceedsAfterFirst} 个窗口超过阈值。` : "";
}

function windowLabel(outcome) {
  return outcome.start === outcome.end ? String(outcome.start) : `${outcome.start} 至 ${outcome.end}`;
}

export function saturationRecord(result, usingExample = false) {
  const origin = usingExample ? `Guest 等（2020）图 3 的示例计数\n${saturationFigure}` : "研究者录入的计数";
  const parameters = [
    `基准访谈数 ${result.baseSize} 次`,
    `基准编码合计 ${result.baseCodes} 个`,
    `窗口长度 ${result.runLength} 次访谈`,
    `新增信息阈值 ≤${result.thresholdPercent}%`,
    `共纳入 ${result.counts.length} 次已编码的访谈`,
  ];
  const windows = result.windows.map((outcome) => [
    windowLabel(outcome),
    `${outcome.newCodes}/${result.baseCodes}`,
    percentFormat.format(outcome.ratio),
    outcome.meetsThreshold ? "是" : "否",
  ].join("\t"));
  return [
    "编码饱和度监测记录",
    `计数来源\n${origin}`,
    `计算参数\n${parameters.join("\n")}`,
    `逐访谈新增编码数\n${result.counts.join(", ")}`,
    [thresholdSummary(result), reboundSummary(result)].filter(Boolean).join("\n"),
    `窗口访谈序号\t新增编码数/基准编码数\t新增信息比例\t达阈值\n${windows.join("\n")}`,
    `方法依据\n使用固定基准与重叠窗口。以未舍入的比例判断阈值。结果可供研究者复核材料并记录招募决定。\nGuest、Namey 和 Chen（2020）\n${saturationSource}`,
  ].join("\n\n");
}

function clearFieldError(form, error) {
  const field = form.querySelector('[aria-errormessage]');
  field?.removeAttribute("aria-errormessage");
  field?.removeAttribute("aria-invalid");
  error.hidden = true;
}

function showFieldError(form, error, problem) {
  const field = form.elements.namedItem(problem.cause ?? "");
  const messageParent = field?.closest(".field") ?? form;
  messageParent.append(error);
  error.textContent = problem.message;
  error.hidden = false;
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-errormessage", error.id);
    field.focus();
  }
}

function interviewFieldTemplate({ name, label, prompt }) {
  return `
    <div class="field">
      <label for="interview-${name}">${label}</label>
      <textarea id="interview-${name}" name="${name}" rows="2" required aria-describedby="interview-${name}-help"></textarea>
      <small id="interview-${name}-help">${prompt}</small>
    </div>`;
}

function bindInterview(container) {
  container.innerHTML = `
    <div class="tool-grid">
      <form class="tool-form" data-interview-form novalidate>
        <div class="field-grid">${interviewFields.map(interviewFieldTemplate).join("")}</div>
        <div class="form-actions">
          <button class="button" type="submit">生成规划记录</button>
        </div>
        <p id="interview-error" class="error field-error" data-interview-error role="alert" hidden></p>
      </form>
      <div class="tool-result">
        <h2 class="result-header" id="interview-result-heading" tabindex="-1">规划记录</h2>
        <p data-interview-status aria-live="polite">填写研究设计和初始招募计划后，可生成一份供复核的记录。</p>
        <div data-interview-output hidden>
          <div class="field">
            <label for="interview-record">访谈样本规划记录</label>
            <textarea id="interview-record" rows="12" readonly></textarea>
          </div>
          <div class="form-actions result-actions">
            <button class="button secondary" type="button" data-copy-record>复制记录</button>
            <button class="button secondary" type="button" data-download-record>下载 TXT</button>
          </div>
        </div>
      </div>
    </div>
    <details class="method-notes">
      <summary>方法与参考文献</summary>
      <p>信息力框架关注样本能为研究目标提供多少相关信息。初始招募人数和调整条件由研究者确定，并在资料收集与分析过程中复核。<a href="${informationPowerSource}">Malterud、Siersma 和 Guassora（2016）</a></p>
    </details>`;

  const form = container.querySelector("[data-interview-form]");
  const error = container.querySelector("#interview-error");
  const output = container.querySelector("[data-interview-output]");
  const record = container.querySelector("#interview-record");
  const status = container.querySelector("[data-interview-status]");
  const heading = container.querySelector("#interview-result-heading");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearFieldError(form, error);
    try {
      record.value = interviewRecord(Object.fromEntries(new FormData(form)));
      output.hidden = false;
      status.textContent = "规划记录已生成。";
      heading.focus();
    } catch (problem) {
      record.value = "";
      output.hidden = true;
      status.textContent = "填写研究设计和初始招募计划后，可生成一份供复核的记录。";
      showFieldError(form, error, problem);
    }
  });

  form.addEventListener("input", () => {
    clearFieldError(form, error);
    if (!output.hidden) {
      output.hidden = true;
      record.value = "";
      status.textContent = "填写内容已更新。请重新生成记录。";
    }
  });

  container.querySelector("[data-copy-record]").addEventListener("click", async () => {
    if (output.hidden || !record.value) return;
    const currentRecord = record.value;
    const copied = await copyText(currentRecord);
    if (record.value !== currentRecord || output.hidden) return;
    if (copied) {
      status.textContent = "记录已复制。";
    } else {
      record.focus();
      record.select();
      status.textContent = "记录已选中。可用键盘或系统菜单复制。";
    }
  });

  container.querySelector("[data-download-record]").addEventListener("click", () => {
    if (output.hidden || !record.value) return;
    downloadText("访谈样本规划记录.txt", record.value);
    status.textContent = "已发起 TXT 下载。";
  });
}

function bindSaturation(container) {
  container.innerHTML = `
    <div class="tool-grid">
      <form class="tool-form" data-saturation-form novalidate>
        <div class="field">
          <label for="sat-counts">每次访谈的新增编码数</label>
          <textarea id="sat-counts" name="counts" rows="4" required aria-describedby="sat-counts-help" autocapitalize="off" spellcheck="false" placeholder="17, 8, 5, 7, 4, 3, 1, 0"></textarea>
          <small id="sat-counts-help">可直接粘贴表格中的一列计数，或用逗号分隔。每个编码只计入它首次出现的访谈。无新增编码时填 0。</small>
        </div>
        <div class="field-grid">
          <div class="field">
            <label for="sat-base">基准访谈数</label>
            <input id="sat-base" name="base" type="number" min="1" step="1" value="4" inputmode="numeric" required aria-describedby="sat-base-help">
            <small id="sat-base-help">最早若干次访谈的不同编码合计为固定分母。</small>
          </div>
          <div class="field">
            <label for="sat-window">窗口长度</label>
            <input id="sat-window" name="window" type="number" min="1" step="1" value="2" inputmode="numeric" required aria-describedby="sat-window-help">
            <small id="sat-window-help">每个窗口内的连续访谈数。窗口每次向后移动一次访谈。</small>
          </div>
          <div class="field">
            <label for="sat-threshold">新增信息阈值</label>
            <select id="sat-threshold" name="threshold" aria-describedby="sat-threshold-help">
              <option value="5">≤5%</option>
              <option value="0">0%</option>
            </select>
            <small id="sat-threshold-help">依据研究设计选定。论文图 3 比较了这两种设置。</small>
          </div>
        </div>
        <div class="form-actions">
          <button class="button" type="submit">计算新增信息比例</button>
          <button class="button secondary" type="button" data-saturation-demo>载入论文图 3 示例</button>
        </div>
        <p id="sat-input-error" class="error field-error" data-saturation-error role="alert" hidden></p>
      </form>
      <div class="tool-result">
        <h2 class="result-header" id="sat-result-heading" tabindex="-1">监测结果</h2>
        <p data-saturation-status aria-live="polite">填入已编码的访谈计数后，可查看各窗口的新增信息比例。</p>
        <div data-saturation-output hidden>
          <p class="notice" data-saturation-example hidden>当前结果使用论文图 3 的示例计数。</p>
          <p data-saturation-base></p>
          <p class="callout" data-saturation-rebound hidden></p>
          <div class="form-actions result-actions">
            <button class="button secondary" type="button" data-saturation-download>下载监测记录</button>
          </div>
          <p data-saturation-download-status aria-live="polite" hidden></p>
          <details data-saturation-details>
            <summary>查看各窗口的新增信息比例</summary>
            <div class="table-wrap" role="region" aria-label="逐窗口计算结果" tabindex="0">
              <table aria-label="逐窗口计算结果">
                <thead>
                  <tr>
                    <th scope="col">访谈序号</th>
                    <th scope="col">新增编码</th>
                    <th scope="col">占基准比例</th>
                    <th scope="col">达阈值</th>
                  </tr>
                </thead>
                <tbody data-saturation-rows></tbody>
              </table>
            </div>
          </details>
        </div>
      </div>
    </div>
    <details class="method-notes">
      <summary>计算依据与适用范围</summary>
      <p>每个窗口的新增编码数除以基准访谈的新增编码总数。程序按未舍入的比例判断阈值。论文图 3 将比例显示为整数，本工具显示至多两位小数。该方法在采用归纳式主题分析的个人访谈资料中得到检验。判断依赖当前访谈顺序、稳定的编码粒度和所选阈值。研究者应结合材料的内容和研究目标决定是否继续招募。<a href="${saturationSource}">Guest、Namey 和 Chen（2020）</a> · <a href="${saturationFigure}">论文图 3</a></p>
      <p>反思性主题分析的样本充分性宜结合研究目标、材料的深度和解释过程来论证。<a href="${reflexiveSource}">Braun 和 Clarke（2021）</a></p>
    </details>`;

  const form = container.querySelector("[data-saturation-form]");
  const error = container.querySelector("#sat-input-error");
  const output = container.querySelector("[data-saturation-output]");
  const rows = container.querySelector("[data-saturation-rows]");
  const status = container.querySelector("[data-saturation-status]");
  const heading = container.querySelector("#sat-result-heading");
  const parameters = container.querySelector("[data-saturation-base]");
  const exampleNote = container.querySelector("[data-saturation-example]");
  const rebound = container.querySelector("[data-saturation-rebound]");
  const windowDetails = container.querySelector("[data-saturation-details]");
  const downloadStatus = container.querySelector("[data-saturation-download-status]");
  let usingExample = false;
  let currentResult = null;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearFieldError(form, error);
    downloadStatus.hidden = true;
    try {
      const { base, window, threshold, counts } = Object.fromEntries(new FormData(form));
      const result = assessSaturation(parseNewCodeCounts(counts), Number(base), Number(window), Number(threshold));
      const tableRows = document.createDocumentFragment();
      for (const outcome of result.windows) {
        const row = tableRows.appendChild(document.createElement("tr"));
        const label = row.appendChild(document.createElement("th"));
        label.scope = "row";
        label.textContent = windowLabel(outcome);
        row.insertCell().textContent = String(outcome.newCodes);
        row.insertCell().textContent = percentFormat.format(outcome.ratio);
        row.insertCell().textContent = outcome.meetsThreshold ? "是" : "否";
      }
      rows.replaceChildren(tableRows);
      parameters.textContent =
        `共纳入 ${result.counts.length} 次已编码的访谈。前 ${result.baseSize} 次访谈合计产生 ${result.baseCodes} 个不同编码。窗口长度为 ${result.runLength} 次访谈，新增信息阈值为 ≤${result.thresholdPercent}%。`;
      exampleNote.hidden = !usingExample;
      const note = reboundSummary(result);
      rebound.textContent = note;
      rebound.hidden = !note;
      currentResult = result;
      output.hidden = false;
      status.textContent = thresholdSummary(result);
      heading.focus();
    } catch (problem) {
      currentResult = null;
      output.hidden = true;
      status.textContent = "请核对输入后重新计算。";
      showFieldError(form, error, problem);
    }
  });

  form.addEventListener("input", (event) => {
    clearFieldError(form, error);
    if (event.target.name === "counts") usingExample = false;
    currentResult = null;
    if (!output.hidden) {
      output.hidden = true;
      windowDetails.open = false;
      rows.replaceChildren();
      status.textContent = "输入已更新。请重新计算。";
    }
  });

  container.querySelector("[data-saturation-demo]").addEventListener("click", () => {
    usingExample = true;
    form.elements.namedItem("base").value = "4";
    form.elements.namedItem("window").value = "2";
    form.elements.namedItem("threshold").value = "5";
    form.elements.namedItem("counts").value = guestFigure3.join(", ");
    form.requestSubmit();
  });

  container.querySelector("[data-saturation-download]").addEventListener("click", () => {
    if (output.hidden || !currentResult) return;
    downloadText("编码饱和度监测记录.txt", saturationRecord(currentResult, usingExample));
    downloadStatus.hidden = false;
    downloadStatus.textContent = "已发起 TXT 下载。";
  });
}

export function mountQual() {
  const interview = document.querySelector("#interview-tool");
  const saturation = document.querySelector("#saturation-tool");
  if (interview) bindInterview(interview);
  if (saturation) bindSaturation(saturation);
}
