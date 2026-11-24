const marks = new Map([
  [0x00ad, '软连字符'],
  [0x034f, '组合字素连接符'],
  [0x180e, '蒙古文元音分隔符'],
  [0x200b, '零宽空格'],
  [0x200c, '零宽非连接符'],
  [0x200d, '零宽连接符'],
  [0x2060, '单词连接符'],
  [0xfeff, '零宽不换行空格'],
]);
const specialMarks = /[\u00ad\u034f\u180e\u200b-\u200d\ufeff\u2060]|\p{Bidi_Control}|\p{Variation_Selector}|\p{Space_Separator}/u;

export function scanTraceText(text, location = '粘贴的文字') {
  const results = new Map();
  let line = 1;
  let column = 1;
  let wasCR = false;
  for (const character of text) {
    if (character === '\r' || character === '\n') {
      if (character === '\r' || !wasCR) line++;
      column = 1;
      wasCR = character === '\r';
      continue;
    }
    wasCR = false;
    if (character !== ' ' && specialMarks.test(character)) {
      const codePoint = character.codePointAt(0);
      const record = results.get(codePoint) ?? { count: 0, positions: [] };
      record.count++;
      if (record.positions.length < 5) record.positions.push('第 ' + line + ' 行第 ' + column + ' 字符');
      results.set(codePoint, record);
    }
    column++;
  }

  return [...results.entries()].map(([code, { count, positions }]) => {
    const point = String.fromCodePoint(code);
    const type = marks.get(code) ?? (
      /\p{Space_Separator}/u.test(point) ? '特殊空格' :
        /\p{Bidi_Control}/u.test(point) ? '双向排版控制符' : '字形变体选择符'
    );
    return {
      kind: 'unicode',
      label: type,
      value: 'U+' + code.toString(16).toUpperCase().padStart(4, '0'),
      count,
      location: location + ' · ' + positions.join('、') + (count > positions.length ? ' 等' : ''),
    };
  });
}

function begins(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes, index, target) {
  return [...target].every((letter, offset) => bytes[index + offset] === letter.charCodeAt(0));
}

const plainExtensions = new Set(['txt', 'md', 'csv', 'tsv']);
const officeExtensions = new Set(['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp']);
const maximumFileSize = 25 * 1024 * 1024;
export const maximumTextLength = 500_000;
const plainNotes = ['不可见字符和特殊空格常用于排版、表情和多语种书写。字符本身无法判断作者或识别特定的 AI 系统。'];

export function identifyTraceType(bytes, name = '') {
  const extension = name.toLowerCase().split('.').pop();
  if (asciiAt(bytes, 0, '%PDF-')) return 'pdf';
  if (begins(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
      begins(bytes, [0xff, 0xd8]) || (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP'))) return 'image';
  if (begins(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'office';
  if (officeExtensions.has(extension)) {
    throw new Error('无法读取该 Office 文件。请选择未加密的 DOCX、XLSX 或 PPTX。');
  }
  if (extension === 'pdf' || imageExtensions.has(extension)) {
    throw new Error('文件开头与所选格式不匹配。请确认文件可以正常打开。');
  }
  if (plainExtensions.has(extension)) return 'text';
  throw new Error('请选择 TXT、MD、CSV、TSV、DOCX、XLSX、PPTX、PDF、PNG、JPEG 或 WebP 文件。');
}

export function inspectTraceTextFile(bytes) {
  let encoding = 'utf-8';
  let signatureLength = 0;
  if (begins(bytes, [0xff, 0xfe, 0x00, 0x00]) || begins(bytes, [0x00, 0x00, 0xfe, 0xff])) {
    throw new Error('当前支持 UTF-8 或带编码标记的 UTF-16。请另存为 UTF-8 后重试。');
  }
  if (begins(bytes, [0xef, 0xbb, 0xbf])) {
    signatureLength = 3;
  } else if (begins(bytes, [0xff, 0xfe])) {
    encoding = 'utf-16le';
    signatureLength = 2;
  } else if (begins(bytes, [0xfe, 0xff])) {
    encoding = 'utf-16be';
    signatureLength = 2;
  }

  let text;
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(signatureLength));
  } catch {
    throw new Error('无法按 UTF-8 或带编码标记的 UTF-16 读取。请另存为 UTF-8，或粘贴文字检查。');
  }
  if (text.includes('\0')) throw new Error('文件内容无法识别为纯文本。请确认文件格式与编码。');
  if (text.length > maximumTextLength) throw new Error('纯文本超出单次检查上限。请分段检查，每次最多 50 万个 UTF-16 代码单元。');

  const encodingName = encoding.toUpperCase();
  const findings = scanTraceText(text, '纯文本内容');
  const notes = [...plainNotes];
  if (signatureLength) notes.push('文件开头的 ' + encodingName + ' 编码标记按格式规则单独识别。它未计入字符结果。');
  return { format: '纯文本 · ' + encodingName, findings, notes };
}

export function inspectPastedTraceText(text) {
  if (!text.length) throw new Error('请粘贴要检查的文字。');
  if (text.length > maximumTextLength) throw new Error('文字超出单次检查上限。请分段检查。');
  return { format: '粘贴文字', findings: scanTraceText(text), notes: plainNotes };
}

function metadataField(findings, label, value, location) {
  if (typeof value === 'string' && value.trim()) {
    findings.push({ kind: 'metadata', label, value: value.trim().slice(0, 1000), location });
  }
}

export function collectPdfTraceFields(info = {}, xmp) {
  const findings = [];
  metadataField(findings, '创建应用', info.Creator, 'PDF Info · Creator');
  metadataField(findings, 'PDF 转换应用', info.Producer, 'PDF Info · Producer');
  metadataField(findings, '创建应用', xmp?.get('xmp:creatortool'), 'PDF XMP · CreatorTool');
  metadataField(findings, 'PDF 转换应用', xmp?.get('pdf:producer'), 'PDF XMP · Producer');
  return findings;
}

async function inspectTracePdf(bytes) {
  const { openLocalPdf } = await import('./travel/pdf-reader.mjs');
  const task = await openLocalPdf(bytes);
  try {
    const document = await task.promise;
    const { info, metadata } = await document.getMetadata();
    return {
      format: 'PDF',
      findings: collectPdfTraceFields(info, metadata),
      notes: ['PDF 范围限于文档信息字典及 XMP 的应用字段。字段由创建应用填写，可被修改。正文、扫描页和嵌入图片未检查。'],
    };
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('该 PDF 需要密码。请选择已解锁的副本。');
    throw new Error('无法读取 PDF 元数据。请确认文件可正常打开后重试。');
  } finally {
    await task.destroy();
  }
}

export async function inspectTraceFile(file) {
  if (!file?.size) throw new Error('请选择非空文件。');
  if (file.size > maximumFileSize) throw new Error('单个文件最多 25 MiB。请选择较小的文件。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = identifyTraceType(bytes, file.name);
  const hash = typeof globalThis.crypto?.subtle?.digest === 'function'
    ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0')).join('')
    : null;
  let result;
  switch (type) {
    case 'pdf':
      result = await inspectTracePdf(bytes);
      break;
    case 'office': {
      const { inspectTraceOffice } = await import('./trace-office.mjs');
      result = await inspectTraceOffice(bytes, scanTraceText);
      break;
    }
    case 'image': {
      const { inspectTraceImage } = await import('./trace-image.mjs');
      result = await inspectTraceImage(bytes);
      break;
    }
    default:
      result = inspectTraceTextFile(bytes);
  }
  return { ...result, fileName: file.name, sha256: hash };
}
