// ai-cut：派生版的服务端插件全部从这里注册。上游 server/plugins/index.ts 的插件数组末尾只有一行
// `...aicutServerPlugins()`（接入点 IP-09），开发服务器与桌面内嵌服务器因此同时生效。
import type { Plugin } from 'vite';
import { agentInstallerPlugin } from './agent-installer.ts';

export function aicutServerPlugins(): Plugin[] {
  return [agentInstallerPlugin()];
}
