@echo off
setlocal
cd /d "%~dp0"
start "Jazz Scheduler Backend" powershell -ExecutionPolicy Bypass -NoExit -File "outputs\jazz-content-scheduler\backend\start-backend.ps1"
timeout /t 2 /nobreak > nul
start "" "%~dp0outputs\jazz-content-scheduler\index.html"
