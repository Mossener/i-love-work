@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20 or later: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo.
echo Ban Shang You Shu: http://127.0.0.1:5173
echo Keep this window open. Press Ctrl+C to stop.
call npm run dev -- --port 5173 --open
pause
