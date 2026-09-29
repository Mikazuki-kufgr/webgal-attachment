$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$releaseRoot = Split-Path -Parent $PSScriptRoot
$nodePath = Join-Path $PSScriptRoot 'node/node.exe'
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '随包 Node 缺失，请使用完整安装包修复。' }
$updateScript = Join-Path $PSScriptRoot 'engine-game-update.mjs'
$gameNames = @((& $nodePath $updateScript --list | ConvertFrom-Json))
if ($LASTEXITCODE -ne 0) { throw '无法读取已授权游戏列表。' }
Write-Host '更新已有游戏引擎（保留剧情、人物和附件）。请先关闭 Terre、制作器及游戏预览。'
for ($gameIndex=0; $gameIndex -lt $gameNames.Count; $gameIndex++) { Write-Host ('{0}. {1}' -f ($gameIndex+1), $gameNames[$gameIndex]) }
$choice = Read-Host '输入要更新的游戏序号，直接回车取消'
if (-not $choice) { exit 0 }
$selectedNumber = 0
if (-not [int]::TryParse($choice,[ref]$selectedNumber) -or $selectedNumber -lt 1 -or $selectedNumber -gt $gameNames.Count) { throw '游戏序号无效。' }
& $nodePath $updateScript $gameNames[$selectedNumber-1]
if ($LASTEXITCODE -ne 0) { throw '更新未完成，请查看上面的具体原因。' }
Write-Host '更新完成。旧引擎备份路径见上方结果。请重新启动 Terre 再预览。'
