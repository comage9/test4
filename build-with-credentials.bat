@echo off
echo Building Windows executable with credentials...

REM Build the executable
call npm run build:win

REM Copy credentials.json to dist folder
copy credentials.json dist\

echo Build complete! Files in dist folder:
dir dist\

echo.
echo To run: dist\production-dashboard-win.exe
pause