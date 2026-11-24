const PNG_HEADER = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const JPEG_XMP_HEADER = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
const JPEG_EXTENDED_XMP_HEADER = new TextEncoder().encode('http://ns.adobe.com/xmp/extension/\0');
const JUMBF_UUID_SUFFIX = Uint8Array.of(0, 17, 0, 16, 128, 0, 0, 170, 0, 56, 155, 113);
const MANIFEST_TYPES = new Set(['c2ma', 'c2md', 'c2um', 'c2cm']);
const XMP_RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XMP_IPTC = 'http://iptc.org/std/Iptc4xmpExt/2008-02-29/';
const XMP_BASIC = 'http://ns.adobe.com/xap/1.0/';
const MAX_METADATA = 512 * 1024;
const MAX_TOTAL_METADATA = 2 * 1024 * 1024;
const MAX_METADATA_FIELDS = 96;
const MAX_FINDINGS = 100;
const SOURCE_TYPES = new Map([
  ['trainedAlgorithmicMedia', '生成式 AI 制作'],
  ['compositeWithTrainedAlgorithmicMedia', '含有生成式 AI 素材或编辑'],
]);
const AI_SOFTWARE = /\b(?:ChatGPT|DALL[· -]?E|Midjourney|Stable Diffusion|Adobe Firefly|Google (?:Gemini|Imagen))\b/iu;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});
const utf8 = new TextDecoder('utf-8', { fatal: true });

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function matches(bytes, offset, prefix) {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function fourCC(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function validPngCrc(bytes, start, end, expected) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 255];
  return ((crc ^ 0xffffffff) >>> 0) === expected;
}

function boxHeader(bytes, offset, limit) {
  if (offset + 8 > limit) return null;
  const view = viewOf(bytes);
  let size = view.getUint32(offset);
  let headerLength = 8;
  if (size === 1) {
    if (offset + 16 > limit || view.getUint32(offset + 8)) return null;
    size = view.getUint32(offset + 12);
    headerLength = 16;
  }
  if (size < headerLength) return null;
  return { type: fourCC(bytes, offset + 4), start: offset + headerLength, end: offset + size };
}

function description(bytes, box, limit) {
  const descriptor = boxHeader(bytes, box.start, limit);
  if (!descriptor || descriptor.type !== 'jumd' || descriptor.end > limit || descriptor.end - descriptor.start < 17) return null;
  if (!matches(bytes, descriptor.start + 4, JUMBF_UUID_SUFFIX)) return null;
  return { ...descriptor, uuidType: fourCC(bytes, descriptor.start) };
}

function isC2paStore(bytes) {
  const top = boxHeader(bytes, 0, bytes.length);
  if (!top || top.type !== 'jumb' || top.end !== bytes.length) return false;
  const desc = description(bytes, top, top.end);
  if (!desc || desc.uuidType !== 'c2pa' || desc.end - desc.start < 22
    || !(bytes[desc.start + 16] & 2) || fourCC(bytes, desc.start + 17) !== 'c2pa' || bytes[desc.start + 21] !== 0) return false;

  let hasManifest = false;
  for (let pos = desc.end; pos < top.end;) {
    const child = boxHeader(bytes, pos, top.end);
    if (!child || child.end > top.end) return false;
    if (child.type === 'jumb' && MANIFEST_TYPES.has(description(bytes, child, child.end)?.uuidType)) hasManifest = true;
    pos = child.end;
  }
  return hasManifest;
}

function addFinding(state, kind, label, value, location) {
  if (state.findings.length < MAX_FINDINGS) state.findings.push({ kind, label, value, location });
  else addNote(state, '结果过多，仅展示前 100 条发现。');
}

function addNote(state, note) {
  if (state.notes.size < 20) state.notes.add(note);
  else if (!state.notes.has(note)) state.notes.add('另有检查提示，请使用专用工具复核。');
}

function includeMetadata(state) {
  if (state.fieldsRemaining > 0) {
    state.fieldsRemaining -= 1;
    return true;
  }
  addNote(state, '部分图片元数据超过检查容量。');
  return false;
}

