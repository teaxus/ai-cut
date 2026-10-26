#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/aicut-agents.sh list      [--all] [--json]
  ./tools/aicut-agents.sh install   [--agent id1,id2] [--part mcp,skill] [--dry-run]
  ./tools/aicut-agents.sh uninstall [--agent id1,id2] [--part mcp,skill] [--dry-run]
  ./tools/aicut-agents.sh -h

做什么 / What it does:
  不开界面完成「Agent 接入」：把 AI Cut 的 MCP 服务（服务名 ai-cut，带令牌）和技能 skills/ai-cut
  装进本机已安装的 AI 编码 agent（Claude Code、Codex、Cursor、Gemini CLI……），或者卸掉。
  与 App 里「外部 Agent 接入 (MCP)」弹窗用的是同一份代码和注册表（shared/aicut/agents.json）。
  Installs / removes AI Cut's MCP server and skill in the coding agents found on this machine.

  端点和令牌来自 AI Cut 的数据目录（~/.ai-cut/mcp-port、mcp-token）：AI Cut 至少要启动过一次。
  改配置文件前先把原文件备份到 ~/.ai-cut/agent-backups/<时间>/，只改名为 ai-cut 的那一项。

命令 / Commands:
  list         列出检测到的 agent 及 MCP / 技能的安装状态（默认命令）/ show status
  install      安装或更新（不指定 --agent 时 = 所有检测到且需要安装 / 更新的）/ install or update
  uninstall    卸载 AI Cut 装过的东西（不指定 --agent 时 = 所有装过的）/ remove what AI Cut installed

选项 / Options:
  --agent IDS    只处理这些 agent（逗号分隔，id 见 list --all）/ only these agents
  --part P       只处理 mcp 或 skill（默认两样都做）/ only mcp or skill (default both)
  --all          list 时也列出没检测到的 agent / include agents not found on this machine
  --json         输出 JSON / JSON output
  --home DIR     把 DIR 当作用户主目录（测试用，默认 $HOME）/ treat DIR as home (testing)
  --port N       MCP 端口（默认读 ~/.ai-cut/mcp-port，没有则 5299）/ MCP port override
  -n, --dry-run  install / uninstall 只列出将处理的 agent，不写入 / print plan only
  -h, --help     显示本帮助 / show this help

示例 / Examples:
  ./tools/aicut-agents.sh list
  ./tools/aicut-agents.sh install --dry-run
  ./tools/aicut-agents.sh install --agent claude-code,codex
  ./tools/aicut-agents.sh uninstall --agent cursor --part skill
HELP
}

case "${1:-}" in -h|--help) show_help; exit 0 ;; esac
need_node24
need_deps
exec node --import tsx tools/lib/aicut-agents.mts "$@"
