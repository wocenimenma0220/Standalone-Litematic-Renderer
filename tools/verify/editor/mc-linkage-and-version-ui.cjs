'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = process.argv[2] || path.resolve(__dirname, '../../..');
const out = path.join(__dirname, '../mc-linkage-ui-output');
process.argv = process.argv.slice(0, 2);

fs.mkdirSync(out, { recursive: true });
for (const oldFile of ['01-welcome.png', '02-help.png', '03-mc-link-packs.png', '04-mc-link-schematics.png', '05-version-mapping.png', '06-workspace-legacy.png', 'result.json', 'stdout.log', 'stderr.log']) {
  try { fs.unlinkSync(path.join(out, oldFile)); } catch {}
}
for (const oldDir of ['invalid-mc-dir', '1.21.11-Fabric-Test', '1.21.8-Fabric-Test', 'settings']) {
  try { fs.rmSync(path.join(out, oldDir), { recursive: true, force: true }); } catch {}
}
app.setPath('userData', path.join(out, 'electron'));

app.commandLine.appendSwitch('disable-renderer-backgrounding');
BrowserWindow.prototype.show = function showHidden() {
  this.setPosition(-20000, -20000, false);
  this.showInactive();
};

const settings = require(path.join(root, 'webapp/ui-settings'));
const OriginalUiSettings = settings.UiSettings;
settings.UiSettings = class extends OriginalUiSettings {
  constructor() {
    super(out);
  }
};

function buildMinimalZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localParts.push(local, dataBuf);
    centralParts.push(central);
    offset += local.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function nbtUtf8(str) {
  const b = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function nbtField(type, name, payload) {
  return Buffer.concat([Buffer.from([type]), nbtUtf8(name), payload]);
}

function nbtInt(val) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(val, 0);
  return b;
}

function nbtCompound(fields) {
  return Buffer.concat([...fields, Buffer.from([0])]);
}

function nbtList(elemType, payloads) {
  return Buffer.concat([Buffer.from([elemType]), nbtInt(payloads.length), ...payloads]);
}

function nbtLongArray(longs) {
  const b = Buffer.alloc(4 + longs.length * 8);
  b.writeInt32BE(longs.length, 0);
  for (let i = 0; i < longs.length; i++) b.writeBigInt64BE(BigInt(longs[i]), 4 + i * 8);
  return b;
}

function buildCrossVerLitematic() {
  const paletteEntry = (name, props = {}) => {
    const fields = [nbtField(8, 'Name', nbtUtf8(name))];
    const keys = Object.keys(props);
    if (keys.length) {
      fields.push(nbtField(10, 'Properties', nbtCompound(
        keys.map(k => nbtField(8, k, nbtUtf8(props[k])))
      )));
    }
    return nbtCompound(fields);
  };

  // Palette (4 entries -> 2 bits per cell): 0=air, 1=chain[axis=y], 2=grass, 3=cauldron[level=2]
  // Cells at (x=0..3, y=0, z=0): [1, 2, 3, 0] -> 1 | (2<<2) | (3<<4) = 1 + 8 + 48 = 57n
  const xyz = (x, y, z) => nbtCompound([
    nbtField(3, 'x', nbtInt(x)),
    nbtField(3, 'y', nbtInt(y)),
    nbtField(3, 'z', nbtInt(z)),
  ]);

  const region = nbtCompound([
    nbtField(10, 'Position', xyz(0, 0, 0)),
    nbtField(10, 'Size', xyz(4, 1, 1)),
    nbtField(9, 'BlockStatePalette', nbtList(10, [
      paletteEntry('minecraft:air'),
      paletteEntry('minecraft:chain', { axis: 'y' }),
      paletteEntry('minecraft:grass'),
      paletteEntry('minecraft:cauldron', { level: '2' }),
    ])),
    nbtField(12, 'BlockStates', nbtLongArray([57n])),
  ]);

  const rootTag = nbtField(10, '', nbtCompound([
    nbtField(3, 'Version', nbtInt(6)),
    nbtField(3, 'MinecraftDataVersion', nbtInt(3465)),
    nbtField(10, 'Metadata', nbtCompound([
      nbtField(10, 'EnclosingSize', xyz(4, 1, 1)),
    ])),
    nbtField(10, 'Regions', nbtCompound([
      nbtField(10, 'region0', region),
    ])),
  ]));
  return zlib.gzipSync(rootTag);
}

