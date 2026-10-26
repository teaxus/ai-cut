#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/upstream-sync.sh check
  ./tools/upstream-sync.sh start <上游tag>          例 / e.g. start v0.2.18
  ./tools/upstream-sync.sh gate [--install] [--package]
  ./tools/upstream-sync.sh report [<from> <to>]
  ./tools/upstream-sync.sh finish
  ./tools/upstream-sync.sh -h

做什么 / What it does:
  把上游 OpenChatCut 的新版本合进 AI Cut。完整流程（给人和 AI 的操作说明）见
  .claude/skills/aicut-upstream-sync/SKILL.md。Merges a new upstream OpenChatCut release into AI Cut.

  check   拉取上游 tag，列出比当前基线（aicut.json 的 upstreamTag）新的版本、各自改了哪些接入点文件
          fetch tags; list newer releases and which integration-point files they touch
  start   从当前分支切出 sync/<tag>，git merge 上游 tag（rerere 已开）。
          无冲突：更新 aicut.json（基线 tag、修订号归 1）、重新生成 skills/ai-cut、提交。
          有冲突：列出冲突文件及其在 docs/integration-points.md 里的合并策略，退出码 3，等人或 AI 解决后
          `git add` + `git commit`，再跑 `start <tag>` 的收尾：./tools/upstream-sync.sh start <tag> --continue
  gate    同步后的门禁：接入点标记、skills/ai-cut 与上游一致、类型检查、上游 lint + 全量 verify、派生测试；
          --install 先 npm ci（上游改了依赖时要加），--package 再本机打一个 mac 目录包
  report  生成 docs/upgrades/<to>.md：上游 CHANGELOG、MCP 工具变化、技能、设置项、依赖、被改动的接入点
          默认 from = main 分支上 aicut.json 的基线，to = 当前工作区的基线
  finish  门禁通过后把 sync/<tag> 快进合并回 main，打本地 tag v<版本>-aicut.1（不推送 / never pushes）

选项 / Options:
  --continue   （start）冲突解决并提交后，完成收尾步骤 / finish the post-merge steps after resolving
  --install    （gate）先 npm ci / run npm ci first
  --package    （gate）再打一个 mac --dir 包验证 / also build an unpacked mac app
  -h, --help   显示本帮助 / show this help

示例 / Examples:
  ./tools/upstream-sync.sh check
  ./tools/upstream-sync.sh start v0.2.18 && ./tools/upstream-sync.sh gate --install && ./tools/upstream-sync.sh report && ./tools/upstream-sync.sh finish
HELP
}

base_tag() { node -p "require('./aicut.json').upstreamTag"; }
newer_tags() {
  local base="$1"
  git tag --list 'v[0-9]*' --sort=v:refname | awk -v b="${base}" 'f{print} $0==b{f=1}' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true
}
ip_files() { node -e "import('./tools/lib/integration-points.mjs').then(m=>{for(const r of m.readRegistry()) if(r.status!=='removed') for(const f of r.files) console.log(r.id+' '+r.strategy+' '+f)})"; }

cmd_check() {
  need_cmd git "需要 git"
  say "拉取上游 tag / fetching upstream tags"
  git fetch upstream --tags --quiet
  local base; base="$(base_tag)"
  say "当前基线 / current base: ${base}"
  local tags; tags="$(newer_tags "${base}")"
  if [[ -z "${tags}" ]]; then say "已是最新 / up to date"; return 0; fi
  while read -r tag; do
    [[ -z "${tag}" ]] && continue
    echo "  ${tag}  $(git log -1 --format='%cs  %s' "${tag}")  （$(git rev-list --count "${base}..${tag}") 个提交）"
  done <<< "${tags}"
  local latest; latest="$(tail -1 <<< "${tags}")"
  say "${base} → ${latest} 动到的接入点文件 / touched integration points:"
  local any=0
  while read -r id strategy file; do
    if [[ -n "$(git log --format=%h "${base}..${latest}" -- "${file}")" ]]; then echo "  ${id} (${strategy}) ${file}"; any=1; fi
  done < <(ip_files)
  [[ ${any} -eq 0 ]] && echo "  （无 / none）"
  say "下一步 / next: ./tools/upstream-sync.sh start ${latest}"
}

post_merge() {
  local tag="$1"
  say "更新 aicut.json 基线 / bump base to ${tag}（修订号归 1）"
  node -e "const fs=require('fs');const p='aicut.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.upstreamTag=process.argv[1];j.revision=1;fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" "${tag}"
  say "重新生成 skills/ai-cut / regenerating the AI Cut skill"
  node tools/lib/sync-skill.mjs
  git add aicut.json skills/ai-cut
  if ! git diff --cached --quiet; then
    git commit -q -m "chore(sync): 基线升到上游 ${tag}，重新生成 skills/ai-cut"
  fi
  say "合并完成 / merged. 下一步 / next: ./tools/upstream-sync.sh gate --install"
}

