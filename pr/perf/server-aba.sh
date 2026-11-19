#!/usr/bin/env bash
# Production-build A/B/A on s154: BASE, FIX, BASE again. Usage: server-aba.sh <base-sha> <fix-sha>
set -uo pipefail
BASE=$1
FIX=$2
REPO=~/orca-fleet-perf
H=~/orca-fleet-perf-harness
OUT=$H/aba-$(date +%Y%m%d-%H%M%S)
export LD_LIBRARY_PATH=~/orca-fleet-perf-libs/root/usr/lib/x86_64-linux-gnu
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="corepack pnpm"
PORT=4791
mkdir -p "$OUT"
exec > >(tee -a "$OUT/server-aba.log") 2>&1
stamp() { echo "[$(date +%H:%M:%S)] $*"; }

prod_run() {
  local label=$1 sha=$2
  (cd "$REPO" && git checkout -q --detach "$sha") || { stamp "CHECKOUT FAILED $sha"; return 1; }
  stamp "$label at $(cd "$REPO" && git rev-parse --short HEAD); changed files: $(cd "$REPO" && git status --short | wc -l)"
  (cd "$REPO" && $PNPM exec vite build --config config/vite.fixtures.config.ts > "$OUT/$label-build.log" 2>&1) || { stamp "BUILD FAILED $label"; return 1; }
  (cd "$REPO" && $PNPM exec vite preview --config config/vite.fixtures.config.ts --host 127.0.0.1 --port $PORT --strictPort > "$OUT/$label-preview.log" 2>&1) &
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
  stamp "machine: $(nproc) cores; $(uptime)"
  node "$H/run.mjs" --repo "$REPO" --url "http://127.0.0.1:$PORT" --out "$OUT/$label" --runs 7 --ticks 40 > "$OUT/$label-run.log" 2>&1
  stamp "run $label exit=$?"
  pkill -f "vite preview --config config/vite.fixtures.config.ts"; sleep 1
}

rm -f "$H/ABA-DONE"
prod_run a1-base "$BASE"
prod_run b-fix "$FIX"
prod_run a2-base "$BASE"
(cd "$REPO" && git checkout -q --detach "$FIX")
python3 "$H/summarize.py" "$OUT"/*/results.json > "$OUT/summary.txt" 2>&1
stamp "summary written"
echo "$OUT" > "$H/ABA-DONE"
