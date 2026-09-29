param([switch]$Stop, [switch]$NoOpen)
$ErrorActionPreference = 'Stop'
# Built-in Windows PowerShell/.NET only. No network download or Node required.
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location ([IO.Path]::GetTempPath())
$hash = [Security.Cryptography.SHA256]::Create()
$key = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant()
$hash.Dispose()
$stateDir = Join-Path ([IO.Path]::GetTempPath()) 'WebGAL-LocalGame'
[IO.Directory]::CreateDirectory($stateDir) | Out-Null
$stateFile = Join-Path $stateDir ($key + '.json')
# Serialize startup for this exact export, rather than relying on stale PID files.
$mutex = New-Object Threading.Mutex($false, ('Local\WebGALLocalGame-' + $key))
$locked = $false
$instance = $null
function Read-LiveState {
  if (!(Test-Path -LiteralPath $stateFile)) { return $null }
  try {
    $s = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($s.key -ne $key -or $s.port -lt 30000 -or $s.port -gt 59999 -or $s.token -notmatch '^[a-f0-9]{32}$') { return $null }
    $url = 'http://127.0.0.1:' + $s.port
    $r = Invoke-RestMethod -Uri ($url + '/__webgal_local_identity') -TimeoutSec 2 -UseBasicParsing
    if ($r.key -eq $key -and $r.token -eq $s.token) { return $s }
  } catch { }
  return $null
}
try {
  try { $locked = $mutex.WaitOne(10000) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (!$locked) { throw '另一个启动操作尚未结束，请稍后再试。' }
  $live = Read-LiveState
  if ($Stop) {
    if ($live) {
      Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $live.port + '/__webgal_local_stop?token=' + $live.token) -TimeoutSec 3 -UseBasicParsing | Out-Null
      Write-Host '本地游戏服务已关闭。'
    } else { Write-Host '这份游戏没有运行中的本地服务。' }
    return
  }
  if ($live) {
    $url = 'http://127.0.0.1:' + $live.port + '/__webgal_local_control?token=' + $live.token
    Write-Host ('复用本份游戏的本地服务：' + $url)
    if (!$NoOpen) { Start-Process $url }
    return
  }
  if (!(Test-Path -LiteralPath (Join-Path $root 'index.html') -PathType Leaf)) { throw '未找到 index.html，请复制完整的网页导出目录后重试。' }
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
public sealed class WebGALLocalGame : IDisposable {
  readonly string root, key, token;
  readonly TcpListener listener;
  volatile bool stopped;
  readonly SemaphoreSlim slots = new SemaphoreSlim(16);
  public int Port { get { return ((IPEndPoint)listener.LocalEndpoint).Port; } }
  public WebGALLocalGame(string folder, string id, string secret, int preferred) {
    root = Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    key = id; token = secret;
    for (int i=0; i<32; i++) {
      var candidate = new TcpListener(IPAddress.Loopback, 30000 + ((preferred - 30000 + i) % 30000));
      candidate.Server.ExclusiveAddressUse = true;
      try { candidate.Start(128); listener = candidate; break; }
      catch (SocketException) { candidate.Stop(); }
    }
    if (listener == null) throw new IOException("本地端口均被占用，请关闭其他本地服务后重试。");
  }
  public void Run() {
    while (!stopped) {
      try {
        if (!slots.Wait(200)) continue;
        var client = listener.AcceptTcpClient();
        Task.Run(() => { try { Handle(client); } catch { } finally { client.Close(); slots.Release(); } });
      } catch (SocketException) { if (!stopped) throw; }
      catch (ObjectDisposedException) { if (!stopped) throw; }
    }
  }
  public void Dispose() { stopped = true; listener.Stop(); }
  static void Reply(NetworkStream stream, int code, string mime, byte[] bytes, bool head, string extra = "") {
    string status = code==200?"OK":code==206?"Partial Content":code==403?"Forbidden":code==404?"Not Found":code==416?"Range Not Satisfiable":"Bad Request";
    var header = Encoding.ASCII.GetBytes("HTTP/1.1 " + code + " " + status + "\r\nContent-Type: " + mime + "\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n" + extra + "\r\n");
    stream.Write(header,0,header.Length); if (!head) stream.Write(bytes,0,bytes.Length);
  }
  static void Text(NetworkStream stream, int code, string text, bool head=false) { Reply(stream,code,"text/plain; charset=utf-8",Encoding.UTF8.GetBytes(text),head); }
  bool SafeFile(string file) {
    if (!file.StartsWith(root,StringComparison.OrdinalIgnoreCase)) return false;
    string at = root.TrimEnd(Path.DirectorySeparatorChar);
    if ((File.GetAttributes(at) & FileAttributes.ReparsePoint) != 0) return false;
    foreach (string part in file.Substring(root.Length).Split(Path.DirectorySeparatorChar)) {
      at = Path.Combine(at,part);
      if ((File.GetAttributes(at) & FileAttributes.ReparsePoint) != 0) return false;
    }
    return true;
  }
  void Handle(TcpClient client) {
    client.ReceiveTimeout=4000; client.SendTimeout=10000;
    using (var stream=client.GetStream()) {
      var raw = new List<byte>(); int b;
      while (raw.Count<16384 && (b=stream.ReadByte())>=0) {
        raw.Add((byte)b); int n=raw.Count;
        if(n>=4 && raw[n-4]==13 && raw[n-3]==10 && raw[n-2]==13 && raw[n-1]==10) break;
      }
      int count=raw.Count;
      if(count<4 || raw[count-4]!=13 || raw[count-3]!=10 || raw[count-2]!=13 || raw[count-1]!=10) { Text(stream,400,"请求头不完整或过长"); return; }
      var lines=Encoding.ASCII.GetString(raw.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None);
      var first=lines[0].Split(' ');
      if(first.Length!=3 || !first[2].StartsWith("HTTP/1.")) { Text(stream,400,"请求格式无效"); return; }
      string method=first[0], target=first[1]; bool head=method=="HEAD";
      var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(var line in lines) { int colon=line.IndexOf(':'); if(colon>0) headers[line.Substring(0,colon)]=line.Substring(colon+1).Trim(); }
      string host; if(!headers.TryGetValue("Host",out host) || (host!="127.0.0.1:"+Port && host!="localhost:"+Port)) { Text(stream,403,"仅支持本机访问",head); return; }
      string origin; if(headers.TryGetValue("Origin",out origin) && origin!="http://"+host) { Text(stream,403,"不允许外部页面请求",head); return; }
      if(!target.StartsWith("/") || target.StartsWith("//")) { Text(stream,400,"路径无效",head); return; }
      int q=target.IndexOf('?'); string url=q<0?target:target.Substring(0,q), query=q<0?"":target.Substring(q+1);
      if(url=="/__webgal_local_identity" && (method=="GET" || head)) {
        Reply(stream,200,"application/json",Encoding.UTF8.GetBytes("{\"key\":\""+key+"\",\"token\":\""+token+"\"}"),head); return;
      }
      if(url=="/__webgal_local_stop") {
        if(method!="POST" || query!="token="+token) { Text(stream,403,"关闭请求无效",head); return; }
        Text(stream,200,"本地服务已关闭，可以关闭此页面。"); Dispose(); return;
      }
      if(method!="GET" && !head) { Text(stream,400,"仅支持读取文件",head); return; }
      if(url=="/__webgal_local_control") {
        if(query!="token="+token) { Text(stream,403,"启动链接已过期，请再次双击启动游戏。",head); return; }
        string page="<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>WebGAL 本地游戏</title><style>html,body{margin:0;height:100%;background:#121820;color:#eef3fa;font:14px sans-serif}header{height:42px;display:flex;align-items:center;gap:14px;padding:0 12px}button{padding:6px 12px;cursor:pointer}iframe{display:block;border:0;width:100%;height:calc(100% - 42px)}</style><header><span>本地游戏 · 仅本机访问</span><button id='stop'>结束游戏并关闭服务</button><span id='msg'>关闭窗口前请点结束，或关闭启动日志窗口。</span></header><iframe src='/index.html' title='游戏' allow='autoplay; fullscreen' allowfullscreen></iframe><script>document.getElementById('stop').onclick=async()=>{try{let r=await fetch('/__webgal_local_stop?token="+token+"',{method:'POST'});if(!r.ok)throw Error();document.querySelector('iframe').remove();document.getElementById('msg').textContent='本地服务已关闭，可以关闭此页面。';document.getElementById('stop').disabled=true;}catch(e){document.getElementById('msg').textContent='关闭失败，请关闭启动日志窗口或双击关闭服务入口。';}}</script></html>";
        Reply(stream,200,"text/html; charset=utf-8",Encoding.UTF8.GetBytes(page),head); return;
      }
      string relative;
      try { relative=Uri.UnescapeDataString(url).TrimStart('/'); }
      catch { Text(stream,400,"路径编码无效",head); return; }
      if(relative=="") relative="index.html";
      foreach(string segment in relative.Split('/')) {
        if(segment=="." || segment==".." || segment.Equals(".webgal-local",StringComparison.OrdinalIgnoreCase) || segment.IndexOfAny(new[]{'\\',':','\0'})>=0 || segment.EndsWith(".") || segment.EndsWith(" ")) { Text(stream,403,"路径不可访问",head); return; }
      }
      string file=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
      if(!File.Exists(file)) { Text(stream,404,"未找到文件",head); return; }
      if(!SafeFile(file)) { Text(stream,403,"不支持链接文件",head); return; }
      string ext=Path.GetExtension(file).ToLowerInvariant(), mime="application/octet-stream";
      switch(ext) {
        case ".html": mime="text/html; charset=utf-8"; break;
        case ".js": case ".mjs": mime="text/javascript; charset=utf-8"; break;
        case ".css": mime="text/css; charset=utf-8"; break;
        case ".json": mime="application/json; charset=utf-8"; break;
        case ".txt": case ".svg": mime=ext==".svg"?"image/svg+xml":"text/plain; charset=utf-8"; break;
        case ".png": mime="image/png"; break; case ".jpg": case ".jpeg": mime="image/jpeg"; break;
        case ".webp": mime="image/webp"; break; case ".gif": mime="image/gif"; break;
        case ".ico": mime="image/x-icon"; break; case ".wasm": mime="application/wasm"; break;
        case ".woff": mime="font/woff"; break; case ".woff2": mime="font/woff2"; break;
        case ".ttf": mime="font/ttf"; break; case ".otf": mime="font/otf"; break;
        case ".mp3": mime="audio/mpeg"; break; case ".ogg": mime="audio/ogg"; break;
        case ".wav": mime="audio/wav"; break; case ".mp4": mime="video/mp4"; break; case ".webm": mime="video/webm"; break;
      }
      using(var input=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
        long start=0, end=input.Length-1; string range; bool partial=false;
        if(headers.TryGetValue("Range",out range)) {
          var match=System.Text.RegularExpressions.Regex.Match(range,"^bytes=([0-9]*)-([0-9]*)$");
          long a=0,z=0;
          bool valid=match.Success && (match.Groups[1].Value!="" || match.Groups[2].Value!="");
          if(valid && match.Groups[1].Value=="") { valid=long.TryParse(match.Groups[2].Value,out z) && z>0; start=Math.Max(0,input.Length-z); }
          else if(valid) { valid=long.TryParse(match.Groups[1].Value,out a); start=a; if(match.Groups[2].Value!="") { valid=valid && long.TryParse(match.Groups[2].Value,out z); end=Math.Min(end,z); } }
          if(!valid || start>end || start>=input.Length) { Reply(stream,416,"text/plain",new byte[0],head,"Content-Range: bytes */"+input.Length+"\r\n"); return; }
          partial=true;
        }
        long length=Math.Max(0,end-start+1);
        string response="HTTP/1.1 "+(partial?"206 Partial Content":"200 OK")+"\r\nContent-Type: "+mime+"\r\nContent-Length: "+length+"\r\nConnection: close\r\nAccept-Ranges: bytes\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n"+(partial?"Content-Range: bytes "+start+"-"+end+"/"+input.Length+"\r\n":"")+"\r\n";
        var bytes=Encoding.ASCII.GetBytes(response); stream.Write(bytes,0,bytes.Length);
        if(!head) { input.Position=start; var buffer=new byte[65536]; while(length>0) { int n=input.Read(buffer,0,(int)Math.Min(length,buffer.Length)); if(n==0) break; stream.Write(buffer,0,n); length-=n; } }
      }
    }
  }
}
'@
  $token = [Guid]::NewGuid().ToString('N')
  $preferred = 30000 + ([Convert]::ToInt32($key.Substring(0, 7), 16) % 30000)
  $instance = New-Object WebGALLocalGame($root, $key, $token, $preferred)
  @{ key=$key; port=$instance.Port; token=$token; pid=$PID } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
  $url = 'http://127.0.0.1:' + $instance.Port + '/__webgal_local_control?token=' + $token
  $mutex.ReleaseMutex(); $locked=$false
  Write-Host ('游戏地址：' + $url)
  Write-Host '保持此日志窗口打开。结束时点击网页上的“结束游戏并关闭服务”，或关闭此窗口。'
  if (!$NoOpen) { Start-Process $url }
  $instance.Run()
} catch {
  Write-Host ('无法启动/关闭本地游戏：' + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($instance) {
    $instance.Dispose()
    try {
      $current=Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($current.token -eq $token) { Remove-Item -LiteralPath $stateFile -Force }
    } catch { }
  }
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