cmd_start() {
  local tag="${1:-}"; shift || true
  local cont=0; [[ "${1:-}" == "--continue" ]] && cont=1
  [[ -n "${tag}" ]] || die "start 需要上游 tag，例如 start v0.2.18 / needs a tag"
  git rev-parse -q --verify "refs/tags/${tag}" >/dev/null || die "本地没有 tag ${tag}：先 ./tools/upstream-sync.sh check"
  if [[ ${cont} -eq 1 ]]; then
    [[ -z "$(git diff --name-only --diff-filter=U)" ]] || die "还有未解决的冲突 / unresolved conflicts remain"
    git rev-parse -q --verify MERGE_HEAD >/dev/null && die "合并还没提交：git add 后 git commit / commit the merge first"
    post_merge "${tag}"; return 0
  fi
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "工作区有未提交的改动，先提交 / commit your changes first"
  local branch="sync/${tag}"
  git rev-parse -q --verify "refs/heads/${branch}" >/dev/null && die "分支 ${branch} 已存在 / branch exists"
  git switch -q -c "${branch}"
  say "在 ${branch} 上合并 / merging ${tag}"
  if git merge --no-ff -m "chore(sync): 合并上游 ${tag}" "${tag}"; then
    post_merge "${tag}"; return 0
  fi
  local conflicts; conflicts="$(git diff --name-only --diff-filter=U)"
  warn "有冲突，需要解决 / conflicts to resolve:"
  local map; map="$(ip_files)"
  while read -r file; do
    [[ -z "${file}" ]] && continue
    local hit; hit="$(awk -v f="${file}" '$3==f{print $1" 策略 "$2}' <<< "${map}")"
    echo "  ${file}  ${hit:-（不是接入点：一般直接取上游版本 / not an integration point: usually take upstream）}"
  done <<< "${conflicts}"
  echo "解决办法见 .claude/skills/aicut-upstream-sync/SKILL.md；解决后 git add <文件> && git commit --no-edit，再跑："
  echo "  ./tools/upstream-sync.sh start ${tag} --continue"
  exit 3
}

cmd_gate() {
  local install=0 package=0
  while [[ $# -gt 0 ]]; do
    case "$1" in --install) install=1; shift ;; --package) package=1; shift ;; *) die "未知参数 / unknown option: $1" ;; esac
  done
  need_node24
  [[ ${install} -eq 1 ]] && { say "npm ci"; npm ci --no-audit --no-fund; }
  need_deps
  say "skills/ai-cut 与上游一致 / skill in sync"; node tools/lib/sync-skill.mjs --check
  say "工具目录 / tool catalog"; npm run --silent verify:server-tool-catalog
  say "类型检查 / type check"; npx tsc -b
  ./tools/test.sh --all
  if [[ ${package} -eq 1 ]]; then ./tools/build.sh --mac --dir; fi
  git rev-parse HEAD > "$(git rev-parse --git-dir)/aicut-gate-ok"
  say "门禁通过 / gate passed（$(git rev-parse --short HEAD)）"
}

cmd_report() {
  local from="${1:-}" to="${2:-}"
  [[ -z "${from}" ]] && from="$(git show main:aicut.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).upstreamTag")"
  [[ -z "${to}" ]] && to="$(base_tag)"
  [[ "${from}" == "${to}" ]] && die "from 与 to 相同（${to}）：在 sync 分支上跑，或显式给出 report <from> <to>"
  node tools/lib/upstream-report.mjs "${from}" "${to}"
}

cmd_finish() {
  local branch; branch="$(git branch --show-current)"
  [[ "${branch}" == sync/* ]] || die "要在 sync/<tag> 分支上跑 / run on a sync/<tag> branch（当前 ${branch}）"
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "有未提交的改动 / uncommitted changes"
  local ok_file; ok_file="$(git rev-parse --git-dir)/aicut-gate-ok"
  [[ -f "${ok_file}" && "$(cat "${ok_file}")" == "$(git rev-parse HEAD)" ]] || die "当前提交没过门禁：先 ./tools/upstream-sync.sh gate / gate not passed for HEAD"
  local version; version="$(node -p "require('./package.json').version")-aicut.$(node -p "require('./aicut.json').revision")"
  git switch -q main
  git merge --ff-only "${branch}"
  git tag "v${version}"
  say "main 已更新到 $(git rev-parse --short HEAD)，本地 tag v${version}（未推送 / not pushed）"
}

case "${1:-}" in
  ""|-h|--help) show_help ;;
  check) shift; cmd_check "$@" ;;
  start) shift; cmd_start "$@" ;;
  gate) shift; cmd_gate "$@" ;;
  report) shift; cmd_report "$@" ;;
  finish) shift; cmd_finish "$@" ;;
  *) die "未知命令 / unknown command: $1（见 -h）" ;;
esac
