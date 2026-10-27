# 构建包含运行时的 Windows 便携包。
# 输出目录和 ZIP 位于 dist，解压后无需另装 Java 或 Node.js。
#   投影预览.exe     <- double-click this

param(
    [string]$JdkHome = "",
    [string]$ProjectRoot = $PSScriptRoot,
    [switch]$SkipElectron,
    [switch]$ReuseRuntime,
    # 即使源码目录的旧 EXE 正被占用，也为分发包构建新启动器。
    [switch]$SkipRootLauncherCopy,
    [ValidatePattern('^[\p{L}\p{N}_-]+$')]
    [string]$PackageName = '投影预览',
    [ValidatePattern('^\d+\.\d+\.\d+(\.\d+)?(-?[A-Za-z][A-Za-z0-9.-]*)?$')]
    [string]$Version = '',
    [string]$ZipName = '',
    [string]$ClientJar = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
Set-Location $ProjectRoot
$versionNode=if(Test-Path -LiteralPath 'tools/node/node.exe'){(Resolve-Path 'tools/node/node.exe').Path}else{(Get-Command node -ErrorAction Stop).Source}
$versionJson=& $versionNode tools/version.cjs --json
if($LASTEXITCODE -ne 0){throw '版本不同步，请先运行 node tools/version.cjs --write'}
$versionInfo=$versionJson | ConvertFrom-Json
if($Version -and $Version -ne $versionInfo.display){throw '请在 webapp/package.json 修改版本并运行 node tools/version.cjs --write'}
$Version=$versionInfo.display
if(-not $ZipName){$ZipName=$versionInfo.zipName}
if($ClientJar){& ./tools/prepare-resources.ps1 -ClientJar $ClientJar}
if(-not(Test-Path 'assets/vanilla/assets/minecraft/blockstates')){throw '缺少游戏资源；可传入 -ClientJar 指定本地 Minecraft Java 客户端 JAR'}

function Remove-BuildDirectory {
    param([string]$Path)
    $target = [IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($ProjectRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $target"
    }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}

$distRoot  = Join-Path $ProjectRoot 'dist'
$stageDir  = Join-Path $distRoot $PackageName
$webapp    = Join-Path $ProjectRoot 'webapp'

# 查找同时具备编译器和链接器的 JDK。
# 较新的 JDK 可直接使用 lib/modules 构建精简运行时，不一定含有 jmods 目录。

function Find-Jdk {
    param([string]$Explicit)
    # 参数名不能使用只读的 $HOME，否则 PowerShell 会在绑定参数时失败。

    $usable = {
        param($jdkDir)
        $jdkDir -and
        (Test-Path (Join-Path $jdkDir 'bin/javac.exe')) -and
        ($ReuseRuntime -or ((Test-Path (Join-Path $jdkDir 'bin/jlink.exe')) -and
          ((Test-Path (Join-Path $jdkDir 'jmods')) -or (Test-Path (Join-Path $jdkDir 'lib/modules')))))
    }
    if (& $usable $Explicit) { return $Explicit }
    # 优先使用工作区自带 JDK，避免系统 JAVA_HOME 误指向 Minecraft 的 JRE。

    $beside = Get-ChildItem (Join-Path $ProjectRoot '..\..') -Directory -Filter 'jdk*' -ErrorAction SilentlyContinue |
              Sort-Object Name -Descending
    foreach ($d in $beside) {
        if (& $usable $d.FullName) { return $d.FullName }
    }
    if (& $usable $env:JAVA_HOME) { return $env:JAVA_HOME }
    if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin/javac.exe'))) {
        throw "JAVA_HOME ($env:JAVA_HOME) cannot build a runtime. Pass -JdkHome <linkable JDK>."
    }
    throw "No linkable JDK found. Pass -JdkHome <path to a full JDK>."
}

$jdk   = Find-Jdk -Explicit $JdkHome
$javac = Join-Path $jdk 'bin/javac.exe'
$jlink = Join-Path $jdk 'bin/jlink.exe'
Write-Host "JDK: $jdk"


Write-Host "`n[1/7] Compiling the render engine..."
$binDir = Join-Path $ProjectRoot 'bin'
Remove-BuildDirectory $binDir
New-Item -ItemType Directory -Path $binDir | Out-Null
$sources = Get-ChildItem (Join-Path $ProjectRoot 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
Write-Host "      $($sources.Count) source files"
& $javac --release 21 -encoding UTF-8 -nowarn -d $binDir $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }


Write-Host "`n[2/7] Building the root launcher (投影预览.exe)..."
$launcherDir = Join-Path $ProjectRoot 'tools\launcher'
$launcherExe = Join-Path $launcherDir 'bin\投影预览.exe'
# 在同一 PowerShell 进程构建启动器，无需另启脚本宿主。

& (Join-Path $launcherDir 'build-launcher.ps1') -OutDir (Join-Path $launcherDir 'bin') | Out-Host
if (-not (Test-Path $launcherExe)) { throw "launcher build produced no exe" }
if (-not $SkipRootLauncherCopy) {
    Copy-Item -LiteralPath $launcherExe -Destination (Join-Path $ProjectRoot '投影预览.exe') -Force
}


Write-Host "`n[3/7] Building the trimmed Java runtime (jlink)..."
$bundledRuntime = Join-Path $ProjectRoot 'runtime'
if ($ReuseRuntime) {
    $runtimeJava = Join-Path $bundledRuntime 'bin/java.exe'
    if (-not (Test-Path -LiteralPath $runtimeJava)) { throw 'No bundled runtime to reuse' }
    $modules = & $runtimeJava --list-modules
    $runtimeExit = $LASTEXITCODE
    $baseModule = $modules | Where-Object { $_ -match '^java.base@' } | Select-Object -First 1
    $runtimeMajor = if ($baseModule) { [int]($baseModule -replace '^java.base@([0-9]+).*$', '$1') } else { 0 }
    if ($runtimeExit -ne 0 -or $runtimeMajor -lt 21 -or -not ($modules -match '^java.desktop@') -or
        -not ($modules -match '^jdk.crypto.ec@')) {
        throw 'Bundled runtime must provide Java 21 or newer, with java.desktop and jdk.crypto.ec for HTTPS skins'
    }
    Write-Host "      Reusing validated bundled Java $runtimeMajor runtime"
} else {
    Remove-BuildDirectory $bundledRuntime
    & $jlink --add-modules java.base,java.desktop,jdk.crypto.ec --strip-debug --no-header-files --no-man-pages `
             --compress=zip-9 --output $bundledRuntime
    if ($LASTEXITCODE -ne 0) { throw "jlink failed" }
}


Write-Host "`n[4/7] Staging the package..."
Remove-BuildDirectory $stageDir
New-Item -ItemType Directory -Path $stageDir | Out-Null

foreach ($item in @('bin', 'runtime', 'assets')) {
    $src = Join-Path $ProjectRoot $item
    if (-not (Test-Path $src)) { throw "missing $item" }
    Copy-Item $src -Destination $stageDir -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $stageDir 'renders') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageDir 'logs') -Force | Out-Null

Copy-Item $launcherExe -Destination $stageDir
if (Test-Path -LiteralPath (Join-Path $ProjectRoot 'README.md')) { Copy-Item -LiteralPath (Join-Path $ProjectRoot 'README.md') -Destination $stageDir }
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'docs') -Destination $stageDir -Recurse
# 将测试范围说明同时放在启动器旁，便于用户查看。
$scopeText = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'docs/二维微时序测试版说明.md'))
$scopeText = $scopeText.Replace('](examples/', '](docs/examples/').Replace('](DEVELOPMENT.md)', '](docs/DEVELOPMENT.md)').Replace('](二维TNT与流体实现.md)', '](docs/二维TNT与流体实现.md)')
[IO.File]::WriteAllText((Join-Path $stageDir '二维微时序测试版说明.md'), $scopeText, [Text.UTF8Encoding]::new($false))
$evaluationDocs = Join-Path $ProjectRoot '评估与测评'
if (Test-Path -LiteralPath $evaluationDocs) {
    Copy-Item -LiteralPath $evaluationDocs -Destination $stageDir -Recurse
}
# 公共皮肤纹理和资料缓存可以随包保留，以支持离线查看。
# 本地皮肤覆盖与联网偏好属于个人配置，不复制进分发包。
foreach ($part in @('textures', 'profiles')) {
    $cached = Join-Path $ProjectRoot ('skins/' + $part)
    if (Test-Path -LiteralPath $cached) {
        $stageSkins = Join-Path $stageDir 'skins'
        New-Item -ItemType Directory -Path $stageSkins -Force | Out-Null
        Copy-Item -LiteralPath $cached -Destination $stageSkins -Recurse
    }
}