// Create fixture directories
const invalidDir = path.join(out, 'invalid-mc-dir');
fs.mkdirSync(invalidDir, { recursive: true });

const mcDir = path.join(out, '1.21.11-Fabric-Test');
fs.mkdirSync(path.join(mcDir, 'resourcepacks'), { recursive: true });
fs.mkdirSync(path.join(mcDir, 'schematics'), { recursive: true });
fs.mkdirSync(path.join(mcDir, 'mods'), { recursive: true });

fs.writeFileSync(path.join(mcDir, '1.21.11-Fabric-Test.json'), JSON.stringify({
  id: '1.21.11-Fabric-Test',
  inheritsFrom: '1.21.11',
  libraries: [{ name: 'net.fabricmc:fabric-loader:0.18.4' }],
}));
fs.writeFileSync(path.join(mcDir, 'options.txt'), 'lang:zh_cn\nresourcePacks:["vanilla","file/TestOrePack.zip"]\n');
fs.writeFileSync(path.join(mcDir, 'mods', 'litematica-fabric-1.21.11-0.23.0.jar'), 'dummy');
fs.writeFileSync(path.join(mcDir, 'resourcepacks', 'TestOrePack.zip'), buildMinimalZip([
  { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 64, description: 'Synthetic test resource pack' } }) },
]));
fs.writeFileSync(path.join(mcDir, 'schematics', 'crossver-sample.litematic'), buildCrossVerLitematic());

const dialogQueue = [
  { canceled: false, filePaths: [invalidDir] },
  { canceled: false, filePaths: [mcDir] },
];

dialog.showOpenDialog = async () => dialogQueue.shift() || { canceled: true, filePaths: [] };

