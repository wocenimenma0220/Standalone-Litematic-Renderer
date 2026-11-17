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

    // Copy real compiled 投影预览.exe from tools/launcher/bin (building if missing)
    const launcherSrc = path.join(repo, 'tools/launcher/bin/投影预览.exe');
    if (!fs.existsSync(launcherSrc)) {
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
    execFileSync(setupExe, ['--silent', '--dir', installedHome, '--no-shortcuts', '--no-assoc', '--no-launch'], { windowsHide: true });

    const distInfo = readDistribution(installedHome);
    assert.equal(distInfo.mode, 'installer');
    assert.equal(distInfo.canPatch, true);
    assert.equal(fs.existsSync(path.join(installedHome, '卸载投影预览.exe')), true);
    assert.equal(fs.existsSync(path.join(installedHome, 'install-manifest.json')), true);

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
    const backups = fs.readdirSync(path.join(installedHome, 'updates/backup'));
    assert.equal(backups.length, 1, 'Expected 1 rollback backup folder');

    // 5. Verify silent uninstall command runs cleanly
    execFileSync(path.join(installedHome, '卸载投影预览.exe'), ['--uninstall', '--silent'], {
      cwd: outputRoot,
      windowsHide: true,
    });

    console.log('PASS: 便携 ZIP 引导下载 + 安装版校验补丁 + 真实 Launcher 热替换与回滚备份 + 安装卸载全链路测试通过');
  } finally {
    server.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
