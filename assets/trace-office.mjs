import { openTraceZip } from './trace/zip.mjs';

const CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types';
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CORE_PROPERTIES = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const DC_TERMS = 'http://purl.org/dc/terms/';
const OFFICE_RELATIONSHIPS = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/',
];

const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];
const SHEET_NAMESPACES = [
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
];
const PRESENTATION_NAMESPACES = [
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
];
const DRAWING_NAMESPACES = [
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
];
const EXTENDED_PROPERTIES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties',
  'http://purl.oclc.org/ooxml/officeDocument/extendedProperties',
];

const FORMATS = new Map([
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', {
    name: 'DOCX', root: 'document', namespaces: WORD_NAMESPACES,
    scope: '文字检查覆盖主文档的正文，可包含仍保留在正文中的修订插入内容。页眉、页脚、批注、删除修订与内嵌文件不在本次文字检查范围内。',
  }],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', {
    name: 'XLSX', root: 'workbook', namespaces: SHEET_NAMESPACES,
    scope: '文字检查覆盖清单中的共享字符串和工作表内联字符串。公式、批注与内嵌文件不在本次文字检查范围内。',
  }],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', {
    name: 'PPTX', root: 'presentation', namespaces: PRESENTATION_NAMESPACES,
    scope: '文字检查覆盖清单中的幻灯片文字。备注、母版、批注与内嵌文件不在本次文字检查范围内。',
  }],
]);

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const UTF16LE = new TextDecoder('utf-16le', { fatal: true });
const UTF16BE = new TextDecoder('utf-16be', { fatal: true });

function parser() {
  if (typeof DOMParser !== 'function') throw new Error('当前环境无法安全读取 Office XML。请使用浏览器。');
  return new DOMParser();
}

function xmlDocument(bytes, location) {
  let text;
  try {
    const first = bytes[0];
    const second = bytes[1];
    const littleEndian = first === 0xff && second === 0xfe || first === 0x3c && second === 0;
    const bigEndian = first === 0xfe && second === 0xff || first === 0 && second === 0x3c;
    const decoder = littleEndian ? UTF16LE : bigEndian ? UTF16BE : UTF8;
    text = decoder.decode(bytes);
  } catch {
    throw new Error('无法读取 Office 文件中的 XML 文本编码。');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('Office 文件中的 XML 含有文档类型或实体声明，无法继续检查。');
  const doc = parser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagNameNS('*', 'parsererror').length) {
    throw new Error('Office 文件中的 XML 无法解析。' + location);
  }
  return doc.documentElement;
}

function expectRoot(root, label, namespaces) {
  if (root.localName !== label || !namespaces.includes(root.namespaceURI)) {
    throw new Error('文件内的 XML 类型与 Office 清单不符。');
  }
}

async function readXml(archive, name) {
  const bytes = await archive.read(name);
  if (!bytes) throw new Error('Office 文件缺少清单引用的内部项目。');
  return xmlDocument(bytes, name);
}

