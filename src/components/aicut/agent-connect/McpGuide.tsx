// ai-cut：「外部 Agent 接入 (MCP)」弹窗——取代上游 McpGuide.tsx（接入点 IP-16：mcpGuideLoader.ts 改为加载本文件）。
// 打开即检测本机的 agent，把 AI Cut 的 MCP 服务（带令牌）和 ai-cut 技能装进去；能自动装的逐个 / 批量安装，
// 只能手动的展开配置片段。上游弹窗下半部分的两张说明卡与令牌说明原样保留（同一个中文 key）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { theme, themeAlpha } from '../../../theme';
import { useT } from '../../../i18n/locale';
import { Icon } from '../../icons';
import {
  AgentApiError, applyAgents, batchPlan, detectedOrder, installParts, listAgents, needsAttention, rowErrorsFrom,
  uninstallParts, type AgentStatus, type Part, type RowError,
} from './agentConnectApi';
import { requestFailure } from './agentConnectText';
import { cardStyle, codeBlockStyle, errorStyle, noteStyle, secondaryButtonStyle } from './agentConnectStyles';
import { AgentLogo } from './agentConnectLogos';
import { AgentRow } from './AgentRow';
import { EmptyDetected, OtherAgents, SummaryBar, type BatchProgress, type BatchResult } from './AgentSummary';

type Busy = { readonly id: string; readonly action: 'install' | 'uninstall' } | null;
type Outcome = { readonly ok: boolean; readonly agents?: readonly AgentStatus[] };

/** 顺时针刷新箭头（icons.tsx 里没有 refresh）；检测中转动。 */
function RefreshGlyph({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ display: 'block', animation: spinning ? 'cc-transcribe-spin 0.9s linear infinite' : undefined }}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8 M21 3v5h-5" />
    </svg>
  );
}

/** 检测到的 id 顺序只在检测时排一次；安装 / 卸载后行不跳位置，新检测到的追加在后面。 */
function keepOrder(previous: readonly string[], agents: readonly AgentStatus[]): string[] {
  const detected = new Set(agents.filter((agent) => agent.detected).map((agent) => agent.id));
  const kept = previous.filter((id) => detected.has(id));
  return [...kept, ...detectedOrder(agents).filter((id) => !kept.includes(id))];
}

