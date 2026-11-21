// Checks render-env.cjs against the backend's own dotenv: every value must come back exactly as stored, or be refused.
// Run from the repository root: node --test docs/infra/terraform/tests/render-env.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { quote, render, settingsFrom } = require('../render-env.cjs');

const dotenv = createRequire(path.join(__dirname, '..', '..', '..', '..', 'Backend', 'package.json'))('dotenv');
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\nAAAA+/==\n-----END CERTIFICATE-----';

const survivors = {
  PLAIN: 'abc123',
  EMPTY: '',
  PEM_REAL_LINE_BREAKS: PEM,
  LITERAL_BACKSLASH_N: 'line1\\nline2',
  BACKSLASH: 'ab\\cd',
  DOUBLE_QUOTES: 'say "hi"',
  SINGLE_QUOTE: "it's",
  BOTH_QUOTES: 'it\'s "x"',
  BOTH_QUOTES_AND_BACKSLASH_N: 'it\'s "x" \\n',
  HASH: 'pa#ss # not a comment',
  URL: 'postgres://u:p@h:5432/db?sslmode=require&x=1',
  JSON: '{"a":1,"b":"two"}',
  SPACES: '  padded  ',
  DOLLAR: '$HOME ${NOT_EXPANDED}',
  UNICODE: 'café ✓',
};

test('every value comes back from dotenv exactly as stored', () => {
  const { text, bad } = render(survivors, dotenv.parse);
  assert.deepEqual(bad, []);
  assert.deepEqual(dotenv.parse(text), survivors);
});

test('values dotenv cannot carry are refused by name, never written', () => {
  const settings = { OK: 'x', CR: 'a\rb', TRAILING_BACKSLASH: 'abc\\', ALL_THREE_QUOTES: 'a\'b"c`d', 'BAD-NAME': 'x' };
  const { text, bad } = render(settings, dotenv.parse);
  assert.deepEqual(bad.sort(), ['ALL_THREE_QUOTES', 'BAD-NAME', 'CR', 'TRAILING_BACKSLASH']);
  assert.deepEqual(dotenv.parse(text), { OK: 'x' });
});

test('a mismatch found by the parse-back check is reported', () => {
  const lying = () => ({ A: 'changed' });
  assert.deepEqual(render({ A: 'original' }, lying).bad, ['A']);
});

test('quote picks single quotes first and refuses what no style can carry', () => {
  assert.equal(quote('x'), "'x'");
  assert.equal(quote("it's"), '"it\'s"');
  assert.equal(quote('it\'s \\n'), "`it's \\n`");
  assert.equal(quote('a\'b"c`d'), null);
});

test('the bootstrap settings win over SSM copies of them', () => {
  const params = [{ Name: '/nasa/prod/DB_HOST', Value: 'db' }, { Name: '/nasa/prod/PORT', Value: '9999' }];
  const { settings, ignored } = settingsFrom(params, 3251);
  assert.deepEqual(settings, { NODE_ENV: 'production', PORT: '3251', TRUST_PROXY: '1', DB_HOST: 'db' });
  assert.deepEqual(ignored, ['PORT']);
});
