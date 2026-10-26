// ai-cut：「Agent 接入」弹窗里的一行 = 本机检测到的一个 agent。
// 行首常显 agent 名 + logo；两个状态标签旁写清会写到哪；主按钮安装 / 更新，次按钮卸载（行内二次确认）；
// 只能手动添加的 agent 直接展开配置片段 + 复制；所有结果与失败原因都显示在本行，不弹 toast。
import { Fragment, useState, type ReactNode } from 'react';
import { theme } from '../../../theme';
import { useT } from '../../../i18n/locale';
import { Icon } from '../../icons';
import { installParts, installVerb, uninstallParts, type AgentStatus, type RowError } from './agentConnectApi';
import { mcpChip, serverText, skillChip, type Chip } from './agentConnectText';
import {
  cardStyle, chipStyle, codeBlockStyle, dangerButtonStyle, errorStyle, noteStyle, pathStyle,
  primaryButtonStyle, secondaryButtonStyle,
} from './agentConnectStyles';

export interface AgentRowProps {
  readonly agent: AgentStatus;
  readonly logo: ReactNode;
  /** 本行正在进行的操作 */
  readonly busy: 'install' | 'uninstall' | null;
  /** 别的行 / 批量 / 重新检测正在进行，本行按钮暂不可点 */
  readonly locked: boolean;
  readonly errors: readonly RowError[];
  readonly onInstall: () => void;
  readonly onUninstall: () => void;
}

/** 把 `{mcp}` 这类占位符换成等宽、可选中的路径；其余文字照常显示。 */
function withPaths(template: string, values: Readonly<Record<string, string>>): ReactNode {
  return template.split(/(\{\w+\})/).map((piece, index) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    if (key && key in values) return <span key={index} style={pathStyle}>{values[key]}</span>;
    return <Fragment key={index}>{piece}</Fragment>;
  });
}

function StatusChip({ chip }: { chip: Chip }) {
  return <span style={chipStyle(chip.tone)}>{chip.text}</span>;
}

function McpDetail({ mcp }: { mcp: AgentStatus['mcp'] }) {
  const t = useT();
  const path = mcp.path ?? '';
  if (mcp.mode === 'unsupported') {
    return <span style={noteStyle}>{mcp.detail ? serverText(mcp.detail) : t('AI Cut 还不能给这个 agent 配置 MCP')}</span>;
  }
  if (mcp.mode === 'manual') {
    return <span style={noteStyle}>{mcp.detail ? serverText(mcp.detail) : t('这个 agent 需要手动添加配置')}</span>;
  }
  if (mcp.state === 'unreadable') {
    return (
      <span style={{ ...noteStyle, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ color: theme.danger }}>{mcp.detail ? serverText(mcp.detail) : t('配置文件读不懂')}</span>
        <span>{withPaths(t('文件：{path}'), { path })}</span>
        <span>{t('修好这个文件后点右上角的「重新检测」')}</span>
      </span>
    );
  }
  if (mcp.state === 'installed') return <span style={noteStyle}>{withPaths(t('已写入 {path} 的 ai-cut 项'), { path })}</span>;
  return (
    <span style={{ ...noteStyle, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span>{withPaths(t('写入 {path} 的 ai-cut 项'), { path })}</span>
      {mcp.state === 'outdated' ? <span>{mcp.detail ? serverText(mcp.detail) : t('地址或令牌与当前 AI Cut 不一致')}</span> : null}
    </span>
  );
}

function SkillDetail({ skill }: { skill: AgentStatus['skill'] }) {
  const t = useT();
  const path = skill.path ?? '';
  if (skill.state === 'unsupported') return <span style={noteStyle}>{t('这个 agent 不支持 Agent Skills')}</span>;
  if (skill.state === 'no-source') return <span style={{ ...noteStyle, color: theme.danger }}>{t('找不到 AI Cut 自带的技能文件（skills/ai-cut）')}</span>;
  if (skill.state === 'foreign') {
    return <span style={noteStyle}>{withPaths(t('{path} 已存在且不是 AI Cut 装的，不会覆盖；要安装请先自行移走或改名这个目录'), { path })}</span>;
  }
  if (skill.state === 'installed') return <span style={noteStyle}>{withPaths(t('已复制到 {path}'), { path })}</span>;
  return (
    <span style={{ ...noteStyle, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span>{withPaths(t('复制到 {path}'), { path })}</span>
      {skill.state === 'outdated' ? <span>{t('技能文件与当前 AI Cut 自带的版本不一致')}</span> : null}
    </span>
  );
}

function CopyConfigButton({ snippet }: { snippet: string }) {
  const t = useT();
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {state === 'error' ? <span style={errorStyle}>{t('复制失败，请手动选择配置文本。')}</span> : null}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(snippet).then(
            () => {
              setState('done');
              setTimeout(() => setState('idle'), 2500);
            },
            () => setState('error'),
          );
        }}
        style={primaryButtonStyle(false)}
      >
        <Icon name={state === 'done' ? 'check' : 'copy'} size={11} />
        {state === 'done' ? t('已复制') : t('复制配置')}
      </button>
    </span>
  );
}

/** 只能手动添加的 agent：说明贴到哪、官方配置说明链接、展开的配置片段与复制按钮。 */
function ManualSnippet({ mcp }: { mcp: AgentStatus['mcp'] }) {
  const t = useT();
  if (mcp.mode !== 'manual' || !mcp.snippet) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...noteStyle, flex: '1 1 260px' }}>
          {mcp.path
            ? withPaths(t('复制下面的配置，手动添加到 {path}'), { path: mcp.path })
            : t('复制下面的配置，粘贴到这个 agent 的 MCP 设置里')}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {mcp.source ? (
            <a
              href={mcp.source}
              target="_blank"
              rel="noopener noreferrer"
              className="cc-tip cc-tip-r"
              data-tip={mcp.source}
              style={{ color: theme.accent, fontSize: 11.5, whiteSpace: 'nowrap' }}
            >
              {t('配置说明')} ↗
            </a>
          ) : null}
          <CopyConfigButton snippet={mcp.snippet} />
        </span>
      </div>
      <pre style={codeBlockStyle}>{mcp.snippet}</pre>
    </div>
  );
}