function inspectManifest(bytes, state, location) {
  if (isC2paStore(bytes)) {
    addFinding(state, 'credential', '嵌入 C2PA 清单结构', '发现 C2PA JUMBF 清单容器及清单项。', location);
  } else {
    addNote(state, `${location}中的 C2PA 专用载体未提供可识别的清单结构。`);
  }
}

function inspectSoftware(value, location, state) {
  const match = value.match(AI_SOFTWARE);
  if (match) addFinding(state, 'metadata', '软件字段中的 AI 工具名称', match[0], location);
}

function xmpValues(rdf, namespace, key) {
  const values = new Set();
  for (const description of rdf.children) {
    if (description.namespaceURI !== XMP_RDF || description.localName !== 'Description') continue;
    const attribute = description.getAttributeNS(namespace, key);
    if (attribute) values.add(attribute.trim());
    for (const property of description.children) {
      if (property.namespaceURI === namespace && property.localName === key && !property.children.length) {
        values.add((property.getAttributeNS(XMP_RDF, 'resource') ?? property.textContent).trim());
      }
    }
  }
  return [...values];
}

function inspectXmp(bytes, state, location) {
  if (bytes.length > MAX_METADATA || bytes.length > state.metadataRemaining) {
    addNote(state, '部分图片元数据超过检查容量。');
    return;
  }
  state.metadataRemaining -= bytes.length;
  if (typeof DOMParser === 'undefined') {
    addNote(state, '当前环境无法解析 XMP 元数据。');
    return;
  }
  try {
    const xml = utf8.decode(bytes).replace(/\0+$/u, '');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml)) throw new Error('unsupported XML declaration');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.getElementsByTagNameNS('*', 'parsererror').length) throw new Error('invalid XMP XML');

    for (const rdf of document.getElementsByTagNameNS(XMP_RDF, 'RDF')) {
      for (const uri of xmpValues(rdf, XMP_IPTC, 'DigitalSourceType')) {
        const token = /^https?:\/\/cv\.iptc\.org\/newscodes\/digitalsourcetype\/(\w+)$/u.exec(uri)?.[1];
        const meaning = SOURCE_TYPES.get(token);
        if (meaning) addFinding(state, 'metadata', `IPTC 数字来源类型 · ${meaning}`, uri, location);
      }
      for (const name of xmpValues(rdf, XMP_IPTC, 'AISystemUsed')) {
        if (name) addFinding(state, 'metadata', 'IPTC 声明使用的 AI 系统', name.slice(0, 180), location);
      }
      for (const software of xmpValues(rdf, XMP_BASIC, 'CreatorTool')) inspectSoftware(software, location, state);
    }
  } catch {
    addNote(state, '有 XMP 元数据无法解析。');
  }
}

