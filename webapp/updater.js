'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const DEFAULT_REPO = 'wocenimenma0220/Standalone-Litematic-Renderer';
const MANIFEST_FILE = 'install-manifest.json';
const PENDING_REL = path.join('updates', 'pending-update.json');

function getDefaultElectronNet() {
  try {
    const electron = require('electron');
    if (electron && electron.net && typeof electron.net.fetch === 'function') {
      return electron.net;
    }
  } catch { }
  return null;
}

function parseVersion(raw) {
  const s = String(raw || '').trim().replace(/^v/i, '');
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:[-.]?(.+))?$/);
  if (!m) return null;
  const core = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] || 0)];
  const pre = m[5] ? m[5].replace(/^test-v/i, 'test.').split(/[.-]/).filter(Boolean) : [];
  return { raw: s, core, pre };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return String(a || '').localeCompare(String(b || ''));
  for (let i = 0; i < 4; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const ix = Number(x);
      const iy = Number(y);
      if (ix !== iy) return ix > iy ? 1 : -1;
    } else if (nx !== ny) {
      return nx ? -1 : 1;
    } else if (x !== y) {
      return x.localeCompare(y) > 0 ? 1 : -1;
    }
  }
  return 0;
}

function readPackageMetadata(home) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(home, 'webapp', 'package.json'), 'utf8'));
    const electronVersion = String(pkg?.dependencies?.electron || '44.7.0').replace(/^[^0-9]*/, '') || '44.7.0';
    return {
      version: String(pkg?.version || '0.0.0'),
      productName: String(pkg?.productName || '投影预览'),
      runtimeSignature: `electron-${electronVersion}-java-21`,
    };
  } catch {
    return { version: '0.0.0', productName: '投影预览', runtimeSignature: 'electron-44.7.0-java-21' };
  }
}

function readDistribution(home) {
  const pkgMeta = readPackageMetadata(home);
  const manifestPath = path.join(home, MANIFEST_FILE);
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (raw && raw.distribution === 'installer') {
        const currentVersion = String(raw.installedVersion || pkgMeta.version);
        const runtimeSignature = String(raw.runtimeSignature || pkgMeta.runtimeSignature);
        return {
          mode: 'installer',
          canPatch: true,
          currentVersion,
          runtimeSignature,
          repo: typeof raw.repo === 'string' && raw.repo.includes('/') ? raw.repo : DEFAULT_REPO,
          manifest: raw,
        };
      }
    }
  } catch { }
  return {
    mode: 'portable',
    canPatch: false,
    currentVersion: pkgMeta.version,
    runtimeSignature: pkgMeta.runtimeSignature,
    repo: DEFAULT_REPO,
    manifest: null,
  };
}

function readPendingUpdate(home) {
  const file = path.join(home, PENDING_REL);
  try {
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && data.toVersion && data.payloadDir && fs.existsSync(data.payloadDir)) {
      return data;
    }
  } catch { }
  return null;
}

async function nodeHttpGet(url, { redirectsLeft = 6, timeoutMs = 20000, onProgress = null, destFile = null } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      reject(Error('仅支持 HTTP/HTTPS 下载链接'));
      return;
    }
    const mod = parsed.protocol === 'https:' ? https : require('node:http');
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Litematic-Viewer-Updater/1.0',
        Accept: 'application/json, application/octet-stream, */*',
      },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(Error('更新请求重定向次数过多'));
          return;
        }
        const nextUrl = new URL(res.headers.location, url).toString();
        nodeHttpGet(nextUrl, { redirectsLeft: redirectsLeft - 1, timeoutMs, onProgress, destFile })
          .then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(Error(`HTTP ${res.statusCode} ${res.statusMessage || ''}`.trim()));
        return;
      }
      const total = Number(res.headers['content-length'] || 0) || 0;
      if (destFile) {
        const hash = crypto.createHash('sha256');
        const ws = fs.createWriteStream(destFile);
        let received = 0;
        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          ws.destroy();
          res.destroy();
          reject(err);
        };
        res.on('data', (chunk) => {
          hash.update(chunk);
          received += chunk.length;
          if (onProgress) onProgress(received, total);
        });
        res.on('error', fail);
        ws.on('error', fail);
        ws.on('finish', () => {
          if (settled) return;
          settled = true;
          resolve({ bytes: received, sha256: hash.digest('hex').toLowerCase() });
        });
        res.pipe(ws);
      } else {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    });
    req.on('timeout', () => req.destroy(Error('网络请求超时')));
    req.on('error', reject);
  });
}

