import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, planSteps, AICUT_CONFIG, UPSTREAM_CONFIG } from '../tools/lib/dist.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const release = JSON.parse(readFileSync(new URL('../aicut.json', import.meta.url), 'utf8'));
const upstreamPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// 上游配置在模块求值时读 CC_EB_TARGET，同一进程里只会求值一次，所以每个目标单独起一个子进程读配置。
function loadConfig(target: string, extraEnv: Record<string, string | undefined> = {}) {
  const script = `
    const w = await import('./config/aicut-electron-builder.config.mjs');
    const b = await import('./config/electron-builder.config.mjs');
    const json = (c) => JSON.parse(JSON.stringify(c, (k, v) => typeof v === 'function' ? '[function]' : v));
    console.log(JSON.stringify({ cfg: json(w.default), base: json(b.default), version: w.AICUT_VERSION, entry: w.AICUT_ENTRY }));`;
  const env = { ...process.env, CC_EB_TARGET: target, ...extraEnv };
  for (const [k, v] of Object.entries(extraEnv)) if (v === undefined) delete env[k];
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, env, encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').at(-1)!);
}

test('派生打包配置：身份、入口、版本、更新源、产物目录', () => {
  const { cfg, base, version, entry } = loadConfig('darwin-arm64');
  assert.equal(cfg.appId, release.appId);
  assert.equal(cfg.productName, release.product);
  assert.equal(version, `${upstreamPackage.version}-aicut.${release.revision}`);
  assert.equal(cfg.extraMetadata.version, version);
  assert.equal(cfg.extraMetadata.main, entry);
  assert.equal(cfg.files[0], entry);
  assert.deepEqual(cfg.files.slice(1), base.files, '其余文件规则沿用上游');
  assert.equal(cfg.directories.output, 'release-aicut');
  const [owner, repo] = release.repository.split('/');
  assert.deepEqual(cfg.publish.map((p: { owner: string; repo: string }) => [p.owner, p.repo]), [[owner, repo]]);
  assert.equal(cfg.publish[0].channel, 'latest-arm64');
  assert.deepEqual(cfg.asarUnpack, base.asarUnpack);
  assert.deepEqual(cfg.extraResources, base.extraResources);
  for (const icon of [cfg.mac.icon, cfg.win.icon, cfg.linux.icon]) assert.ok(existsSync(new URL(`../${icon}`, import.meta.url)), icon);
});

test('没有正式证书时 mac 走自定义 ad-hoc 签名；有证书时交还 electron-builder', () => {
  const adhoc = loadConfig('darwin-x64', { CSC_LINK: undefined, CSC_NAME: undefined });
  assert.equal(adhoc.cfg.mac.sign, '[function]');
  assert.equal(adhoc.cfg.publish[0].channel, 'latest-x64');
  const signed = loadConfig('darwin-arm64', { CSC_NAME: 'Developer ID Application: Example' });
  assert.equal(signed.cfg.mac.sign, undefined);
  assert.equal(signed.cfg.mac.hardenedRuntime, true);
});

test('打包步骤：派生模式多一步派生入口、最后用派生配置；--pristine 完全是上游步骤', () => {
  const fork = planSteps(parseArgs(['win32-x64']));
  assert.ok(fork.some((s: { args: string[] }) => s.args.join(' ').includes('build-entry.mjs')));
  const last = fork.at(-1)!;
  assert.ok(last.args.includes(AICUT_CONFIG));
  assert.deepEqual(last.env, { CC_EB_TARGET: 'win32-x64' });
  assert.ok(last.args.includes('nsis') && last.args.includes('--x64'));
  const pristine = planSteps(parseArgs(['darwin-arm64', '--pristine', '--dir']));
  assert.ok(!pristine.some((s: { args: string[] }) => s.args.join(' ').includes('build-entry.mjs')));
  assert.ok(pristine.at(-1)!.args.includes(UPSTREAM_CONFIG));
  assert.ok(pristine.at(-1)!.args.includes('--dir'));
  assert.throws(() => parseArgs(['plan9-arm']), /未知目标/);
  assert.throws(() => parseArgs(['darwin-arm64', '--bogus']), /未知参数/);
  const skip = planSteps(parseArgs(['darwin-x64', '--skip-web', '--targets', 'dmg']));
  assert.ok(!skip.some((s: { args: string[] }) => s.args.includes('build')));
  assert.ok(skip.at(-1)!.args.includes('dmg') && !skip.at(-1)!.args.includes('zip'));
});
