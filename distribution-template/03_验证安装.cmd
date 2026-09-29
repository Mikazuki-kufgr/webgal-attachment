@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-WebGALAttachment.ps1" -HumanReadable -Mode Validate -Request "%~1"
set "RC=%ERRORLEVEL%"
echo.
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause
exit /b %RC%
