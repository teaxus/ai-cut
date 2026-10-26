import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AICUT_ISSUES_URL, AICUT_LATEST_RELEASE_API_URL, AICUT_RELEASES_URL, AICUT_REPOSITORY_URL, aicutVersion } from '../shared/aicut/release.ts';

const release = JSON.parse(readFileSync(new URL('../aicut.json', import.meta.url), 'utf8'));
const upstreamPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('aicut.json 字段齐全', () => {
  for (const key of ['product', 'appId', 'repository', 'upstreamRepository', 'upstreamTag', 'revision']) {
    assert.ok(release[key] !== undefined && release[key] !== '', key);
  }
  assert.match(release.repository, /^[\w.-]+\/[\w.-]+$/);
  assert.ok(Number.isInteger(release.revision) && release.revision >= 1);
});

test('基线 tag 与 package.json 版本一致（同步上游后必须同时更新）', () => {
  assert.equal(release.upstreamTag.replace(/^v/, ''), upstreamPackage.version);
});

test('版本号规则：上游版本 + -aicut.<修订号>，重复套用不叠加', () => {
  assert.equal(aicutVersion('0.2.17', 1), '0.2.17-aicut.1');
  assert.equal(aicutVersion('v0.2.18', 3), '0.2.18-aicut.3');
  assert.equal(aicutVersion('0.2.17-aicut.1', 2), '0.2.17-aicut.2');
});

test('链接都指向派生仓库', () => {
  assert.equal(AICUT_REPOSITORY_URL, `https://github.com/${release.repository}`);
  assert.equal(AICUT_ISSUES_URL, `https://github.com/${release.repository}/issues`);
  assert.equal(AICUT_RELEASES_URL, `https://github.com/${release.repository}/releases/latest`);
  assert.equal(AICUT_LATEST_RELEASE_API_URL, `https://api.github.com/repos/${release.repository}/releases/latest`);
});
