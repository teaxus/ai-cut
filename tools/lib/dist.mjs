// ai-cut 打包编排：本机（tools/build.sh）和远端 Windows 主机（tools/pkghost-remote-build.ps1）都调它，
// 步骤与上游 package.json 的 desktop:dist:* 一致，只把最后一步 electron-builder 换成派生版的配置。
// Packaging pipeline shared by local and remote builds; mirrors upstream's desktop:dist:* scripts.
//
// 用法 / usage: node tools/lib/dist.mjs <target> [--targets nsis,zip] [--dir] [--pristine] [--skip-web]
//   target: darwin-arm64 | darwin-x64 | win32-x64 | linux-x64
//   --pristine  用上游原样的打包配置（基线验证用）/ use upstream's own builder config (baseline check)
//   --dir       只出目录形式的 .app / win-unpacked，不出安装包 / unpacked output only
//   --skip-web  跳过 `npm run build`（前端已构建过时省时间）/ reuse an existing dist/
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './integration-points.mjs';

const TARGETS = {
  'darwin-arm64': { os: '--mac', arch: '--arm64', defaults: ['dmg', 'zip'] },
  'darwin-x64': { os: '--mac', arch: '--x64', defaults: ['dmg', 'zip'] },
  'win32-x64': { os: '--win', arch: '--x64', defaults: ['nsis'] },
  'linux-x64': { os: '--linux', arch: '--x64', defaults: ['AppImage'] },
};
export const AICUT_CONFIG = 'config/aicut-electron-builder.config.mjs';
export const UPSTREAM_CONFIG = 'config/electron-builder.config.mjs';

export function parseArgs(argv) {
  const [target, ...rest] = argv;
  if (!TARGETS[target]) throw new Error(`未知目标 / unknown target: ${target ?? '(空)'}；可选 ${Object.keys(TARGETS).join(' | ')}`);
  const opts = { target, targets: null, dir: false, pristine: false, skipWeb: false };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--dir') opts.dir = true;
    else if (a === '--pristine') opts.pristine = true;
    else if (a === '--skip-web') opts.skipWeb = true;
    else if (a === '--targets') opts.targets = (rest[++i] ?? '').split(/[,\s]+/).filter(Boolean);
    else throw new Error(`未知参数 / unknown option: ${a}`);
  }
  return opts;
}

/** 返回要依次执行的步骤：[{label, cmd, args, env}] */
export function planSteps(opts) {
  const t = TARGETS[opts.target];
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const builderConfig = opts.pristine ? UPSTREAM_CONFIG : AICUT_CONFIG;
  const builderArgs = [join('node_modules', 'electron-builder', 'cli.js'), '--config', builderConfig, t.os];
  if (opts.dir) builderArgs.push('--dir');
  else builderArgs.push(...(opts.targets ?? t.defaults));
  builderArgs.push(t.arch, '--publish', 'never');
  const steps = [];
  if (!opts.skipWeb) steps.push({ label: '前端构建 / web build', cmd: npm, args: ['run', 'build'] });
  steps.push({ label: '主进程打包 / main-process bundles', cmd: npm, args: ['run', 'desktop:build:main'] });
  if (!opts.pristine) {
    steps.push({ label: '派生入口打包 / ai-cut entry bundle', cmd: process.execPath, args: [join('tools', 'lib', 'build-entry.mjs')] });
  }
  steps.push({ label: 'Remotion 预打包 / Remotion prebundle', cmd: npm, args: ['run', 'desktop:prebundle'] });
  steps.push({ label: `目标平台二进制 / target binaries (${opts.target})`, cmd: process.execPath,
    args: [join('node_modules', 'tsx', 'dist', 'cli.mjs'), join('desktop', 'prepare-target.mts'), opts.target] });
  steps.push({ label: `electron-builder（${builderConfig}）`, cmd: process.execPath, args: builderArgs,
    env: { CC_EB_TARGET: opts.target } });
  return steps;
}

function run(steps) {
  // 本机钥匙串里可能有别的组织的证书：关掉 electron-builder 的自动签名（docs/decisions.md D-07）。
  const baseEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  steps.forEach((step, i) => {
    console.log(`>>> [${i + 1}/${steps.length}] ${step.label}`);
    console.log(`    $ ${[step.cmd, ...step.args].join(' ')}`);
    const r = spawnSync(step.cmd, step.args, {
      cwd: ROOT, stdio: 'inherit', env: { ...baseEnv, ...(step.env ?? {}) },
      shell: process.platform === 'win32' && step.cmd.endsWith('.cmd'),
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
      console.error(`✗ 第 ${i + 1} 步失败 / step failed (exit ${r.status}): ${step.label}`);
      process.exit(r.status ?? 1);
    }
  });
}

if (process.argv[1] && process.argv[1].endsWith('dist.mjs')) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  if (!opts.pristine && !existsSync(join(ROOT, AICUT_CONFIG))) {
    console.error(`✗ 找不到 ${AICUT_CONFIG}；基线验证请加 --pristine / missing fork config, use --pristine for a baseline build`);
    process.exit(2);
  }
  run(planSteps(opts));
  console.log('>>> 打包完成 / packaging done');
}
