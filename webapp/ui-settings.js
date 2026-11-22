'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { nativeImage } = require('electron');
const {memoryPolicy}=require('./performance-policy');
const {cleanShortcutBindings}=require('./renderer/keyboard-shortcuts');
const {cleanInventory}=require('./renderer/editor-inventory');
const { normalizeSheetStyle } = require('./sheet-style');
const BACKGROUND_LIMIT = 10 * 1024 * 1024;
const SHEET_ASSET_EXTS = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const BACKGROUND_MODES = new Set(['checker', 'sky', 'white', 'dark', 'image', 'color']);
const AUTHOR_URL = 'https://www.bilibili.com/video/BV1UT42167xb/?share_source=copy_web&vd_source=d1e157c09b3321a7ecaf103abcde1586';

function cleanMappingRules(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (/^[a-z0-9_]{1,32}$/i.test(k) && (v === 'remap' || v === 'legacy')) out[k] = v;
  }
  return out;
}

class UiSettings {
  constructor(home) {
    this.directory = path.join(home, 'settings');
    this.file = path.join(this.directory, 'ui.json');
    this.imageFile = path.join(this.directory, 'background.img');
    this.sheetAssetsDir = path.join(this.directory, 'sheet-assets');
    this.state = null;
    this.queue = Promise.resolve();
  }
  async read() {
    if (!this.state) {
      let stored = {};
      try { stored = JSON.parse(await fs.readFile(this.file, 'utf8')) || {}; } catch {   }
      this.state = {
        hideWelcome: stored.hideWelcome === true,
        consoleHidden: stored.consoleHidden === true,
        keybindings:cleanShortcutBindings(stored.keybindings),
        editorInventory:cleanInventory(stored.editorInventory),
        sidebarCollapsed: stored.sidebarCollapsed === true,
        realLighting: stored.realLighting !== false,
        lodPreview: stored.lodPreview !== false,
        largeProjection: stored.largeProjection === true,
        projectionMode: ['auto','full','streaming'].includes(stored.projectionMode)?stored.projectionMode:'auto',
        lightingEnabled: stored.lightingEnabled !== false,
        showCoordinates: stored.showCoordinates === true,
        clearCacheOnExit: stored.clearCacheOnExit !== false,
        viewDistance: Number.isInteger(stored.viewDistance)&&stored.viewDistance>=1&&stored.viewDistance<=128?stored.viewDistance:6,
        geometryBudgetMB: Number.isInteger(stored.geometryBudgetMB)&&stored.geometryBudgetMB>=32&&stored.geometryBudgetMB<=16384?stored.geometryBudgetMB:memoryPolicy().geometryBudgetMB,
        preloadMode: ['distance','full','streaming'].includes(stored.preloadMode)?stored.preloadMode:'streaming',
        previewBackend: stored.previewBackend === 'cpu' ? 'cpu' : 'gpu',
        exportMode: stored.exportMode === 'cpu' ? 'cpu' : 'gpu',
        sheetMode: stored.sheetMode === true,
        sheetView1: typeof stored.sheetView1 === 'string' && stored.sheetView1.length <= 48 ? stored.sheetView1 : 'dimetric_front',
        sheetView2: typeof stored.sheetView2 === 'string' && stored.sheetView2.length <= 48 ? stored.sheetView2 : 'dimetric_back',
        sheetOutputDir: typeof stored.sheetOutputDir === 'string' ? stored.sheetOutputDir : '',
        sheetCopyClipboard: stored.sheetCopyClipboard !== false,
        sheetStyle: normalizeSheetStyle(stored.sheetStyle),
        ignoredUpdateVersion: typeof stored.ignoredUpdateVersion === 'string' ? stored.ignoredUpdateVersion : '',
        linkedMcDir: typeof stored.linkedMcDir === 'string' ? stored.linkedMcDir : '',
        useLinkedMcJarAssets: stored.useLinkedMcJarAssets === true,
        versionMappingDefault: stored.versionMappingDefault === 'legacy' ? 'legacy' : 'remap',
        versionMappingRules: cleanMappingRules(stored.versionMappingRules),
        versionMappingRemember: stored.versionMappingRemember === true,
        backgroundMode: BACKGROUND_MODES.has(stored.backgroundMode) ? stored.backgroundMode : 'checker',
        backgroundName: typeof stored.backgroundName === 'string' ? stored.backgroundName : '',
        backgroundColor: /^#[0-9a-f]{6}$/i.test(stored.backgroundColor) ? stored.backgroundColor : '#ffffff',
      };
    }
    return this.state;
  }
  async save(values) {
    const action = this.queue.then(async () => {
      const updated = { ...await this.read(), ...values };
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = this.file + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(updated, null, 2), 'utf8');
      await fs.rename(temporary, this.file);
      this.state = updated;
    });
    this.queue = action.catch(() => {});
    await action;
  }
  async settings() {
    const stored = await this.read();
    let dataUrl = null;
    try {
      if ((await fs.stat(this.imageFile)).size <= BACKGROUND_LIMIT) dataUrl = this.decode(await fs.readFile(this.imageFile)).dataUrl;
    } catch {   }
    return {
      showWelcome: !stored.hideWelcome,
      consoleHidden: stored.consoleHidden,
      keybindings:stored.keybindings,
      editorInventory:stored.editorInventory,
      sidebarCollapsed: stored.sidebarCollapsed,
      realLighting: stored.realLighting,
      lodPreview: stored.lodPreview,
      largeProjection: stored.largeProjection,
      projectionMode: stored.projectionMode,
      lightingEnabled: stored.lightingEnabled,
      showCoordinates: stored.showCoordinates,
      clearCacheOnExit: stored.clearCacheOnExit,
      viewDistance: stored.viewDistance,
      geometryBudgetMB: stored.geometryBudgetMB,
      preloadMode: stored.preloadMode,
      previewBackend: stored.previewBackend,
      exportMode: stored.exportMode,
      sheetMode: stored.sheetMode,
      sheetView1: stored.sheetView1,
      sheetView2: stored.sheetView2,
      sheetOutputDir: stored.sheetOutputDir,
      sheetCopyClipboard: stored.sheetCopyClipboard,
      sheetStyle: stored.sheetStyle,
      sheetAssets: await this.readSheetAssets(),
      ignoredUpdateVersion: stored.ignoredUpdateVersion,
      linkedMcDir: stored.linkedMcDir,
      useLinkedMcJarAssets: stored.useLinkedMcJarAssets,
      versionMappingDefault: stored.versionMappingDefault,
      versionMappingRules: stored.versionMappingRules,
      versionMappingRemember: stored.versionMappingRemember,
      background: { mode: stored.backgroundMode === 'image' && !dataUrl ? 'checker' : stored.backgroundMode,
        name: stored.backgroundName, color: stored.backgroundColor, dataUrl },
    };
  }
  decode(bytes) {
    if (bytes.length > BACKGROUND_LIMIT) throw new Error('背景图片不能超过 10 MB');
    const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!png && !jpeg) throw new Error('请导入 PNG 或 JPG 图片');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) throw new Error('这张图片无法读取，请选择有效的 PNG 或 JPG');
    return { dataUrl: 'data:' + (png ? 'image/png' : 'image/jpeg') + ';base64,' + bytes.toString('base64') };
  }
  async importBackground(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > BACKGROUND_LIMIT) throw new Error('背景图片不能超过 10 MB');
    const bytes = await fs.readFile(file);
    const decoded = this.decode(bytes);
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(this.imageFile + '.tmp', bytes);
    await fs.rename(this.imageFile + '.tmp', this.imageFile);
    const name = path.basename(file);
    await this.save({ backgroundMode: 'image', backgroundName: name });
    return { mode: 'image', name, ...decoded };
  }
  async setBackgroundMode(mode, color) {
    if (!BACKGROUND_MODES.has(mode)) throw new Error('未知的背景类型');
    if (mode === 'image') {
      const settings = await this.settings();
      if (!settings.background.dataUrl) throw new Error('请先导入背景图片');
    }
    await this.save({ backgroundMode: mode, ...(/^#[0-9a-f]{6}$/i.test(color) ? { backgroundColor: color } : {}) });
    return { mode };
  }
  async renderParams(params) {
    const result = { ...params };
    delete result.backgroundImage;
    if (result.transparent === true || result.backgroundMode === 'checker') {
      result.transparent = true;
      delete result.background;
    }
    if (!result.transparent && result.backgroundMode === 'image') result.backgroundImage = this.imageFile;
    return result;
  }
  async readSheetAssets() {
    const map = {};
    let entries = [];
    try { entries = await fs.readdir(this.sheetAssetsDir, { withFileTypes: true }); } catch { return map; }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      const mime = SHEET_ASSET_EXTS[ext];
      if (!mime) continue;
      const id = path.basename(ent.name, ext);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) continue;
      try {
        const full = path.join(this.sheetAssetsDir, ent.name);
        const stat = await fs.stat(full);
        if (stat.size <= 0 || stat.size > BACKGROUND_LIMIT) continue;
        const bytes = await fs.readFile(full);
        map[id] = `data:${mime};base64,${bytes.toString('base64')}`;
      } catch { }
      if (Object.keys(map).length >= 32) break;
    }
    return map;
  }
  async importSheetAsset(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > BACKGROUND_LIMIT) throw new Error('插图文件不能超过 10 MB');
    const bytes = await fs.readFile(file);
    const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const gif = bytes.length > 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF89a' || bytes.subarray(0, 6).toString('ascii') === 'GIF87a');
    const webp = bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
    const ext = png ? '.png' : jpeg ? '.jpg' : gif ? '.gif' : webp ? '.webp' : '';
    if (!ext) throw new Error('请选择有效的 PNG / JPG / WebP / GIF 图片');
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty() && !webp) throw new Error('这张图片无法读取');
    const dim = image.isEmpty() ? { width: 128, height: 128 } : image.getSize();
    const id = 'asset_' + crypto.randomBytes(6).toString('hex');
    await fs.mkdir(this.sheetAssetsDir, { recursive: true });
    const target = path.join(this.sheetAssetsDir, id + ext);
    await fs.writeFile(target + '.tmp', bytes);
    await fs.rename(target + '.tmp', target);
    const mime = SHEET_ASSET_EXTS[ext];
    return {
      id,
      name: path.basename(file),
      width: dim.width || 128,
      height: dim.height || 128,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    };
  }
  async deleteSheetAsset(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return;
    for (const ext of Object.keys(SHEET_ASSET_EXTS)) {
      try { await fs.unlink(path.join(this.sheetAssetsDir, id + ext)); } catch { }
    }
  }
}
module.exports = { UiSettings, AUTHOR_URL, BACKGROUND_LIMIT, cleanMappingRules };
