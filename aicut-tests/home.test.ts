import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { canonicalEmbeddedPort, openChatCutHomeRoot } from '../shared/aicut/home.ts';

const home = '/Users/someone';

test('没设 AICUT_HOME 时与上游一致：~/.openchatcut', () => {
  assert.equal(openChatCutHomeRoot(home, {}), join(home, '.openchatcut'));
  assert.equal(openChatCutHomeRoot(home, { AICUT_HOME: '  ' }), join(home, '.openchatcut'));
});

test('设了 AICUT_HOME 时用它，支持 ~ 展开', () => {
  assert.equal(openChatCutHomeRoot(home, { AICUT_HOME: '/data/ai-cut' }), '/data/ai-cut');
  assert.equal(openChatCutHomeRoot(home, { AICUT_HOME: '~/.ai-cut' }), join(home, '.ai-cut'));
  assert.equal(openChatCutHomeRoot(home, { AICUT_HOME: '~' }), home);
});

test('AICUT_HOME 不是绝对路径时直接报错，不悄悄回退', () => {
  assert.throws(() => openChatCutHomeRoot(home, { AICUT_HOME: 'relative/dir' }), /absolute path/);
});

test('规范端口：没设或非法时用上游的 5199，合法时用设定值', () => {
  assert.equal(canonicalEmbeddedPort(5199, {}), 5199);
  assert.equal(canonicalEmbeddedPort(5199, { AICUT_CANONICAL_PORT: '5299' }), 5299);
  for (const bad of ['80', '70000', 'abc', '52.5', '']) {
    assert.equal(canonicalEmbeddedPort(5199, { AICUT_CANONICAL_PORT: bad }), 5199, bad);
  }
});

test('上游被改动的模块在没设环境变量时返回上游路径', async () => {
  const { mcpTokenPath } = await import('../server/mcp-token.ts');
  const { dataDirPointerPath } = await import('../server/data-dir.ts');
  const { embeddedPortPath, CANONICAL_EMBEDDED_PORT } = await import('../desktop/embedded-port.ts');
  if (process.env.AICUT_HOME || process.env.AICUT_CANONICAL_PORT) return; // 外部环境设了就不比对
  assert.equal(mcpTokenPath({ home }), join(home, '.openchatcut', 'mcp-token'));
  assert.equal(dataDirPointerPath(home), join(home, '.openchatcut', 'data-dir.json'));
  assert.equal(embeddedPortPath({ home }), join(home, '.openchatcut', 'mcp-port'));
  assert.equal(CANONICAL_EMBEDDED_PORT, 5199);
});
