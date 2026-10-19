param([Parameter(Mandatory=$true)][string]$Script,[string[]]$TestArguments=@(),[ValidateRange(10,900)][int]$TimeoutSeconds=180,[string]$ElectronExecutable='')
$ErrorActionPreference='Stop'
$testProject=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$launchInfo=[Diagnostics.ProcessStartInfo]::new()
$launchInfo.FileName=if ($ElectronExecutable) { [IO.Path]::GetFullPath($ElectronExecutable) } else { Join-Path $testProject 'webapp/node_modules/electron/dist/electron.exe' }
$launchInfo.WorkingDirectory=$testProject
$launchInfo.UseShellExecute=$false
$launchInfo.CreateNoWindow=$true
$launchInfo.RedirectStandardOutput=$true
$launchInfo.RedirectStandardError=$true
if ($launchInfo.PSObject.Properties['Environment'] -and $launchInfo.Environment) {
    $launchInfo.Environment.Remove('ELECTRON_RUN_AS_NODE') | Out-Null
} elseif ($launchInfo.PSObject.Properties['EnvironmentVariables'] -and $launchInfo.EnvironmentVariables) {
    $launchInfo.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
}
$scriptArg = [IO.Path]::GetFullPath((Join-Path $testProject $Script))
$allArgs = @($scriptArg) + $TestArguments
if ($launchInfo.PSObject.Properties['ArgumentList'] -and $launchInfo.ArgumentList) {
    foreach ($arg in $allArgs) { $launchInfo.ArgumentList.Add($arg) }
} else {
    $escapedArgs = $allArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"{0}"' -f ($_ -replace '(\\*)(")', '$1$1\"' -replace '(\\+)$', '$1$1') } else { $_ }
    }
    $launchInfo.Arguments = $escapedArgs -join ' '
}
$testProcess=[Diagnostics.Process]::new()
$testProcess.StartInfo=$launchInfo
if(-not $testProcess.Start()){throw 'Electron test did not start'}
$stdoutTask=$testProcess.StandardOutput.ReadToEndAsync()
$stderrTask=$testProcess.StandardError.ReadToEndAsync()
$watch=[Diagnostics.Stopwatch]::StartNew()
while(-not $testProcess.WaitForExit(1000)){
    if($watch.Elapsed.TotalSeconds -gt $TimeoutSeconds){$testProcess.Kill($true);throw 'Electron test timed out'}
}
$stdout = $stdoutTask.GetAwaiter().GetResult()
$stderr = $stderrTask.GetAwaiter().GetResult()
if ($stdout) { Write-Output $stdout }
if ($stderr) { [Console]::Error.WriteLine($stderr) }
if($testProcess.ExitCode -ne 0){throw "Electron test failed: $($testProcess.ExitCode)"}
