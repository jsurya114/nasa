import test from 'node:test';
import assert from 'node:assert/strict';
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
  ratio.writeUInt32LE(150 * 1024 * 1024, firstEntryOf(ratio) + 24); // under the size cap, but a thousand times its compressed size
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
