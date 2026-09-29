param(
  [string]$HostRoot = "",
  [string]$HostHomeRoot = "",
  [string]$ProjectNames = "",
  [string]$OutputPath = "",
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$productRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-NoGames {
  Write-Host "[WebGAL附件] 未检测到 WebGAL 游戏项目。"
  Write-Host '请先启动 WebGAL Terre，点击“新建游戏”创建至少一个项目，完全退出 Terre 后重新运行安装程序。'
  Write-Host "当前未执行安装，也未修改宿主。"
  Write-Output '{"ok":false,"code":"TERRE_GAME_PROJECT_NOT_FOUND","stage":"project-selection","operation":"prepare-install","writesApplied":0}'
  exit 1
}

function Resolve-ExistingDirectory([string]$Value, [string]$Code) {
  if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathRooted($Value)) { throw $Code }
  $resolved = [IO.Path]::GetFullPath($Value)
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw $Code }
  return $resolved.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Select-TerreFolder {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "请选择包含 WebGAL_Terre.exe 的目录，或仅包含这一宿主目录的外层文件夹"
  $dialog.ShowNewFolderButton = $false
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "INSTALL_SELECTION_CANCELLED" }
  return $dialog.SelectedPath
}

function Select-Projects([string[]]$Names) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "WebGAL 附件插件：选择可保存的游戏"
  $form.StartPosition = "CenterScreen"
  $form.Size = New-Object System.Drawing.Size(620, 470)
  $form.MinimizeBox = $false
  $form.MaximizeBox = $false

  $label = New-Object System.Windows.Forms.Label
  $label.Text = "请选择至少一个允许附件制作器保存的游戏。按 Ctrl 或 Shift 可以多选；列表中的第一项将作为制作区初始模板。"
  $label.AutoSize = $false
  $label.Location = New-Object System.Drawing.Point(18, 16)
  $label.Size = New-Object System.Drawing.Size(570, 52)

  $list = New-Object System.Windows.Forms.ListBox
  $list.SelectionMode = "MultiExtended"
  $list.Location = New-Object System.Drawing.Point(18, 74)
  $list.Size = New-Object System.Drawing.Size(570, 300)
  foreach ($name in $Names) { [void]$list.Items.Add($name) }

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = "继续安装"
  $ok.Location = New-Object System.Drawing.Point(398, 388)
  $ok.Size = New-Object System.Drawing.Size(92, 30)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = "取消"
  $cancel.Location = New-Object System.Drawing.Point(496, 388)
  $cancel.Size = New-Object System.Drawing.Size(92, 30)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.Controls.AddRange(@($label, $list, $ok, $cancel))
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "INSTALL_SELECTION_CANCELLED" }
  $selected = @($list.SelectedItems | ForEach-Object { [string]$_ })
  if ($selected.Count -eq 0) { throw "INSTALL_PROJECT_SELECTION_REQUIRED" }
  return $selected
}

if ([string]::IsNullOrWhiteSpace($HostRoot)) {
  if ($NonInteractive) { throw "TERRE_RELEASE_FOLDER_REQUIRED" }
  $HostRoot = Select-TerreFolder
}
. (Join-Path $productRoot 'Resolve-WebGALTerreHost.ps1')
$HostRoot = Resolve-WebGALTerreHost $HostRoot
Write-Host "[WebGAL附件] 最终实际安装路径：$HostRoot"

if ([string]::IsNullOrWhiteSpace($HostHomeRoot)) {
  $HostHomeRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
}
$HostHomeRoot = Resolve-ExistingDirectory $HostHomeRoot "TERRE_HOME_FOLDER_INVALID"
$configRoot = Join-Path $HostHomeRoot ".webgal_terre"
$configPath = Join-Path $configRoot "config.json"
$portableRoot = Join-Path $HostRoot "data"
if (Test-Path -LiteralPath $portableRoot -PathType Container) {
  $userDataRoot = [IO.Path]::GetFullPath($portableRoot)
} else {
  $configured = ""
  if (Test-Path -LiteralPath $configPath -PathType Leaf) {
    $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
    if ($null -ne $config.userDataPath -and $config.userDataPath -isnot [string]) { throw "TERRE_CONFIG_INVALID" }
    $configured = [string]$config.userDataPath
  }
  if ([string]::IsNullOrWhiteSpace($configured)) {
    $userDataRoot = $configRoot
  } elseif ([IO.Path]::IsPathRooted($configured)) {
    $userDataRoot = [IO.Path]::GetFullPath($configured)
  } else {
    $userDataRoot = [IO.Path]::GetFullPath((Join-Path $HostRoot $configured))
  }
}
# Installation initializes an independent authoring area; games are selected at deployment.
$selectedProjects = @()
if (-not [string]::IsNullOrWhiteSpace($ProjectNames)) {
  $selectedProjects = @($ProjectNames.Split('|', [StringSplitOptions]::RemoveEmptyEntries))
  foreach ($name in $selectedProjects) {
    if (-not (Test-Path -LiteralPath (Join-Path $userDataRoot "games/$name/game/config.txt") -PathType Leaf)) { throw "INSTALL_PROJECT_NOT_FOUND:$name" }
  }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $localStateRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
  if ([string]::IsNullOrWhiteSpace($localStateRoot)) { $localStateRoot = [IO.Path]::GetTempPath() }
  $OutputPath = Join-Path $localStateRoot "WebGAL-Attachment\install-request.json"
}
if (-not [IO.Path]::IsPathRooted($OutputPath)) { throw "INSTALL_REQUEST_OUTPUT_PATH_INVALID" }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$request = [ordered]@{
  schema = "webgal-attachment-install-request"
  schemaVersion = 1
  hostRoot = $HostRoot
  hostHomeRoot = $HostHomeRoot
  authorizedUserDataRoot = $userDataRoot
  authorizedAuthoringRoot = Join-Path $HostRoot "WebGAL-Attachment-Authoring"
  authoringTemplateProject = ""
  projectGrants = @($selectedProjects | ForEach-Object { [ordered]@{ name = $_; access = "attachment-write" } })
}
$parent = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { [void](New-Item -ItemType Directory -Path $parent) }
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutputPath, (($request | ConvertTo-Json -Depth 6) + [Environment]::NewLine), $utf8)
Write-Host "[WebGAL附件] 已准备安装配置。目标：$HostRoot"
Write-Host "[WebGAL附件] 独立制作区已配置；添加人物或附件到游戏时，再在制作器中选择目标游戏。"
Write-Output $OutputPath