Write-Host "`n[5/7] Copying the Electron shell..."
$stageWebapp = Join-Path $stageDir 'webapp'
New-Item -ItemType Directory -Path $stageWebapp | Out-Null
foreach ($f in @('main.js', 'preload.js', 'engine-client.js', 'background-exports.js', 'runtime.js', 'performance-policy.js', 'ui-settings.js', 'scene-transfer.js', 'cache-cleanup.js', 'schematic-formats.js', 'package.json', 'app.ico', 'icon.png')) {
    Copy-Item (Join-Path $webapp $f) -Destination $stageWebapp
}
Copy-Item (Join-Path $webapp 'renderer') -Destination $stageWebapp -Recurse

if (-not $SkipElectron) {
    $electronSrc = Join-Path $webapp 'node_modules/electron'
    if (-not (Test-Path -LiteralPath (Join-Path $electronSrc 'dist/electron.exe'))) { throw "Electron runtime not installed; run install.bat (needs network once)" }

    # 界面只需 Electron 二进制目录及模块元数据。
    $nmElectron = Join-Path $stageWebapp 'node_modules/electron'
    New-Item -ItemType Directory -Path $nmElectron -Force | Out-Null
    Copy-Item (Join-Path $electronSrc 'package.json') -Destination $nmElectron
    Copy-Item (Join-Path $electronSrc 'dist') -Destination $nmElectron -Recurse
}


