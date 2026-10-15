#!/usr/bin/env bash
# 气衡 M06 · 只读数据服务启动脚本（仅 loopback）。
# 能力令牌只在本地文件/环境变量中，不打印其值。
set -euo pipefail
DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export QH_DATA_HOST="${QH_DATA_HOST:-127.0.0.1}"          # 仅 loopback
export QH_DATA_PORT="${QH_DATA_PORT:-4246}"
export QH_DATA_DB="${QH_DATA_DB:-$DIR/var/m16r03.sqlite3}"
export QH_DATA_ALLOWED_ORIGINS="${QH_DATA_ALLOWED_ORIGINS:-https://4245-a1db149b692927f8.code.cosmoplat.cn,http://127.0.0.1:4245,http://localhost:4245}"
export QH_DATA_MAX_BODY="${QH_DATA_MAX_BODY:-1048576}"

mkdir -p "$DIR/var"
CAP_FILE="$DIR/var/.capability"
if [ -z "${QH_DATA_TOKEN:-}" ]; then
  if [ ! -f "$CAP_FILE" ]; then
    python3 -c "import secrets; print(secrets.token_urlsafe(24))" > "$CAP_FILE"
    chmod 600 "$CAP_FILE"
  fi
  QH_DATA_TOKEN="$(cat "$CAP_FILE")"
  export QH_DATA_TOKEN
fi

echo "[run.sh] host=$QH_DATA_HOST port=$QH_DATA_PORT db=$QH_DATA_DB (令牌值不打印，存于 $CAP_FILE)"
exec python3 "$DIR/server.py"