function ErrorLines({ errors }: { errors: readonly RowError[] }) {
  const t = useT();
  if (errors.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {errors.map((error, index) => {
        const reason = error.message ? serverText(error.message) : t('原因未知');
        const text = error.part === 'mcp' ? t('MCP 失败：{reason}', { reason })
          : error.part === 'skill' ? t('技能失败：{reason}', { reason })
            : t('操作失败：{reason}', { reason });
        return (
          <div key={index} style={errorStyle}>
            {text}
            {error.path ? <> · <span style={{ ...pathStyle, color: theme.danger }}>{error.path}</span></> : null}
          </div>
        );
      })}
    </div>
  );
}

/** 行内卸载确认：只列这一行实际由 AI Cut 装过的部分。 */
export function UninstallConfirm({ agent, locked, onConfirm, onCancel }: { agent: AgentStatus; locked: boolean; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const parts = uninstallParts(agent);
  const mcp = agent.mcp.path ?? '';
  const skill = agent.skill.path ?? '';
  const text = parts.includes('mcp') && parts.includes('skill')
    ? withPaths(t('将从 {mcp} 删除 ai-cut 项，并删除 {skill}。改动前配置文件会备份到 ~/.ai-cut/agent-backups/，重新安装即可恢复。'), { mcp, skill })
    : parts.includes('mcp')
      ? withPaths(t('将从 {mcp} 删除 ai-cut 项。改动前配置文件会备份到 ~/.ai-cut/agent-backups/，重新安装即可恢复。'), { mcp })
      : withPaths(t('将删除 {skill}。重新安装即可恢复。'), { skill });
  return (
    <div
      role="group"
      aria-label={t('确认卸载')}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: 6,
        border: `0.5px solid ${theme.danger}`, background: theme.inset,
      }}
    >
      <span style={{ fontSize: 12, lineHeight: 1.55, color: theme.text }}>{text}</span>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle(false)}>{t('取消')}</button>
        <button type="button" disabled={locked} onClick={onConfirm} style={dangerButtonStyle(locked)}>
          <Icon name="trash" size={11} />
          {t('确认卸载')}
        </button>
      </div>
    </div>
  );
}

function RowActions({ agent, busy, locked, confirming, onInstall, onAskUninstall }: {
  agent: AgentStatus; busy: AgentRowProps['busy']; locked: boolean; confirming: boolean;
  onInstall: () => void; onAskUninstall: () => void;
}) {
  const t = useT();
  const canInstall = installParts(agent).length > 0;
  const canRemove = uninstallParts(agent).length > 0;
  // 「已安装 ✓」只在两部分都装好（或这个 agent 本来就没有那一部分）时显示；有一部分要手动 / 读不懂 / 被占时不显示，免得误导。
  const allDone = [agent.mcp.state, agent.skill.state].every((state) => state === 'installed' || state === 'unsupported');
  const disabled = locked || busy !== null;
  const installLabel = installVerb(agent) === 'install' ? t('安装') : t('更新');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
      {canRemove || busy === 'uninstall' ? (
        <button
          type="button"
          disabled={disabled || confirming}
          onClick={onAskUninstall}
          style={secondaryButtonStyle(disabled || confirming)}
        >
          {busy === 'uninstall' ? t('卸载中…') : t('卸载')}
        </button>
      ) : null}
      {canInstall || busy === 'install' ? (
        <button type="button" disabled={disabled} onClick={onInstall} style={primaryButtonStyle(disabled)}>
          <Icon name="plug" size={11} />
          {busy === 'install' ? t('安装中…') : installLabel}
        </button>
      ) : canRemove && allDone ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: theme.success, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {t('已安装')}
          <Icon name="check" size={12} />
        </span>
      ) : null}
    </div>
  );
}

export function AgentRow({ agent, logo, busy, locked, errors, onInstall, onUninstall }: AgentRowProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const showConfirm = confirming && uninstallParts(agent).length > 0 && busy === null;
  const hasExtra = (agent.mcp.mode === 'manual' && Boolean(agent.mcp.snippet)) || errors.length > 0 || showConfirm;
  return (
    <div style={cardStyle} data-agent-id={agent.id}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {logo}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: '1 1 auto' }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{agent.name}</span>
          {agent.detectedBy ? <span style={noteStyle}>{withPaths(t('检测到：{path}'), { path: agent.detectedBy })}</span> : null}
        </div>
        <RowActions
          agent={agent}
          busy={busy}
          locked={locked}
          confirming={showConfirm}
          onInstall={onInstall}
          onAskUninstall={() => setConfirming(true)}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 8, rowGap: 5, alignItems: 'start', paddingLeft: 36 }}>
        <StatusChip chip={mcpChip(agent.mcp)} />
        <McpDetail mcp={agent.mcp} />
        <StatusChip chip={skillChip(agent.skill)} />
        <SkillDetail skill={agent.skill} />
      </div>
      {hasExtra ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 36 }}>
        <ManualSnippet mcp={agent.mcp} />
        <ErrorLines errors={errors} />
        {showConfirm ? (
          <UninstallConfirm
            agent={agent}
            locked={locked}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              onUninstall();
            }}
          />
        ) : null}
      </div> : null}
    </div>
  );
}
