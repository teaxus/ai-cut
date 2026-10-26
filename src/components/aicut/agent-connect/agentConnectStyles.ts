// ai-cut：「Agent 接入」弹窗的样式对象，沿用上游 McpGuide 的 cardStyle / endpointStyle / 按钮写法，只用 theme token。
import type { CSSProperties } from 'react';
import { theme, themeAlpha } from '../../../theme';

export const MONO_FONT = 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace';

export const cardStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8,
  background: theme.panelAlt, border: `0.5px solid ${theme.borderLight}`,
  borderRadius: 8, padding: '10px 12px',
};

/** 端点地址 / 配置片段：等宽、可选中、长内容换行而不是截断或横向滚动。 */
export const codeBlockStyle: CSSProperties = {
  margin: 0, padding: '6px 9px', border: `0.5px solid ${theme.borderLight}`, borderRadius: 4,
  background: theme.inset, color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5,
  fontFamily: MONO_FONT, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text',
};

/** 行内路径：等宽、可选中、在任意位置换行。 */
export const pathStyle: CSSProperties = {
  fontFamily: MONO_FONT, fontSize: 11, color: theme.text, overflowWrap: 'anywhere', userSelect: 'text',
};

export const noteStyle: CSSProperties = { color: theme.textMuted, fontSize: 11.5, lineHeight: 1.5 };

export const errorStyle: CSSProperties = { color: theme.danger, fontSize: 11.5, lineHeight: 1.5, overflowWrap: 'anywhere' };

const buttonBase: CSSProperties = {
  flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
};

/** 主按钮（与上游「连接」同款渐变）；busy 时半透明、不可点。 */
export function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonBase,
    border: '0.5px solid transparent',
    background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentDeep})`,
    boxShadow: themeAlpha.shadow(0.25), color: theme.onAccent,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}

export function secondaryButtonStyle(disabled: boolean, tone: 'normal' | 'danger' = 'normal'): CSSProperties {
  return {
    ...buttonBase,
    fontWeight: 500,
    border: `0.5px solid ${tone === 'danger' ? theme.danger : theme.border}`,
    background: theme.hover, color: tone === 'danger' ? theme.danger : theme.text,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}

/** 「确认卸载」：实心红色。 */
export function dangerButtonStyle(disabled: boolean): CSSProperties {
  return {
    ...buttonBase,
    border: `0.5px solid ${theme.danger}`, background: theme.danger, color: theme.onAccent,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
  };
}

export type ChipTone = 'ok' | 'warn' | 'todo' | 'off' | 'bad';

const CHIP_COLOR: Record<ChipTone, string> = {
  ok: theme.success, warn: theme.gold, todo: theme.text, off: theme.textDim, bad: theme.danger,
};

/** 状态标签：「MCP：已安装」这类，整块不换行。 */
export function chipStyle(tone: ChipTone): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap',
    padding: '1px 7px', borderRadius: 4, fontSize: 11, lineHeight: 1.6, fontWeight: 600,
    color: CHIP_COLOR[tone], background: theme.inset, border: `0.5px solid ${theme.borderLight}`,
  };
}
