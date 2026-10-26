// ai-cut：发行信息（产品名、仓库、版本号）。数据源是仓库根目录的 aicut.json，
// 打包配置 config/aicut-electron-builder.config.mjs 读同一份文件，保证安装包与界面显示的版本一致。
import release from '../../aicut.json' with { type: 'json' };

export const AICUT_PRODUCT_NAME = release.product;
export const AICUT_REPOSITORY_URL = `https://github.com/${release.repository}`;
export const AICUT_ISSUES_URL = `${AICUT_REPOSITORY_URL}/issues`;
export const AICUT_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${release.repository}/releases/latest`;
export const AICUT_RELEASES_URL = `${AICUT_REPOSITORY_URL}/releases/latest`;

/** 派生版版本号 = 上游版本 + "-aicut.<修订号>"，例如 0.2.17-aicut.1。 */
export function aicutVersion(upstreamVersion: string, revision: number = release.revision): string {
  const base = upstreamVersion.trim().replace(/^v/i, '').replace(/-aicut\.\d+$/, '');
  return `${base}-aicut.${revision}`;
}
