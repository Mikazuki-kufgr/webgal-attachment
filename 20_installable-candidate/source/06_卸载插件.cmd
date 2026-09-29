@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem Release Explorer's inherited working directory before any maintenance child starts.
cd /d "%~dp0.."

rem Lifecycle relay / cleanup.
rem Lifecycle relay / cleanup.
if not defined WEBGAL_ATTACHMENT_UNINSTALL_RELAY (
  chcp 65001 >nul
  for %%I in ("%~dp0..") do set "HOST_ROOT=%%~fI"
  set "RELAY_PATH=!HOST_ROOT!\.webgal-attachment-uninstall-relay-!RANDOM!!RANDOM!.cmd"
  copy /y "%~f0" "!RELAY_PATH!" >nul
  if errorlevel 1 (
    echo [WebGAL附件] 无法在宿主目录准备安全卸载接力脚本；尚未开始卸载。
    exit /b 1
  )
  set "WEBGAL_ATTACHMENT_UNINSTALL_RELAY=1"
  set "REQUEST=%~1"
  if not defined REQUEST if exist "%~dp0config\install-request.json" set "REQUEST=%~dp0config\install-request.json"
  if not defined REQUEST set "REQUEST=%LOCALAPPDATA%\WebGAL-Attachment\install-request.json"
  "!RELAY_PATH!" "%~dp0Invoke-WebGALAttachment.ps1" "!REQUEST!" "!RELAY_PATH!"
)

rem Lifecycle relay / cleanup.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~1" -HumanReadable -Mode Uninstall -Request "%~2"
set "RC=!ERRORLEVEL!"
set "RELAY_PATH=%~3"
if not defined RELAY_PATH set "RELAY_PATH=%~f0"

rem Lifecycle relay / cleanup.
set "WEBGAL_ATTACHMENT_RELAY_CLEANUP=!RELAY_PATH!"
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 300; Remove-Item -LiteralPath $env:WEBGAL_ATTACHMENT_RELAY_CLEANUP -Force" >nul 2>&1
echo.
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause
exit /b !RC!
