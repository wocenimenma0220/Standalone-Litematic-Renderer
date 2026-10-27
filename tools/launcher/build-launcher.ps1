# 构建便携包根目录的统一启动器：投影预览.exe。
# 使用 Windows 自带的 .NET Framework C# 编译器，无需 SDK、NuGet 或网络。

# 启动器仅解析路径并启动包内 Electron 或 Java。


param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'bin'),
    [string]$Icon   = (Join-Path $PSScriptRoot 'app.ico')
)

$ErrorActionPreference = 'Stop'

# 优先使用 64 位编译器，缺失时回退到 32 位编译器。
$cscCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "No C# compiler found. Looked in: $($cscCandidates -join '; ')" }

$src = Join-Path $PSScriptRoot 'Launcher.cs'
if (-not (Test-Path $src)) { throw "Missing $src" }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$exe = Join-Path $OutDir '投影预览.exe'
$versionNode=if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '../node/node.exe')){Join-Path $PSScriptRoot '../node/node.exe'}else{(Get-Command node -ErrorAction Stop).Source}
$versionJson=& $versionNode (Join-Path $PSScriptRoot '../version.cjs') --json
if($LASTEXITCODE -ne 0){throw 'Version metadata is out of sync'}
$versionInfo=$versionJson | ConvertFrom-Json
$versionSource=Join-Path $OutDir 'Version.g.cs'
$versionAttributes="using System.Reflection;`n[assembly: AssemblyVersion(`"$($versionInfo.assembly)`")]`n[assembly: AssemblyFileVersion(`"$($versionInfo.assembly)`")]`n[assembly: AssemblyInformationalVersion(`"$($versionInfo.display)`")]`n"
[IO.File]::WriteAllText([IO.Path]::GetFullPath($versionSource),$versionAttributes,[Text.UTF8Encoding]::new($false))

# 使用图形子系统，双击启动时不闪现控制台。
# 目标平台与随包 Electron 和 Java 一致，使用 x64。

# 窗口和任务栏图标需要真实 ICO 文件。
$cscArgs = @(
    '/nologo'
    '/target:winexe'
    '/platform:x64'
    '/optimize+'
    '/codepage:65001'
    "/out:$exe"
    $src
    $versionSource
)
if (Test-Path $Icon) { $cscArgs = @('/win32icon:' + $Icon) + $cscArgs }
else { Write-Warning "Icon not found at $Icon; building without one." }

Write-Host "compiler: $csc"
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

$fi = Get-Item $exe
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash
Write-Host ("`nbuilt {0}  ({1:N0} bytes)  sha256={2}" -f $exe, $fi.Length, $sha)
