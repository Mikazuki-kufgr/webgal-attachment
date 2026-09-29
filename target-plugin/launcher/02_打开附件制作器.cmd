@echo off
setlocal
chcp 65001 >nul
set "PRODUCT_ROOT=%~dp0"
set "NODE_EXE=%PRODUCT_ROOT%runtime\node\node.exe"
set "LAUNCHER=%PRODUCT_ROOT%runtime\creator-launch.mjs"
set "CONFIG=%PRODUCT_ROOT%config\creator-launch.json"
title WebGAL 附件制作器 - 实时日志
echo [WebGAL附件] 正在检查产品文件并启动制作器……
if not exist "%NODE_EXE%" goto :missing
if not exist "%LAUNCHER%" goto :missing
if not exist "%CONFIG%" goto :missing
"%NODE_EXE%" "%LAUNCHER%" --config "%CONFIG%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (
  echo [WebGAL附件] 本次附件服务已正常结束。
) else (
  echo [WebGAL附件] 启动或运行失败，错误码：%EXIT_CODE%
)
echo 请保留本窗口中的日志；按任意键关闭。
pause >nul
exit /b %EXIT_CODE%
:missing
echo [WebGAL附件] 产品文件不完整，请先运行安装/验证流程，不要手工猜路径。
pause >nul
exit /b 2
