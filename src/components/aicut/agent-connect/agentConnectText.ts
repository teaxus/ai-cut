// ai-cut：「Agent 接入」弹窗里随状态变化的文案（状态标签、失败原因）。中文原文即 i18n key，英文在 src/i18n/dict/en/aicut.ts。
// 组件里用 useT() 订阅语言切换，这里直接用 t()：渲染时重新调用即可跟随语言。
import { t } from '../../../i18n/locale';
import { AgentApiError, type AgentStatus } from './agentConnectApi';
import type { ChipTone } from './agentConnectStyles';

export interface Chip { readonly text: string; readonly tone: ChipTone }

export function mcpChip(mcp: AgentStatus['mcp']): Chip {
  switch (mcp.state) {
    case 'installed': return { text: t('MCP：已安装'), tone: 'ok' };
    case 'outdated': return { text: t('MCP：需更新'), tone: 'warn' };
    case 'absent': return { text: t('MCP：未安装'), tone: 'todo' };
    case 'manual': return { text: t('MCP：需手动添加'), tone: 'warn' };
    case 'unreadable': return { text: t('MCP：配置文件读不懂'), tone: 'bad' };
    default: return { text: t('MCP：不支持'), tone: 'off' };
  }
}

export function skillChip(skill: AgentStatus['skill']): Chip {
  switch (skill.state) {
    case 'installed': return { text: t('技能：已安装'), tone: 'ok' };
    case 'outdated': return { text: t('技能：需更新'), tone: 'warn' };
    case 'absent': return { text: t('技能：未安装'), tone: 'todo' };
    case 'foreign': return { text: t('技能：同名目录不是 AI Cut 装的'), tone: 'warn' };
    case 'no-source': return { text: t('技能：缺少技能文件'), tone: 'bad' };
    default: return { text: t('技能：不支持'), tone: 'off' };
  }
}

/** 服务端返回的中文原因经字典翻译；查不到（带路径的动态文案）就原样显示。 */
export const serverText = (text: string): string => t(text);

/** 请求本身失败（不是某个 agent 的安装失败）时给人看的原因。 */
export function requestFailure(error: unknown): string {
  if (error instanceof AgentApiError) {
    if (error.kind === 'network') return t('连不上 AI Cut 服务：{reason}', { reason: error.message });
    if (error.kind === 'invalid') return t('服务返回的内容无法识别（{status}）', { status: error.message });
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function capabilityText(kind: 'auto' | 'manual' | 'skill-only' | 'none'): string {
  if (kind === 'auto') return t('可自动安装');
  if (kind === 'manual') return t('需手动添加');
  if (kind === 'skill-only') return t('只装技能');
  return t('不支持');
}
