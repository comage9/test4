@echo off
setlocal
REM --- 설정: 경로는 환경에 맞게 수정 ---
REM 예) set DELIVERY_DB_PATH=E:\\data\\delivery-data.json
if "%DELIVERY_DB_PATH%"=="" (
  echo [INFO] DELIVERY_DB_PATH not set. Using exe-folder delivery-data.json
) else (
  echo [INFO] Using DELIVERY_DB_PATH=%DELIVERY_DB_PATH%
)
REM 포트를 지정하려면 주석 해제 후 사용
REM set PORT=5173

set EXE=dist\production-dashboard-win.exe
if not exist "%EXE%" (
  echo [ERROR] %EXE% not found. Run: npm run build:win
  exit /b 1
)

"%EXE%"
endlocal
