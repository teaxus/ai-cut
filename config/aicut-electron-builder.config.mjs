// ai-cut 打包配置：在上游 electron-builder 配置上覆盖身份、更新源、图标、入口和版本号，上游文件一行不改。
// 由 tools/lib/dist.mjs 通过 `electron-builder --config config/aicut-electron-builder.config.mjs` 使用。
// CC_EB_TARGET 在上游模块求值时读取，这里 import 时自动继承（平台二进制过滤规则全部沿用上游）。
import { readFileSync } from 'node:fs';
import base from './electron-builder.config.mjs';
import { signAsync } from '@electron/osx-sign';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const release = readJson('../aicut.json');
const upstreamPackage = readJson('../package.json');
const [owner, repo] = release.repository.split('/');

/** 与 shared/aicut/release.ts 的 aicutVersion() 同一规则：上游版本 + "-aicut.<修订号>"。 */
export const AICUT_VERSION = `${upstreamPackage.version}-aicut.${release.revision}`;
export const AICUT_ENTRY = 'desktop-dist/aicut-main.mjs';

export default {
  ...base,
  appId: release.appId,
  productName: release.product,
  artifactName: 'AI-Cut-${version}-${arch}.${ext}',
  directories: { ...base.directories, output: 'release-aicut' },
  // 更新源换成派生仓库的 GitHub Releases（按架构分 channel 的做法沿用上游）。
  publish: base.publish.map((entry) => ({ ...entry, owner, repo })),
  files: [AICUT_ENTRY, ...base.files],
  // 「Agent 接入」装进各 agent 的技能（tools/lib/sync-skill.mjs 从上游 skills/openchatcut 生成）
  extraResources: [...base.extraResources, { from: 'skills/ai-cut', to: 'aicut-skill' }],
  // 写进安装包里 package.json 的字段：入口换成派生入口，版本号带派生修订号，应用名决定 userData 目录。
  extraMetadata: {
    name: 'ai-cut',
    productName: release.product,
    version: AICUT_VERSION,
    main: AICUT_ENTRY,
    description: 'AI Cut：基于 OpenChatCut 的本地优先 AI 视频剪辑桌面版 / a local-first AI video editor based on OpenChatCut',
    homepage: `https://github.com/${release.repository}`,
    desktopName: 'ai-cut.desktop',
  },
  mac: {
    ...base.mac,
    icon: 'assets/aicut/icon.icns',
    // 没有 Developer ID 时强制 ad-hoc 签名。上游写的 identity: '-' 在 electron-builder 26 里会先按子串
    // 去钥匙串匹配证书（MacTargetHelper.findSigningIdentity → findIdentity 用 line.includes('-')），
    // 本机任何名字带 "-" 的证书都会被拿来签名；这里绕过查找，直接交给 osx-sign 用 "-" 签。
    // 有正式证书（CSC_LINK / CSC_NAME）时不覆盖，走 electron-builder 的正常签名。
    ...(process.env.CSC_LINK || process.env.CSC_NAME
      ? {}
      : {
          // ad-hoc 签名不需要（也拿不到）Apple 时间戳，关掉可免去每个文件一次联网
          sign: (opts) => signAsync({
            ...opts,
            identity: '-',
            identityValidation: false,
            optionsForFile: (file) => ({ ...(opts.optionsForFile?.(file) ?? {}), timestamp: 'none' }),
          }),
        }),
  },
  // 直接给 .ico：用 PNG 时 electron-builder 要先从 GitHub 下载 icons-bundle 转格式（打包主机上曾因此卡 10 分钟超时）
  win: { ...base.win, icon: 'assets/aicut/icon.ico' },
  linux: { ...base.linux, icon: 'assets/aicut/icon.png', executableName: 'ai-cut' },
};
