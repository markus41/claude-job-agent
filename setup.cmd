@echo off
rem claude-job-agent one-click setup — double-click me.
rem Runs setup.ps1 with this folder as the working directory.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
echo.
pause
