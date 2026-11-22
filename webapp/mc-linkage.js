'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const schematicFormats = require('./schematic-formats');

const MC_VERSION_TO_DATA = [
  ['26.3', 5023],
  ['26.1.2', 4790],
  ['26.1.1', 4786],
  ['26.1', 4780],
  ['26.0', 4690],
  ['1.21.11', 4671],
  ['1.21.10', 4556],
  ['1.21.9', 4554],
  ['1.21.8', 4440],
  ['1.21.7', 4438],
  ['1.21.6', 4435],
  ['1.21.5', 4325],
  ['1.21.4', 4189],
  ['1.21.3', 4082],
  ['1.21.2', 4080],
  ['1.21.1', 3955],
  ['1.21', 3953],
  ['1.20.6', 3839],
  ['1.20.5', 3837],
  ['1.20.4', 3700],
  ['1.20.3', 3698],
  ['1.20.2', 3578],
  ['1.20.1', 3465],
  ['1.20', 3463],
  ['1.19.4', 3337],
  ['1.19.3', 3218],
  ['1.19.2', 3120],
  ['1.19.1', 3117],
  ['1.19', 2975],
  ['1.18.2', 2865],
  ['1.18.1', 2860],
  ['1.18', 2860],
  ['1.17.1', 2730],
  ['1.17', 2724],
  ['1.16.5', 2586],
  ['1.16.4', 2584],
  ['1.16.3', 2580],
  ['1.16.2', 2578],
  ['1.16.1', 2567],
  ['1.16', 2566],
  ['1.15.2', 2230],
  ['1.14.4', 1976],
  ['1.13.2', 1631],
  ['1.12.2', 1343],
];

function inferDataVersionFromLabel(label) {
  const clean = String(label || '').trim();
  if (!clean) return 0;
  for (const [ver, dv] of MC_VERSION_TO_DATA) {
    if (clean === ver) return dv;
  }
  const match = clean.match(/(\d+\.\d+(?:\.\d+)?)/);
  if (match) {
    for (const [ver, dv] of MC_VERSION_TO_DATA) {
      if (match[1] === ver) return dv;
    }
    const parts = match[1].split('.').map(Number);
    const shortVer = `${parts[0]}.${parts[1]}`;
    for (const [ver, dv] of MC_VERSION_TO_DATA) {
      if (ver === shortVer) return dv;
    }
  }
  return 0;
}

function stripMcFormatting(text) {
  return String(text || '').replace(/§[0-9a-fk-or]/gi, '').trim();
}

function readZipEntryBuffer(fd, entry, maxBytes = 4 * 1024 * 1024) {
  if (!entry || entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes) return null;
  const header = Buffer.allocUnsafe(30);
  fs.readSync(fd, header, 0, 30, entry.localHeaderOffset);
  if (header.readUInt32LE(0) !== 0x04034b50) return null;
  const fnLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + fnLen + extraLen;
  const comp = Buffer.allocUnsafe(entry.compressedSize);
  fs.readSync(fd, comp, 0, entry.compressedSize, dataOffset);
  if (entry.method === 0) return comp;
  if (entry.method === 8) return zlib.inflateRawSync(comp);
  return null;
}

