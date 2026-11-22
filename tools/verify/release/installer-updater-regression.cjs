'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '../../..');
const { AppUpdater, compareVersions, readDistribution } = require(path.join(repo, 'webapp/updater'));
const { releaseInfo } = require(path.join(repo, 'tools/version.cjs'));

const outputRoot = path.join(repo, 'tools/verify/verification-output', 'installer-updater-test');

function inspectReg(subKey, names) {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:R_KEY, $false)",
    'if (-not $k) { Write-Output "null"; exit 0 }',
    '$obj = [ordered]@{}',
    'try {',
    '  foreach ($n in ($env:R_NAMES | ConvertFrom-Json)) {',
    '    $propName = if ([string]$n -eq "") { "__default__" } else { [string]$n }',
    '    $obj[$propName] = $k.GetValue([string]$n, $null)',
    '  }',
    '} finally { $k.Dispose() }',
    '$obj | ConvertTo-Json -Compress',
  ].join('\n');
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    env: { ...process.env, R_KEY: subKey, R_NAMES: JSON.stringify(names) },
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!raw || raw === 'null') return null;
  const parsed = JSON.parse(raw);
  if (Object.prototype.hasOwnProperty.call(parsed, '__default__')) {
    parsed[''] = parsed.__default__;
    delete parsed.__default__;
  }
  return parsed;
}

function deleteRegTree(subKey) {
  if (!subKey || !subKey.startsWith('Software\\LiteKindaTest\\')) return;
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($env:R_KEY, $false)',
  ].join('\n');
  const testRegRoot = `Software\\LiteKindaTest\\Verify-${process.pid}-${Date.now()}`;
  const realUninstallSnap = inspectReg('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LiteKindaProjectionPreview', ['InstallLocation', 'DisplayVersion']);
  const realAssocSnap = inspectReg('Software\\Classes\\.litematic', ['']);

  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
      env: { ...process.env, R_KEY: subKey },
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch { }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toLowerCase();
}

function createZipFromDir(srcDir, outZip) {
  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  if (fs.existsSync(outZip)) fs.rmSync(outZip, { force: true });
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '[IO.Compression.ZipFile]::CreateFromDirectory($env:Z_SRC, $env:Z_OUT, [IO.Compression.CompressionLevel]::Fastest, $false)',
  ].join('\n');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], {
    env: { ...process.env, Z_SRC: srcDir, Z_OUT: outZip },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function buildDummyExe(outExe) {
  const csc = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
    path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET/Framework/v4.0.30319/csc.exe'),
  ].find(p => fs.existsSync(p));
  if (!csc) throw Error('csc.exe not found');
  const cs = outExe + '.cs';
  fs.writeFileSync(cs, 'class Dummy { static int Main() { return 0; } }\n');
  execFileSync(csc, ['/nologo', '/target:winexe', '/platform:x64', '/out:' + outExe, cs], { windowsHide: true });
  fs.rmSync(cs, { force: true });
}

