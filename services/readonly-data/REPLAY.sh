#!/usr/bin/env bash
# 气衡 M06 · curl 复跑（真实 HTTP 冒烟）。
# 前置：后端已在 127.0.0.1:4203 运行，令牌在 var/.capability（本脚本读取，不打印）。
# 用法：bash REPLAY.sh
set -euo pipefail
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
: "${QH_DATA_TOKEN:=$(cat "$DIR/var/.capability" 2>/dev/null || true)}"
if [ -z "${QH_DATA_TOKEN:-}" ]; then echo "缺少 QH_DATA_TOKEN（或 var/.capability）" >&2; exit 2; fi
B="${QH_DATA_BASE:-http://127.0.0.1:4203}"
H="X-QH-Capability: $QH_DATA_TOKEN"

echo "== health (no token -> 401) =="
curl -s -o /dev/null -w "%{http_code}\n" "$B/health"
echo "== health (token -> 200) =="
curl -s -H "$H" "$B/health"; echo
echo "== bad origin -> 403 =="
curl -s -o /dev/null -w "%{http_code}\n" -H "$H" -H "Origin: http://evil.example" "$B/health"
echo "== import CSV =="
curl -s -H "$H" -H "Content-Type: text/csv" --data-binary @"$DIR/samples/sample-batch.csv" \
  "$B/batches?format=csv&filename=sample-batch.csv"; echo
echo "== re-import CSV (idempotent) =="
curl -s -H "$H" -H "Content-Type: text/csv" --data-binary @"$DIR/samples/sample-batch.csv" \
  "$B/batches?format=csv&filename=sample-batch.csv"; echo
echo "== import mixed JSON =="
MID=$(curl -s -H "$H" -H "Content-Type: application/json" --data-binary @"$DIR/samples/sample-batch-mixed.json" \
  "$B/batches?format=json" | python3 -c 'import sys,json;print(json.load(sys.stdin)["batchId"])')
echo "batchId=$MID"
echo "== quality =="
curl -s -H "$H" "$B/batches/$MID/quality"; echo
echo "== source state =="
curl -s -H "$H" "$B/sources/synth-air-2/state"; echo
echo "== batches list =="
curl -s -H "$H" "$B/batches?limit=3" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("total=",d["total"])'
