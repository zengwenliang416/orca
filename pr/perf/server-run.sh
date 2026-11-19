#!/usr/bin/env bash
# Fleet vs Board benchmark on s154: production build A/B/A around the memo mitigation, plus dev profiler runs.
set -uo pipefail
REPO=~/orca-fleet-perf
H=~/orca-fleet-perf-harness
OUT=$H/results-$(date +%Y%m%d-%H%M%S)
export LD_LIBRARY_PATH=~/orca-fleet-perf-libs/root/usr/lib/x86_64-linux-gnu
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="corepack pnpm"
PORT=4791
mkdir -p "$OUT"
LOG="$OUT/server-run.log"
exec > >(tee -a "$LOG") 2>&1

stamp() { echo "[$(date +%H:%M:%S)] $*"; }
machine() { stamp "machine: $(nproc) cores; $(uptime)"; }

prod_run() {
  local label=$1
  stamp "prod build for $label"
  (cd "$REPO" && $PNPM exec vite build --config config/vite.fixtures.config.ts > "$OUT/$label-build.log" 2>&1) || { stamp "BUILD FAILED $label"; return 1; }
  (cd "$REPO" && $PNPM exec vite preview --config config/vite.fixtures.config.ts --host 127.0.0.1 --port $PORT --strictPort > "$OUT/$label-preview.log" 2>&1) &
  local pid=$!
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
  machine
  stamp "run $label"
  node "$H/run.mjs" --repo "$REPO" --url "http://127.0.0.1:$PORT" --out "$OUT/$label" --runs 7 --ticks 40 > "$OUT/$label-run.log" 2>&1
  stamp "run $label exit=$?"
  kill "$pid" 2>/dev/null; pkill -f "vite preview --config config/vite.fixtures.config.ts" 2>/dev/null; wait "$pid" 2>/dev/null
}

dev_run() {
  local label=$1
  (cd "$REPO" && $PNPM fixtures:shot --stop > /dev/null 2>&1)
  (cd "$REPO" && $PNPM fixtures:shot dashboard/fleet/AgentDashboardScale:scale100Board > "$OUT/$label-warm.log" 2>&1) || (cd "$REPO" && $PNPM fixtures:shot --stop > /dev/null 2>&1; $PNPM fixtures:shot dashboard/fleet/AgentDashboardScale:scale100Board >> "$OUT/$label-warm.log" 2>&1)
  machine
  stamp "run $label"
  node "$H/run.mjs" --repo "$REPO" --out "$OUT/$label" --runs 5 --ticks 40 > "$OUT/$label-run.log" 2>&1
  stamp "run $label exit=$?"
  (cd "$REPO" && $PNPM fixtures:shot --stop > /dev/null 2>&1)
}

cd "$REPO" || exit 2
stamp "HEAD $(git rev-parse --short HEAD); clean: $(git status --short | wc -l) changed files"
machine

prod_run prod-base
dev_run dev-base

stamp "apply memo patch"
git apply "$H/mitigation-memo-fleet-nodes.patch" || { stamp "PATCH FAILED"; echo failed > "$H/DONE"; exit 3; }
prod_run prod-memo
dev_run dev-memo
git apply -R "$H/mitigation-memo-fleet-nodes.patch" || stamp "PATCH REVERT FAILED"
stamp "after revert: $(git status --short | wc -l) changed files"

prod_run prod-base2
machine

python3 "$H/summarize.py" "$OUT"/*/results.json > "$OUT/summary.txt" 2>&1
stamp "summary written"
echo "$OUT" > "$H/DONE"
