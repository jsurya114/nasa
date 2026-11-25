import { inflateRawSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { SaxesParser } from 'saxes';
import { StatementError } from '../finance/gofoStatement/statementMoney.js';

// Reads an .xlsx buffer into { [sheet name]: rows[][] } WITHOUT building ExcelJS's cell objects, so the biggest weekly file
// (about 35,000 delivery lines) needs about a third of the memory. The rows are the same ones `sheetsFromWorkbook` builds from an opened
// ExcelJS workbook: plain values, a formula gives its saved result, rich text gives its text, a merged cell shows its master's value,
// a number in a date-formatted cell is a Date, and a missing cell is a hole in the row.
//
// Why not ExcelJS's own streaming reader: it turns every chunk of bytes into text on its own, so an accented letter that is split between two
// chunks is damaged (an accented letter in a real driver name came out as two replacement characters), and it ignores merged cells. Here each part of the zip is inflated whole
// (the caller has already run assertSafeWorkbook, which caps the total) and decoded with a StringDecoder, which keeps a split letter together.
//
// The caller runs assertSafeWorkbook on the bytes first (this function does not trust the file any more than that: every part is inflated
// with a hard cap on its declared size).

export const MAX_SHEETS = 20;
export const MAX_ROWS = 200000; // a week of one fleet is about 16,000 lines; the biggest Dallas week so far about 44,000

const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const SLICE_BYTES = 256 * 1024;

// "The file is not a workbook this reader understands." Callers may then try ExcelJS, which accepts a few more variants of the format.
export class WorkbookReadError extends StatementError {
  constructor(why) {
    super('The file could not be read as an Excel (.xlsx) workbook.');
    this.name = 'WorkbookReadError';
    this.why = why;
  }
}
const bad = (why) => new WorkbookReadError(why);

// The zip's directory: part name -> where it is and how it is packed. assertSafeWorkbook has already checked the directory is sound.
const zipParts = (buffer) => {
  let end = -1;
  for (let at = buffer.length - 22; at >= Math.max(0, buffer.length - 22 - 65535); at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_DIRECTORY) { end = at; break; }
  }
  if (end < 0) throw bad('not a zip');
  const entries = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const parts = new Map();
  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_ENTRY) throw bad('damaged directory');
    const nameLength = buffer.readUInt16LE(at + 28);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    parts.set(name, { method: buffer.readUInt16LE(at + 10), compressed: buffer.readUInt32LE(at + 20), declared: buffer.readUInt32LE(at + 24), local: buffer.readUInt32LE(at + 42) });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return parts;
};

const partBytes = (buffer, parts, name) => {
  const part = parts.get(name);
  if (!part) return null;
  const header = part.local;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_ENTRY) throw bad('damaged part');
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const data = buffer.subarray(start, start + part.compressed);
  if (part.method === STORED) return data;
  if (part.method === DEFLATED) {
    try { return inflateRawSync(data, { maxOutputLength: part.declared + 1 }); } catch { throw bad('damaged part'); }
  }
  throw bad('unsupported compression');
};

// Feeds the part to the parser in slices, decoding bytes to text with a decoder that holds back an unfinished letter.
// The slice size is only changed by tests (to put a letter on every possible boundary); reading is synchronous, so nothing else can see it.
let currentSlice = SLICE_BYTES;
const parseXml = (bytes, handlers) => {
  const parser = new SaxesParser();
  parser.on('error', (error) => { throw bad(String(error.message).slice(0, 80)); });
  if (handlers.opentag) parser.on('opentag', handlers.opentag);
  if (handlers.closetag) parser.on('closetag', handlers.closetag);
  if (handlers.text) parser.on('text', handlers.text);
  const decoder = new StringDecoder('utf8');
  for (let at = 0; at < bytes.length; at += currentSlice) parser.write(decoder.write(bytes.subarray(at, at + currentSlice)));
  const rest = decoder.end();
  if (rest) parser.write(rest);
  parser.close();
};