function internalPath(target) {
  if (!target || target.startsWith('//') || /[:\\?#\u0000-\u001f]/u.test(target)) {
    throw new Error('Office 清单中的内部路径无效。');
  }
  const path = target.replace(/^\//, '');
  if (path.split('/').some((component) => !component || component === '.' || component === '..')) {
    throw new Error('Office 清单中的内部路径无效。');
  }
  return path;
}

function findRelationship(relationships, kinds) {
  const matching = relationships.filter((item) => kinds.includes(item.getAttribute('Type')) &&
    item.getAttribute('TargetMode') !== 'External');
  if (matching.length > 1) throw new Error('Office 清单包含无法区分的重复关系。');
  return matching.length ? internalPath(matching[0].getAttribute('Target')) : null;
}

function typeOverrides(contentTypes) {
  const parts = new Map();
  for (const item of contentTypes.children) {
    if (item.namespaceURI !== CONTENT_TYPES || item.localName !== 'Override') continue;
    const path = internalPath(item.getAttribute('PartName'));
    const key = path.toLowerCase();
    if (parts.has(key)) throw new Error('Office 清单包含重复的内部项目。');
    parts.set(key, { path, type: item.getAttribute('ContentType') });
  }
  return parts;
}

async function inspectMetadata(archive, relationships) {
  const findings = [];
  const core = findRelationship(relationships, [PACKAGE_RELATIONSHIPS + '/metadata/core-properties']);
  const app = findRelationship(relationships, OFFICE_RELATIONSHIPS.map((prefix) => prefix + 'extended-properties'));
  const batches = [
    [core, 'coreProperties', [CORE_PROPERTIES], [
      ['creator', [DC], '作者字段'],
      ['lastModifiedBy', [CORE_PROPERTIES], '修改者字段'],
      ['created', [DC_TERMS], '创建时间字段'],
      ['modified', [DC_TERMS], '修改时间字段'],
    ]],
    [app, 'Properties', EXTENDED_PROPERTIES, [
      ['Application', EXTENDED_PROPERTIES, '应用程序字段'],
      ['AppVersion', EXTENDED_PROPERTIES, '应用程序版本字段'],
      ['Company', EXTENDED_PROPERTIES, '单位字段'],
    ]],
  ];
  for (const [path, rootName, namespaces, fields] of batches) {
    if (!path) continue;
    const root = await readXml(archive, path);
    expectRoot(root, rootName, namespaces);
    for (const [field, locations, label] of fields) {
      const element = Array.from(root.children).find((item) => item.localName === field && locations.includes(item.namespaceURI));
      const value = element?.textContent.trim();
      if (value) findings.push({ kind: 'metadata', label, value: value.length > 240 ? value.slice(0, 240) + '…' : value, location: path });
    }
  }
  return findings;
}

function elementTexts(root, namespaces, label) {
  return Array.from(root.getElementsByTagNameNS('*', label))
    .filter((node) => namespaces.includes(node.namespaceURI))
    .map((node) => node.textContent);
}

async function inspectOfficeText(format, archive, main, mainPath, parts, scanText) {
  const findings = [];
  if (format === 'DOCX') {
    const body = Array.from(main.children).find((node) => node.localName === 'body' && WORD_NAMESPACES.includes(node.namespaceURI));
    if (body) findings.push(...scanText(elementTexts(body, WORD_NAMESPACES, 't').join('\n'), mainPath + ' 正文'));
    return findings;
  }

  const scopes = format === 'XLSX' ? [
    ['spreadsheetml.sharedStrings+xml', 'sst', SHEET_NAMESPACES, SHEET_NAMESPACES],
    ['spreadsheetml.worksheet+xml', 'worksheet', SHEET_NAMESPACES, SHEET_NAMESPACES],
  ] : [
    ['presentationml.slide+xml', 'sld', PRESENTATION_NAMESPACES, DRAWING_NAMESPACES],
  ];
  const byType = new Map(scopes.map(([type, ...scope]) => ['application/vnd.openxmlformats-officedocument.' + type, scope]));
  for (const { path, type } of parts.values()) {
    const scope = byType.get(type);
    if (!scope) continue;
    const [rootName, rootNamespaces, textNamespaces] = scope;
    const content = await readXml(archive, path);
    expectRoot(content, rootName, rootNamespaces);
    findings.push(...scanText(elementTexts(content, textNamespaces, 't').join('\n'), path));
  }
  return findings;
}

export async function inspectTraceOffice(bytes, scanText) {
  const archive = openTraceZip(bytes);
  if (!archive.has('[Content_Types].xml') || !archive.has('_rels/.rels')) {
    throw new Error('所选 ZIP 不是可识别的 DOCX、XLSX 或 PPTX 文件。');
  }
  const contentTypes = await readXml(archive, '[Content_Types].xml');
  expectRoot(contentTypes, 'Types', [CONTENT_TYPES]);
  const relationshipRoot = await readXml(archive, '_rels/.rels');
  expectRoot(relationshipRoot, 'Relationships', [PACKAGE_RELATIONSHIPS]);
  const relationships = Array.from(relationshipRoot.children)
    .filter((item) => item.namespaceURI === PACKAGE_RELATIONSHIPS && item.localName === 'Relationship');
  const mainPath = findRelationship(relationships, OFFICE_RELATIONSHIPS.map((prefix) => prefix + 'officeDocument'));
  const parts = typeOverrides(contentTypes);
  const format = mainPath ? FORMATS.get(parts.get(mainPath.toLowerCase())?.type) : null;
  if (!format) throw new Error('网页检查支持标准 DOCX、XLSX 和 PPTX 文件。请检查所选文件的实际格式。');
  const main = await readXml(archive, mainPath);
  expectRoot(main, format.root, format.namespaces);

  const findings = await inspectMetadata(archive, relationships);
  findings.push(...await inspectOfficeText(format.name, archive, main, mainPath, parts, scanText));
  return {
    format: format.name,
    findings,
    notes: [
      'Office 属性由文件记录，可被编辑。用途是核对文档信息与正文字符。',
      format.scope,
      '图片像素、电子签名和文件外部记录需要另行检查。',
    ],
  };
}
