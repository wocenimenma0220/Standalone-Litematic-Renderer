param([switch]$WithEntitySprites)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$outputDir = Join-Path $PSScriptRoot 'verify/board-support-output'
$classpath = Get-Content -Raw -LiteralPath (Join-Path $outputDir 'classpath.txt')
$jdk = Join-Path $projectRoot '../../jdk-25.0.4.1+1/bin'
$sources = @('ExportBoardPhysics', 'ExportBoardItems')
foreach ($source in $sources) {
    & (Join-Path $jdk 'javac.exe') -cp $classpath -d $outputDir (Join-Path $PSScriptRoot "verify/$source.java")
    if ($LASTEXITCODE -ne 0) { throw "$source compilation failed" }
}
& (Join-Path $jdk 'java.exe') -Xmx2G -cp ($outputDir+';'+$classpath) ExportBoardPhysics (Join-Path $projectRoot 'webapp/renderer/board-physics-data.js') (Join-Path $projectRoot '../../26.3-client-src/data/minecraft/tags/block')
if ($LASTEXITCODE -ne 0) { throw 'Physics export failed' }
& (Join-Path $jdk 'java.exe') -Xmx2G -cp ($outputDir+';'+$classpath) ExportBoardItems (Join-Path $projectRoot 'webapp/renderer/board-item-data.js')
if ($LASTEXITCODE -ne 0) { throw 'Item export failed' }
if ($WithEntitySprites) {
    & (Join-Path $jdk 'javac.exe') -cp (Join-Path $projectRoot 'bin') -d $outputDir (Join-Path $PSScriptRoot 'verify/ExportBoardEntities.java')
    if ($LASTEXITCODE -ne 0) { throw 'Entity sprite exporter compilation failed' }
    & (Join-Path $jdk 'java.exe') -Xmx2G -cp ((Join-Path $projectRoot 'bin')+';'+$outputDir) ExportBoardEntities $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Entity sprite export failed' }
}
