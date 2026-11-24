import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  collectPdfTraceFields, identifyTraceType, inspectPastedTraceText, inspectTraceFile, inspectTraceTextFile, scanTraceText,
} from '../assets/trace-core.mjs';
import { traceReport } from '../assets/trace-tool.mjs';

test('inspect Unicode code points and count positions across CRLF and supplementary characters', () => {
  const findings = scanTraceText('中\u200b😀\u200b\r\n二\u2060 \u202f');
  assert.deepEqual(findings.map(({ value, count }) => [value, count]), [['U+200B', 2], ['U+2060', 1], ['U+202F', 1]]);
  assert.match(findings[0].location, /第 1 行第 2 字符、第 1 行第 4 字符/u);
  assert.match(findings[1].location, /第 2 行第 2 字符/u);
});

test('characters and brand words in pasted text give observable data, never provider attribution', () => {
  const result = inspectPastedTraceText('ChatGPT and a real emoji 👨‍👩 plus مرحبا\u200f');
  assert.deepEqual(result.findings.map(({ kind, value }) => [kind, value]), [['unicode', 'U+200D'], ['unicode', 'U+200F']]);
  assert.ok(result.notes.some((note) => note.includes('无法判断作者')));
  assert.doesNotMatch(traceReport(result), /ChatGPT|👨|مرحبا/u);
  assert.equal(inspectPastedTraceText('ordinary text').findings.length, 0);
  assert.throws(() => inspectPastedTraceText(''), /粘贴/u);
});

test('the UTF-8 and UTF-16 byte order signatures are separate from in-content U+FEFF', () => {
  const first = inspectTraceTextFile(new TextEncoder().encode('\ufeff\ufeffabc'));
  assert.equal(first.format, '纯文本 · UTF-8');
  assert.equal(first.findings[0].count, 1);
  assert.match(first.notes.at(-1), /编码标记/u);
  const second = inspectTraceTextFile(new Uint8Array([0xff,0xfe,0x61,0x00,0x0b,0x20]));
  assert.equal(second.format, '纯文本 · UTF-16LE');
  assert.equal(second.findings[0].value, 'U+200B');
  assert.throws(() => inspectTraceTextFile(new Uint8Array([0xff,0xfe,0,0])), /另存为 UTF-8/u);
  assert.throws(() => inspectTraceTextFile(new Uint8Array([0xc0,0xaf])), /无法按 UTF-8/u);
});

test('use known signatures before extensions and reject mislabeled formats', () => {
  const encode = (text) => new TextEncoder().encode(text);
  assert.equal(identifyTraceType(encode('%PDF-1.7'), 'record.pdf'), 'pdf');
  assert.equal(identifyTraceType(encode('text'), 'notes.md'), 'text');
  assert.equal(identifyTraceType(encode('RIFFxxxxWEBP'), 'record'), 'image');
  assert.throws(() => identifyTraceType(encode('fake'), 'record.png'), /格式不匹配/u);
  assert.throws(() => identifyTraceType(encode('fake'), 'record.docx'), /Office/u);
});

test('PDF application fields are distinct from keywords and filenames', () => {
  const result = collectPdfTraceFields(
    { Creator: 'Word', Producer: 'PDF Converter', Keywords: 'ChatGPT' },
    new Map([['xmp:creatortool','Adobe Photoshop'], ['xmp:label','OpenAI']]),
  );
  assert.deepEqual(result.map(({ kind, value }) => [kind, value]), [
    ['metadata', 'Word'], ['metadata','PDF Converter'], ['metadata','Adobe Photoshop'],
  ]);
});

test('report only selected file details and a SHA-256 of the original bytes', async () => {
  const source = new TextEncoder().encode('no upload sample\u200b');
  const file = new File([source], 'sample.txt');
  const result = await inspectTraceFile(file);
  assert.equal(result.fileName, 'sample.txt');
  assert.equal(result.sha256, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), source);
  assert.doesNotMatch(traceReport(result), /no upload sample/u);
});
