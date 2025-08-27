#!/bin/bash
# Windows 폴더와 동기화 스크립트

WINDOWS_PATH="/mnt/e/python/test/delivery-dashboard-production"
LINUX_PATH="/home/comage/delivery-dashboard-production"

echo "=== 동기화 시작 ==="

# Windows에서 Linux로 변경된 파일 복사
rsync -av --exclude='node_modules' --exclude='*.exe' --exclude='dist' "$WINDOWS_PATH/" "$LINUX_PATH/"

echo "=== Windows → Linux 동기화 완료 ==="

# Linux에서 Windows로 변경된 파일 복사 (주요 작업 파일들)
rsync -av --include='*.js' --include='*.json' --include='*.html' --include='*.css' --include='*.md' --include='*.log' --include='*.db' --exclude='*' "$LINUX_PATH/" "$WINDOWS_PATH/"

echo "=== Linux → Windows 동기화 완료 ==="
echo "=== 전체 동기화 완료 ==="