// "_x000D_" in a text is the carriage return, as ExcelJS reads it.
const unescapeText = (text) => text.replace(/_x([0-9A-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

// ExcelJS's own rule for "this number format shows a date".
const isDateFormat = (code) => {
  if (!code) return false;
  return /[ymdhMsb]+/.test(code.replace(/\[[^\]]*]/g, '').replace(/"[^"]*"/g, ''));
};
// The number formats ExcelJS knows by id (the others it only knows when styles.xml defines them).
const BUILT_IN_FORMATS = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'mm-dd-yy', 15: 'd-mmm-yy',
  16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy "h":mm', 37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00 ;(#,##0.00)', 40: '#,##0.00 ;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
};
const excelToDate = (serial, date1904) => new Date(Math.round((serial - 25569 + (date1904 ? 1462 : 0)) * 24 * 3600 * 1000));

const columnNumber = (reference) => {
  let column = 0;
  for (let i = 0; i < reference.length; i += 1) {
    const code = reference.charCodeAt(i);
    if (code < 65 || code > 90) break;
    column = column * 26 + (code - 64);
  }
  return column;
};
const parseRange = (range) => {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!match) return null;
  const left = columnNumber(match[1]);
  const top = parseInt(match[2], 10);
  return { left, top, right: match[3] ? columnNumber(match[3]) : left, bottom: match[4] ? parseInt(match[4], 10) : top };
};

const readWorkbookPart = (bytes) => {
  const sheets = [];
  let date1904 = false;
  parseXml(bytes, {
    opentag: (node) => {
      if (node.name === 'workbookPr') date1904 = ['1', 'true'].includes(String(node.attributes.date1904));
      if (node.name === 'sheet') sheets.push({ name: node.attributes.name, relationship: node.attributes['r:id'] });
    },
  });
  return { sheets, date1904 };
};

const readRelationships = (bytes) => {
  const targets = new Map();
  parseXml(bytes, { opentag: (node) => { if (node.name === 'Relationship') targets.set(node.attributes.Id, node.attributes.Target); } });
  return targets;
};

// One <si> (shared string) or <is> (inline string): all its <t> text, leaving out the phonetic guide (<rPh>), like ExcelJS.
const textCollector = () => {
  let depthPhonetic = 0;
  let inText = false;
  let text = '';
  let current = '';
  return {
    open: (name) => {
      if (name === 'rPh') depthPhonetic += 1;
      if (name === 't' && depthPhonetic === 0) { inText = true; current = ''; }
    },
    text: (value) => { if (inText) current += value; },
    close: (name) => {
      if (name === 'rPh') depthPhonetic -= 1;
      if (name === 't' && inText) { inText = false; text += unescapeText(current); }
    },
    start: () => { text = ''; depthPhonetic = 0; inText = false; },
    result: () => text,
  };
};

const readSharedStrings = (bytes) => {
  const strings = [];
  const collector = textCollector();
  let inItem = false;
  parseXml(bytes, {
    opentag: (node) => {
      if (node.name === 'si') { inItem = true; collector.start(); return; }
      if (inItem) collector.open(node.name);
    },
    text: (value) => { if (inItem) collector.text(value); },
    closetag: (node) => {
      if (node.name === 'si') { inItem = false; strings.push(collector.result()); return; }
      if (inItem) collector.close(node.name);
    },
  });
  return strings;
};

// Which cell styles (the "s" of a cell) show a date.
const readDateStyles = (bytes) => {
  const custom = new Map();
  const formatOfStyle = [];
  let inCellXfs = false;
  parseXml(bytes, {
    opentag: (node) => {
      if (node.name === 'numFmt') custom.set(parseInt(node.attributes.numFmtId, 10), String(node.attributes.formatCode).replace(/[\\](.)/g, '$1'));
      if (node.name === 'cellXfs') inCellXfs = true;
      else if (node.name === 'xf' && inCellXfs) formatOfStyle.push(parseInt(node.attributes.numFmtId || '0', 10));
    },
    closetag: (node) => { if (node.name === 'cellXfs') inCellXfs = false; },
  });
  // ExcelJS gives style 0 (and a format id of 0) no format at all.
  return formatOfStyle.map((id, index) => index !== 0 && id !== 0 && isDateFormat(custom.get(id) ?? BUILT_IN_FORMATS[id]));
};

const readSheetPart = (bytes, { strings, dateStyles, date1904 }) => {
  const rows = [];
  const merges = [];
  let row = null;
  let rowNumber = 0;
  let cell = null;
  let lastColumn = 0;
  let inValue = false;
  let inInline = false;
  const inline = textCollector();

  const finishCell = () => {
    const { column, style, type, formula, value, inlineText, hasInline } = cell;
    cell = null;
    if (column < 1) return;
    const isDate = style > 0 && dateStyles[style] === true;
    let result;
    if (formula) {
      if (value === null) result = null; // a formula with no saved result gives no value
      else if (type === 'str') result = unescapeText(value);
      else if (type === 'b') result = parseInt(value, 10) !== 0;
      else if (type === 'e') result = null;
      else { const number = parseFloat(value); result = isDate ? excelToDate(number, date1904) : number; }
    } else if (hasInline && type === 'inlineStr') result = inlineText;
    else if (value === null) return; // no value: a hole (a merged cell is filled in below)
    else if (type === 's') result = strings[parseInt(value, 10)];
    else if (type === 'str') result = unescapeText(value);
    else if (type === 'b') result = parseInt(value, 10) !== 0;
    else if (type === 'e') result = null;
    else { const number = parseFloat(value); result = isDate ? excelToDate(number, date1904) : number; }
    row[column - 1] = result === undefined ? null : result;
  };

  parseXml(bytes, {
    opentag: (node) => {
      const { name, attributes } = node;
      if (cell && inInline) { inline.open(name); return; }
      if (name === 'row') {
        rowNumber = attributes.r ? parseInt(attributes.r, 10) : rowNumber + 1;
        row = rows[rowNumber - 1] ?? [];
        rows[rowNumber - 1] = row;
        lastColumn = 0;
      } else if (name === 'c' && row) {
        const reference = attributes.r ? columnNumber(attributes.r) : lastColumn + 1;
        lastColumn = reference;
        cell = { column: reference, style: parseInt(attributes.s || '0', 10), type: attributes.t, formula: false, value: null, inlineText: '', hasInline: false };
      } else if (name === 'f' && cell) cell.formula = true;
      else if (name === 'v' && cell) { inValue = true; cell.value = ''; }
      else if (name === 'is' && cell) { inInline = true; cell.hasInline = true; inline.start(); }
      else if (name === 'mergeCell') merges.push(attributes.ref);
    },
    text: (value) => {
      if (inValue && cell) cell.value += value;
      else if (inInline && cell) inline.text(value);
    },
    closetag: (node) => {
      const { name } = node;
      if (name === 'v') inValue = false;
      else if (name === 'is' && cell) { inInline = false; cell.inlineText = inline.result(); }
      else if (inInline && cell) inline.close(name);
      else if (name === 'c' && cell) finishCell();
      else if (name === 'row') row = null;
    },
  });

  // A merged range shows its top-left cell's value in every cell, as ExcelJS does.
  for (const reference of merges) {
    const range = parseRange(String(reference));
    if (!range) continue;
    const master = rows[range.top - 1]?.[range.left - 1];
    if (master === undefined) continue;
    for (let r = range.top; r <= range.bottom; r += 1) {
      const target = rows[r - 1] ?? [];
      rows[r - 1] = target;
      for (let c = range.left; c <= range.right; c += 1) if (r !== range.top || c !== range.left) target[c - 1] = master;
    }
  }
  return rows;
};

// Whether rows that were read without limits are within the limits a statement is held to.
export const sheetsWithinLimits = (sheets) => {
  const names = Object.keys(sheets);
  return names.length <= MAX_SHEETS && names.every((name) => sheets[name].length <= MAX_ROWS);
};

// limits: true (the default) refuses a workbook with too many sheets or rows, like `sheetsFromWorkbook`. The weekly upload passes false so
// that pay is read from any file it could read before, and checks `sheetsWithinLimits` for the steps that were always limited.
export const readWorkbookRows = (buffer, { limits = true, sliceBytes = SLICE_BYTES } = {}) => {
  currentSlice = sliceBytes;
  try {
    return readAll(buffer, limits);
  } finally {
    currentSlice = SLICE_BYTES;
  }
};

const readAll = (buffer, limits) => {
  const parts = zipParts(buffer);
  const workbookBytes = partBytes(buffer, parts, 'xl/workbook.xml');
  if (!workbookBytes) throw bad('no workbook part');
  const { sheets: declared, date1904 } = readWorkbookPart(workbookBytes);
  if (limits && declared.length > MAX_SHEETS) throw new StatementError(`The workbook has ${declared.length} sheets; a statement has about nine.`);
  const relationshipBytes = partBytes(buffer, parts, 'xl/_rels/workbook.xml.rels');
  const targets = relationshipBytes ? readRelationships(relationshipBytes) : new Map();
  const stringsBytes = partBytes(buffer, parts, 'xl/sharedStrings.xml');
  const strings = stringsBytes ? readSharedStrings(stringsBytes) : [];
  const stylesBytes = partBytes(buffer, parts, 'xl/styles.xml');
  const dateStyles = stylesBytes ? readDateStyles(stylesBytes) : [];

  const sheets = {};
  for (const sheet of declared) {
    const target = targets.get(sheet.relationship);
    if (!target) continue;
    const bytes = partBytes(buffer, parts, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    if (!bytes) continue;
    const rows = readSheetPart(bytes, { strings, dateStyles, date1904 });
    if (limits && rows.length > MAX_ROWS) throw new StatementError(`The sheet "${sheet.name}" has ${rows.length} rows, far more than a statement.`);
    sheets[sheet.name] = Array.from(rows, (row) => row ?? []);
  }
  return sheets;
};
