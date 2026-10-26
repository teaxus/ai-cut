import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRegistry, checkLanded } from '../tools/lib/integration-points.mjs';

test('登记表能解析出编号、文件和策略', () => {
  const rows = readRegistry();
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.match(row.id, /^IP-\d{2,}$/);
    assert.ok(['ours', 'keep-hook', 'binary-ours'].includes(row.strategy), `${row.id} 策略 ${row.strategy}`);
    assert.ok(['planned', 'landed', 'removed'].includes(row.status), `${row.id} 状态 ${row.status}`);
  }
});

test('每个已落地的接入点标记都还在文件里', () => {
  assert.deepEqual(checkLanded(readRegistry()), []);
});

test('缺标记会被报出来', () => {
  const fake = [{ id: 'IP-99', files: ['.gitignore'], marker: 'aicut-hook:IP-99-not-there', strategy: 'ours', status: 'landed', intent: '' }];
  const problems = checkLanded(fake);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /IP-99/);
});