Write-Host "`n[6/7] Pruning non-Windows and unused payloads..."
if (-not $SkipElectron) {
    $dist = Join-Path $stageWebapp 'node_modules/electron/dist'
    # 只保留需要的语言和平台文件。
    $locales = Join-Path $dist 'locales'
    if (Test-Path $locales) {
        Get-ChildItem $locales -Filter '*.pak' |
            Where-Object { $_.Name -notmatch '^(en-US|zh-CN|zh-TW)\.pak$' } |
            Remove-Item -Force
    }
}
# 引擎源码、开发脚本和诊断产物不进入便携包。
foreach ($junk in @('src', 'tools', 'packs', 'archive', '.dsh-acl-reports')) {
    $p = Join-Path $stageDir $junk
    Remove-BuildDirectory $p
}


Write-Host "`n[7/7] Package summary"
$files = Get-ChildItem $stageDir -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum
Write-Host ("      {0} files, {1:N1} MB" -f $files.Count, ($total / 1MB))
foreach ($part in @('bin', 'runtime', 'assets', 'webapp')) {
    $p = Join-Path $stageDir $part
    if (Test-Path $p) {
        $s = (Get-ChildItem $p -Recurse -File | Measure-Object Length -Sum).Sum
        Write-Host ("        {0,-8} {1,8:N1} MB" -f $part, ($s / 1MB))
    }
}
$exeInfo = Get-Item (Join-Path $stageDir '投影预览.exe')
Write-Host ("        {0,-8} {1,8:N1} MB  (sha256 {2})" -f 'exe', ($exeInfo.Length / 1MB),
    (Get-FileHash $exeInfo.FullName -Algorithm SHA256).Hash)

Write-Host "`nReady: $stageDir"
if (-not $SkipElectron) {
    $zipFileName = if ($ZipName) { if ($ZipName.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) { $ZipName } else { "$ZipName.zip" } } else { "$PackageName-$Version.zip" }
    $zipPath = Join-Path $distRoot $zipFileName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # ZIP 根目录直接放置启动器，不额外嵌套包装目录。
    $compression=if([Enum]::GetNames([IO.Compression.CompressionLevel]) -contains 'SmallestSize'){[IO.Compression.CompressionLevel]::SmallestSize}else{[IO.Compression.CompressionLevel]::Optimal}
    [IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $zipPath,$compression,$false)
    Write-Host "ZIP: $zipPath"
    $zipHash=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($zipPath+'.sha256',"$zipHash  $zipFileName`n",[Text.UTF8Encoding]::new($false))
    $changesPath=Join-Path $ProjectRoot 'docs/修复记录.md'
    $sums="$zipHash  $zipFileName`n"
    if(Test-Path -LiteralPath $changesPath){$changesHash=(Get-FileHash -LiteralPath $changesPath -Algorithm SHA256).Hash.ToLowerInvariant();$sums+="$changesHash  Changes.md`n"}
    [IO.File]::WriteAllText((Join-Path $distRoot "SHA256SUMS-$Version.txt"),$sums,[Text.UTF8Encoding]::new($false))
    Write-Host "SHA256: $zipHash"
}
