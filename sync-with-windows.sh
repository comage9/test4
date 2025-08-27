#!/usr/bin/env bash
# 양방향 rsync 동기화 (WSL에서 실행)
set -euo pipefail

# 경로 설정: Windows E: 드라이브의 대상 폴더와 현재 WSL 작업 폴더
WINDOWS_PATH="/mnt/e/python/test4_source_backup (1)/test4_source_backup"
WSL_PATH="/home/comage/test4_source_backup"

echo "=== 동기화 시작 ==="

EXCLUDES=(
  "--exclude=node_modules" "--exclude=dist" "--exclude=*.exe"
  "--exclude=uploads" "--exclude=*.db" "--exclude=delivery-dashboard-*"
  "--exclude=delivery-data.json" "--exclude=server.log"
)

echo "[Windows → WSL]"
rsync -av --delete "${EXCLUDES[@]}" "$WINDOWS_PATH/" "$WSL_PATH/"
echo "=== Windows → WSL 완료 ==="

echo "[WSL → Windows]"
rsync -av --delete "${EXCLUDES[@]}" "$WSL_PATH/" "$WINDOWS_PATH/"
echo "=== WSL → Windows 완료 ==="

echo "=== 전체 동기화 완료 ==="
