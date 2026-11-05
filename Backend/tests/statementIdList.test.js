import test from 'node:test';
import assert from 'node:assert/strict';
import { statementIdList } from '../controllers/payroll/statementIdList.js';

test('no list means the whole run; a list is parsed, de-duplicated and sorted; anything odd is a 400, never the whole run', () => {
  assert.equal(statementIdList(undefined), undefined);
  assert.equal(statementIdList(null), undefined);
  assert.equal(statementIdList(''), undefined);
  assert.deepEqual(statementIdList('5, 3,5'), [3, 5]);
  assert.deepEqual(statementIdList([9, '2', 2]), [2, 9]);
  for (const bad of [[], 'a,1', '0', '-1', '1.5', [1, 'x'], Array.from({ length: 2001 }, (_, i) => i + 1)]) {
    assert.throws(() => statementIdList(bad), { status: 400 }, JSON.stringify(bad).slice(0, 40));
  }
});
