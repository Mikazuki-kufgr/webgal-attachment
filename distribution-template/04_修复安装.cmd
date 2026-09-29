@echo off
setlocal
if exist "%~dp0config\installed-files.json" cd /d "%~dp0.."
chcp 65001 >nul
set "REQUEST=%~1"
if not defined REQUEST if exist "%~dp0config\install-request.json" set "REQUEST=%~dp0config\install-request.json"
if not defined REQUEST set "REQUEST=%LOCALAPPDATA%\WebGAL-Attachment\install-request.json"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-WebGALAttachment.ps1" -HumanReadable -Mode Repair -Request "%REQUEST%"
set "RC=%ERRORLEVEL%"
echo.
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause
exit /b %RC%