async function defaultFetchJson(url) {
  const net = getDefaultElectronNet();
  if (net) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await net.fetch(url, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'Litematic-Viewer-Updater/1.0',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  const text = await nodeHttpGet(url, { timeoutMs: 15000 });
  return JSON.parse(text);
}

async function defaultDownloadFile(url, destFile, onProgress) {
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  const part = destFile + '.part';
  await fsp.rm(part, { force: true }).catch(() => {});
  const net = getDefaultElectronNet();
  if (net) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await net.fetch(url, {
        headers: { 'User-Agent': 'Litematic-Viewer-Updater/1.0' },
        signal: controller.signal,
      });
      if (!res.ok) throw Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
      if (!res.body) throw Error('下载响应体为空');
      const total = Number(res.headers.get('content-length') || 0) || 0;
      const hash = crypto.createHash('sha256');
      const ws = fs.createWriteStream(part);
      let received = 0;
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const buf = Buffer.from(value);
          hash.update(buf);
          received += buf.length;
          if (!ws.write(buf)) {
            await new Promise(resolve => ws.once('drain', resolve));
          }
          if (onProgress) onProgress(received, total);
        }
        await new Promise((resolve, reject) => {
          ws.end(err => (err ? reject(err) : resolve()));
        });
      } catch (err) {
        ws.destroy();
        throw err;
      }
      await fsp.rename(part, destFile);
      return { bytes: received, sha256: hash.digest('hex').toLowerCase() };
    } catch (err) {
      await fsp.rm(part, { force: true }).catch(() => {});
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const out = await nodeHttpGet(url, { timeoutMs: 120000, onProgress, destFile: part });
    await fsp.rename(part, destFile);
    return out;
  } catch (err) {
    await fsp.rm(part, { force: true }).catch(() => {});
    throw err;
  }
}

function normalizeGitHubApiRelease(rel, repo) {
  const version = String(rel?.tag_name || '').replace(/^v/i, '');
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  const pick = re => assets.find(a => re.test(String(a?.name || '')));
  const patchAsset = pick(/-patch\.zip$/i);
  const setupAsset = pick(/-setup\.exe$/i);
  const zipAsset = assets.find(a => /\.zip$/i.test(String(a?.name || '')) && !/-patch\.zip$/i.test(String(a?.name || '')));
  return {
    version,
    tag: String(rel?.tag_name || `v${version}`),
    publishedAt: String(rel?.published_at || ''),
    releaseUrl: String(rel?.html_url || `https://github.com/${repo}/releases/latest`),
    notes: String(rel?.body || ''),
    runtimeSignature: '',
    portable: zipAsset ? { name: zipAsset.name, url: zipAsset.browser_download_url, size: Number(zipAsset.size) || 0, sha256: '' } : null,
    installer: setupAsset ? { name: setupAsset.name, url: setupAsset.browser_download_url, size: Number(setupAsset.size) || 0, sha256: '' } : null,
    patch: patchAsset ? { name: patchAsset.name, url: patchAsset.browser_download_url, size: Number(patchAsset.size) || 0, sha256: '' } : null,
  };
}

function normalizeLatestManifest(data, repo) {
  const version = String(data?.version || data?.tag || '').replace(/^v/i, '');
  return {
    version,
    tag: String(data?.tag || `v${version}`),
    publishedAt: String(data?.publishedAt || ''),
    releaseUrl: String(data?.releaseUrl || `https://github.com/${repo}/releases/latest`),
    notes: String(data?.notes || ''),
    runtimeSignature: String(data?.runtimeSignature || ''),
    portable: data?.portable || null,
    installer: data?.installer || null,
    patch: data?.patch || null,
  };
}

async function extractZipSafely(zipFile, destDir) {
  await fsp.rm(destDir, { recursive: true, force: true });
  await fsp.mkdir(destDir, { recursive: true });
  const psScript = [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$zipPath = $env:LITEMATIC_ZIP_SRC',
    '$destRoot = [IO.Path]::GetFullPath($env:LITEMATIC_ZIP_DST)',
    '$prefix = $destRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar',
    '$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)',
    'try {',
    '  foreach ($entry in $archive.Entries) {',
    '    if (-not $entry.FullName -or $entry.FullName.EndsWith("/") -or $entry.FullName.EndsWith("\\")) { continue }',
    '    $rel = $entry.FullName.Replace("/", [IO.Path]::DirectorySeparatorChar)',
    '    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destRoot, $rel))',
    '    if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw ("Unsafe zip entry: " + $entry.FullName) }',
    '    $parent = [IO.Path]::GetDirectoryName($target)',
    '    if (-not [IO.Directory]::Exists($parent)) { [IO.Directory]::CreateDirectory($parent) | Out-Null }',
    '    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)',
    '  }',
    '} finally { $archive.Dispose() }',
  ].join('\n');
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    env: { ...process.env, LITEMATIC_ZIP_SRC: zipFile, LITEMATIC_ZIP_DST: destDir },
    timeout: 60000,
  });
}

