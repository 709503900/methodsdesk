import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { inspectTraceOffice } from '../assets/trace-office.mjs';
import { openTraceZip } from '../assets/trace/zip.mjs';

function zipFile(parts) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;

  for (const { name, content, method = 8, declaredSize, checksumOverride } of parts) {
    const nameBytes = Buffer.from(name);
    const text = Buffer.from(content);
    const compressed = method === 8 ? deflateRawSync(text) : text;
    const checksum = checksumOverride ?? crc32(text);
    const size = declaredSize ?? text.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localRecords.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    offset += local.length + nameBytes.length + compressed.length;
    centralRecords.push(central, nameBytes);
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(centralRecords.reduce((size, record) => size + record.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

test('reads stored and deflated Office parts while preserving input bytes', async () => {
  const bytes = zipFile([
    { name: '[Content_Types].xml', content: '类型', method: 0 },
    { name: 'word/document.xml', content: 'X\u200bY'.repeat(2000) },
  ]);
  const before = Buffer.from(bytes);
  const zip = openTraceZip(bytes);

  assert.equal(Buffer.from(await zip.read('[Content_Types].xml')).toString(), '类型');
  assert.equal(Buffer.from(await zip.read('Word/Document.xml')).toString(), 'X\u200bY'.repeat(2000));
  assert.equal(await zip.read('docProps/core.xml'), null);
  assert.deepEqual(bytes, before);
});

test('rejects truncated and duplicate ZIP directory entries', () => {
  const duplicate = zipFile([{ name: 'a', content: 'a' }, { name: 'A', content: 'b' }]);
  const truncated = zipFile([{ name: 'one', content: 'one' }]).subarray(0, -2);

  assert.throws(() => openTraceZip(duplicate), /ZIP/u);
  assert.throws(() => openTraceZip(truncated), /ZIP/u);
});

test('rejects oversized parts, excess decompressed data and checksum errors', async () => {
  const zip = openTraceZip(zipFile([
    { name: 'oversized', content: '', declaredSize: 5 * 1024 * 1024 },
    { name: 'understated', content: 'A'.repeat(4000), declaredSize: 4 },
    { name: 'incorrect checksum', content: 'test', method: 0, checksumOverride: 1 },
  ]));

  await assert.rejects(() => zip.read('oversized'), /解压范围/u);
  await assert.rejects(() => zip.read('understated'), /校验失败/u);
  await assert.rejects(() => zip.read('incorrect checksum'), /校验失败/u);
});

test('a ZIP extension does not substitute for an Office package manifest', async () => {
  const bytes = zipFile([{ name: 'word/document.xml', content: '<document />' }]);
  await assert.rejects(() => inspectTraceOffice(bytes, () => []), /可识别的 DOCX/u);
});
