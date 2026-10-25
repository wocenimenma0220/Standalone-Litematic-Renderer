# 使用与方块物理导出相同的原版运行时生成流体数据。
param([string]$Classpath='',[string]$ReferenceRoot='', [string]$JdkHome='')
$ErrorActionPreference='Stop'
$fluidProject=Split-Path $PSScriptRoot -Parent
if(-not $Classpath){$Classpath=(Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'verify/board-support-output/classpath.txt')).Trim()}
if(-not $ReferenceRoot){$ReferenceRoot=[IO.Path]::GetFullPath((Join-Path $fluidProject '../../26.3-client-src'))}
if(-not $JdkHome){$JdkHome=@($env:JAVA_HOME)+@(Get-ChildItem (Join-Path $fluidProject '../..') -Directory -Filter 'jdk*' | Sort-Object Name -Descending | ForEach-Object FullName) | Where-Object {$_ -and (Test-Path (Join-Path $_ 'bin/javac.exe'))} | Select-Object -First 1}
if(-not $JdkHome){throw '请指定 JdkHome'}
$fluidOutput=Join-Path $PSScriptRoot 'verify/board-support-output'
New-Item -ItemType Directory -Force -Path $fluidOutput | Out-Null
& (Join-Path $JdkHome 'bin/javac.exe') -encoding UTF-8 -cp $Classpath -d $fluidOutput (Join-Path $PSScriptRoot 'verify/ExportBoardFluids.java')
if($LASTEXITCODE -ne 0){throw '流体数据导出器编译失败'}
& (Join-Path $JdkHome 'bin/java.exe') '-Dfile.encoding=UTF-8' -cp ($fluidOutput+';'+$Classpath) ExportBoardFluids (Join-Path $ReferenceRoot 'data/minecraft/tags/block') (Join-Path $fluidProject 'webapp/renderer/board-fluid-data.js')
if($LASTEXITCODE -ne 0){throw '流体数据导出失败'}