function scanZipMetadata(zipPath, { collectBlockstates = false, wantedFiles = [] } = {}) {
  const stat = fs.statSync(zipPath);
  const fd = fs.openSync(zipPath, 'r');
  try {
    const tailLen = Math.min(stat.size, 65558);
    const tailOffset = stat.size - tailLen;
    const tail = Buffer.allocUnsafe(tailLen);
    fs.readSync(fd, tail, 0, tailLen, tailOffset);

    let eocdPos = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        const commentLen = tail.readUInt16LE(i + 20);
        if (i + 22 + commentLen <= tailLen) {
          eocdPos = i;
          break;
        }
      }
    }
    if (eocdPos < 0) return { valid: false, files: {}, blockstates: [] };

    const cdSize = tail.readUInt32LE(eocdPos + 12);
    const cdOffset = tail.readUInt32LE(eocdPos + 16);
    if (cdOffset === 0xffffffff || cdSize === 0xffffffff || cdOffset + cdSize > stat.size || cdSize > 32 * 1024 * 1024) {
      return { valid: false, files: {}, blockstates: [] };
    }

    const cdBuf = Buffer.allocUnsafe(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, cdOffset);

    const wantedSet = new Set(wantedFiles);
    const files = {};
    const blockstates = [];
    let pos = 0;
    while (pos + 46 <= cdSize) {
      if (cdBuf.readUInt32LE(pos) !== 0x02014b50) break;
      const method = cdBuf.readUInt16LE(pos + 10);
      const compressedSize = cdBuf.readUInt32LE(pos + 20);
      const uncompressedSize = cdBuf.readUInt32LE(pos + 24);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const localHeaderOffset = cdBuf.readUInt32LE(pos + 42);
      const nameStart = pos + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > cdSize) break;
      const name = cdBuf.subarray(nameStart, nameEnd).toString('utf8').replace(/\\/g, '/');

      if (collectBlockstates && name.startsWith('assets/minecraft/blockstates/') && name.endsWith('.json')) {
        const stem = name.slice('assets/minecraft/blockstates/'.length, -5);
        if (stem && !stem.includes('/')) blockstates.push('minecraft:' + stem);
      }
      if (wantedSet.has(name)) {
        try {
          const buf = readZipEntryBuffer(fd, { method, compressedSize, uncompressedSize, localHeaderOffset });
          if (buf) files[name] = buf;
        } catch { }
      }
      pos = nameEnd + extraLen + commentLen;
    }
    return { valid: true, files, blockstates };
  } finally {
    fs.closeSync(fd);
  }
}

function parseVersionManifest(dirPath, folderName) {
  const candidates = [];
  const named = path.join(dirPath, `${folderName}.json`);
  if (fs.existsSync(named)) candidates.push(named);
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue;
      const full = path.join(dirPath, entry.name);
      if (full !== named) candidates.push(full);
    }
  } catch { }

  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > 4 * 1024 * 1024) continue;
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!json || typeof json !== 'object') continue;
      if (!json.id && !json.clientVersion && !json.inheritsFrom && !Array.isArray(json.libraries)) continue;

      let gameVersion = String(json.clientVersion || json.inheritsFrom || '').trim();
      let loader = '';
      const libs = Array.isArray(json.libraries) ? json.libraries : [];
      for (const lib of libs) {
        const name = String(lib?.name || '');
        if (name.startsWith('net.fabricmc:fabric-loader:')) {
          loader = 'Fabric ' + name.split(':')[2];
        } else if (name.startsWith('net.fabricmc:intermediary:') && !gameVersion) {
          gameVersion = name.split(':')[2];
        } else if (name.startsWith('org.quiltmc:quilt-loader:')) {
          loader = 'Quilt ' + name.split(':')[2];
        } else if (name.startsWith('net.neoforged:neoforge:')) {
          loader = 'NeoForge ' + name.split(':')[2];
        } else if (name.startsWith('net.minecraftforge:forge:')) {
          loader = 'Forge ' + name.split(':')[2];
        }
      }
      if (!loader && typeof json.mainClass === 'string') {
        if (json.mainClass.includes('fabricmc')) loader = 'Fabric';
        else if (json.mainClass.includes('neoforged')) loader = 'NeoForge';
        else if (json.mainClass.includes('minecraftforge')) loader = 'Forge';
        else if (json.mainClass.includes('quiltmc')) loader = 'Quilt';
      }
      if (!gameVersion && typeof json.assets === 'string' && /^\d+\.\d+/.test(json.assets)) {
        gameVersion = json.assets;
      }
      if (!gameVersion && typeof json.id === 'string') {
        const m = json.id.match(/(\d+\.\d+(?:\.\d+)?)/);
        if (m) gameVersion = m[1];
      }
      return {
        manifestPath: file,
        id: String(json.id || ''),
        inheritsFrom: String(json.inheritsFrom || ''),
        gameVersion,
        loader: loader || '原版 / 未识别加载器',
      };
    } catch { }
  }
  return null;
}

function findClientJar(dirPath, folderName, inheritsFrom) {
  const candidates = [];
  if (folderName) candidates.push(path.join(dirPath, `${folderName}.jar`));
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
        const full = path.join(dirPath, entry.name);
        if (!candidates.includes(full)) candidates.push(full);
      }
    }
  } catch { }
  if (inheritsFrom) {
    candidates.push(path.resolve(dirPath, '..', inheritsFrom, `${inheritsFrom}.jar`));
  }
  for (const file of candidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    } catch { }
  }
  return '';
}

