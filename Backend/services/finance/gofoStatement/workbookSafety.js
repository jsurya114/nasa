import { inflateRawSync } from 'node:zlib';
import { StatementError } from './statementMoney.js';

// A statement is untrusted input. An .xlsx file is a zip, and a small zip can inflate to gigabytes. Before the workbook is opened:
//   1. the zip's own directory is read and a file that declares too many parts, too much data or an absurd compression ratio is refused;
//   2. every part is then really inflated here, with a hard cap on the bytes produced, and must come out at exactly the size the directory declared.
//      A file that lies about its sizes is refused, so the check cannot be bypassed by a directory that says one thing and a part that does another.
// A real statement is about 15 to 20 MB inflated at a ratio near 11. The opened workbook is also capped (readStatementWorkbook.js) and the upload
// itself is limited to 25 MB.

export const MAX_ENTRIES = 100;
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const MAX_RATIO = 100;
const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 65535;

const refuse = (why) => { throw new StatementError(`The file does not look like a normal Excel statement (${why}).`); };

export const assertSafeWorkbook = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < END_RECORD_BYTES) refuse('too small');
  let end = -1;
  for (let at = buffer.length - END_RECORD_BYTES; at >= Math.max(0, buffer.length - END_RECORD_BYTES - MAX_COMMENT_BYTES); at -= 1) {
    if (buffer.readUInt32LE(at) === END_OF_DIRECTORY) { end = at; break; }
  }
  if (end < 0) refuse('it is not a complete zip');
  const entries = buffer.readUInt16LE(end + 10);
  const offset = buffer.readUInt32LE(end + 16);
  if (entries === 0xffff || offset === 0xffffffff) refuse('zip64 files are not accepted');
  if (entries === 0 || entries > MAX_ENTRIES) refuse(`${entries} parts`);
  const parts = [];
  let compressed = 0;
  let inflated = 0;
  let at = offset;
  for (let i = 0; i < entries; i += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_ENTRY) refuse('its directory is damaged');
    const part = { method: buffer.readUInt16LE(at + 10), compressed: buffer.readUInt32LE(at + 20), declared: buffer.readUInt32LE(at + 24), local: buffer.readUInt32LE(at + 42) };
    compressed += part.compressed;
    inflated += part.declared;
    parts.push(part);
    at += 46 + buffer.readUInt16LE(at + 28) + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  if (inflated > MAX_UNCOMPRESSED_BYTES) refuse('it would inflate to too much data');
  if (compressed > 0 && inflated / compressed > MAX_RATIO) refuse('its compression ratio is far beyond a spreadsheet');

  // What the parts really contain, with the same cap, so a directory that understates a part cannot hide it.
  let budget = MAX_UNCOMPRESSED_BYTES;
  for (const part of parts) {
    const header = part.local;
    if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_ENTRY) refuse('a part is damaged');
    const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
    const data = buffer.subarray(start, start + part.compressed);
    if (data.length !== part.compressed) refuse('a part is cut short');
    let actual;
    if (part.method === STORED) actual = data.length;
    else if (part.method === DEFLATED) {
      try { actual = inflateRawSync(data, { maxOutputLength: Math.max(1, budget + 1) }).length; } catch { refuse('a part inflates to more than it declares or is damaged'); }
    } else refuse('a part uses an unsupported compression method');
    budget -= actual;
    if (budget < 0) refuse('it would inflate to too much data');
    if (actual !== part.declared) refuse('a part is not the size its directory says');
  }
};
