import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { StatementError } from '../services/finance/gofoStatement/statementMoney.js';
import { assertSafeWorkbook } from '../services/finance/gofoStatement/workbookSafety.js';
import { readStatementWorkbook } from '../services/finance/gofoStatement/readStatementWorkbook.js';
import { statementWorkbook } from './helpers/gofoStatementFixture.js';

// A statement is untrusted input: a small zip that claims to inflate to gigabytes is refused before anything is opened. All files here are made up.
const endOf = (buffer) => { let at = buffer.length - 22; while (buffer.readUInt32LE(at) !== 0x06054b50) at -= 1; return at; };
const firstEntryOf = (buffer) => buffer.readUInt32LE(endOf(buffer) + 16);

test('a normal workbook is accepted', async () => {
  const file = await statementWorkbook();
  assert.doesNotThrow(() => assertSafeWorkbook(file));
  assert.ok(Object.keys(await readStatementWorkbook(file)).length >= 9);
});

test('a zip that declares far too much data, or an absurd compression ratio, or too many parts, is refused', async () => {
  const huge = Buffer.from(await statementWorkbook());
  huge.writeUInt32LE(0xf0000000, firstEntryOf(huge) + 24); // one part claims ~4 GB
  assert.throws(() => assertSafeWorkbook(huge), (e) => e instanceof StatementError && /inflate to too much data/.test(e.message));

  const ratio = Buffer.from(await statementWorkbook());
  ratio.writeUInt32LE(90 * 1024 * 1024, firstEntryOf(ratio) + 24); // under the size cap, but a thousand times its compressed size
  assert.throws(() => assertSafeWorkbook(ratio), (e) => /compression ratio/.test(e.message));

  const many = Buffer.from(await statementWorkbook());
  many.writeUInt16LE(101, endOf(many) + 10);
  assert.throws(() => assertSafeWorkbook(many), (e) => /101 parts/.test(e.message));

  const zip64 = Buffer.from(await statementWorkbook());
  zip64.writeUInt16LE(0xffff, endOf(zip64) + 10);
  assert.throws(() => assertSafeWorkbook(zip64), (e) => /zip64/.test(e.message));
});

test('something that is not a complete zip is refused, and the reader refuses a hostile file before opening it', async () => {
  for (const bad of [Buffer.from('plain text, not a zip'), Buffer.alloc(10), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)])]) {
    assert.throws(() => assertSafeWorkbook(bad), StatementError);
  }
  const huge = Buffer.from(await statementWorkbook());
  huge.writeUInt32LE(0xf0000000, firstEntryOf(huge) + 24);
  await assert.rejects(() => readStatementWorkbook(huge), StatementError);
});

// A zip built by hand whose directory UNDERSTATES a part: it declares a few bytes but the part really inflates to 120 MB of zeros.
const lyingZip = (declared) => {
  const data = deflateRawSync(Buffer.alloc(120 * 1024 * 1024));
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(declared, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  const directoryAt = local.length + name.length + data.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(directoryAt, 16);
  return Buffer.concat([local, name, data, central, name, end]);
};

test('a part that really inflates to far more than its directory declares is refused, so the declared sizes cannot be used to hide a zip bomb', () => {
  assert.throws(() => assertSafeWorkbook(lyingZip(1000)), (e) => e instanceof StatementError && /inflates to more than it declares/.test(e.message));
  // Even a directory that declares the huge size honestly is refused for being too big, without relying on the declaration alone.
  assert.throws(() => assertSafeWorkbook(lyingZip(120 * 1024 * 1024)), (e) => /too much data/.test(e.message));
});

test('a part whose real size differs from its declared size is refused', async () => {
  const file = Buffer.from(await statementWorkbook());
  const entry = firstEntryOf(file);
  file.writeUInt32LE(file.readUInt32LE(entry + 24) + 1, entry + 24); // declares one byte more than the part really holds
  assert.throws(() => assertSafeWorkbook(file), (e) => /not the size its directory says/.test(e.message));
});
