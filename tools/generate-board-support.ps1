param(
    [string]$JdkHome = (Join-Path $PSScriptRoot '../../../jdk-25.0.4.1+1'),
    [string]$MinecraftCache = (Join-Path $env:USERPROFILE '.gradle/caches/fabric-loom/26.3'),
    [string]$DependencyCache = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'),
    [switch]$VerifyWire
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$outputDir = Join-Path $projectRoot 'tools/verify/board-support-output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$metadata = Get-Content -LiteralPath (Join-Path $MinecraftCache 'mojang_minecraft_info.json') -Raw | ConvertFrom-Json
if ($metadata.id -ne '26.3') { throw 'Support data must be generated with Minecraft Java 26.3.' }
$libraries = @((Join-Path $MinecraftCache 'minecraft-merged.jar'))
foreach ($library in $metadata.libraries) {
    $parts = $library.name.Split(':')
    if ($parts.Length -gt 3) { continue }
    $directory = Join-Path $DependencyCache ($parts[0]+'/'+$parts[1]+'/'+$parts[2])
    $jar = Get-ChildItem -LiteralPath $directory -Recurse -Filter '*.jar' -ErrorAction SilentlyContinue |
        Where-Object Name -eq ($parts[1]+'-'+$parts[2]+'.jar') | Select-Object -First 1
    if ($jar) { $libraries += $jar.FullName }
    elseif ($parts[0] -ne 'ca.weblite') { throw ('Missing local Minecraft dependency: '+$library.name) }
}
$classpath = $libraries -join ';'
Set-Content -LiteralPath (Join-Path $outputDir 'classpath.txt') -Value $classpath -NoNewline
& (Join-Path $JdkHome 'bin/javac.exe') -cp $classpath -d $outputDir (Join-Path $PSScriptRoot 'ExportBoardSupport.java')
if ($LASTEXITCODE -ne 0) { throw 'Support exporter compilation failed.' }
Push-Location $projectRoot
try {
    & (Join-Path $JdkHome 'bin/java.exe') -cp ($outputDir+';'+$classpath) ExportBoardSupport (Join-Path $projectRoot 'webapp/renderer/board-support-data.js')
    if ($LASTEXITCODE -ne 0) { throw 'Support exporter failed.' }
    if ($VerifyWire) {
        $wireOutput = Join-Path $projectRoot 'tools/verify/board-wire-output'
        New-Item -ItemType Directory -Force -Path $wireOutput | Out-Null
        & (Join-Path $JdkHome 'bin/javac.exe') -cp $classpath -d $outputDir (Join-Path $PSScriptRoot 'verify/VanillaWireReference.java')
        if ($LASTEXITCODE -ne 0) { throw 'Wire reference compilation failed.' }
        & (Join-Path $JdkHome 'bin/java.exe') -cp ($outputDir+';'+$classpath) VanillaWireReference (Join-Path $wireOutput 'vanilla-reference.json')
        if ($LASTEXITCODE -ne 0) { throw 'Wire reference export failed.' }
        & node (Join-Path $PSScriptRoot 'verify/board-wire-vanilla.cjs')
        if ($LASTEXITCODE -ne 0) { throw 'Wire reference comparison failed.' }
    }
} finally { Pop-Location }
