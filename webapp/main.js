'use strict';

/** Electron 主进程持有窗口、Java 子进程和串行请求队列。 */

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, ClipboardItem, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { EngineClient } = require('./engine-client');
const { resolveRuntime } = require('./runtime');
const { UiSettings, AUTHOR_URL } = require('./ui-settings');
const { SceneTransfer, INLINE_LIMIT } = require('./scene-transfer');
const { clearRenderingCache,clearInterruptedCache } = require('./cache-cleanup');
const {BackgroundExports}=require('./background-exports');
const schematicFormats=require('./schematic-formats');
const { AppUpdater } = require('./updater');


const APP_HOME = path.resolve(__dirname, '..');
const uiSettings = new UiSettings(APP_HOME);
const sceneTransfer = new SceneTransfer();
const selectionTransfer = new SceneTransfer();

function diagnostic(message) {
  try {
    fs.mkdirSync(path.join(APP_HOME, 'logs'), { recursive: true });
    const file = path.join(APP_HOME, 'logs', 'app.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 2 * 1024 * 1024) {
      fs.copyFileSync(file, file + '.previous');fs.truncateSync(file, 0);
    }
    fs.appendFileSync(file, new Date().toISOString() + ' ' + message + '\n', 'utf8');
  } catch {   }
}
app.setName('投影预览');
app.setAppUserModelId('io.kindasus.projectionpreview');

let mainWindow = null;
let engine = null;
let renderStopPromise = null;
let openedSchematic=null,resourceRoot=null;
const backgroundExports=new BackgroundExports({home:APP_HOME,runtime:resolveRuntime(APP_HOME),onUpdate:job=>{
  if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('exports:update',job);
}});
let shutdownPromise = null;
let shutdownComplete = false;
let pendingPostQuitLaunch = null;

const appUpdater = new AppUpdater({
  home: APP_HOME,
  onStatus: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', status);
    }
  },
});

let startupFile = null;

function setupDevHotReload(win) {
  const isDev = process.argv.includes('--dev') || process.env.LITEMATIC_HOT_RELOAD === '1';
  if (!isDev || app.isPackaged) return;
  const rendererDir = path.join(__dirname, 'renderer');
  let reloadTimer = null;
  const cssTimers = new Map();
  let watcher = null;
  try {
    watcher = fs.watch(rendererDir, { recursive: false }, (_eventType, filename) => {
      if (!filename || typeof filename !== 'string') return;
      if (win.isDestroyed()) return;
      if (/\.css$/i.test(filename)) {
        clearTimeout(cssTimers.get(filename));
        cssTimers.set(filename, setTimeout(() => {
          cssTimers.delete(filename);
          if (!win.isDestroyed()) win.webContents.send('dev:reloadCss', filename);
        }, 70));
        return;
      }
      if (/\.(html|js)$/i.test(filename)) {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
        }, 120);
      }
    });
    win.once('closed', () => {
      clearTimeout(reloadTimer);
      for (const timer of cssTimers.values()) clearTimeout(timer);
      cssTimers.clear();
      try { watcher?.close(); } catch { }
    });
  } catch (err) {
    diagnostic('dev hot reload watcher failed: ' + err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 660,
    frame: false,
    backgroundColor: '#18181a',
    show: false,
    title: '投影预览',
    icon: path.join(__dirname, 'app.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 应用已有页面菜单，关闭隐藏的原生菜单，避免释放 Alt 时抢走焦点和鼠标锁定。

  mainWindow.setMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('render-process-gone', (_event, details) => diagnostic('preview process exited: ' + JSON.stringify(details)));
  mainWindow.webContents.once('destroyed', () => { sceneTransfer.close().catch(() => {});selectionTransfer.close().catch(()=>{}); });
  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('window:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('window:fullscreen', false));
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  setupDevHotReload(mainWindow);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}


function startEngine() {
  const runtime = resolveRuntime(APP_HOME);
  const client = new EngineClient({
    javaExe: runtime.javaExe,
    classpath: runtime.classpath,
    home: APP_HOME,
    onEvent: (evt) => {
      if (engine !== client) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine:event', evt);
      }
    },
    onExit: (info) => {
      diagnostic('render engine exited: '+JSON.stringify(info));
      if (engine !== client || info.forced) return;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('engine:exit', info);
      }
    },
  });
  engine = client;
  return client.start();
}

function requireCurrentEngine(client) {
  if (!client || client !== engine || client.stopping || shutdownPromise) throw Error('渲染已强制停止');
}
// 在任何异步等待前固定引擎实例，旧请求不能进入替换后的引擎。
function handleEngine(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    const client = engine;
    requireCurrentEngine(client);
    if (renderStopPromise) throw Error('正在停止渲染，请稍候');
    return handler(client, event, ...args);
  });
}
async function loadEngineResources(client, root) {
  const imports = await packStore.read();
  requireCurrentEngine(client);
  const result = await client.call('loadResources', { ...(root ? { root } : {}), imports });
  requireCurrentEngine(client);
  backgroundExports.resetWorker().catch(()=>{});
  return client.resourcesLoaded = true,
  resourceRoot = root || null,
  result;
}