async function inflateMetadata(payload, limit) {
  if (typeof DecompressionStream === 'undefined') return null;
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function inspectPngText(type, chunk, state, location) {
  const keyEnd = chunk.indexOf(0);
  if (keyEnd < 1 || keyEnd > 79) return;
  const key = String.fromCharCode(...chunk.subarray(0, keyEnd));
  const isXmp = type === 'iTXt' && key === 'XML:com.adobe.xmp';
  const isSoftware = ['software', 'generator', 'creatortool'].includes(key.toLowerCase());
  if ((!isXmp && !isSoftware) || !includeMetadata(state)) return;

  let start = keyEnd + 1;
  let compressed = false;
  if (type === 'iTXt') {
    const flag = chunk[start];
    if ((flag !== 0 && flag !== 1) || chunk[start + 1] !== 0) return;
    compressed = flag === 1;
    const languageEnd = chunk.indexOf(0, start + 2);
    const translatedKeyEnd = languageEnd < 0 ? -1 : chunk.indexOf(0, languageEnd + 1);
    if (translatedKeyEnd < 0) return;
    start = translatedKeyEnd + 1;
  } else if (type === 'zTXt') {
    if (chunk[start] !== 0) return;
    compressed = true;
    start += 1;
  }

  const limit = Math.min(MAX_METADATA, state.metadataRemaining);
  let field = chunk.subarray(start);
  if (field.length > limit) {
    addNote(state, '部分图片元数据超过检查容量。');
    return;
  }
  if (compressed) {
    try {
      field = await inflateMetadata(field, limit);
    } catch {
      field = null;
    }
    if (!field) {
      addNote(state, '部分压缩图片元数据无法解码或超过检查容量。');
      return;
    }
  }
  if (isXmp) inspectXmp(field, state, location);
  else {
    state.metadataRemaining -= field.length;
    inspectSoftware(new TextDecoder(type === 'iTXt' ? 'utf-8' : 'latin1').decode(field), `${location} 的 ${key} 字段`, state);
  }
}

async function inspectPng(bytes, state) {
  const view = viewOf(bytes);
  let imageData = false;
  for (let pos = 8; pos < bytes.length;) {
    if (pos + 12 > bytes.length) break;
    const size = view.getUint32(pos);
    const type = fourCC(bytes, pos + 4);
    const end = pos + 8 + size;
    if (end + 4 > bytes.length || (pos === 8 && (type !== 'IHDR' || size !== 13))) break;
    if (type === 'IEND' && size === 0 && imageData) return;
    if (type === 'IDAT') imageData = true;
    if (type === 'caBX' || ['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const location = `PNG ${type} · 字节偏移 ${pos}`;
      if (!validPngCrc(bytes, pos + 4, end, view.getUint32(end))) addNote(state, `${location}的校验值不匹配。`);
      else if (type === 'caBX') inspectManifest(bytes.subarray(pos + 8, end), state, location);
      else await inspectPngText(type, bytes.subarray(pos + 8, end), state, location);
    }
    pos = end + 4;
  }
  throw new Error('PNG 文件的块结构不完整。');
}

function readJpegPart(payload) {
  if (payload.length < 16 || payload[0] !== 0x4a || payload[1] !== 0x50) return null;
  const view = viewOf(payload);
  const box = boxHeader(payload, 8, payload.length);
  if (!box || box.type !== 'jumb') return null;
  return { instance: view.getUint16(2), sequence: view.getUint32(4), box };
}

function collectJpegParts(assembly, state) {
  let data = assembly.parts[0];
  if (assembly.parts.length > 1) {
    data = new Uint8Array(assembly.size);
    let offset = 0;
    for (const part of assembly.parts) {
      data.set(part, offset);
      offset += part.length;
    }
  }
  const top = boxHeader(data, 0, data.length);
  if (description(data, top, data.length)?.uuidType === 'c2pa') {
    inspectManifest(data, state, `JPEG APP11 · 字节偏移 ${assembly.offset}`);
  }
}

function inspectJpeg(bytes, state) {
  const view = viewOf(bytes);
  let scanning = false;
  let hasScan = false;
  let assembly = null;
  for (let pos = 2; pos < bytes.length;) {
    if (scanning) pos = bytes.indexOf(0xff, pos);
    if (pos < 0 || bytes[pos] !== 0xff) break;
    const start = pos;
    while (bytes[pos] === 0xff) pos += 1;
    const marker = bytes[pos++];
    if (scanning && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    scanning = false;
    if (marker !== 0xeb && assembly) {
      if (assembly.knownC2pa) addNote(state, 'JPEG APP11 的 C2PA 清单分段不完整。');
      assembly = null;
    }
    if (marker === 0xd9 && hasScan) return;
    if (marker === 0 || marker === 0xd8 || marker === 0xd9 || pos + 2 > bytes.length) break;
    if (marker === 1) continue;
    const length = view.getUint16(pos);
    if (length < 2 || pos + length > bytes.length) break;
    const payload = bytes.subarray(pos + 2, pos + length);
    pos += length;

    if (marker === 0xeb) {
      const part = readJpegPart(payload);
      if (assembly && (!part || part.instance !== assembly.instance || part.sequence !== assembly.next
          || part.box.start !== assembly.headerLength || part.box.end - 8 !== assembly.size)) {
        if (assembly.knownC2pa) addNote(state, 'JPEG APP11 的 C2PA 清单分段不完整。');
        assembly = null;
      }
      if (part?.sequence === 1) {
        const descriptor = description(payload, part.box, Math.min(part.box.end, payload.length));
        const knownC2pa = descriptor?.uuidType === 'c2pa';
        const size = part.box.end - 8;
        if (size > bytes.length) {
          if (knownC2pa) addNote(state, 'JPEG APP11 的 C2PA 清单长度超出文件大小。');
        } else if (knownC2pa || !descriptor) {
          assembly = { instance: part.instance, next: 1, size, length: 0, parts: [], knownC2pa,
            offset: start, headerLength: part.box.start };
        }
      }
      if (assembly && part?.sequence === assembly.next) {
        const data = payload.subarray(assembly.next === 1 ? 8 : part.box.start);
        if (assembly.length + data.length > assembly.size) {
          if (assembly.knownC2pa) addNote(state, 'JPEG APP11 的 C2PA 清单分段长度不一致。');
          assembly = null;
        } else {
          assembly.parts.push(data);
          assembly.length += data.length;
          assembly.next += 1;
          if (assembly.length === assembly.size) {
            collectJpegParts(assembly, state);
            assembly = null;
          }
        }
      }
    } else if (marker === 0xe1) {
      if (matches(payload, 0, JPEG_XMP_HEADER) && includeMetadata(state)) {
        inspectXmp(payload.subarray(JPEG_XMP_HEADER.length), state, `JPEG APP1 XMP · 字节偏移 ${start}`);
      } else if (matches(payload, 0, JPEG_EXTENDED_XMP_HEADER)) {
        addNote(state, 'JPEG 的扩展 XMP 分段未纳入检查。');
      }
    } else if (marker === 0xda) {
      scanning = true;
      hasScan = true;
    }
  }
  throw new Error('JPEG 文件的标记段不完整。');
}

function inspectWebp(bytes, state) {
  const view = viewOf(bytes);
  const size = view.getUint32(4, true) + 8;
  if (size !== bytes.length) throw new Error('WebP 文件的 RIFF 长度与文件大小不一致。');
  let imageData = false;
  let pos = 12;
  while (pos + 8 <= size) {
    const type = fourCC(bytes, pos);
    const length = view.getUint32(pos + 4, true);
    const end = pos + 8 + length;
    const paddedEnd = end + (length % 2);
    if (paddedEnd > size) break;
    const location = `WebP ${type.trim()} · 字节偏移 ${pos}`;
    if (type === 'C2PA') inspectManifest(bytes.subarray(pos + 8, end), state, location);
    if (type === 'XMP ' && includeMetadata(state)) inspectXmp(bytes.subarray(pos + 8, end), state, location);
    if (['VP8 ', 'VP8L', 'ANMF'].includes(type)) imageData = true;
    pos = paddedEnd;
  }
  if (!imageData || pos !== size) throw new Error('WebP 文件的块结构不完整。');
}

export async function inspectTraceImage(bytes) {
  const state = { findings: [], notes: new Set(), metadataRemaining: MAX_TOTAL_METADATA, fieldsRemaining: MAX_METADATA_FIELDS };
  let format;
  if (matches(bytes, 0, PNG_HEADER)) {
    format = 'PNG';
    await inspectPng(bytes, state);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'JPEG';
    inspectJpeg(bytes, state);
  } else if (fourCC(bytes, 0) === 'RIFF' && fourCC(bytes, 8) === 'WEBP') {
    format = 'WebP';
    inspectWebp(bytes, state);
  } else {
    throw new Error('未识别为 PNG、JPEG 或 WebP 图片。');
  }
  return { format, findings: state.findings, notes: [...state.notes] };
}
