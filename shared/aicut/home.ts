// ai-cut：派生版的数据根目录与默认端口。
// 打包后的 AI Cut 由 desktop/aicut/entry.ts 在加载上游代码之前设置这两个环境变量，
// 让项目库、MCP token、端口记忆、数据目录指针都落在 ~/.ai-cut，与上游 OpenChatCut 的 ~/.openchatcut 分开。
// 没设置时（开发模式、上游测试）返回值与上游完全一致，所以上游的 verify 不受影响。
// 模型缓存、内容插件、用户技能、Codex/Copilot 隔离目录仍用 ~/.openchatcut（docs/decisions.md D-05、D-13）。
import { isAbsolute, join, resolve } from 'node:path';

export const AICUT_HOME_ENV = 'AICUT_HOME';
export const AICUT_PORT_ENV = 'AICUT_CANONICAL_PORT';
export const AICUT_DEFAULT_PORT = 5299;

type Env = Readonly<Record<string, string | undefined>>;

/** 替代上游写死的 join(home, '.openchatcut')（只用于默认 profile，dev-profiles 不走这里）。 */
export function openChatCutHomeRoot(home: string, env: Env = process.env): string {
  const raw = env[AICUT_HOME_ENV]?.trim();
  if (!raw) return join(home, '.openchatcut');
  const expanded = raw === '~' ? home : raw.replace(/^~(?=[\\/])/, home);
  if (!isAbsolute(expanded)) throw new Error(`${AICUT_HOME_ENV} must be an absolute path (got: ${raw})`);
  return resolve(expanded);
}

/** 替代上游的规范端口常量 5199；环境变量不是 1024–65535 的整数时退回上游值。 */
export function canonicalEmbeddedPort(upstreamPort: number, env: Env = process.env): number {
  const port = Number(env[AICUT_PORT_ENV]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : upstreamPort;
}