class AppUpdater {
  constructor({
    home,
    fetchJson = defaultFetchJson,
    downloadFile = defaultDownloadFile,
    extractZip = extractZipSafely,
    onStatus = () => {},
  }) {
    this.home = path.resolve(home);
    this.fetchJson = fetchJson;
    this.downloadFile = downloadFile;
    this.extractZip = extractZip;
    this.onStatus = onStatus;
    this.latest = null;
    this.busyPromise = null;
    this.lastState = this.snapshot({ status: 'idle' });
  }

  snapshot(extra = {}) {
    const dist = readDistribution(this.home);
    const pending = readPendingUpdate(this.home);
    const latest = extra.latest !== undefined ? extra.latest : this.latest;
    const hasUpdate = !!(latest && latest.version && compareVersions(latest.version, dist.currentVersion) > 0);
    let updateKind = 'none';
    if (hasUpdate) {
      if (dist.mode === 'portable') {
        updateKind = 'guide-download';
      } else {
        const sameRuntime = !latest.runtimeSignature || latest.runtimeSignature === dist.runtimeSignature;
        if (sameRuntime && latest.patch && latest.patch.url && latest.patch.sha256) {
          updateKind = 'patch';
        } else {
          updateKind = 'full-installer';
        }
      }
    }
    const status = pending
      ? 'staged'
      : (extra.status || 'idle');
    const state = {
      status,
      distribution: dist.mode,
      canPatch: dist.canPatch,
      currentVersion: dist.currentVersion,
      runtimeSignature: dist.runtimeSignature,
      repo: dist.repo,
      hasUpdate,
      updateKind,
      latest,
      pending,
      progress: extra.progress || null,
      installerFile: extra.installerFile || null,
      error: extra.error || null,
    };
    this.lastState = state;
    return state;
  }

  emit(extra) {
    const s = this.snapshot(extra);
    try { this.onStatus(s); } catch { }
    return s;
  }

  async check({ manifestUrl = null } = {}) {
    const dist = readDistribution(this.home);
    this.emit({ status: 'checking', error: null });
    const primary = manifestUrl || `https://github.com/${dist.repo}/releases/latest/download/latest.json`;
    let normalized = null;
    let primaryError = null;
    try {
      const json = await this.fetchJson(primary);
      normalized = normalizeLatestManifest(json, dist.repo);
    } catch (err) {
      primaryError = err;
    }
    if (!normalized || !normalized.version) {
      if (manifestUrl) {
        return this.emit({ status: 'error', latest: null, error: primaryError?.message || '更新清单格式无效' });
      }
      try {
        const apiRel = await this.fetchJson(`https://api.github.com/repos/${dist.repo}/releases/latest`);
        normalized = normalizeGitHubApiRelease(apiRel, dist.repo);
      } catch (apiErr) {
        return this.emit({
          status: 'error',
          latest: null,
          error: `检查更新失败：${primaryError?.message || apiErr?.message || '无法连接 GitHub'}`,
        });
      }
    }
    this.latest = normalized;
    const snap = this.snapshot();
    return this.emit({
      status: snap.pending ? 'staged' : (snap.hasUpdate ? 'available' : 'up-to-date'),
      latest: normalized,
      error: null,
    });
  }

