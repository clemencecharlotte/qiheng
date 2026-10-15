#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "$SCRIPT_DIR/dist/index.html" ]; then
  echo "错误：未找到静态产物 $SCRIPT_DIR/dist/index.html。" >&2
  echo "请先在本目录运行 'npm run build' 生成 dist/ 后再启动。" >&2
  exit 1
fi

exec npm run preview -- --strictPort