function parseOptionsResourcePacks(dirPath) {
  const file = path.join(dirPath, 'options.txt');
  if (!fs.existsSync(file)) return { exists: false, enabledNames: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const line = raw.split(/\r?\n/).find(l => l.startsWith('resourcePacks:'));
    if (!line) return { exists: true, enabledNames: [] };
    const value = line.slice('resourcePacks:'.length).trim();
    const list = JSON.parse(value);
    if (!Array.isArray(list)) return { exists: true, enabledNames: [] };
    const enabledNames = [];
    for (const item of list) {
      if (typeof item !== 'string') continue;
      if (item.startsWith('file/')) enabledNames.push(item.slice(5));
    }
    return { exists: true, enabledNames };
  } catch {
    return { exists: true, enabledNames: [] };
  }
}

function parsePackMcmeta(buf) {
  try {
    const json = JSON.parse(Buffer.from(buf).toString('utf8'));
    const pack = json?.pack;
    if (!pack || typeof pack !== 'object') return { packFormat: 0, description: '' };
    const fmt = Number(pack.pack_format) || 0;
    let desc = '';
    if (typeof pack.description === 'string') desc = stripMcFormatting(pack.description);
    else if (pack.description && typeof pack.description === 'object' && typeof pack.description.text === 'string') {
      desc = stripMcFormatting(pack.description.text);
    }
    return { packFormat: fmt, description: desc };
  } catch {
    return { packFormat: 0, description: '' };
  }
}

