import { inspectPastedTraceText, inspectTraceFile, maximumTextLength } from './trace-core.mjs';
import { copyText, downloadText } from './ui.mjs';

const limit = 100;
const kindLabels = {
  credential: '内容凭据线索',
  metadata: '元数据字段',
  unicode: '字符',
  encoding: '编码',
};

const template = `
  <div class="tool-grid">
    <form class="tool-form" data-trace-form novalidate>
      <div class="field">
        <label for="trace-source">检查来源</label>
        <select id="trace-source" name="source">
          <option value="file">选择文件</option>
          <option value="paste">粘贴文字</option>
        </select>
      </div>
      <div class="field" data-trace-file>
        <label for="trace-file">本机文件</label>
        <input id="trace-file" name="file" type="file" aria-describedby="trace-file-help" accept=".txt,.md,.csv,.tsv,.docx,.xlsx,.pptx,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp">
        <small id="trace-file-help">支持纯文本、DOCX、XLSX、PPTX、PDF、PNG、JPEG 和 WebP。单个文件最多 25 MiB。</small>
      </div>
      <div class="field" data-trace-paste hidden>
        <label for="trace-paste">原样粘贴待检查的文字</label>
        <textarea id="trace-paste" name="text" rows="7" aria-describedby="trace-paste-help" disabled></textarea>
        <small id="trace-paste-help">从原应用直接粘贴可减少格式转换。位置按 Unicode 字符计数。</small>
      </div>
      <div class="form-actions">
        <button class="button" type="submit">开始检查</button>
        <button class="button secondary" type="button" data-trace-demo>运行演示</button>
        <button class="button secondary" type="reset">清空</button>
      </div>
      <p class="error" role="alert" data-trace-error hidden></p>
    </form>
    <section class="tool-result" aria-labelledby="trace-result-heading">
      <h2 id="trace-result-heading" tabindex="-1">检查结果</h2>
      <p role="status" data-trace-status>选择文件或粘贴文字后开始检查。</p>
      <div data-trace-output hidden></div>
    </section>
  </div>
  <details class="method-notes">
    <summary>检查范围与依据</summary>
    <p>字符结果列出 Unicode 特殊空格、部分不可见字符及其位置。Office 文档检查指定内容部件和元数据。PDF 检查创建与转换应用字段。图像检查结构化来源字段和嵌入式 C2PA 容器。</p>
    <p>来源字段是文件中的声明。发现 C2PA 容器时仍需验证签名。像素水印、文本统计水印和文件作者身份各需独立核验。无结果只代表本次检查范围内未发现相应记录。</p>
    <p><a href="https://github.com/guillaumemeyer/watermarks-remover">watermarks-remover 开源项目</a> · <a href="https://www.unicode.org/versions/Unicode17.0.0/core-spec/chapter-23/">Unicode 字符规范</a> · <a href="https://spec.c2pa.org/specifications/specifications/2.5/specs/C2PA_Specification.html">C2PA 技术规范</a> · <a href="https://www.iptc.org/std/photometadata/specification/IPTC-PhotoMetadata-2025.1.html">IPTC 照片元数据标准</a></p>
  </details>`;

function node(tag, content, className) {
  const result = document.createElement(tag);
  if (content) result.textContent = content;
  if (className) result.className = className;
  return result;
}

function rowText({ label, value, count }) {
  return label + ' · ' + value + (count ? '（' + count + ' 处）' : '');
}

export function traceReport(result) {
  return [
    'MethodsDesk AI 水印与文件痕迹检查',
    '检查格式  ' + result.format,
    ...(result.fileName ? ['文件名  ' + result.fileName] : []),
    ...(result.sha256 ? ['SHA-256  ' + result.sha256] : []),
    '',
    ...result.notes,
    '检查结果限于列出的项目。结果无法判定作者是否使用 AI。',
    '',
    ...result.findings.map((row) => (kindLabels[row.kind] ?? '检查记录') + '  ' + rowText(row) + '\n位置  ' + row.location),
    ...(result.findings.length ? [] : ['本次检查范围内未发现相应记录。']),
    '',
    '来源  https://methodsdesk.red.edu.kg/#file-trace',
  ].join('\n');
}

