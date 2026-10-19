$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')
$outputDir = Join-Path $PSScriptRoot 'board-devices-output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$classpath = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'board-support-output/classpath.txt')
$jdk = Join-Path $projectRoot '../../jdk-25.0.4.1+1/bin'
& (Join-Path $jdk 'javac.exe') -cp $classpath -d $outputDir (Join-Path $PSScriptRoot 'VanillaDeviceReference.java')
if ($LASTEXITCODE -ne 0) { throw 'Device reference compilation failed.' }
& (Join-Path $jdk 'java.exe') -cp ($outputDir+';'+$classpath) VanillaDeviceReference (Join-Path $outputDir 'vanilla-reference.json')
if ($LASTEXITCODE -ne 0) { throw 'Device reference generation failed.' }
& node (Join-Path $PSScriptRoot 'board-devices-vanilla.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Device reference comparison failed.' }
