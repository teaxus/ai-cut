// ai-cut：「Agent 接入」弹窗列表上方的汇总条（含批量安装）、没检测到 agent 时的空态、未检测到的 agent 折叠区。
import { theme } from '../../../theme';
import { useT } from '../../../i18n/locale';
import { Icon } from '../../icons';
import { capability, type AgentStatus } from './agentConnectApi';
import { capabilityText } from './agentConnectText';
import { cardStyle, chipStyle, noteStyle, primaryButtonStyle, secondaryButtonStyle } from './agentConnectStyles';

export interface BatchProgress { readonly done: number; readonly total: number }
export interface BatchResult { readonly ok: number; readonly fail: number }

export interface SummaryBarProps {
  readonly detected: number;
  /** 需要安装或更新的 agent 数、会改的配置文件数、会复制的技能份数 */
  readonly plan: { readonly agents: number; readonly files: number; readonly skills: number };
  /** 需要用户自己处理的 agent 数（手动添加、配置读不懂、同名目录被占…） */
  readonly attention: number;
  readonly batch: BatchProgress | null;
  readonly result: BatchResult | null;
  readonly locked: boolean;
  readonly onBatch: () => void;
}

function BatchConsequence({ files, skills }: { files: number; skills: number }) {
  const t = useT();
  const text = files > 0 && skills > 0
    ? t('将修改 {files} 个配置文件、复制 {skills} 份技能；改动前原文件备份到 ~/.ai-cut/agent-backups/', { files, skills })
    : files > 0
      ? t('将修改 {files} 个配置文件；改动前原文件备份到 ~/.ai-cut/agent-backups/', { files })
      : t('将复制 {skills} 份技能', { skills });
  return <span style={noteStyle}>{text}</span>;
}

export function SummaryBar({ detected, plan, attention, batch, result, locked, onBatch }: SummaryBarProps) {
  const t = useT();
  const headline = plan.agents > 0
    ? t('检测到 {n} 个 agent，其中 {m} 个需要安装或更新', { n: detected, m: plan.agents })
    : attention > 0
      ? t('检测到 {n} 个 agent，能自动安装的都已装好；{k} 个需要你处理（见下方说明）', { n: detected, k: attention })
      : t('检测到 {n} 个 agent，都已装好', { n: detected });
  const showButton = batch !== null || plan.agents > 0;
  const disabled = locked || batch !== null;
  return (
    <div style={{ ...cardStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{headline}</span>
        {batch === null && plan.agents > 0 ? <BatchConsequence files={plan.files} skills={plan.skills} /> : null}
        {batch === null && result ? (
          <span style={{ fontSize: 11.5, color: result.fail > 0 ? theme.danger : theme.success }}>
            {result.fail > 0
              ? t('完成 {ok} 个，失败 {fail} 个（见红字行）', { ok: result.ok, fail: result.fail })
              : t('完成 {ok} 个', { ok: result.ok })}
          </span>
        ) : null}
      </div>
      {showButton ? (
        <button type="button" disabled={disabled} onClick={onBatch} style={primaryButtonStyle(disabled)}>
          <Icon name="plug" size={11} />
          {batch
            ? t('安装中 {i}/{m}', { i: Math.min(batch.done + 1, batch.total), m: batch.total })
            : t('全部安装 / 更新（{m}）', { m: plan.agents })}
        </button>
      ) : null}
    </div>
  );
}

/** 一个 agent 都没检测到：说明 + 「重新检测」+ 直接展开支持的 agent 清单。 */
export function EmptyDetected({ total, locked, onDetect }: { total: number; locked: boolean; onDetect: () => void }) {
  const t = useT();
  return (
    <div style={{ ...cardStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 auto' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{t('本机没有检测到支持的 agent')}</span>
        <span style={noteStyle}>
          {t('AI Cut 支持下面 {k} 个 agent；装好其中任意一个后点「重新检测」。', { k: total })}
        </span>
      </div>
      <button type="button" disabled={locked} onClick={onDetect} style={secondaryButtonStyle(locked)}>
        {t('重新检测本机的 agent')}
      </button>
    </div>
  );
}

/** 未检测到的 agent：名称 + 能装成什么样。空态时默认展开，平时默认收起。 */
export function OtherAgents({ agents, title, defaultOpen }: { agents: readonly AgentStatus[]; title: string; defaultOpen: boolean }) {
  if (agents.length === 0) return null;
  return (
    <details open={defaultOpen} style={{ ...cardStyle, display: 'block' }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: theme.text }}>{title}</summary>
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
          columnGap: 14, rowGap: 4, marginTop: 8,
        }}
      >
        {agents.map((agent) => {
          const kind = capability(agent);
          return (
            <div key={agent.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11.5, color: theme.text, overflowWrap: 'anywhere' }}>{agent.name}</span>
              <span style={chipStyle(kind === 'auto' ? 'ok' : kind === 'none' ? 'off' : 'todo')}>{capabilityText(kind)}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