ipcMain.handle('engine:forceStop', () => {
  if (renderStopPromise) return renderStopPromise;
  const previous = engine;
  const previousPid=previous?.proc?.pid;
  openedSchematic = null;
  // 先独立终止进程，再等待在途传输和临时资源清理。
  const stopped = previous ? previous.forceStop() : Promise.resolve();
  renderStopPromise = (async () => {
    await Promise.all([stopped, sceneTransfer.close(), selectionTransfer.close()]);
    try{await clearInterruptedCache(APP_HOME,previousPid,previous?.temporaryCaches);}catch(error){diagnostic('interrupted cache cleanup failed: '+error.message);}
    if (!shutdownPromise) await startEngine();
    diagnostic('preview force-stopped; replacement engine ready');
    return { stopped: true };
  })().finally(() => { renderStopPromise = null; });
  return renderStopPromise;
});

// ---------------------------------------------------------------------------


ipcMain.handle('engine:status', async () => {
  const runtime = resolveRuntime(APP_HOME);
  return {
    home: APP_HOME,
    java: runtime.javaExe,
    javaSource: runtime.source,
    running: engine ? engine.isRunning() : false,
  };
});

handleEngine('engine:ping', client => client.call('ping', {}));
handleEngine('engine:selectBlock',(client,_event,ray)=>client.call('selectBlock',ray));
handleEngine('engine:loadResources', (client, _e, root) => loadEngineResources(client, root));
handleEngine('engine:open', async (client, _e, file) => {
  if(!schematicFormats.accepts(file)||!(await fs.promises.stat(file)).isFile())throw Error('请选择 '+schematicFormats.label+' 结构文件');
  requireCurrentEngine(client);
  if(!client.resourcesLoaded)await loadEngineResources(client,resourceRoot);
  diagnostic('opening schematic: '+file);
  try {await sceneTransfer.close();requireCurrentEngine(client);await selectionTransfer.close();await client.call('cancelPreview',{});const result=await client.call('open',{path:file});requireCurrentEngine(client);openedSchematic=file;diagnostic('schematic opened: '+file);return result;}
  catch(error){diagnostic('schematic open failed: '+file+'; '+error.message);throw error;}
});
handleEngine('engine:render', async (client, _e, params) => client.call('render', await uiSettings.renderParams(params)));
handleEngine('engine:renderPreview', async (client, _e, params) => client.call('renderPreview', await uiSettings.renderParams(params)));
handleEngine('engine:renderAnimation', async (client, _e, params) => client.call('renderAnimation', await uiSettings.renderParams(params)));
ipcMain.handle('exports:start',async(_event,{kind,params})=>{
  if(!openedSchematic)throw Error('请先打开投影');
  const committed=await engine.call('commitEdits',{});if(committed.changed)openedSchematic=committed.path;
  const source=openedSchematic;
  return backgroundExports.submit({kind,source,params:await uiSettings.renderParams(params),resources:{...(resourceRoot?{root:resourceRoot}:{}),imports:await packStore.read()}});
});
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function pngChunk(type, data) {
  const len = data.length, buf = Buffer.allocUnsafe(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  if (len > 0) data.copy(buf, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + len; i++) crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + len);
  return buf;
}
function encodeRgbaPng(rgba, width, height) {
  const rowBytes = width * 4, stride = 1 + rowBytes;
  const raw = Buffer.allocUnsafe(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 3 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const gpuGifSpools = new Map();
function emitGpuGifJob(session, state, stage, extra = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('exports:update', {
      id: session.id, kind: 'gif', name: path.basename(session.out), path: session.out,
      state, stage, completed: session.completed || 0, total: session.frames, ...extra,
    });
  }
}

ipcMain.handle('exports:list', () => [
  ...backgroundExports.list(),
  ...Array.from(gpuGifSpools.values(), s => ({ id: s.id, kind: 'gif', name: path.basename(s.out), path: s.out, state: 'running', stage: 'rendering', completed: s.completed || 0, total: s.frames })),
]);
ipcMain.handle('exports:cancel', async (_event, id) => {
  const spool = gpuGifSpools.get(id);
  if (spool) {
    spool.aborted = true;
    gpuGifSpools.delete(id);
    try { await spool.handle.close(); } catch { }
    try { await fs.promises.rm(spool.directory, { recursive: true, force: true }); } catch { }
    emitGpuGifJob(spool, 'cancelled', 'cancelled');
    return { id, state: 'cancelled', stage: 'cancelled' };
  }
  return backgroundExports.cancel(id);
});
ipcMain.handle('exports:saveGpuPng', async (_event, { out, width, height, rgbaBuffer }) => {
  if (!out || !path.isAbsolute(out) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !rgbaBuffer) {
    throw Error('GPU PNG 导出参数无效');
  }
  const resolved = path.resolve(out);
  const rgba = Buffer.from(rgbaBuffer);
  if (rgba.byteLength !== width * height * 4) throw Error('GPU 像素缓冲大小不匹配');
  const png = encodeRgbaPng(rgba, width, height);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  const tmp = path.join(path.dirname(resolved), `.gpu-export-${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(tmp, png);
    await fs.promises.rename(tmp, resolved);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
  return backgroundExports.recordExternal({ kind: 'png', out: resolved, result: { width, height, bytes: png.byteLength, mode: 'gpu' } });
});
function formatSheetTimestamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}
async function uniqueSheetPath(sourceFile, configuredDir = '') {
  const parsed = path.parse(path.resolve(sourceFile || 'projection.litematic'));
  const stemBase = `${parsed.name || 'projection'}-双视图-${formatSheetTimestamp()}`;
  const dirs = [];
  if (configuredDir && path.isAbsolute(configuredDir)) dirs.push(path.resolve(configuredDir));
  if (sourceFile) dirs.push(parsed.dir);
  try { dirs.push(path.join(app.getPath('pictures'), '投影预览')); } catch { }
  for (const dir of dirs) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      let candidate = path.join(dir, stemBase + '.png');
      for (let suffix = 2; fs.existsSync(candidate); suffix++) {
        candidate = path.join(dir, `${stemBase}-${suffix}.png`);
      }
      const probe = path.join(dir, `.write-test-${randomUUID()}.tmp`);
      await fs.promises.writeFile(probe, '');
      await fs.promises.unlink(probe).catch(() => {});
      return candidate;
    } catch { }
  }
  throw Error('无法在指定位置或图片文件夹创建展示图文件');
}
ipcMain.handle('exports:saveSheetPng', async (_event, { sourceFile, out, pngBuffer, width, height, copyClipboard }) => {
  if (!pngBuffer) throw Error('展示图内容为空');
  const buf = Buffer.from(pngBuffer);
  if (!buf.byteLength) throw Error('展示图内容为空');
  const settings = await uiSettings.read();
  const resolved = out && path.isAbsolute(out)
    ? path.resolve(out)
    : await uniqueSheetPath(sourceFile, settings.sheetOutputDir);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  const tmp = path.join(path.dirname(resolved), `.sheet-export-${randomUUID()}.tmp`);
  try {
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, resolved);
  } catch (err) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
  let copied = false;
  if (copyClipboard !== false) {
    try {
      if (typeof clipboard.write === 'function' && typeof ClipboardItem === 'function') {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })]);
        copied = true;
      } else if (typeof clipboard.writeImage === 'function') {
        const img = nativeImage.createFromBuffer(buf);
        if (img.isEmpty()) diagnostic('clipboard copy skipped: empty nativeImage');
        else { clipboard.writeImage(img); copied = true; }
      }
    } catch (clipErr) {
      diagnostic('clipboard copy failed: ' + (clipErr?.message || clipErr));
    }
  }
  const job = backgroundExports.recordExternal({
    kind: 'png',
    out: resolved,
    result: { width: Number(width) || 0, height: Number(height) || 0, bytes: buf.byteLength, sheet: true, copied },
  });
  return { out: resolved, copied, job };
});
handleEngine('exports:renderCpuPanel', async (client, _event, params) => {
  const stagingRoot = path.join(APP_HOME, 'cache', 'exports');
  await fs.promises.mkdir(stagingRoot, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(stagingRoot, 'sheet-cpu-'));
  const tmpPng = path.join(dir, 'panel.png');
  try {
    const rendered = await client.call('render', { ...(await uiSettings.renderParams(params)), transparent: true, out: tmpPng });
    requireCurrentEngine(client);
    const bytes = await fs.promises.readFile(tmpPng);
    return {
      arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      width: rendered.width,
      height: rendered.height,
    };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
ipcMain.handle('exports:gpuGifBegin', async (_event, { out, width, height, frames, delay }) => {
  if (!out || !path.isAbsolute(out) || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !Number.isInteger(frames) || frames < 2) {
    throw Error('GPU GIF 导出参数无效');
  }
  const resolved = path.resolve(out);
  const dup = backgroundExports.list().some(j => !['completed', 'failed', 'cancelled'].includes(j.state) && path.resolve(j.path).toLowerCase() === resolved.toLowerCase())
    || Array.from(gpuGifSpools.values()).some(s => path.resolve(s.out).toLowerCase() === resolved.toLowerCase());
  if (dup) throw Error('这个文件已有导出任务，请选择其他文件名');
  const stagingRoot = path.join(APP_HOME, 'cache', 'exports');
  await fs.promises.mkdir(stagingRoot, { recursive: true });
  const directory = await fs.promises.mkdtemp(path.join(stagingRoot, 'gpu-gif-'));
  const spoolPath = path.join(directory, 'frames.argb');
  const handle = await fs.promises.open(spoolPath, 'w');
  const session = { id: randomUUID(), out: resolved, directory, spoolPath, handle, width, height, frames, delay: Math.max(1, Number(delay) || 2), completed: 0, aborted: false };
  gpuGifSpools.set(session.id, session);
  emitGpuGifJob(session, 'running', 'rendering');
  return { id: session.id };
});
ipcMain.handle('exports:gpuGifChunk', async (_event, { id, chunk, completed }) => {
  const session = gpuGifSpools.get(id);
  if (!session || session.aborted) return { aborted: true };
  const buf = Buffer.from(chunk);
  await session.handle.write(buf);
  session.completed = Math.min(session.frames, Number(completed) || session.completed);
  emitGpuGifJob(session, 'running', 'rendering');
  return { aborted: false };
});
ipcMain.handle('exports:gpuGifFinish', async (_event, { id }) => {
  const session = gpuGifSpools.get(id);
  if (!session) throw Error('GIF 缓冲会话不存在或已取消');
  gpuGifSpools.delete(id);
  await session.handle.close();
  if (session.aborted) {
    await fs.promises.rm(session.directory, { recursive: true, force: true }).catch(() => {});
    return { aborted: true };
  }
  return backgroundExports.submitSpoolGif({
    id: session.id,
    directory: session.directory,
    spoolPath: session.spoolPath,
    params: { out: session.out, width: session.width, height: session.height, frames: session.frames, delay: session.delay },
  });
});
ipcMain.handle('exports:gpuGifAbort', async (_event, id) => {
  const session = gpuGifSpools.get(id);
  if (!session) return { ok: true };
  session.aborted = true;
  gpuGifSpools.delete(id);
  try { await session.handle.close(); } catch { }
  try { await fs.promises.rm(session.directory, { recursive: true, force: true }); } catch { }
  emitGpuGifJob(session, 'cancelled', 'cancelled');
  return { ok: true };
});
handleEngine('engine:cancel', client => client.call('cancel', {}));
handleEngine('engine:releaseStreaming', async client => {await sceneTransfer.close();await client.call('cancelPreview',{});return client.call('releaseStreaming', {});});
handleEngine('engine:materials',(client,_event,request)=>client.call('materials',{waterAsIce:request?.waterAsIce===true}));
handleEngine('engine:exportMaterials',(client,_event,request)=>client.call('exportMaterials',request));
handleEngine('engine:sceneCacheStats',client=>client.call('sceneCacheStats',{}));
handleEngine('engine:configureSceneCache',async(client,_event,request)=>{const res=await client.call('configureSceneCache',request);if(request?.clear)backgroundExports.resetWorker().catch(()=>{});return res;});
ipcMain.handle('dialog:saveMaterials',async(_event,{suggested,format,scope})=>{
  format=format==='csv'?'csv':'xlsx';
  const res=await dialog.showSaveDialog(mainWindow,{defaultPath:suggested||('材料清单.'+format),filters:[{name:format==='csv'?'CSV 表格':'Excel 工作簿',extensions:[format]}]});
  if(res.canceled)return null;
  let file=res.filePath;if(!/\.(xlsx|csv)$/i.test(file))file+='.'+format;
  if(scope==='separate'){
    const extension=path.extname(file),stem=file.slice(0,-extension.length);
    const existing=['-建材','-容器内容物'].map(suffix=>stem+suffix+extension).filter(p=>fs.existsSync(p));
    if(existing.length){const choice=await dialog.showMessageBox(mainWindow,{type:'question',buttons:['取消','替换'],defaultId:0,cancelId:0,message:'替换已有材料表？',detail:existing.join('\n')});if(choice.response!==1)return null;}
  }
  return file;
});
handleEngine('engine:pickBlock', (client, _e, ray) => client.call('pickBlock', ray));

function readResourceGameVersion() {
  for (const base of [resourceRoot, APP_HOME]) {
    if (!base) continue;
    try {
      const file = path.join(base, 'assets', 'vanilla', 'assets', 'version.json');
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (json?.id || json?.name) return String(json.name || json.id);
      }
    } catch { }
  }
  return '';
}
ipcMain.handle('ui:settings', async () => ({ ...(await uiSettings.settings()), defaultGameVersion: readResourceGameVersion() }));
ipcMain.handle('ui:sheetSettings', async (_event, patch = {}) => {
  const next = {};
  if (typeof patch.sheetMode === 'boolean') next.sheetMode = patch.sheetMode;
  if (typeof patch.sheetView1 === 'string' && /^[a-z0-9_]{1,48}$/i.test(patch.sheetView1)) next.sheetView1 = patch.sheetView1;
  if (typeof patch.sheetView2 === 'string' && /^[a-z0-9_]{1,48}$/i.test(patch.sheetView2)) next.sheetView2 = patch.sheetView2;
  if (typeof patch.sheetOutputDir === 'string') {
    const clean = patch.sheetOutputDir.trim();
    if (clean !== '' && !path.isAbsolute(clean)) throw Error('默认导出文件夹必须是绝对路径');
    next.sheetOutputDir = clean ? path.resolve(clean) : '';
  }
  if (typeof patch.sheetCopyClipboard === 'boolean') next.sheetCopyClipboard = patch.sheetCopyClipboard;
  await uiSettings.save(next);
  return next;
});
ipcMain.handle('dialog:chooseSheetDir', async () => {
  const cur = (await uiSettings.read()).sheetOutputDir;
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出模式默认保存文件夹',
    properties: ['openDirectory', 'createDirectory'],
    ...(cur && fs.existsSync(cur) ? { defaultPath: cur } : {}),
  });
  if (choice.canceled || !choice.filePaths.length) return null;
  const dir = path.resolve(choice.filePaths[0]);
  await uiSettings.save({ sheetOutputDir: dir });
  return { dir };
});
ipcMain.handle('ui:editorInventory',async(_event,inventory)=>{
  const {cleanInventory}=require('./renderer/editor-inventory');
  const editorInventory=cleanInventory(inventory);await uiSettings.save({editorInventory});return {editorInventory};
});
ipcMain.handle('ui:keybindings',async(_event,bindings)=>{
  const {cleanShortcutBindings}=require('./renderer/keyboard-shortcuts');
  const keybindings=cleanShortcutBindings(bindings);await uiSettings.save({keybindings});return {keybindings};
});
ipcMain.handle('ui:previewBackend', async (_event, backend) => {
  if (backend !== 'cpu' && backend !== 'gpu') throw new Error('未知的预览渲染方式。');
  await uiSettings.save({ previewBackend: backend });
  return { previewBackend: backend };
});
ipcMain.handle('ui:exportMode', async (_event, mode) => {
  if (mode !== 'gpu' && mode !== 'cpu') throw new Error('未知的导出模式。');
  await uiSettings.save({ exportMode: mode });
  return { exportMode: mode };
});
for(const key of ['largeProjection','lightingEnabled','showCoordinates','clearCacheOnExit','consoleHidden']) {
  ipcMain.handle('ui:'+key,async(_event,enabled)=>{await uiSettings.save({[key]:enabled===true,...(key==='largeProjection'?{projectionMode:enabled?'streaming':'full'}:{})});return {[key]:enabled===true};});
}
ipcMain.handle('ui:projectionMode',async(_event,mode)=>{
  if(!['auto','full','streaming'].includes(mode))throw Error('无效的加载方式');
  await uiSettings.save({projectionMode:mode});return {projectionMode:mode};
});
ipcMain.handle('ui:realLighting', async (_event, enabled) => {
  await uiSettings.save({ realLighting: enabled === true });
  return { realLighting: enabled === true };
});
ipcMain.handle('ui:lodPreview', async (_event, enabled) => {
  if(typeof enabled!=='boolean')throw new Error('无效的预览设置');
  await uiSettings.save({lodPreview:enabled});return {lodPreview:enabled};
});
ipcMain.handle('ui:viewDistance',async(_event,distance)=>{
  if(!Number.isInteger(distance)||distance<1||distance>128)throw new Error('视距需为 1 到 128 区块。');
  await uiSettings.save({viewDistance:distance});return {viewDistance:distance};
});
ipcMain.handle('ui:geometryBudget',async(_event,megabytes)=>{
  if(!Number.isInteger(megabytes)||megabytes<32||megabytes>16384)throw new Error('几何缓存上限应为 32–16384 MB 的整数');
  await uiSettings.save({geometryBudgetMB:megabytes});return {geometryBudgetMB:megabytes};
});
ipcMain.handle('ui:preloadMode',async(_event,mode)=>{
  if(!['distance','full','streaming'].includes(mode))throw new Error('未知的预渲染方式');
  await uiSettings.save({preloadMode:mode});return {preloadMode:mode};
});
ipcMain.handle('ui:sidebar', async (_e, collapsed) => {
  await uiSettings.save({ sidebarCollapsed: collapsed === true });
  return { collapsed: collapsed === true };
});
ipcMain.handle('ui:dismissWelcome', async (_e, forever) => {
  if (forever === true) await uiSettings.save({ hideWelcome: true });
  return { dismissed: true };
});
ipcMain.handle('ui:authorLink', () => shell.openExternal(AUTHOR_URL));
ipcMain.handle('ui:backgroundMode', (_e, mode, color) => uiSettings.setBackgroundMode(mode, color));
ipcMain.handle('ui:importBackground', async () => {
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '导入背景图片（10 MB 以内）',
    filters: [{ name: '背景图片', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile'],
  });
  if (choice.canceled) return null;
  return uiSettings.importBackground(choice.filePaths[0]);
});
ipcMain.handle('window:fullscreen', (_e, enabled) => {
  const fullscreen = typeof enabled === 'boolean' ? enabled : !mainWindow.isFullScreen();
  mainWindow.setFullScreen(fullscreen);
  return { fullscreen };
});
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false };
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  else if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return { maximized: mainWindow.isMaximized() };
});
ipcMain.handle('window:isMaximized', () => ({ maximized: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized() }));
ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

handleEngine('skins:settings', client => client.call('skinSettings', {}));
handleEngine('skins:setOnline', async (client, _event, online) => { const r = await client.call('setSkinOnline', { online: !!online }); backgroundExports.resetWorker().catch(()=>{}); return r; });
handleEngine('skins:importLocal', async (client, _event, identity) => {
  if (typeof identity !== 'string' || !/^(?:[A-Za-z0-9_]{1,16}|[0-9a-fA-F]{32}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/.test(identity.trim())) {
    throw new Error('请先填写玩家名或 UUID');
  }
  const choice = await dialog.showOpenDialog(mainWindow, {
    title: '导入玩家皮肤 PNG', filters: [{ name: 'Minecraft 皮肤 PNG', extensions: ['png'] }], properties: ['openFile'],
  });
  if (choice.canceled) return { imported: false };
  const r = await client.call('importSkin', { identity: identity.trim(), path: choice.filePaths[0] });
  backgroundExports.resetWorker().catch(()=>{});
  return r;
});

/** 图集通过数据 URL 传输，网格保持二进制，避免 Base64 膨胀顶点数据。 */
ipcMain.handle('engine:readSceneChunk', (event, request = {}) => sceneTransfer.read(event.sender.id, request.id, request.offset, request.length));
ipcMain.handle('engine:readSelectionChunk',(event,request={})=>selectionTransfer.read(event.sender.id,request.id,request.offset,request.length));
ipcMain.handle('engine:releaseSelection',()=>selectionTransfer.close());
handleEngine('engine:exportSelectionScene',async(client,event,options={})=>{
  const dir=path.join(APP_HOME,'renders','.gpu','selection');await fs.promises.mkdir(dir,{recursive:true});requireCurrentEngine(client);await selectionTransfer.close();
  const result=await client.call('exportSelectionScene',{selection:options.selection,realLighting:options.realLighting===true,lightingEnabled:options.lightingEnabled!==false,atlas:path.join(dir,'atlas.png'),mesh:path.join(dir,'mesh.bin')});
  return scenePayload(client,event,result,{transfer:selectionTransfer});
});
ipcMain.handle('engine:readScenePage',(event,request={})=>sceneTransfer.readPage(event.sender.id,request.id,request.page));
ipcMain.handle('engine:readScenePages',(event,request={})=>sceneTransfer.readPages(event.sender.id,request.id,request.pages));
handleEngine('engine:beginPreview',async (client,_event,options={})=>{await sceneTransfer.close();return client.call('beginPreview',options);});
handleEngine('engine:previewStatus',async(client,event,request)=>{
  const query=typeof request==='string'?{id:request}:request;
  const status=await client.call('previewStatus',query);requireCurrentEngine(client);sceneTransfer.commit(event.sender.id,query.id,status.committedBytes);return status;
});
handleEngine('engine:previewLive',async(client,event,id)=>scenePayload(client,event,await client.call('previewLive',{id}),{retain:true,growing:true,key:id}));
handleEngine('engine:cancelPreview',async client=>{await sceneTransfer.close();return client.call('cancelPreview',{});});
handleEngine('engine:previewResult',async(client,event,request)=>scenePayload(client,event,await client.call('previewResult',request)));
handleEngine('engine:previewComplete',(client,_event,id)=>client.call('previewResult',{id,overview:false}));
handleEngine('engine:exportScene', async (client, event, options = {}) => {
  const progressId=typeof options.progressId==='string'?options.progressId.slice(0,64):'';
  const dir = path.join(APP_HOME, 'renders', '.gpu');
  await fs.promises.mkdir(dir, { recursive: true });
  requireCurrentEngine(client);
  await sceneTransfer.close();
  diagnostic('building preview scene');
  await client.call('cancelPreview',{});
  const res = await client.call(options.streaming===true?'exportCachedScene':'exportScene', {
    atlas: path.join(dir, 'atlas.png'),
    mesh: path.join(dir, 'mesh.bin'),
    force: options.force === true,
    realLighting: options.realLighting === true,
    lightingEnabled: options.lightingEnabled !== false,
    streaming: options.streaming === true,
    progressId,
  });
  return scenePayload(client,event,res,{progressId});
});
async function scenePayload(client,event,res,options={}) {
  requireCurrentEngine(client);
  if(options.progressId)event.sender.send('engine:event',{event:'previewProgress',progressId:options.progressId,stage:'transfer'});
  const atlasBuffer = await fs.promises.readFile(res.atlas);
  const meshBytes = (await fs.promises.stat(res.mesh)).size;
  requireCurrentEngine(client);
  diagnostic(options.growing?'progressive detail stream opened: '+res.committedBytes+' committed bytes':'scene exported: ' + meshBytes + ' bytes, ' + res.quads + ' faces');
  let payload;
  if (['LMESH5','LMESH6','LMESH7'].includes(res.meshFormat) || meshBytes > INLINE_LIMIT) {
    payload = { meshTransfer: await (options.transfer||sceneTransfer).open(res.mesh, event.sender.id,{...options,committedBytes:res.committedBytes}) };
    diagnostic(['LMESH5','LMESH6','LMESH7'].includes(res.meshFormat)?'using sectioned scene transfer':'transferring complete mesh in batches');
  } else {
    const meshBuffer = await fs.promises.readFile(res.mesh);
    payload = { meshArrayBuffer: meshBuffer.buffer.slice(meshBuffer.byteOffset, meshBuffer.byteOffset + meshBuffer.byteLength) };
  }
  requireCurrentEngine(client);
  return {
    ...res,
    ...payload,
    atlasArrayBuffer: atlasBuffer.buffer.slice(atlasBuffer.byteOffset, atlasBuffer.byteOffset + atlasBuffer.byteLength),
  };
}
ipcMain.handle('engine:previewDiagnostic', (_event, message) => { diagnostic(String(message).slice(0, 1500)); });

handleEngine('engine:searchBlocks',(client,_event,request)=>client.call('searchBlocks',request));
handleEngine('engine:editPick',(client,_event,request)=>client.call('editPick',request));
handleEngine('engine:editBlock',(client,_event,request)=>client.call('editBlock',request));
handleEngine('engine:editRegion',(client,_event,request)=>client.call('editRegion',request));
handleEngine('engine:selectionStats',(client,_event,request)=>client.call('selectionStats',request));
handleEngine('engine:editStates',(client,_event,positions)=>client.call('editStates',{positions}));
handleEngine('engine:inspectPosition',(client,_event,position)=>client.call('inspectPosition',{position}));
handleEngine('engine:commitEdits',async client=>{const result=await client.call('commitEdits',{rebasePreview:true});requireCurrentEngine(client);if(result.changed)openedSchematic=result.path;return result;});
handleEngine('engine:editPatch',async(client,_event,options={})=>{
  const result=await client.call('editPatch',{directory:path.join(APP_HOME,'renders','.edit','preview'),selection:options.selection});requireCurrentEngine(client);if(result.empty||result.rebuildRequired)return result;
  const atlasUnchanged=!!(result.atlasRevision&&options.knownAtlasRevision===result.atlasRevision);
  const [buffer,atlas,selected]=await Promise.all([
    fs.promises.readFile(result.mesh),
    atlasUnchanged?null:fs.promises.readFile(result.atlas),
    result.selectionMesh?fs.promises.readFile(result.selectionMesh):null,
  ]);
  return {cells:result.cells,revision:result.revision,quads:result.quads,atlasRevision:result.atlasRevision,atlasCached:atlasUnchanged,meshArrayBuffer:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),selectionArrayBuffer:selected?selected.buffer.slice(selected.byteOffset,selected.byteOffset+selected.byteLength):null,atlasArrayBuffer:atlas?atlas.buffer.slice(atlas.byteOffset,atlas.byteOffset+atlas.byteLength):null};
});
handleEngine('engine:exportEdited',async(client,_event,request={})=>{
  const result=await dialog.showSaveDialog(mainWindow,{title:'导出修改后的投影',defaultPath:request.suggested||'更改投影.litematic',filters:[{name:'Litematica 投影',extensions:['litematic']}]});
  if(result.canceled||!result.filePath)return null;requireCurrentEngine(client);
  const output=/\.litematic$/i.test(result.filePath)?result.filePath:result.filePath+'.litematic';
  return client.call('exportEdited',{out:output});
});


/** 用户资源路径持久化保存，加载在内置包之后以覆盖其外观。 */
const packStore = {
  file: () => path.join(APP_HOME, 'renders', 'packs.json'),
  removedFile: () => path.join(APP_HOME, 'settings', 'removed-builtins.json'),
  async removed() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.removedFile(), 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : [];
    } catch { return []; }
  },
  async writeRemoved(list) {
    const file = this.removedFile();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file + '.tmp', JSON.stringify(list, null, 2), 'utf8');
    await fs.promises.rename(file + '.tmp', file);
  },
  async read() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.file(), 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  async write(list) {
    await fs.promises.mkdir(path.dirname(this.file()), { recursive: true });
    await fs.promises.writeFile(this.file(), JSON.stringify(list, null, 2), 'utf8');
  },
};

ipcMain.handle('packs:list', () => packStore.read());

ipcMain.handle('packs:import', async (_e, file) => {
  const name = path.basename(file);
  if (path.resolve(file) === path.resolve(APP_HOME, 'assets', 'builtin', name)) {
    await packStore.writeRemoved((await packStore.removed()).filter(p => p !== name));
    return packStore.read();
  }
  const list = await packStore.read();
  if (!list.includes(file)) list.push(file);
  await packStore.write(list);
  return list;
});

ipcMain.handle('packs:removeBuiltin', async (_e, name) => {
  if (typeof name !== 'string' || path.basename(name) !== name || !name.toLowerCase().endsWith('.zip')) {
    throw new Error('无法删除这个内置材质包');
  }
  const file = path.join(APP_HOME, 'assets', 'builtin', name);
  if (!(await fs.promises.stat(file)).isFile()) throw new Error('内置材质包不存在');
  const removed = await packStore.removed();
  if (!removed.includes(name)) removed.push(name);
  await packStore.writeRemoved(removed);
});

ipcMain.handle('packs:remove', async (_e, path) => {
  const list = (await packStore.read()).filter((p) => p !== path);
  await packStore.write(list);
  return list;
});

ipcMain.handle('packs:move', async (_e, { path, direction }) => {
  const list = await packStore.read();
  const i = list.indexOf(path);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i >= 0 && j >= 0 && j < list.length) {
    list.splice(i, 1);
    list.splice(j, 0, path);
    await packStore.write(list);
  }
  return list;
});

ipcMain.handle('dialog:openSchematic', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: '打开投影或结构文件',
    filters: [
      { name: '投影和 Java 结构', extensions: schematicFormats.extensions },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:savePng', async (_e, suggested) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出 PNG',
    defaultPath: suggested || 'render.png',
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('dialog:saveGif', async (_e, suggested) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: '导出旋转 GIF',
    defaultPath: suggested || 'animation.gif',
    filters: [{ name: 'GIF 动画', extensions: ['gif'] }],
  });
  if (res.canceled) return null;
  return /\.gif$/i.test(res.filePath) ? res.filePath : res.filePath + '.gif';
});

ipcMain.handle('dialog:openPack', async (_event, kind) => {
  const folder=kind==='folder';
  const res = await dialog.showOpenDialog(mainWindow, {
    title: folder?'导入材质包文件夹':'导入材质包压缩包（zip）',
    filters: [
      { name: '资源包', extensions: ['zip'] },
      { name: '所有文件', extensions: ['*'] },
    ],
    properties: [folder?'openDirectory':'openFile'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('shell:reveal', (_e, target) => {
  if (target && fs.existsSync(target)) shell.showItemInFolder(target);
});

ipcMain.handle('updater:status', async () => {
  const settings = await uiSettings.read();
  return { ...appUpdater.snapshot(), ignoredVersion: settings.ignoredUpdateVersion || '' };
});
ipcMain.handle('updater:check', async (_e, options = {}) => {
  const res = await appUpdater.check(options && typeof options === 'object' ? options : {});
  const settings = await uiSettings.read();
  return { ...res, ignoredVersion: settings.ignoredUpdateVersion || '' };
});
ipcMain.handle('updater:downloadPatch', async () => appUpdater.downloadAndStagePatch());
ipcMain.handle('updater:downloadInstaller', async () => appUpdater.downloadInstaller());
ipcMain.handle('updater:ignoreVersion', async (_e, version) => {
  const clean = typeof version === 'string' ? version.trim().slice(0, 64) : '';
  await uiSettings.save({ ignoredUpdateVersion: clean });
  return { ignoredVersion: clean };
});
ipcMain.handle('updater:openExternal', async (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9.-]+/i.test(url)) {
    throw Error('无效的外部下载链接');
  }
  await shell.openExternal(url);
  return { ok: true };
});
ipcMain.handle('updater:applyAndRestart', async () => {
  const launcher = path.join(APP_HOME, '投影预览.exe');
  if (!fs.existsSync(launcher)) {
    throw Error('未找到安装目录启动器：' + launcher);
  }
  if (!appUpdater.snapshot().pending) {
    throw Error('当前没有待应用的更新补丁');
  }
  pendingPostQuitLaunch = {
    exe: launcher,
    args: ['--apply-update', '--wait-pid', String(process.pid)],
  };
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  });
  return { scheduled: true };
});
ipcMain.handle('updater:launchInstaller', async (_e, file) => {
  const downloadsRoot = path.resolve(APP_HOME, 'updates', 'downloads') + path.sep;
  const resolved = typeof file === 'string' ? path.resolve(file) : '';
  if (!resolved.startsWith(downloadsRoot) || !resolved.toLowerCase().endsWith('.exe') || !fs.existsSync(resolved)) {
    throw Error('未找到已校验的安装程序文件');
  }
  pendingPostQuitLaunch = { exe: resolved, args: [] };
  setImmediate(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
  });
  return { scheduled: true };
});

// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  createWindow();
  try {
    await startEngine();
  } catch (err) {
    if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('engine:exit', { error: String(err && err.message ? err.message : err) });
      });
    }
  }

  // 命令行传入的投影在启动后打开，支持拖到 EXE 和文件关联。

  const cliFile = process.argv.slice(1).find((a) => schematicFormats.accepts(a));
  if (cliFile && mainWindow) {
    startupFile = path.resolve(cliFile);
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.send('app:openFile', startupFile);
    });
  }

  if (process.env.LITEMATIC_DISABLE_AUTO_UPDATE !== '1') {
    const timer = setTimeout(() => {
      appUpdater.check().catch(() => {});
    }, 2800);
    timer.unref?.();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', event => {
  if(shutdownComplete)return;
  event.preventDefault();
  if(!shutdownPromise)shutdownPromise=(async()=>{
    try {
      await sceneTransfer.close();
      await selectionTransfer.close();
      for (const session of gpuGifSpools.values()) {
        session.aborted = true;
        try { await session.handle.close(); } catch { }
        try { await fs.promises.rm(session.directory, { recursive: true, force: true }); } catch { }
      }
      gpuGifSpools.clear();
      await backgroundExports.close();
      if(renderStopPromise)await renderStopPromise.catch(()=>{});
      // 提交排在在途修改之后，不依赖界面是否已收到修改回复。
      if(engine?.isRunning()&&!renderStopPromise)await engine.call('commitEdits',{});
      if(engine)await engine.stop();
      await uiSettings.queue;
      if((await uiSettings.read()).clearCacheOnExit){await clearRenderingCache(APP_HOME);diagnostic('render cache cleared on exit');}
    }catch(error){diagnostic('exit cleanup failed: '+(error.stack||error.message));}
    finally{
      if (pendingPostQuitLaunch && fs.existsSync(pendingPostQuitLaunch.exe)) {
        try {
          const child = spawn(pendingPostQuitLaunch.exe, pendingPostQuitLaunch.args, {
            cwd: APP_HOME,
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
          });
          child.unref();
        } catch (err) {
          diagnostic('post-quit update launch failed: ' + (err?.message || err));
        }
      }
      shutdownComplete=true;app.quit();
    }
  })();
});
