// ai-cut：agent 行首的 logo。有官方图标的按 agent id 映射（写法同上游 McpGuide 的 ClientLogo / 内联 SVG），
// 其余用首字母方块（上游 ClientMonogram）。注册表里有哪些 id 不固定，这里只认识几个，认不出的一律走首字母。
import { theme } from '../../../theme';
import claudeSvg from '../../../../assets/vendor-icons/claude-color.svg?raw';
import geminiSvg from '../../../../assets/vendor-icons/gemini-color.svg?raw';
import qwenSvg from '../../../../assets/vendor-icons/qwen-color.svg?raw';
import copilotSvg from '../../../../assets/vendor-icons/copilot.svg?raw';
import codexPng from '../../../../assets/vendor-icons/codex-color.png';
import cursorPng from '../../../../assets/vendor-icons/cursor-color.png';
import antigravityPng from '../../../../assets/vendor-icons/antigravity-color.png';

const SIZE = 26;

type Logo = { svg: string; tint?: string } | { png: string };

const LOGOS: Record<string, Logo> = {
  'claude-code': { svg: claudeSvg, tint: '#d97757' },
  codex: { png: codexPng },
  cursor: { png: cursorPng },
  antigravity: { png: antigravityPng },
  'antigravity-cli': { png: antigravityPng },
  'gemini-cli': { svg: geminiSvg },
  'qwen-code': { svg: qwenSvg },
  'github-copilot': { svg: copilotSvg, tint: theme.text },
  'github-copilot-cli': { svg: copilotSvg, tint: theme.text },
};

function Monogram({ name }: { name: string }) {
  const trimmed = name.trim();
  const letter = (trimmed.match(/[A-Za-z0-9]/)?.[0] ?? (trimmed.charAt(0) || '?')).toUpperCase();
  return (
    <span
      aria-hidden
      style={{
        width: SIZE, height: SIZE, borderRadius: 6, flex: '0 0 auto',
        background: theme.inset, border: `0.5px solid ${theme.borderLight}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: theme.textMuted, fontSize: 13, fontWeight: 700,
      }}
    >
      {letter}
    </span>
  );
}

export function AgentLogo({ id, name }: { id: string; name: string }) {
  const logo = LOGOS[id];
  if (!logo) return <Monogram name={name} />;
  if ('png' in logo) {
    return (
      <img
        src={logo.png}
        alt=""
        aria-hidden
        style={{ width: SIZE, height: SIZE, borderRadius: 6, objectFit: 'contain', flex: '0 0 auto', background: theme.panel, border: `0.5px solid ${theme.borderLight}` }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="cc-vendor-icon"
      style={{ color: logo.tint, width: SIZE, height: SIZE, fontSize: SIZE, flex: '0 0 auto', display: 'inline-flex' }}
      dangerouslySetInnerHTML={{ __html: logo.svg }}
    />
  );
}