app.once('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const snap = async name => {
        await wait(160);
        await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
        fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
      };

      const step1 = await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        await window.__uiReady;
        check(els.welcome.open, 'welcome dialog did not open initially');
        check(document.activeElement !== els.authorLink, 'authorLink unexpectedly received initial focus (yellow focus ring regression)');
        const linkStyle = getComputedStyle(els.authorLink);
        check(linkStyle.outlineStyle === 'none', 'authorLink should not show focus outline on initial welcome open: ' + linkStyle.outlineStyle);
        return { activeId: document.activeElement?.id || document.activeElement?.tagName };
      })()`);
      await snap('01-welcome.png');

      const step2 = await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        await dismissWelcome(false);
        check(!els.welcome.open, 'welcome did not close');
        const mcBtn = document.getElementById('menuMcLink');
        const helpBtn = document.getElementById('menuHelp');
        check(mcBtn && helpBtn, 'missing top bar menuMcLink or menuHelp button');
        check(mcBtn.getBoundingClientRect().height <= 36 && helpBtn.getBoundingClientRect().height <= 36, 'menu buttons too tall');

        helpBtn.click();
        const helpDlg = document.getElementById('helpDialog');
        check(helpDlg && helpDlg.open, 'helpDialog did not open');
        const helpText = helpDlg.textContent || '';
        check(helpText.includes('resourcepacks') && helpText.includes('iron_chain') && helpText.includes('short_grass'),
          'helpDialog missing MC linkage / cross-version documentation');
        return { mcText: mcBtn.textContent.trim(), helpTextLen: helpText.length };
      })()`);
      await snap('02-help.png');

      await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn) => { const end = Date.now() + 60000; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await wait(40); } };

        document.getElementById('helpClose').click();
        check(!document.getElementById('helpDialog').open, 'helpDialog did not close');

        document.getElementById('menuMcLink').click();
        await until(() => document.getElementById('mcLinkDialog').open);

        // 1. Invalid dir missing resourcepacks
        document.getElementById('mcLinkChooseBtn').click();
        await until(() => !document.getElementById('mcLinkChooseBtn').disabled);
        const errText = document.getElementById('mcLinkStatus').textContent || '';
        check(errText.includes('resourcepacks'), 'expected missing resourcepacks validation error, got: ' + errText);

        // 2. Valid MC dir
        document.getElementById('mcLinkChooseBtn').click();
        await until(() => !document.getElementById('mcLinkChooseBtn').disabled && (document.getElementById('mcStatVersion').textContent || '').includes('1.21.11'));
        const badgeText = document.getElementById('mcLinkSidebarBadge').textContent || '';
        check(badgeText.includes('1.21.11'), 'sidebar badge did not update: ' + badgeText);
      })()`);
      await snap('03-mc-link-packs.png');

      const step4 = await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn) => { const end = Date.now() + 60000; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await wait(40); } };

        document.getElementById('mcSyncEnabledPacksBtn').click();
        await until(() => !state.busy && state.packs.some(p => p.endsWith('TestOrePack.zip')));

        document.getElementById('mcTabSchematics').click();
        await until(() => !document.getElementById('mcPanelSchematics').classList.contains('hidden'));
        const rowBtns = [...document.querySelectorAll('#mcSchematicRows button')];
        check(rowBtns.length === 1, 'expected 1 schematic row, got ' + rowBtns.length);
        return { packs: state.packs.length, schemBtn: rowBtns[0].textContent };
      })()`);
      await snap('04-mc-link-schematics.png');

      const step5 = await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn) => { const end = Date.now() + 120000; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await wait(50); } };

        document.querySelector('#mcSchematicRows button').click();
        await until(() => state.viewReady && document.getElementById('versionMappingDialog').open);

        const banner = document.getElementById('fileVersionBanner');
        check(!banner.classList.contains('hidden'), 'fileVersionBanner should be visible');
        const rowsText = document.getElementById('versionMapRows').textContent || '';
        check(rowsText.includes('iron_chain') && rowsText.includes('short_grass'), 'versionMapRows missing expected rules: ' + rowsText);

        const remapMats = await window.engine.materials();
        check(remapMats.building.some(m => m.id === 'minecraft:iron_chain'), 'expected iron_chain in remap materials');
        check(remapMats.building.some(m => m.id === 'minecraft:short_grass'), 'expected short_grass in remap materials');
        return { banner: banner.textContent.trim(), buildingCount: remapMats.building.length };
      })()`);
      await snap('05-version-mapping.png');

      const step6 = await win.webContents.executeJavaScript(`(async () => {
        const check = (ok, msg) => { if (!ok) throw Error(msg); };
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const until = async (fn) => { const end = Date.now() + 120000; while (!fn()) { if (Date.now() > end) throw Error('timeout'); await wait(50); } };

        document.getElementById('versionMapAllLegacy').click();
        document.getElementById('versionMapApply').click();
        await until(() => !document.getElementById('versionMappingDialog').open && !state.rendering && !state.scenePreparing && state.viewReady);

        const legacyMats = await window.engine.materials();
        check(legacyMats.building.some(m => m.id === 'minecraft:chain'), 'expected preserved minecraft:chain after legacy apply');
        check(legacyMats.building.some(m => m.id === 'minecraft:grass'), 'expected preserved minecraft:grass after legacy apply');

        // Remember choice and reload schematic: dialog must stay closed
        document.getElementById('btnOpenVersionMapping').click();
        await until(() => document.getElementById('versionMappingDialog').open);
        document.getElementById('versionMapRemember').checked = true;
        document.getElementById('versionMapApply').click();
        await until(() => !document.getElementById('versionMappingDialog').open && !state.rendering && !state.scenePreparing);

        const filePath = state.file;
        await loadFile(filePath);
        await until(() => state.viewReady && !state.rendering && !state.scenePreparing);
        check(!document.getElementById('versionMappingDialog').open, 'versionMappingDialog popped up despite remember=true');

        return { pass: true, legacyIds: legacyMats.building.map(m => m.id) };
      })()`);
      await snap('06-workspace-legacy.png');

      const report = { pass: true, step1, step2, step4, step5, step6 };
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      app.quit();
    } catch (err) {
      console.error(err.stack || String(err));
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ pass: false, error: err.stack || String(err) }, null, 2));
      app.exit(1);
    }
  });
});

require(path.join(root, 'webapp/main.js'));
setTimeout(() => app.exit(1), 180000).unref();