function renderResult(output, result) {
  const format = node('p', '检查格式  ' + result.format);
  const rows = node('dl', '', 'trace-findings');
  for (const finding of result.findings.slice(0, limit)) {
    const group = node('div');
    const label = node('dt', kindLabels[finding.kind] ?? '检查记录');
    const value = node('dd', rowText(finding), 'trace-value');
    const location = node('dd', finding.location, 'trace-location');
    group.append(label, value, location);
    rows.append(group);
  }
  const notes = node('div', '', 'callout');
  notes.append(...result.notes.map((note) => node('p', note)));
  if (result.findings.length > limit) notes.append(node('p', '页面显示前 ' + limit + ' 条。完整检查记录可下载。'));
  const copyStatus = node('p');
  copyStatus.setAttribute('role', 'status');
  const manual = node('label', '检查记录', 'field');
  manual.hidden = true;
  const text = node('textarea');
  text.readOnly = true;
  text.rows = 6;
  manual.append(text);

  const actions = node('div', '', 'form-actions result-actions');
  const copy = node('button', '复制记录', 'button secondary');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    const record = traceReport(result);
    const copied = await copyText(record);
    if (!copy.isConnected) return;
    copyStatus.textContent = copied ? '检查记录已复制。' : '可手动复制下方选中的记录。';
    manual.hidden = copied;
    if (!copied) {
      text.value = record;
      text.focus();
      text.select();
    }
  });
  const download = node('button', '下载 TXT', 'button secondary');
  download.type = 'button';
  download.addEventListener('click', () => downloadText('methodsdesk-file-trace.txt', traceReport(result)));
  actions.append(copy, download);
  output.replaceChildren(format, notes, rows, actions, copyStatus, manual);
  output.hidden = false;
}

export function mountFileTrace(root = document) {
  const container = root.querySelector('#file-trace-tool');
  if (!container) return;
  container.innerHTML = template;
  const form = container.querySelector('form');
  const source = form.elements.namedItem('source');
  const file = form.elements.namedItem('file');
  const text = form.elements.namedItem('text');
  const error = form.querySelector('[data-trace-error]');
  error.id = 'trace-error';
  const status = container.querySelector('[data-trace-status]');
  const output = container.querySelector('[data-trace-output]');
  const heading = container.querySelector('#trace-result-heading');
  const submit = form.querySelector('[type=submit]');
  const demo = form.querySelector('[data-trace-demo]');
  text.maxLength = maximumTextLength;
  let revision = 0;
  let usingDemo = false;

  function resetOutput(message) {
    revision++;
    error.hidden = true;
    file.removeAttribute('aria-invalid');
    text.removeAttribute('aria-invalid');
    file.setAttribute('aria-describedby', 'trace-file-help');
    text.setAttribute('aria-describedby', 'trace-paste-help');
    output.hidden = true;
    output.replaceChildren();
    status.textContent = message;
  }

  function syncSource() {
    const pasted = source.value === 'paste';
    text.disabled = !pasted;
    file.disabled = pasted;
    container.querySelector('[data-trace-file]').hidden = pasted;
    container.querySelector('[data-trace-paste]').hidden = !pasted;
  }

  form.addEventListener('input', () => {
    usingDemo = false;
    syncSource();
    resetOutput('输入已更新。可以开始检查。');
  });
  form.addEventListener('reset', () => {
    usingDemo = false;
    resetOutput('选择文件或粘贴文字后开始检查。');
    queueMicrotask(syncSource);
  });
  demo.addEventListener('click', () => {
    file.value = '';
    source.value = 'paste';
    text.value = '演示文字\u200b含有一个零宽空格。\n这里\u00a0有一个不换行空格。';
    usingDemo = true;
    syncSource();
    form.requestSubmit();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    resetOutput('正在检查。');
    const current = revision;
    const pasted = source.value === 'paste';
    const field = pasted ? text : file;
    submit.disabled = true;
    demo.disabled = true;
    try {
      const result = pasted ? inspectPastedTraceText(text.value) : await inspectTraceFile(file.files[0]);
      if (current !== revision) return;
      if (usingDemo) result.notes = ['当前结果使用演示文字。', ...result.notes];
      renderResult(output, result);
      status.textContent = result.findings.length
        ? '列出 ' + result.findings.length + ' 条检查记录。'
        : '本次检查范围内未发现相应记录。';
      if (container.closest('.view')?.hidden !== true) heading.focus();
    } catch (failure) {
      if (current !== revision) return;
      status.textContent = '请核对输入后再检查。';
      error.textContent = failure instanceof Error && /[\u3400-\u9fff]/u.test(failure.message)
        ? failure.message : '无法完成检查。请确认文件可正常打开后重试。';
      error.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', field.getAttribute('aria-describedby') + ' trace-error');
      if (container.closest('.view')?.hidden !== true) field.focus();
    } finally {
      submit.disabled = false;
      demo.disabled = false;
    }
  });
}
