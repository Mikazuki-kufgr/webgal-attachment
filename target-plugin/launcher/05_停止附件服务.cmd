@echo off
setlocal
chcp 65001 >nul
set "PRODUCT_ROOT=%~dp0"
set "NODE_EXE=%PRODUCT_ROOT%runtime\node\node.exe"
set "LAUNCHER=%PRODUCT_ROOT%runtime\creator-launch.mjs"
set "CONFIG=%PRODUCT_ROOT%config\creator-launch.json"
title WebGAL 附件制作器 - 停止服务
echo [WebGAL附件] 正在请求关闭本产品拥有的附件服务……
if not exist "%NODE_EXE%" goto :missing
if not exist "%LAUNCHER%" goto :missing
if not exist "%CONFIG%" goto :missing
"%NODE_EXE%" "%LAUNCHER%" --stop --config "%CONFIG%"
set "EXIT_CODE=%ERRORLEVEL%"
if "%EXIT_CODE%"=="0" (
  echo [WebGAL附件] 已发送安全停止请求；不会结束其他 Node、Terre 或浏览器进程。
) else (
  echo [WebGAL附件] 未能确认当前产品服务，错误码：%EXIT_CODE%
)
pause
exit /b %EXIT_CODE%
:missing
echo [WebGAL附件] 产品文件不完整，未执行任何进程终止操作。
pause
exit /b 2
