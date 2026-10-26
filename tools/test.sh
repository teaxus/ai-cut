#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
cd "${AICUT_ROOT}"

show_help() {
  cat <<'HELP'
用法 / Usage:
  ./tools/test.sh [--all | --aicut | --upstream | --affected] [测试文件 ...] [-h]

做什么 / What it does:
  跑 ai-cut 的测试。派生版的测试在 aicut-tests/（*.test.ts，node:test + tsx）；
  上游的门禁是 `npm run lint` + `npm test`（约 200 个 *.verify.* 脚本，含 500 行上限、i18n、工具目录等检查）。
  Runs ai-cut's tests: the fork's own aicut-tests/*.test.ts and upstream's lint + verify gate.

选项 / Options（选一个，默认 --all / pick one, default --all）:
  --all        上游 lint + 上游全量 npm test + 接入点标记检查 + 派生测试 / everything
  --aicut      只跑接入点标记检查 + 技能生成检查 + 派生测试（快）/ fork checks only (fast)
  --upstream   只跑上游 lint + npm test / upstream gate only
  --affected   上游按改动挑选的 verify（npm run verify:affected）+ 派生测试 / affected upstream verifies + fork tests
  测试文件     只跑指定的派生测试文件，如 aicut-tests/foo.test.ts / run only these fork test files
  -h, --help   显示本帮助 / show this help

示例 / Example:
  ./tools/test.sh --aicut
  ./tools/test.sh --all
HELP
}

MODE="all"
FILES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) show_help; exit 0 ;;
    --all) MODE="all"; shift ;;
    --aicut) MODE="aicut"; shift ;;
    --upstream) MODE="upstream"; shift ;;
    --affected) MODE="affected"; shift ;;
    -*) die "未知参数 / unknown option: $1（见 -h）" ;;
    *) FILES+=("$1"); MODE="aicut"; shift ;;
  esac
done

need_node24
need_deps

run_aicut() {
  say "接入点标记检查 / integration-point markers"
  node tools/lib/integration-points.mjs
  say "skills/ai-cut 与上游技能一致 / generated skill in sync"
  node tools/lib/sync-skill.mjs --check
  say "派生测试 / fork tests (aicut-tests)"
  if [[ ${#FILES[@]} -gt 0 ]]; then
    node --import tsx --test "${FILES[@]}"
  else
    node --import tsx --test 'aicut-tests/**/*.test.ts'
  fi
}
run_upstream() {
  say "上游 lint / upstream lint"
  npm run --silent lint
  say "上游门禁 / upstream gate: npm test（pretest + test + posttest）"
  npm test
}

case "${MODE}" in
  aicut) run_aicut ;;
  upstream) run_upstream ;;
  affected) say "上游受影响的 verify / affected upstream verifies"; npm run --silent verify:affected; run_aicut ;;
  all) run_upstream; run_aicut ;;
esac
say "测试通过 / tests passed（${MODE}）"
