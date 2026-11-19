const informationPowerSource = "https://doi.org/10.1177/1049732315617444";
const saturationSource = "https://doi.org/10.1371/journal.pone.0232076";
const saturationFigure = "https://doi.org/10.1371/journal.pone.0232076.g003";
const reflexiveSource = "https://doi.org/10.1080/2159676X.2019.1704846";

// Guest, Namey & Chen (2020), Fig. 3. New themes per interview.
export const guestFigure3 = Object.freeze([17, 8, 5, 7, 4, 3, 1, 0, 2, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0]);

const interviewFields = [
  { name: "aim", label: "研究目标", prompt: "这项研究准备回答哪个问题？涉及哪些情境？" },
  { name: "specificity", label: "样本特异性", prompt: "哪些纳入条件能找到熟悉该经验的人？哪些差异需要覆盖？" },
  { name: "theory", label: "既有理论", prompt: "现有概念如何帮助访谈和解释？探索性研究可记录理论尚待发展。" },
  { name: "dialogue", label: "访谈对话质量", prompt: "你预期怎样取得细致的叙述？准备如何根据试访检查这一点？" },
  { name: "analysis", label: "分析策略", prompt: "准备深入分析个案、比较不同受访者的叙述，还是采用其他分析策略？" },
  { name: "plan", label: "初始招募计划", prompt: "填写你拟定的人数或范围。可记录各类参与者的招募安排。" },
  { name: "review", label: "复核节点与调整条件", prompt: "说明何时复核资料，以及哪些证据会促使你扩招或调整招募对象。" },
];

export function interviewRecord(values) {
  const sections = interviewFields.map(({ name, label }) => {
    const value = values[name]?.trim();
    if (!value) throw new Error(`请填写「${label}」。`);
    return `${label}\n${value}`;
  });

  return [
    "访谈样本规划记录",
    ...sections,
    `方法依据\nMalterud, Siersma & Guassora（2016），信息力框架。\n${informationPowerSource}`,
  ].join("\n\n");
}

export function parseNewCodeCounts(input) {
  const source = input.trim();
  if (!source) throw new Error("请按顺序填写每次访谈的新增编码数。");

  const tokens = source.split(/[,，、]/u).flatMap((part) => part.trim().split(/\s+/u));
  const counts = tokens.map((token) => {
    if (!/^\d+$/u.test(token) || !Number.isSafeInteger(Number(token))) {
      throw new Error("每次访谈请输入一个非负整数。无新增编码的访谈请填 0。");
    }
    return Number(token);
  });
  return counts;
}

