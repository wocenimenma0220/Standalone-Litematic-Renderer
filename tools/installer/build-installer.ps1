# 构建单文件 Windows 安装向导（Litematic-Viewer-<version>-win-x64-setup.exe）。
# 使用内置 .NET Framework csc.exe 编译安装引导程序并附加压缩载荷，无需 Inno Setup 或 NSIS。

param(
    [Parameter(Mandatory = $true)][string]$PayloadZip,
    [Parameter(Mandatory = $true)][string]$OutExe,
    [string]$Icon = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Icon) { $Icon = Join-Path $PSScriptRoot '..\launcher\app.ico' }

if (-not (Test-Path -LiteralPath $PayloadZip)) { throw "Missing PayloadZip: $PayloadZip" }

$cscCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "No C# compiler found." }

$versionNode = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '..\node\node.exe')) {
    Join-Path $PSScriptRoot '..\node\node.exe'
} else {
    (Get-Command node -ErrorAction Stop).Source
}
$releaseJson = & $versionNode (Join-Path $PSScriptRoot '..\version.cjs') --release-json
if ($LASTEXITCODE -ne 0) { throw 'Release metadata is out of sync' }
$rel = $releaseJson | ConvertFrom-Json

$buildDir = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

$esc = { param($s) ([string]$s).Replace('\', '\\').Replace('"', '\"') }
$metaCs = @"
using System.Reflection;
[assembly: AssemblyVersion("$($rel.assembly)")]
[assembly: AssemblyFileVersion("$($rel.assembly)")]
[assembly: AssemblyInformationalVersion("$($rel.display)")]
internal static class SetupMeta {
    public const string Version = "$(& $esc $rel.version)";
    public const string Display = "$(& $esc $rel.display)";
    public const string RuntimeSignature = "$(& $esc $rel.runtimeSignature)";
    public const string Repo = "$(& $esc $rel.repo)";
}
"@
$metaFile = Join-Path $buildDir 'SetupMeta.g.cs'
[IO.File]::WriteAllText($metaFile, $metaCs, [Text.UTF8Encoding]::new($false))

$stubExe = Join-Path $buildDir 'SetupStub.exe'
$src = Join-Path $PSScriptRoot 'Setup.cs'

$cscArgs = @(
    '/nologo'
    '/target:winexe'
    '/platform:x64'
    '/optimize+'
    '/codepage:65001'
    '/r:System.Windows.Forms.dll'
    '/r:System.Drawing.dll'
    '/r:System.IO.Compression.dll'
    '/r:System.IO.Compression.FileSystem.dll'
    '/r:System.Web.Extensions.dll'
    "/out:$stubExe"
    $src
    $metaFile
)
if (Test-Path -LiteralPath $Icon) { $cscArgs = @('/win32icon:' + $Icon) + $cscArgs }

Write-Host "compiler: $csc"
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "Setup.cs compile failed ($LASTEXITCODE)" }

$outParent = Split-Path -Parent $OutExe
if ($outParent) { New-Item -ItemType Directory -Path $outParent -Force | Out-Null }
if (Test-Path -LiteralPath $OutExe) { Remove-Item -LiteralPath $OutExe -Force }

# Assemble SFX: [SetupStub.exe] + [PayloadZip] + [int64 offset][int64 length]["LVPACK01"]
$stubBytes = [IO.File]::ReadAllBytes($stubExe)
$zipLength = (Get-Item -LiteralPath $PayloadZip).Length
$offset = [int64]$stubBytes.Length

$outStream = [IO.File]::Create($OutExe)
try {
    $outStream.Write($stubBytes, 0, $stubBytes.Length)
    $zipStream = [IO.File]::OpenRead($PayloadZip)
    try {
        $zipStream.CopyTo($outStream)
    } finally {
        $zipStream.Dispose()
    }
    $offBytes = [BitConverter]::GetBytes([int64]$offset)
    $lenBytes = [BitConverter]::GetBytes([int64]$zipLength)
    $magicBytes = [Text.Encoding]::ASCII.GetBytes('LVPACK01')
    $outStream.Write($offBytes, 0, 8)
    $outStream.Write($lenBytes, 0, 8)
    $outStream.Write($magicBytes, 0, 8)
} finally {
    $outStream.Dispose()
}

$fi = Get-Item -LiteralPath $OutExe
Write-Host ("built installer {0}  ({1:N1} MB)" -f $OutExe, ($fi.Length / 1MB))
