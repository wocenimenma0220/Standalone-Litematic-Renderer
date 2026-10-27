$ErrorActionPreference='Stop'
$output=Join-Path $PSScriptRoot 'verification-output'
$fixture=Join-Path $output ('resource-import-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'tools') | Out-Null
$importer=Join-Path $fixture 'tools/prepare-resources.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../prepare-resources.ps1') -Destination $importer
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Client([string]$Name,[hashtable]$Entries){
    $file=Join-Path $fixture $Name
    $archive=[IO.Compression.ZipFile]::Open($file,[IO.Compression.ZipArchiveMode]::Create)
    try{foreach($key in $Entries.Keys){$entry=$archive.CreateEntry($key);$writer=[IO.StreamWriter]::new($entry.Open());try{$writer.Write($Entries[$key])}finally{$writer.Dispose()}}}finally{$archive.Dispose()}
    return $file
}
$valid=@{'assets/minecraft/blockstates/stone.json'='{}';'assets/minecraft/models/block/stone.json'='{}';'assets/minecraft/textures/block/stone.png'='fixture';'net/minecraft/Unused.class'='not a resource'}
$client=Client 'valid.jar' $valid
& $importer -ClientJar $client | Out-Null
$marker=Join-Path $fixture 'assets/vanilla/assets/minecraft/blockstates/stone.json'
if(-not(Test-Path -LiteralPath $marker) -or (Test-Path (Join-Path $fixture 'assets/vanilla/net'))){throw '资源筛选失败'}
foreach($entries in @(@{'assets/minecraft/blockstates/stone.json'='missing textures'},@{'assets/minecraft/../../escape.txt'='invalid'})){
    $bad=Client ('invalid-'+[guid]::NewGuid().ToString('N')+'.jar') $entries
    $rejected=$false;try{& $importer -ClientJar $bad | Out-Null}catch{$rejected=$true}
    if(-not $rejected -or [IO.File]::ReadAllText($marker) -ne '{}'){throw '无效客户端导入破坏已有资源'}
}
$valid['assets/minecraft/blockstates/stone.json']='{"updated":true}'
& $importer -ClientJar (Client 'updated.jar' $valid) | Out-Null
if([IO.File]::ReadAllText($marker) -ne '{"updated":true}'){throw '资源替换失败'}
if(Get-ChildItem (Join-Path $fixture 'assets') -Directory -Force | Where-Object Name -like '.vanilla-*'){throw '资源导入遗留临时目录'}
Write-Output 'PASS: 本地客户端资源筛选、完整性检查、路径越界拒绝、失败保留旧资源和事务替换'
