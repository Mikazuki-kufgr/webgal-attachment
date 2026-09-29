# Read-only host selection. No recursive search, request writes, or launch forwarding.
function Assert-WebGALSelectionPath([string]$Value, [string]$Kind) {
  if ($Value -notmatch '^[A-Za-z]:[\\/]') { throw 'TERRE_SELECTION_LOCAL_PATH_REQUIRED: 请选择本机磁盘中的宿主目录。' }
  $full = [IO.Path]::GetFullPath($Value)
  $cursor = $full
  while ($cursor) {
    $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'TERRE_SELECTION_REPARSE_UNSUPPORTED: 请选择实际目录，不使用链接或联接。'
    }
    $parent = Split-Path -Parent $cursor
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
  if (-not (Test-Path -LiteralPath $full -PathType $Kind)) { throw 'TERRE_RELEASE_FOLDER_INVALID' }
  return $full.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Test-WebGALHostContents([string]$Root) {
  $exe = Join-Path $Root 'WebGAL_Terre.exe'
  $metadataFile = Join-Path $Root 'assets\templates\Derivative_Engine\MyGO_v3.2.1\webgal-engine.json'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $metadataFile -PathType Leaf)) { throw 'TERRE_ENGINE_METADATA_NOT_FOUND' }
  [void](Assert-WebGALSelectionPath $exe 'Leaf')
  [void](Assert-WebGALSelectionPath $metadataFile 'Leaf')
  if ((Get-Item -LiteralPath $metadataFile).Length -gt 1048576) { throw 'TERRE_ENGINE_METADATA_INVALID' }
  try { $metadata = Get-Content -Raw -LiteralPath $metadataFile -Encoding UTF8 | ConvertFrom-Json }
  catch { throw 'TERRE_ENGINE_METADATA_INVALID' }
  if ($metadata.id -ne 'webgal-mygo.mygo' -or $metadata.version -ne '3.2.1' -or $metadata.webgalVersion -ne '4.6.4') {
    throw 'TERRE_VERSION_NOT_SUPPORTED'
  }
  return $true
}

function Resolve-WebGALTerreHost([string]$Selected) {
  $selectedRoot = Assert-WebGALSelectionPath $Selected 'Container'
  if (Test-WebGALHostContents $selectedRoot) { return $selectedRoot }
  $entries = @(Get-ChildItem -LiteralPath $selectedRoot -Force)
  # Only the unambiguous wrapper containing exactly one actual directory is accepted.
  if ($entries.Count -ne 1 -or -not $entries[0].PSIsContainer) {
    throw 'TERRE_HOST_SELECTION_NOT_UNIQUE: 所选目录没有宿主入口，且并非只含一个直属宿主目录。请直接选择包含 WebGAL_Terre.exe 的目录。'
  }
  $candidate = Assert-WebGALSelectionPath $entries[0].FullName 'Container'
  if (-not (Test-WebGALHostContents $candidate)) {
    throw 'TERRE_EXECUTABLE_NOT_FOUND: 请直接选择包含 WebGAL_Terre.exe 的目录；不搜索更深层目录。'
  }
  Write-Host "[WebGAL附件] 已识别外层目录。实际安装路径：$candidate"
  return $candidate
}
