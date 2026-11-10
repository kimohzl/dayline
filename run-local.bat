@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dayline: http://localhost:5173  (close this window to stop)
start "" cmd /c "timeout /t 4 >nul & start http://localhost:5173"
npx --yes http-server -p 5173 -c-1 .