async function run() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  // 1. SemVer comparison checks (including 4-segment hotfix versions like 1.3.1.1)
  assert.equal(compareVersions('1.3.1.1', '1.3.1'), 1);
  assert.equal(compareVersions('1.3.2', '1.3.1.1'), 1);
  assert.equal(compareVersions('1.3.1', '1.3.0'), 1);
  assert.equal(compareVersions('v1.3.0', '1.3.0'), 0);
  assert.equal(compareVersions('1.3.0', '1.3.0-beta-v2'), 1);
  assert.equal(compareVersions('1.3.0-beta-v2', '1.3.0-beta'), 1);
  assert.equal(compareVersions('1.2.9', '1.3.0'), -1);

  const rel = releaseInfo(repo);

  // Build valid patch content + malicious zip-slip zip
  const patchSrc = path.join(outputRoot, 'patch-src');
  fs.mkdirSync(path.join(patchSrc, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(patchSrc, 'webapp/renderer'), { recursive: true });
  fs.mkdirSync(path.join(patchSrc, 'assets/builtin'), { recursive: true });
  fs.writeFileSync(path.join(patchSrc, 'bin/new-engine.marker'), '9.9.0');
  fs.writeFileSync(path.join(patchSrc, 'webapp/package.json'), JSON.stringify({
    name: 'litematic-render-shell',
    version: '9.9.0',
    dependencies: { electron: '^44.7.0' },
  }));
  fs.writeFileSync(path.join(patchSrc, 'webapp/updater-patched.txt'), 'patched-ok');
  fs.writeFileSync(path.join(patchSrc, 'webapp/renderer/marker.js'), '// 9.9.0');
  fs.writeFileSync(path.join(patchSrc, 'assets/builtin/pack-tag.txt'), 'v9.9.0');

  const validPatchZip = path.join(outputRoot, 'server/Litematic-Viewer-9.9.0-win-x64-patch.zip');
  createZipFromDir(patchSrc, validPatchZip);
  const patchSha = sha256File(validPatchZip);
  const patchSize = fs.statSync(validPatchZip).size;

  // Create mock GitHub HTTP server
  let manifestPayload = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/latest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(manifestPayload));
      return;
    }
    if (req.url === '/patch.zip') {
      const data = fs.readFileSync(validPatchZip);
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': data.length });
      res.end(data);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testRegRoot = `Software\\LiteKindaTest\\Verify-${process.pid}-${Date.now()}`;
  const realUninstallSnap = inspectReg('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LiteKindaProjectionPreview', ['InstallLocation', 'DisplayVersion']);
  const realAssocSnap = inspectReg('Software\\Classes\\.litematic', ['']);

  try {
    manifestPayload = {
      version: '9.9.0',
      tag: 'v9.9.0',
      runtimeSignature: rel.runtimeSignature,
      releaseUrl: 'https://github.com/wocenimenma0220/Standalone-Litematic-Renderer/releases/tag/v9.9.0',
      notes: 'Test update 9.9.0',
      portable: { name: 'portable.zip', url: `${baseUrl}/portable.zip`, size: 1234, sha256: 'abc' },
      installer: { name: 'setup.exe', url: `${baseUrl}/setup.exe`, size: 5678, sha256: 'def' },
      patch: { name: 'patch.zip', url: `${baseUrl}/patch.zip`, size: patchSize, sha256: patchSha },
    };

    // 2. Track 1: Portable ZIP edition must NEVER apply patches, only guide download
    const portableHome = path.join(outputRoot, 'portable-home');
    fs.mkdirSync(path.join(portableHome, 'webapp'), { recursive: true });
    fs.writeFileSync(path.join(portableHome, 'webapp/package.json'), JSON.stringify({
      version: '1.3.0',
      dependencies: { electron: '^44.7.0' },
    }));
    const pUpdater = new AppUpdater({ home: portableHome });
    const pCheck = await pUpdater.check({ manifestUrl: `${baseUrl}/latest.json` });
    assert.equal(pCheck.distribution, 'portable');
    assert.equal(pCheck.canPatch, false);
    assert.equal(pCheck.hasUpdate, true);
    assert.equal(pCheck.updateKind, 'guide-download');
    await assert.rejects(() => pUpdater.downloadAndStagePatch(), /便携 ZIP 版/);

    // 3. Track 2: Build mini SFX Installer + install + corrupt hash rejection + valid patch + real Launcher apply
    const miniStage = path.join(outputRoot, 'mini-stage');
    fs.mkdirSync(path.join(miniStage, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(miniStage, 'webapp/renderer'), { recursive: true });
    fs.mkdirSync(path.join(miniStage, 'webapp/node_modules/electron/dist'), { recursive: true });
    fs.mkdirSync(path.join(miniStage, 'assets/vanilla'), { recursive: true });
    fs.writeFileSync(path.join(miniStage, 'bin/old-engine.marker'), '1.3.0');
    fs.writeFileSync(path.join(miniStage, 'assets/vanilla/keep.txt'), 'vanilla-untouched');
    fs.writeFileSync(path.join(miniStage, 'webapp/package.json'), JSON.stringify({
      version: rel.version,
      dependencies: { electron: '^44.7.0' },
    }));
    fs.writeFileSync(path.join(miniStage, 'webapp/node_modules/keep-electron.txt'), 'electron-untouched');
    buildDummyExe(path.join(miniStage, 'webapp/node_modules/electron/dist/electron.exe'));

    // Copy real compiled 投影预览.exe from tools/launcher/bin (building if missing or stale)
    const launcherCs = path.join(repo, 'tools/launcher/Launcher.cs');
    const launcherSrc = path.join(repo, 'tools/launcher/bin/投影预览.exe');
    if (!fs.existsSync(launcherSrc) || fs.statSync(launcherCs).mtimeMs > fs.statSync(launcherSrc).mtimeMs) {
      execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'tools/launcher/build-launcher.ps1'),
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    }
    assert.equal(fs.existsSync(launcherSrc), true, 'Missing built launcher exe: ' + launcherSrc);
    fs.copyFileSync(launcherSrc, path.join(miniStage, '投影预览.exe'));

    const miniPayloadZip = path.join(outputRoot, 'mini-payload.zip');
    createZipFromDir(miniStage, miniPayloadZip);

    const setupExe = path.join(outputRoot, 'mini-setup.exe');
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(repo, 'tools/installer/build-installer.ps1'),
      '-PayloadZip', miniPayloadZip, '-OutExe', setupExe,
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(fs.existsSync(setupExe), true);

    const installedHome = path.join(outputRoot, 'installed-app');
    execFileSync(setupExe, ['--silent', '--dir', installedHome, '--no-shortcuts', '--no-launch', '--reg-root', testRegRoot], { windowsHide: true });

    const distInfo = readDistribution(installedHome);
    assert.equal(distInfo.mode, 'installer');
    assert.equal(distInfo.canPatch, true);
    assert.equal(fs.existsSync(path.join(installedHome, '卸载投影预览.exe')), true);
    assert.equal(fs.existsSync(path.join(installedHome, 'install-manifest.json')), true);

    // Verify isolated registry uninstall & .litematic association entries were written cleanly
    const uReg1 = inspectReg(`${testRegRoot}\\Uninstall\\LiteKindaProjectionPreview`, ['DisplayName', 'DisplayVersion', 'InstallLocation', 'UninstallString', 'EstimatedSize']);
    assert(uReg1 && uReg1.DisplayName === '投影预览');
    assert.equal(uReg1.DisplayVersion, rel.display);
    assert.equal(uReg1.InstallLocation, installedHome);
    assert(uReg1.EstimatedSize >= 1);
    const extReg1 = inspectReg(`${testRegRoot}\\Classes\\.litematic`, ['']);
    assert.equal(extReg1?.[''], 'LiteKinda.ProjectionPreview');
    const progCmd1 = inspectReg(`${testRegRoot}\\Classes\\LiteKinda.ProjectionPreview\\shell\\open\\command`, ['']);
    assert(progCmd1?.['']?.includes(installedHome));
    const appCmd1 = inspectReg(`${testRegRoot}\\Classes\\Applications\\投影预览.exe\\shell\\open\\command`, ['']);
    assert(appCmd1?.['']?.includes(installedHome));
    const regApp1 = inspectReg(`${testRegRoot}\\RegisteredApplications`, ['LiteKindaProjectionPreview']);
    assert.equal(regApp1?.LiteKindaProjectionPreview, `${testRegRoot}\\LiteKinda\\ProjectionPreview\\Capabilities`);

    // Place user data to ensure patch preserves user files
    fs.mkdirSync(path.join(installedHome, 'settings'), { recursive: true });
    fs.writeFileSync(path.join(installedHome, 'settings/ui.json'), '{"userKeep":true}');

    // Test bad SHA-256 rejection
    const iUpdater = new AppUpdater({ home: installedHome });
    manifestPayload.patch.sha256 = '0'.repeat(64);
    await iUpdater.check({ manifestUrl: `${baseUrl}/latest.json` });
    await assert.rejects(() => iUpdater.downloadAndStagePatch(), /SHA-256 校验失败/);
    assert.equal(fs.existsSync(path.join(installedHome, 'updates/pending-update.json')), false);

    // Test runtime mismatch triggers full-installer instead of patch
    manifestPayload.patch.sha256 = patchSha;
    manifestPayload.runtimeSignature = 'electron-99.0.0-java-25';
    const mismatchCheck = await iUpdater.check({ manifestUrl: `${baseUrl}/latest.json` });
    assert.equal(mismatchCheck.updateKind, 'full-installer');

    // Valid runtime signature -> stage patch
    manifestPayload.runtimeSignature = rel.runtimeSignature;
    const validCheck = await iUpdater.check({ manifestUrl: `${baseUrl}/latest.json` });
    assert.equal(validCheck.updateKind, 'patch');
    const staged = await iUpdater.downloadAndStagePatch();
    assert.equal(staged.status, 'staged');
    assert.equal(fs.existsSync(path.join(installedHome, 'updates/pending-update.json')), true);

    // 4. Execute REAL compiled 投影预览.exe --apply-update to apply patch & launch dummy electron.exe cleanly
    execFileSync(path.join(installedHome, '投影预览.exe'), ['--apply-update'], {
      cwd: installedHome,
      windowsHide: true,
    });

    // Verify patch applied, old bin removed, node_modules + vanilla + settings preserved, backup created, manifest updated
    assert.equal(fs.existsSync(path.join(installedHome, 'updates/pending-update.json')), false, 'pending marker should be cleaned');
    assert.equal(fs.existsSync(path.join(installedHome, 'bin/new-engine.marker')), true, 'new bin file missing');
    assert.equal(fs.existsSync(path.join(installedHome, 'bin/old-engine.marker')), false, 'stale bin file should be removed');
    assert.equal(fs.readFileSync(path.join(installedHome, 'webapp/updater-patched.txt'), 'utf8'), 'patched-ok');
    assert.equal(fs.readFileSync(path.join(installedHome, 'webapp/node_modules/keep-electron.txt'), 'utf8'), 'electron-untouched');
    assert.equal(fs.readFileSync(path.join(installedHome, 'assets/vanilla/keep.txt'), 'utf8'), 'vanilla-untouched');
    assert.equal(fs.readFileSync(path.join(installedHome, 'settings/ui.json'), 'utf8'), '{"userKeep":true}');
    const updatedManifest = JSON.parse(fs.readFileSync(path.join(installedHome, 'install-manifest.json'), 'utf8'));
    assert.equal(updatedManifest.installedVersion, '9.9.0');
    assert.equal(updatedManifest.displayVersion, '9.9.0');
    const backups = fs.readdirSync(path.join(installedHome, 'updates/backup'));
    assert.equal(backups.length, 1, 'Expected 1 rollback backup folder');

    // 5. Verify second install (Chinese directory) + ownership-protected uninstall + --repair + clean uninstall
    const cnHome = path.join(outputRoot, '中文目录安装', '投影预览');
    execFileSync(setupExe, ['--silent', '--dir', cnHome, '--no-shortcuts', '--no-launch', '--reg-root', testRegRoot], { windowsHide: true });

    // Uninstalling installedHome must NOT delete cnHome's active registry entries or .litematic association
    execFileSync(path.join(installedHome, '卸载投影预览.exe'), ['--uninstall', '--silent', '--reg-root', testRegRoot], {
      cwd: outputRoot,
      windowsHide: true,
    });
    const uRegAfterFirstUninstall = inspectReg(`${testRegRoot}\\Uninstall\\LiteKindaProjectionPreview`, ['InstallLocation', 'DisplayVersion']);
    assert.equal(uRegAfterFirstUninstall?.InstallLocation, cnHome, 'Uninstalling old dir must not delete active InstallLocation');
    const extAfterFirstUninstall = inspectReg(`${testRegRoot}\\Classes\\.litematic`, ['']);
    assert.equal(extAfterFirstUninstall?.[''], 'LiteKinda.ProjectionPreview', 'Uninstalling old dir must not clear active .litematic association');

    // Simulate missing Uninstall entry and verify --repair restores it with install-manifest version
    deleteRegTree(`${testRegRoot}\\Uninstall`);
    assert.equal(inspectReg(`${testRegRoot}\\Uninstall\\LiteKindaProjectionPreview`, ['InstallLocation']), null);
    execFileSync(path.join(cnHome, '卸载投影预览.exe'), ['--repair', '--silent', '--no-shortcuts', '--reg-root', testRegRoot], {
      cwd: outputRoot,
      windowsHide: true,
    });
    const repairedReg = inspectReg(`${testRegRoot}\\Uninstall\\LiteKindaProjectionPreview`, ['InstallLocation', 'DisplayVersion']);
    assert.equal(repairedReg?.InstallLocation, cnHome);
    assert.equal(repairedReg?.DisplayVersion, rel.display);

    // Uninstalling owning cnHome MUST cleanly remove isolated registry & association entries
    execFileSync(path.join(cnHome, '卸载投影预览.exe'), ['--uninstall', '--silent', '--reg-root', testRegRoot], {
      cwd: outputRoot,
      windowsHide: true,
    });
    assert.equal(inspectReg(`${testRegRoot}\\Uninstall\\LiteKindaProjectionPreview`, ['InstallLocation']), null);
    assert.equal(inspectReg(`${testRegRoot}\\Classes\\LiteKinda.ProjectionPreview`, ['']), null);
    assert.equal(inspectReg(`${testRegRoot}\\Classes\\.litematic`, [''])?.[''], null);
    assert.equal(inspectReg(`${testRegRoot}\\RegisteredApplications`, ['LiteKindaProjectionPreview'])?.LiteKindaProjectionPreview, null);

    // Assert host system HKCU registry was never modified by the test run
    assert.deepEqual(inspectReg('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LiteKindaProjectionPreview', ['InstallLocation', 'DisplayVersion']), realUninstallSnap);
    assert.deepEqual(inspectReg('Software\\Classes\\.litematic', ['']), realAssocSnap);

    console.log('PASS: 便携 ZIP 引导下载 + 安装版校验补丁 + 真实 Launcher 热替换 + 多目录归属保护/修复/中文安装与卸载回归测试通过');
  } finally {
    deleteRegTree(testRegRoot);
    server.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