export function assessSaturation(counts, baseSize, runLength, thresholdPercent) {
  if (!Number.isSafeInteger(baseSize) || baseSize < 1) {
    throw new Error("基准访谈数须为正整数。");
  }
  if (!Number.isSafeInteger(runLength) || runLength < 1) {
    throw new Error("窗口长度须为正整数。");
  }
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
    throw new Error("新增信息阈值须介于 0% 和 100%。");
  }
  if (!Number.isSafeInteger(baseSize + runLength) || counts.length - baseSize < runLength) {
    throw new Error(`请提供基准访谈和至少一个完整窗口的编码数。当前共有 ${counts.length} 次访谈。`);
  }
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("每次访谈的新增编码数须为非负整数。");
  }
  if (!Number.isSafeInteger(counts.reduce((sum, count) => sum + count, 0))) {
    throw new Error("编码总数超出可精确计算的范围。");
  }

  const baseCodes = counts.slice(0, baseSize).reduce((sum, count) => sum + count, 0);
  if (baseCodes === 0) {
    throw new Error("基准访谈的新增编码合计为 0，比例无法计算。请复核编码记录及基准访谈设置。");
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
  return { baseCodes, windows, first: first ?? null, notation };
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
      <form class="tool-form" data-interview-form>
        <div class="field-grid">${interviewFields.map(interviewFieldTemplate).join("")}</div>
        <div class="form-actions">
          <button class="button" type="submit">生成规划记录</button>
        </div>
        <p class="error" data-interview-error role="alert" hidden></p>
      </form>
      <div class="tool-result">
        <p data-interview-status aria-live="polite">填写研究设计和初始招募计划后，可生成一份供复核的记录。</p>
        <div data-interview-output hidden>
          <div class="field">
            <label for="interview-record">访谈样本规划记录</label>
            <textarea id="interview-record" rows="12" readonly></textarea>
          </div>
          <div class="form-actions">
            <button class="button secondary" type="button" data-copy-record>复制记录</button>
            <button class="button secondary" type="button" data-download-record>下载 TXT</button>
          </div>
        </div>
      </div>
    </div>
    <details class="method-notes">
      <summary>方法与参考文献</summary>
      <p>信息力框架用来判断样本能为研究问题提供多少相关信息。研究者结合五个维度论证招募安排，在访谈和分析过程中复核。<a href="${informationPowerSource}">Malterud、Siersma 和 Guassora（2016）</a></p>
    </details>`;

  const form = container.querySelector("[data-interview-form]");
  const error = container.querySelector("[data-interview-error]");
  const output = container.querySelector("[data-interview-output]");
  const record = container.querySelector("#interview-record");
  const status = container.querySelector("[data-interview-status]");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      record.value = interviewRecord(Object.fromEntries(new FormData(form)));
      output.hidden = false;
      status.textContent = "规划记录已生成。";
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      output.hidden = true;
    }
  });

  form.addEventListener("input", () => {
    error.hidden = true;
    if (!output.hidden) {
      output.hidden = true;
      record.value = "";
      status.textContent = "填写内容已更新。请重新生成记录。";
    }
  });

  container.querySelector("[data-copy-record]").addEventListener("click", async () => {
    if (output.hidden || !record.value) return;
    const currentRecord = record.value;
    try {
      await navigator.clipboard.writeText(currentRecord);
      if (record.value === currentRecord) status.textContent = "记录已复制。";
    } catch {
      if (record.value !== currentRecord) return;
      record.focus();
      record.select();
      status.textContent = "记录已选中。可用键盘或系统菜单复制。";
    }
  });

  container.querySelector("[data-download-record]").addEventListener("click", () => {
    if (output.hidden || !record.value) return;
    const url = URL.createObjectURL(new Blob([record.value], { type: "text/plain;charset=utf-8" }));
    const download = document.createElement("a");
    download.href = url;
    download.download = "访谈样本规划记录.txt";
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "已发起 TXT 下载。";
  });
}

const percentFormat = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 2 });

function bindSaturation(container) {
  container.innerHTML = `
    <div class="tool-grid">
      <form class="tool-form" data-saturation-form>
        <div class="field-grid">
          <div class="field">
            <label for="sat-base">基准访谈数</label>
            <input id="sat-base" name="base" type="number" min="1" step="1" value="4" inputmode="numeric" required aria-describedby="sat-base-help">
            <small id="sat-base-help">最早的若干次访谈。其新增编码合计作为固定分母。</small>
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
            <small id="sat-threshold-help">原文比较了这两个阈值。</small>
          </div>
        </div>
        <div class="field">
          <label for="sat-counts">每次访谈的新增编码数</label>
          <textarea id="sat-counts" name="counts" rows="4" required aria-describedby="sat-counts-help" placeholder="17, 8, 5, 7, 4, 3, 1, 0"></textarea>
          <small id="sat-counts-help">依访谈顺序填整数，以逗号、空格或换行分隔。每个编码只计在首次出现的访谈中，无新增编码时填 0。</small>
        </div>
        <div class="form-actions">
          <button class="button" type="submit">计算新增信息比例</button>
          <button class="button secondary" type="button" data-saturation-demo>载入论文图 3 示例</button>
        </div>
        <p class="error" data-saturation-error role="alert" hidden></p>
      </form>
      <div class="tool-result">
        <p data-saturation-status aria-live="polite">填入已编码的访谈计数后，可查看各窗口的新增信息比例。</p>
        <div data-saturation-output hidden>
          <p data-saturation-base></p>
          <div class="table-wrap">
            <table>
              <caption>逐窗口计算结果</caption>
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
        </div>
      </div>
    </div>
    <details class="method-notes">
      <summary>计算依据与适用范围</summary>
      <p>每个窗口的新增编码数除以基准访谈的新增编码总数。计算按原始比例判断阈值，表格显示至多两位小数。该方法在使用归纳式主题分析的个人访谈数据中得到检验。达标结果对应当前访谈次序、编码粒度和阈值。<a href="${saturationSource}">Guest、Namey 和 Chen（2020）</a> · <a href="${saturationFigure}">论文图 3</a></p>
      <p>反思性主题分析的样本充分性宜结合研究目标、材料的深度和解释过程来论证。<a href="${reflexiveSource}">Braun 和 Clarke（2021）</a></p>
    </details>`;

  const form = container.querySelector("[data-saturation-form]");
  const error = container.querySelector("[data-saturation-error]");
  const output = container.querySelector("[data-saturation-output]");
  const rows = container.querySelector("[data-saturation-rows]");
  const status = container.querySelector("[data-saturation-status]");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      const { base, window, threshold, counts } = Object.fromEntries(new FormData(form));
      const result = assessSaturation(parseNewCodeCounts(counts), Number(base), Number(window), Number(threshold));
      const tableRows = document.createDocumentFragment();
      for (const outcome of result.windows) {
        const row = tableRows.appendChild(document.createElement("tr"));
        const label = row.appendChild(document.createElement("th"));
        label.scope = "row";
        label.textContent = outcome.start === outcome.end ? String(outcome.start) : `${outcome.start} 至 ${outcome.end}`;
        row.insertCell().textContent = String(outcome.newCodes);
        row.insertCell().textContent = percentFormat.format(outcome.ratio);
        row.insertCell().textContent = outcome.meetsThreshold ? "是" : "否";
      }
      rows.replaceChildren(tableRows);
      container.querySelector("[data-saturation-base]").textContent =
        `前 ${base} 次访谈合计产生 ${result.baseCodes} 个不同编码。`;
      output.hidden = false;
      status.textContent = result.first
        ? `首次达到阈值的窗口截至第 ${result.first.end} 次访谈。按原文格式记为 ${result.notation}。`
        : "已提供的访谈窗口均高于设定阈值。";
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      output.hidden = true;
      status.textContent = "";
    }
  });

  form.addEventListener("input", () => {
    error.hidden = true;
    if (!output.hidden) {
      output.hidden = true;
      status.textContent = "输入已更新。请重新计算。";
    }
  });

  container.querySelector("[data-saturation-demo]").addEventListener("click", () => {
    form.elements.namedItem("base").value = "4";
    form.elements.namedItem("window").value = "2";
    form.elements.namedItem("threshold").value = "5";
    form.elements.namedItem("counts").value = guestFigure3.join(", ");
    form.requestSubmit();
  });
}

export function mountQual() {
  const interview = document.querySelector("#interview-tool");
  const saturation = document.querySelector("#saturation-tool");
  if (interview) bindInterview(interview);
  if (saturation) bindSaturation(saturation);
}
