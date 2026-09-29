@echo off
chcp 65001 >nul
setlocal DisableDelayedExpansion
set "WEBGAL_LOCAL_SCRIPT=%~dp0.webgal-local\LocalGame.ps1"
cd /d "%TEMP%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%WEBGAL_LOCAL_SCRIPT%" -Stop
if errorlevel 1 pause
endlocal
