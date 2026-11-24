const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PART_BYTES = 4 * 1024 * 1024;
const MAX_SCANNED_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 4000;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let checksum = index;
  for (let bit = 0; bit < 8; bit += 1) {
    checksum = checksum & 1 ? (checksum >>> 1) ^ 0xedb88320 : checksum >>> 1;
  }
  return checksum;
});

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = (checksum >>> 8) ^ CRC_TABLE[(checksum ^ byte) & 255];
  return (checksum ^ 0xffffffff) >>> 0;
}

function malformedZip() {
  return new Error('文件的 ZIP 容器不完整或目录校验失败。');
}

function findDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50 || offset + 22 + view.getUint16(offset + 20, true) !== bytes.length) continue;
    const count = view.getUint16(offset + 10, true);
    const directorySize = view.getUint32(offset + 12, true);
    const start = view.getUint32(offset + 16, true);
    if (view.getUint32(offset + 4, true) !== 0 || view.getUint16(offset + 8, true) !== count ||
        count === 0xffff || directorySize === 0xffffffff || start === 0xffffffff) {
      throw new Error('网页检查支持标准单卷 ZIP 格式的 Office 文件。');
    }
    if (start + directorySize !== offset || count === 0) throw malformedZip();
    if (count > MAX_ENTRIES) throw new Error('文件内部项目过多，超出本次检查范围。');
    return { view, count, start, end: offset };
  }
  throw malformedZip();
}

function readDirectory(bytes) {
  const { view, count, start, end } = findDirectory(bytes);
  const entries = new Map();
  let offset = start;
  for (let entry = 0; entry < count; entry += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw malformedZip();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const disk = view.getUint16(offset + 34, true);
    const local = view.getUint32(offset + 42, true);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameSize);
    offset += 46 + nameSize + extraSize + commentSize;
    if (offset > end || !nameSize || disk || local + 30 > start || view.getUint32(local, true) !== 0x04034b50) throw malformedZip();

    let name;
    try {
      name = UTF8.decode(nameBytes);
    } catch {
      throw new Error('Office 文件包含无法读取的内部项目名称。');
    }
    const localNameSize = view.getUint16(local + 26, true);
    const data = local + 30 + localNameSize + view.getUint16(local + 28, true);
    if (data + compressedSize > start || localNameSize !== nameSize ||
        view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method ||
        nameBytes.some((byte, i) => byte !== bytes[local + 30 + i]) ||
        (!(flags & 8) && (view.getUint32(local + 14, true) !== checksum ||
          view.getUint32(local + 18, true) !== compressedSize || view.getUint32(local + 22, true) !== size))) {
      throw malformedZip();
    }

    // OPC part names are case-insensitive for ASCII comparisons.
    const key = name.toLowerCase();
    if (entries.has(key)) throw malformedZip();
    entries.set(key, { flags, method, checksum, size, data, compressedSize, local, name });
  }
  if (offset !== end) throw malformedZip();
  const ordered = [...entries.values()].sort((left, right) => left.local - right.local);
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    if (previous.data + previous.compressedSize > ordered[i].local) throw malformedZip();
  }
  return entries;
}

async function inflate(bytes, size) {
  let decompressor;
  try {
    decompressor = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('当前浏览器无法解压 Office 文件。请更新浏览器后重试。');
  }

  // Small input chunks bound temporary output in browsers that buffer an entire
  // transform call. ZIP metadata and streamed output are checked separately.
  let offset = 0;
  const input = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + 2048));
      offset += 2048;
    },
  });
  const reader = input.pipeThrough(decompressor).getReader();
  const result = new Uint8Array(size);
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > size) throw malformedZip();
      result.set(value, length);
      length += value.byteLength;
    }
  } catch {
    throw malformedZip();
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (length !== size) throw malformedZip();
  return result;
}

export function openTraceZip(bytes) {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Office 文件需小于或等于 25 MB。');
  const entries = readDirectory(bytes);
  const loaded = new Set();
  let scannedSize = 0;

  return {
    has(name) { return entries.has(name.toLowerCase()); },

    async read(name) {
      const key = name.toLowerCase();
      const entry = entries.get(key);
      if (!entry) return null;
      const { flags, method, checksum, size, data, compressedSize } = entry;
      if (flags & 0x2041) throw new Error('网页检查支持可直接读取的未加密 Office 文件。');
      if (method !== 0 && method !== 8) throw new Error('该文件使用了网页检查暂不支持的 ZIP 压缩方式。');
      if (!loaded.has(key)) {
        if (size > MAX_PART_BYTES || compressedSize > MAX_PART_BYTES || scannedSize + size > MAX_SCANNED_BYTES) {
          throw new Error('待检查的 Office 数据超出本次解压范围。');
        }
        scannedSize += size;
        loaded.add(key);
      }
      const source = bytes.subarray(data, data + compressedSize);
      const output = method === 0 ? source : await inflate(source, size);
      if (output.byteLength !== size || crc32(output) !== checksum) throw malformedZip();
      return output;
    },
  };
}