function scanResourcepacks(resourcepacksDir, enabledNames) {
  const orderMap = new Map();
  enabledNames.forEach((name, index) => orderMap.set(name, index));

  const packs = [];
  let entries = [];
  try {
    entries = fs.readdirSync(resourcepacksDir, { withFileTypes: true });
  } catch {
    return packs;
  }

  for (const entry of entries) {
    const full = path.join(resourcepacksDir, entry.name);
    const lower = entry.name.toLowerCase();
    const mcOrder = orderMap.has(entry.name) ? orderMap.get(entry.name) : -1;
    const enabledInMc = mcOrder >= 0;

    if (entry.isDirectory()) {
      const hasMeta = fs.existsSync(path.join(full, 'pack.mcmeta'));
      const hasAssets = fs.existsSync(path.join(full, 'assets'));
      if (!hasMeta && !hasAssets) continue;
      let meta = { packFormat: 0, description: '' };
      if (hasMeta) {
        try { meta = parsePackMcmeta(fs.readFileSync(path.join(full, 'pack.mcmeta'))); } catch { }
      }
      packs.push({
        name: entry.name,
        path: full,
        kind: 'dir',
        enabledInMc,
        mcOrder,
        packFormat: meta.packFormat,
        description: meta.description,
        unsupported: false,
      });
    } else if (entry.isFile() && lower.endsWith('.zip')) {
      let meta = { packFormat: 0, description: '' };
      let valid = true;
      try {
        const scanned = scanZipMetadata(full, { wantedFiles: ['pack.mcmeta'] });
        valid = scanned.valid;
        if (scanned.files['pack.mcmeta']) meta = parsePackMcmeta(scanned.files['pack.mcmeta']);
      } catch {
        valid = false;
      }
      if (!valid) continue;
      packs.push({
        name: entry.name,
        path: full,
        kind: 'zip',
        enabledInMc,
        mcOrder,
        packFormat: meta.packFormat,
        description: meta.description,
        unsupported: false,
      });
    } else if (entry.isFile() && (lower.endsWith('.7z') || lower.endsWith('.rar'))) {
      packs.push({
        name: entry.name,
        path: full,
        kind: 'archive',
        enabledInMc,
        mcOrder,
        packFormat: 0,
        description: '需先解压为文件夹或转为 .zip 才可加载',
        unsupported: true,
      });
    }
  }

  packs.sort((a, b) => {
    if (a.enabledInMc !== b.enabledInMc) return a.enabledInMc ? -1 : 1;
    if (a.enabledInMc && b.enabledInMc && a.mcOrder !== b.mcOrder) return a.mcOrder - b.mcOrder;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
  return packs;
}

function scanSchematics(schematicsDir, maxCount = 5000, maxDepth = 8) {
  const results = [];
  if (!fs.existsSync(schematicsDir)) return results;

  function walk(dir, depth) {
    if (depth > maxDepth || results.length >= maxCount) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (results.length >= maxCount) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && schematicFormats.accepts(entry.name)) {
        try {
          const stat = fs.statSync(full);
          results.push({
            name: entry.name,
            relativePath: path.relative(schematicsDir, full).replace(/\\/g, '/'),
            path: full,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        } catch { }
      }
    }
  }

  walk(schematicsDir, 0);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'));
  return results;
}

function scanMods(modsDir) {
  if (!fs.existsSync(modsDir)) return { hasModsDir: false, modCount: 0, litematicaMods: [] };
  try {
    const files = fs.readdirSync(modsDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.jar$/i.test(e.name))
      .map(e => e.name);
    const litematicaMods = files.filter(name => /litematica/i.test(name));
    return { hasModsDir: true, modCount: files.length, litematicaMods };
  } catch {
    return { hasModsDir: false, modCount: 0, litematicaMods: [] };
  }
}

async function inspectMcFolder(rawDir) {
  if (!rawDir || typeof rawDir !== 'string') throw Error('请选择有效的文件夹路径');
  const resolved = path.resolve(rawDir);
  let stat;
  try { stat = await fsp.stat(resolved); } catch { stat = null; }
  if (!stat || !stat.isDirectory()) throw Error('所选路径不存在或不是文件夹：' + resolved);

  const resourcepacksDir = path.join(resolved, 'resourcepacks');
  let rpStat = null;
  try { rpStat = await fsp.stat(resourcepacksDir); } catch { }
  if (!rpStat || !rpStat.isDirectory()) {
    throw Error('该文件夹内未找到 resourcepacks 目录，请选择 Minecraft 版本文件夹或 .minecraft 目录');
  }

  const folderName = path.basename(resolved);
  const manifest = parseVersionManifest(resolved, folderName);
  const jarPath = findClientJar(resolved, folderName, manifest?.inheritsFrom || '');

  let gameVersion = manifest?.gameVersion || '';
  let dataVersion = 0;
  let targetBlockIds = [];
  if (jarPath) {
    try {
      const jarMeta = scanZipMetadata(jarPath, { collectBlockstates: true, wantedFiles: ['version.json'] });
      if (jarMeta.valid) {
        targetBlockIds = jarMeta.blockstates;
        if (jarMeta.files['version.json']) {
          const vj = JSON.parse(jarMeta.files['version.json'].toString('utf8'));
          if (vj?.name || vj?.id) gameVersion = String(vj.name || vj.id);
          if (Number.isInteger(vj?.world_version) && vj.world_version > 0) dataVersion = vj.world_version;
        }
      }
    } catch { }
  }
  if (!gameVersion) {
    const m = folderName.match(/(\d+\.\d+(?:\.\d+)?)/);
    if (m) gameVersion = m[1];
  }
  if (!dataVersion && gameVersion) {
    dataVersion = inferDataVersionFromLabel(gameVersion);
  }

  const options = parseOptionsResourcePacks(resolved);
  const resourcepacks = scanResourcepacks(resourcepacksDir, options.enabledNames);
  const schematicsDir = path.join(resolved, 'schematics');
  const hasSchematicsDir = fs.existsSync(schematicsDir) && fs.statSync(schematicsDir).isDirectory();
  const schematics = hasSchematicsDir ? scanSchematics(schematicsDir) : [];
  const modsInfo = scanMods(path.join(resolved, 'mods'));

  return {
    root: resolved,
    folderName,
    gameVersion: gameVersion || '未识别',
    dataVersion,
    loader: manifest?.loader || '原版 / 未识别',
    jarPath,
    targetBlockIds,
    hasOptionsTxt: options.exists,
    enabledPackNames: options.enabledNames,
    resourcepacksDir,
    resourcepacks,
    hasSchematicsDir,
    schematicsDir: hasSchematicsDir ? schematicsDir : '',
    schematics,
    hasModsDir: modsInfo.hasModsDir,
    modCount: modsInfo.modCount,
    litematicaMods: modsInfo.litematicaMods,
    hasLitematica: modsInfo.litematicaMods.length > 0 || hasSchematicsDir,
  };
}

module.exports = {
  inspectMcFolder,
  inferDataVersionFromLabel,
  scanZipMetadata,
  parseOptionsResourcePacks,
};
