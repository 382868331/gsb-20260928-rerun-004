#!/usr/bin/env bash
# 启动 API 服务：http://127.0.0.1:8000
set -euo pipefail
cd "$(dirname "$0")"
exec python -m uvicorn animstudio.api:app --host 127.0.0.1 --port 8000
