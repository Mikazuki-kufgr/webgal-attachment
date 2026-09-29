param([ValidateSet('Location','Missing','Start','End')][string]$Mode,[string]$ProductRoot,[int]$ExitCode=0)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
switch ($Mode) {
  'Location' {
    Write-Host '[WebGAL附件] 当前入口没有安装后的启动配置。'
    Write-Host "当前入口位置：$ProductRoot"
    Write-Host '如果您正在安装包解压目录中，请先运行本目录的 01_安装或升级.cmd。'
    Write-Host '安装成功后，请运行提示中完整路径指向的 WebGAL-Attachment-Manager\02_打开附件制作器.cmd。'
    Write-Host '如果当前目录已经是已安装 Manager，请运行同目录的 03_验证安装.cmd；失败后从同版本完整安装包修复。'
    Write-Host '此入口不会读取旧安装请求并自动跳转，不会启动另一个宿主，也不会改动游戏。'
  }
  'Missing' { Write-Host '[WebGAL附件] 已安装目录缺少运行文件，请先运行同目录的 03_验证安装.cmd，并保留诊断。' }
  'Start' { Write-Host '[WebGAL附件] 正在检查产品文件并启动制作器……' }
  'End' {
    if ($ExitCode -eq 0) { Write-Host '[WebGAL附件] 本次附件服务已正常结束。' }
    else { Write-Host "[WebGAL附件] 启动或运行失败，错误码：$ExitCode" }
    Write-Host '请保留本窗口中的日志；按任意键关闭。'
  }
}