export function McpGuideDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [endpoint, setEndpoint] = useState(() => `${window.location.origin}/api/external-mcp/mcp`);
  const [agents, setAgents] = useState<readonly AgentStatus[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, readonly RowError[]>>({});
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const alive = useRef(true);
  const detectSeq = useRef(0);

  const detect = useCallback(() => {
    const seq = ++detectSeq.current;
    setLoading(true);
    void listAgents().then(
      (data) => {
        if (!alive.current || seq !== detectSeq.current) return;
        setEndpoint(data.endpoint);
        setAgents(data.agents);
        setOrder(detectedOrder(data.agents));
        setLoadError(null);
        setRowErrors({});
        setBatchResult(null);
        setLoading(false);
      },
      (error: unknown) => {
        if (!alive.current || seq !== detectSeq.current) return;
        setLoadError(error);
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    detect();
    return () => { alive.current = false; };
  }, [detect]);

  /** 对一个 agent 执行安装 / 卸载；结果就地写进这一行，返回最新的全部状态给批量用。 */
  const runOne = useCallback(async (id: string, action: 'install' | 'uninstall', parts: Part[]): Promise<Outcome> => {
    setBusy({ id, action });
    setRowErrors((prev) => ({ ...prev, [id]: [] }));
    try {
      const data = await applyAgents({ action, ids: [id], parts });
      if (!alive.current) return { ok: false };
      const errors = rowErrorsFrom(data.results, id);
      setAgents(data.agents);
      setOrder((prev) => keepOrder(prev, data.agents));
      setRowErrors((prev) => ({ ...prev, [id]: errors }));
      return { ok: errors.length === 0, agents: data.agents };
    } catch (error) {
      if (alive.current) setRowErrors((prev) => ({ ...prev, [id]: [{ part: null, message: requestFailure(error) }] }));
      return { ok: false };
    } finally {
      if (alive.current) setBusy(null);
    }
  }, []);

  const runBatch = useCallback(async () => {
    if (!agents) return;
    const { ids } = batchPlan(agents);
    let latest = agents;
    let ok = 0;
    let fail = 0;
    setBatchResult(null);
    for (let index = 0; index < ids.length; index += 1) {
      setBatch({ done: index, total: ids.length });
      const current = latest.find((agent) => agent.id === ids[index]);
      const parts = current ? installParts(current) : [];
      // 前面的 agent 可能已经顺带装好（几个 agent 共用同一个配置文件），这里就不用再装。
      if (parts.length === 0) { ok += 1; continue; }
      const outcome = await runOne(ids[index], 'install', parts);
      if (!alive.current) return;
      if (outcome.agents) latest = outcome.agents;
      if (outcome.ok) ok += 1; else fail += 1;
    }
    setBatch(null);
    setBatchResult({ ok, fail });
  }, [agents, runOne]);

  const locked = loading || busy !== null || batch !== null;
  const byId = new Map((agents ?? []).map((agent) => [agent.id, agent]));
  const detected = order.map((id) => byId.get(id)).filter((agent): agent is AgentStatus => Boolean(agent));
  const undetected = (agents ?? []).filter((agent) => !agent.detected);
  const plan = batchPlan(detected);
  const untrusted = loadError instanceof AgentApiError && loadError.kind === 'http' && loadError.status === 403;

  return (
    <div className="cc-modal-backdrop" onPointerDown={onClose}>
      <div
        className="cc-modal"
        style={{ width: 680, gap: 12, maxHeight: 'calc(100vh - 64px)', overflowY: 'auto' }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            aria-hidden
            style={{
              width: 36, height: 36, borderRadius: 10, flex: '0 0 auto',
              background: `linear-gradient(135deg, ${theme.accent}, ${theme.accentDeep})`,
              boxShadow: themeAlpha.shadow(0.35),
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: theme.onAccent,
            }}
          >
            <Icon name="plug" size={18} />
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 14 }}>{t('外部 Agent 接入 (MCP)')}</strong>
            <span style={{ color: theme.textMuted, fontSize: 11.5 }}>
              {t('把 AI Cut 的 MCP 服务和使用技能装进本机的 AI 编码 agent')}
            </span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="cc-tip cc-tip-r"
              data-tip={t('重新检测本机的 agent')}
              aria-label={t('重新检测本机的 agent')}
              disabled={locked}
              onClick={detect}
              style={{
                width: 26, height: 26, padding: 0, display: 'grid', placeItems: 'center', borderRadius: 5,
                border: `0.5px solid ${theme.border}`, background: theme.hover, color: theme.textMuted,
                cursor: locked ? 'default' : 'pointer', opacity: locked && !loading ? 0.5 : 1,
              }}
            >
              <RefreshGlyph spinning={loading} />
            </button>
            <button type="button" onClick={onClose} style={{ padding: '3px 9px' }}>{t('关闭')}</button>
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('端点地址')}</span>
            <span style={{ color: theme.textMuted, fontSize: 11.5 }}>{t('所有 agent 共用一个端点')}</span>
          </div>
          <pre style={codeBlockStyle}>{endpoint}</pre>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loadError !== null && !loading ? (
            untrusted ? (
              <div style={{ ...errorStyle, fontSize: 12 }}>{t('无法读取 MCP 连接令牌，请从受信任的编辑器窗口重试。')}</div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...errorStyle, fontSize: 12, flex: '1 1 auto' }}>
                  {t('检测失败：{reason}', { reason: requestFailure(loadError) })}
                </span>
                <button type="button" onClick={detect} style={secondaryButtonStyle(false)}>{t('重试')}</button>
              </div>
            )
          ) : agents === null ? (
            <div style={{ ...noteStyle, fontSize: 12 }}>{t('正在检测本机的 agent…')}</div>
          ) : detected.length === 0 ? (
            <>
              <EmptyDetected total={undetected.length} locked={locked} onDetect={detect} />
              <OtherAgents agents={undetected} defaultOpen title={t('支持的 agent（{k} 个）', { k: undetected.length })} />
            </>
          ) : (
            <>
              <SummaryBar
                detected={detected.length}
                plan={{ agents: plan.ids.length, files: plan.files, skills: plan.skills }}
                attention={detected.filter(needsAttention).length}
                batch={batch}
                result={batchResult}
                locked={locked}
                onBatch={() => { void runBatch(); }}
              />
              {loading ? <div style={{ ...noteStyle, fontSize: 12 }}>{t('正在检测本机的 agent…')}</div> : null}
              {detected.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  logo={<AgentLogo id={agent.id} name={agent.name} />}
                  busy={busy?.id === agent.id ? busy.action : null}
                  locked={locked}
                  errors={rowErrors[agent.id] ?? []}
                  onInstall={() => {
                    setBatchResult(null);
                    void runOne(agent.id, 'install', installParts(agent));
                  }}
                  onUninstall={() => {
                    setBatchResult(null);
                    void runOne(agent.id, 'uninstall', uninstallParts(agent));
                  }}
                />
              ))}
              <OtherAgents
                agents={undetected}
                defaultOpen={false}
                title={t('其他支持的 agent（本机未检测到，{k} 个）', { k: undetected.length })}
              />
            </>
          )}
          <div style={{ color: theme.textDim, fontSize: 11 }}>{t('装好后重启对应的 agent 才会加载 AI Cut。')}</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={cardStyle}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('内置 Agent 与外部 MCP')}</span>
            <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
              {t('内置 Agent 会先生成可预览的修改提案，由你应用或拒绝；外部 MCP 使用独立编辑会话，manual 模式等待审核，auto 模式在 review 时直接应用。两者都只通过 EditorCore 命令修改工程。')}
            </div>
          </div>
          <div style={cardStyle}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('连接本地模型')}</span>
            <div style={{ color: theme.textMuted, fontSize: 12, lineHeight: 1.55 }}>
              {t('打开 设置 → Agent 模型 → Agent 大脑 → OpenAI，填写本地或兼容服务的 API URL 和模型；按服务选择 Responses API 或 Chat Completions API，再点“测试并读取模型”。仅在服务要求时填写 API Key。')}
            </div>
          </div>
        </div>

        <div style={{ display: 'block', color: theme.textDim, fontSize: 11.5, lineHeight: 1.55, borderTop: `0.5px solid ${theme.borderLight}`, paddingTop: 8 }}>
          {t('MCP 端点始终要求 Bearer 令牌。令牌在首次启动时生成并保存在本机，重启后保持不变，配置一次即可持续使用；OPENCHATCUT_MCP_TOKEN 环境变量可覆盖。令牌只在当前受信任编辑器会话中显示，不写入工程、聊天或浏览器存储。')}
        </div>
      </div>
    </div>
  );
}
