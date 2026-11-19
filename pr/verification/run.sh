#!/usr/bin/env bash
# Rerun the hidden Fleet E2E spec against a worktree, then remove it so git stays clean.
# Usage: /tmp/fleet-e2e/run.sh [worktree] [--build]
set -uo pipefail
WORKTREE="${1:-<orca-checkout>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SPEC_DIR="$WORKTREE/tests/e2e/zz-fleet-verify"
LOG="$HERE/rerun.log"

cd "$WORKTREE" || exit 2
if [[ "${2:-}" == "--build" ]]; then
  VITE_EXPOSE_STORE=true npx electron-vite build --mode e2e && pnpm run build:cli || exit 3
fi

mkdir -p "$SPEC_DIR"
cp "$HERE/spec/fleet-verify.spec.ts" "$SPEC_DIR/"

# A caller running inside an Orca agent session leaks its identity; the CLI then fences --from.
unset_args=()
while IFS='=' read -r name _; do
  case "$name" in
    ORCA_*|CLAUDE_CODE_SESSION*|CODEX_THREAD_ID) unset_args+=(-u "$name") ;;
  esac
done < <(env)

env "${unset_args[@]}" ORCA_BACKGROUND_LAUNCH=1 SKIP_BUILD=1 \
  npx playwright test tests/e2e/zz-fleet-verify/fleet-verify.spec.ts \
  --config tests/playwright.config.ts --project=electron-headless \
  --workers=1 --reporter=line >"$LOG" 2>&1
status=$?

rm -rf "$SPEC_DIR"
git update-index --refresh >/dev/null 2>&1
echo "playwright exit: $status (log: $LOG)"
echo "git status:"; git status --short
exit "$status"