  async downloadAndStagePatch() {
    if (this.busyPromise) return this.busyPromise;
    const run = async () => {
      const dist = readDistribution(this.home);
      if (dist.mode !== 'installer') {
        throw Error('当前为便携 ZIP 版，仅支持方式一（检测更新并引导下载）');
      }
      if (!this.latest || compareVersions(this.latest.version, dist.currentVersion) <= 0) {
        throw Error('当前已是最新版本，无需下载补丁');
      }
      const patch = this.latest.patch;
      if (!patch || !patch.url || !patch.sha256) {
        throw Error('新版本未提供增量补丁清单，请使用新版安装程序升级');
      }
      if (this.latest.runtimeSignature && this.latest.runtimeSignature !== dist.runtimeSignature) {
        throw Error('新版本升级了底层运行时环境，请下载新版安装程序覆盖安装');
      }

      const downloadsDir = path.join(this.home, 'updates', 'downloads');
      const stagingDir = path.join(this.home, 'updates', 'staging');
      const payloadDir = path.join(stagingDir, 'payload');
      const zipPath = path.join(downloadsDir, `patch-${this.latest.version}.zip`);

      this.emit({ status: 'downloading', progress: { received: 0, total: patch.size || 0, phase: 'downloading' } });
      const dl = await this.downloadFile(patch.url, zipPath, (received, total) => {
        this.emit({ status: 'downloading', progress: { received, total: total || patch.size || 0, phase: 'downloading' } });
      });

      const expectedHash = String(patch.sha256).trim().toLowerCase();
      if (dl.sha256 !== expectedHash) {
        await fsp.rm(zipPath, { force: true }).catch(() => {});
        throw Error(`补丁包 SHA-256 校验失败（期望 ${expectedHash.slice(0, 12)}…，实际 ${dl.sha256.slice(0, 12)}…）`);
      }

      this.emit({ status: 'downloading', progress: { received: dl.bytes, total: dl.bytes, phase: 'extracting' } });
      await fsp.rm(stagingDir, { recursive: true, force: true });
      await this.extractZip(zipPath, payloadDir);

      const hasBin = fs.existsSync(path.join(payloadDir, 'bin'));
      const hasWebapp = fs.existsSync(path.join(payloadDir, 'webapp'));
      if (!hasBin && !hasWebapp) {
        await fsp.rm(stagingDir, { recursive: true, force: true });
        throw Error('补丁包内容无效：缺少 webapp 或 bin 目录');
      }

      const pendingMeta = {
        fromVersion: dist.currentVersion,
        toVersion: this.latest.version,
        runtimeSignature: dist.runtimeSignature,
        payloadDir,
        zipPath,
        sha256: expectedHash,
        stagedAt: new Date().toISOString(),
      };
      const pendingFile = path.join(this.home, PENDING_REL);
      await fsp.mkdir(path.dirname(pendingFile), { recursive: true });
      await fsp.writeFile(pendingFile + '.tmp', JSON.stringify(pendingMeta, null, 2), 'utf8');
      await fsp.rename(pendingFile + '.tmp', pendingFile);
      return this.emit({ status: 'staged', progress: null, error: null });
    };
    this.busyPromise = run().catch((err) => {
      this.emit({ status: 'error', progress: null, error: err.message });
      throw err;
    }).finally(() => {
      this.busyPromise = null;
    });
    return this.busyPromise;
  }

  async downloadInstaller() {
    if (this.busyPromise) return this.busyPromise;
    const run = async () => {
      const dist = readDistribution(this.home);
      if (dist.mode !== 'installer') {
        throw Error('便携 ZIP 版不支持应用内安装器更新');
      }
      const inst = this.latest?.installer;
      if (!inst || !inst.url) {
        throw Error('新版本未提供安装程序下载地址');
      }
      const downloadsDir = path.join(this.home, 'updates', 'downloads');
      const exeName = path.basename(inst.name || `Litematic-Viewer-${this.latest.version}-win-x64-setup.exe`);
      const targetExe = path.join(downloadsDir, exeName);
      this.emit({ status: 'downloading', progress: { received: 0, total: inst.size || 0, phase: 'downloading-installer' } });
      const dl = await this.downloadFile(inst.url, targetExe, (received, total) => {
        this.emit({ status: 'downloading', progress: { received, total: total || inst.size || 0, phase: 'downloading-installer' } });
      });
      if (inst.sha256) {
        const expected = String(inst.sha256).trim().toLowerCase();
        if (dl.sha256 !== expected) {
          await fsp.rm(targetExe, { force: true }).catch(() => {});
          throw Error(`安装程序 SHA-256 校验失败`);
        }
      }
      return this.emit({ status: 'installer-ready', installerFile: targetExe, progress: null, error: null });
    };
    this.busyPromise = run().catch((err) => {
      this.emit({ status: 'error', progress: null, error: err.message });
      throw err;
    }).finally(() => {
      this.busyPromise = null;
    });
    return this.busyPromise;
  }
}

module.exports = {
  DEFAULT_REPO,
  MANIFEST_FILE,
  PENDING_REL,
  compareVersions,
  readDistribution,
  readPendingUpdate,
  extractZipSafely,
  AppUpdater,
};
