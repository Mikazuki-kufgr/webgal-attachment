@echo off
setlocal
chcp 65001 >nul
set "PRODUCT_ROOT=%~dp0"
set "NODE_EXE=%PRODUCT_ROOT%runtime\node\node.exe"
set "LAUNCHER=%PRODUCT_ROOT%runtime\creator-launch.mjs"
set "CONFIG=%PRODUCT_ROOT%config\creator-launch.json"
set "MESSAGES=%PRODUCT_ROOT%Show-WebGALCreatorEntry.ps1"
title WebGAL Attachment Creator - live log
if not exist "%MESSAGES%" goto :messageMissing
if not exist "%CONFIG%" goto :location
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MESSAGES%" -Mode Start
if not exist "%NODE_EXE%" goto :missing
if not exist "%LAUNCHER%" goto :missing
if "%WEBGAL_ATTACHMENT_CHECK_ONLY%"=="1" goto :check
"%NODE_EXE%" "%LAUNCHER%" --config "%CONFIG%"
set "EXIT_CODE=%ERRORLEVEL%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MESSAGES%" -Mode End -ExitCode %EXIT_CODE%
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause >nul
exit /b %EXIT_CODE%
:check
"%NODE_EXE%" "%LAUNCHER%" --config "%CONFIG%" --check
exit /b %ERRORLEVEL%
:location
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MESSAGES%" -Mode Location -ProductRoot "%PRODUCT_ROOT%."
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause >nul
exit /b 2
:missing
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%MESSAGES%" -Mode Missing
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause >nul
exit /b 2
:messageMissing
echo WebGAL Attachment files incomplete. Run 03 validation in installed Manager or extract the complete package.
echo Current directory: "%PRODUCT_ROOT%"
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause >nul
exit /b 2
