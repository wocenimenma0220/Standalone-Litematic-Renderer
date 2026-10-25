# 默认执行无需资源包的快速检查；Full 增加独立目录中的引擎回归，Ui 增加界面回归。
param(
    [ValidateSet('Fast','Full')][string]$Profile='Fast',
    [switch]$Ui,
    [string]$Schematic='',
    [string]$JdkHome='',
    [ValidateRange(64,4096)][int]$Size=900
)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if ($JdkHome) {
    if (-not (Test-Path -LiteralPath (Join-Path $JdkHome 'bin/javac.exe'))) { throw '指定的 JDK 缺少 javac.exe' }
} else {
    $jdkCandidates=@($env:JAVA_HOME)+@(Get-ChildItem (Join-Path $PSScriptRoot '../..') -Directory -Filter 'jdk*' | Sort-Object Name -Descending | ForEach-Object FullName)
    $JdkHome=$jdkCandidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin/javac.exe')) } | Select-Object -First 1
    if (-not $JdkHome) { throw '未找到 JDK，请传入 -JdkHome' }
}
$node=if(Test-Path -LiteralPath 'tools/node/node.exe'){(Resolve-Path 'tools/node/node.exe').Path}else{(Get-Command node -ErrorAction Stop).Source}
$javac=Join-Path $JdkHome 'bin/javac.exe'
$java=Join-Path $JdkHome 'bin/java.exe'
$output=Join-Path $PSScriptRoot 'tools/verify/verification-output'
$classes=Join-Path $output 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null

function Invoke-Check {
    param([string]$Name,[string]$Executable,[string[]]$Arguments)
    $result=& $Executable @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { $result | Write-Output; throw "检查失败：$Name" }
    Write-Output "通过：$Name"
    $result | Select-Object -Last 2 | Write-Output
}

$checks=@('board-regression','board-timing-regression','board-components-regression','board-wire-regression','board-devices-regression','board-piston-regression','board-entities-regression','board-world-features-regression','board-tnt-regression','board-inventory-regression','board-support-regression','board-audio-regression','projection-edit-model','projection-edit-session','placement-inventory-model','editor-inventory-model','board-session-regression','background-exports','cache-cleanup-regression')
foreach($check in $checks){Invoke-Check -Name $check -Executable $node -Arguments @("tools/verify/$check.cjs")}
$sources=@(Get-ChildItem src -Recurse -Filter '*.java' | ForEach-Object FullName)
$javaChecks=@('PreviewCheckpointRegression')
if($Profile -eq 'Full'){$javaChecks+=@('ProjectionEditRegression','PlacementInventoryRegression','PistonEditRegression','EditPreviewBudgetRegression')}
$testSources=@($javaChecks | ForEach-Object {Join-Path $PSScriptRoot "tools/verify/$_.java"})
Invoke-Check -Name 'Java 编译' -Executable $javac -Arguments (@('--release','21','-encoding','UTF-8','-nowarn','-d',$classes)+$sources+$testSources)
Invoke-Check -Name '预览检查点' -Executable $java -Arguments @('-Dstdout.encoding=UTF-8','-cp',$classes,'PreviewCheckpointRegression',$output)

if($Profile -eq 'Full'){
    if(-not(Test-Path 'assets/vanilla')){throw '完整验证需要 assets/vanilla 和 assets/builtin 资源'}
    $sandbox=[IO.Path]::GetFullPath((Join-Path $output 'engine-home'))
    if(-not $sandbox.StartsWith([IO.Path]::GetFullPath($output)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '验证目录超出允许范围'}
    if(Test-Path -LiteralPath $sandbox){Remove-Item -LiteralPath $sandbox -Recurse -Force}
    New-Item -ItemType Directory -Path $sandbox | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'assets') -Destination $sandbox -Recurse
    foreach($check in $javaChecks | Select-Object -Skip 1){Invoke-Check -Name $check -Executable $java -Arguments @('-Dstdout.encoding=UTF-8','-Xmx2g',"-Dlitematicrender.home=$sandbox",'-Dlitematicrender.skins.offline=true','-cp',$classes,$check,$sandbox)}
}
if($Ui){foreach($check in @('board-loading-ui','board-unified-ui','board-entities-ui','board-tnt-ui')){Invoke-Check -Name $check -Executable $node -Arguments @("tools/verify/$check.cjs")}}
if($Schematic){
    $file=(Resolve-Path -LiteralPath $Schematic).Path
    foreach($rotation in @(45,135,225,315)){
        $image=Join-Path $output "rotation-$rotation.png"
        if(Test-Path -LiteralPath $image){Remove-Item -LiteralPath $image -Force}
        Invoke-Check -Name "图片导出 $rotation 度" -Executable $java -Arguments @('-Dstdout.encoding=UTF-8','-Xmx2g',"-Dlitematicrender.home=$PSScriptRoot",'-cp',$classes,'io.github.litematicrender.Main','--render',$file,$image,"$Size","$Size","$rotation",'30')
        if(-not(Test-Path -LiteralPath $image)){throw '导出未生成图片'}
    }
    $hashes=@(Get-ChildItem -LiteralPath $output -Filter 'rotation-*.png' | Get-FileHash | Select-Object -ExpandProperty Hash -Unique)
    if($hashes.Count -ne 4){throw '不同角度的图片内容重复'}
}
Write-Output '检查完成。'
