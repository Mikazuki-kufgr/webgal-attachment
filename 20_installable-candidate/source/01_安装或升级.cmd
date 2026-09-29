@echo off
setlocal
if exist "%~dp0config\installed-files.json" cd /d "%~dp0.."
chcp 65001 >nul
set "REQUEST=%~1"
if defined REQUEST goto run_install
if exist "%~dp0config\install-request.json" set "REQUEST=%~dp0config\install-request.json"
if defined REQUEST goto run_install
echo [WebGAL附件] 首次安装请选择 WebGAL Terre 文件夹；无需先创建或选择游戏。
set "SETUP_ROOT=%LOCALAPPDATA%\WebGAL-Attachment"
if not defined LOCALAPPDATA set "SETUP_ROOT=%TEMP%\WebGAL-Attachment"
set "REQUEST=%SETUP_ROOT%\install-request.json"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Prepare-WebGALAttachmentInstall.ps1" -OutputPath "%REQUEST%"
if errorlevel 1 goto setup_failed
:run_install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-WebGALAttachment.ps1" -HumanReadable -Mode Install -Request "%REQUEST%"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [WebGAL附件] 安装或升级没有完成。请保留上方完整错误信息。
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause
exit /b %RC%
:setup_failed
set "RC=%ERRORLEVEL%"
echo.
echo [WebGAL附件] 尚未执行安装；没有修改 WebGAL Terre。
if not defined WEBGAL_ATTACHMENT_NO_PAUSE pause
exit /b %RC%
