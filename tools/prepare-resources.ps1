# 从用户指定的本地 Java 客户端准备资源；不需要复制旧版便携包。
param([Parameter(Mandatory=$true)][string]$ClientJar)
$ErrorActionPreference='Stop'
$resourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets'))
$archivePath=(Resolve-Path -LiteralPath $ClientJar).Path
if(-not(Test-Path -LiteralPath $archivePath -PathType Leaf)){throw '请选择 Minecraft Java 客户端 JAR'}
New-Item -ItemType Directory -Force -Path $resourceRoot | Out-Null
$target=Join-Path $resourceRoot 'vanilla'
$stage=Join-Path $resourceRoot ('.vanilla-import-'+[guid]::NewGuid().ToString('N'))
$backup=Join-Path $resourceRoot ('.vanilla-backup-'+[guid]::NewGuid().ToString('N'))
function Assert-ResourcePath([string]$Path){
    $resolved=[IO.Path]::GetFullPath($Path)
    if(-not $resolved.StartsWith($resourceRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '资源目录超出项目范围'}
    if((Test-Path -LiteralPath $resolved) -and ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '资源目录不能是链接'}
}
foreach($directory in @($target,$stage,$backup)){Assert-ResourcePath $directory}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($archivePath)
$installed=$false
try{
    $entries=@($archive.Entries | Where-Object {$_.FullName.StartsWith('assets/minecraft/',[StringComparison]::Ordinal) -and -not $_.FullName.EndsWith('/')})
    $total=($entries | Measure-Object Length -Sum).Sum
    if($entries.Count -eq 0 -or $entries.Count -gt 50000 -or $total -gt 512MB){throw '客户端资源为空或超过导入预算'}
    New-Item -ItemType Directory -Path $stage | Out-Null
    foreach($entry in $entries){
        if($entry.FullName.Contains('\') -or $entry.FullName.Contains(':') -or ($entry.FullName.Split('/') | Where-Object {$_ -in @('..','.','')}) -or $entry.Length -gt 64MB){throw '客户端资源路径或大小无效'}
        $destination=[IO.Path]::GetFullPath((Join-Path $stage $entry.FullName))
        if(-not $destination.StartsWith($stage+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '资源条目超出目录'}
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
    }
    foreach($part in @('blockstates','models','textures')){if(-not(Test-Path -LiteralPath (Join-Path $stage "assets/minecraft/$part"))){throw "客户端缺少 $part 资源"}}
    if(Test-Path -LiteralPath $target){Assert-ResourcePath $target;Assert-ResourcePath $backup;Move-Item -LiteralPath $target -Destination $backup}
    try{Assert-ResourcePath $stage;Assert-ResourcePath $target;Move-Item -LiteralPath $stage -Destination $target;$installed=$true}
    catch{if(Test-Path -LiteralPath $backup){Assert-ResourcePath $backup;Assert-ResourcePath $target;Move-Item -LiteralPath $backup -Destination $target};throw}
    Write-Output "已准备 $($entries.Count) 个客户端资源：$target"
}finally{
    $archive.Dispose()
    if(Test-Path -LiteralPath $stage){Assert-ResourcePath $stage;Remove-Item -LiteralPath $stage -Recurse -Force}
    if($installed -and (Test-Path -LiteralPath $backup)){Assert-ResourcePath $backup;Remove-Item -LiteralPath $backup -Recurse -Force}
}
