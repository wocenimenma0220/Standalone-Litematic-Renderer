'use strict';

const { app, BrowserWindow, dialog, shell, nativeImage, clipboard } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '../../..');
const root = process.argv[2] || repo;
process.argv = process.argv.slice(0, 2);

const out = path.join(__dirname, '../ui-upgrade-output', root === repo ? 'source' : 'package');
try { fs.rmSync(out, { recursive: true, force: true }); } catch { }
fs.mkdirSync(out, { recursive: true });
for (const sub of ['sheet-drop', 'configured-sheet-dir']) {
  fs.rmSync(path.join(out, sub), { recursive: true, force: true });
}

process.env.JAVA_TOOL_OPTIONS = (process.env.JAVA_TOOL_OPTIONS || '') + ' -Dlitematicrender.skins.offline=true';
process.env.LITEMATIC_HOT_RELOAD = '1';
process.env.LITEMATIC_DISABLE_AUTO_UPDATE = '1';
app.setPath('userData', path.join(out, 'electron'));
BrowserWindow.prototype.show = function () {
  this.setPosition(-20000, -20000, false);
  this.showInactive();
};
app.commandLine.appendSwitch('disable-renderer-backgrounding');

const settingsModule = require(path.join(root, 'webapp/ui-settings'));
const OriginalSettings = settingsModule.UiSettings;
settingsModule.UiSettings = class extends OriginalSettings {
  constructor() { super(out); }
};
const settingsFile = path.join(out, 'settings/ui.json');
fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
fs.writeFileSync(settingsFile, JSON.stringify({
  hideWelcome: true,
  backgroundMode: 'checker',
  previewBackend: 'gpu',
}));

const saves = [];
dialog.showSaveDialog = async () => {
  if (!saves.length) throw Error('Unexpected save dialog');
  return { canceled: false, filePath: saves.shift() };
};
shell.showItemInFolder = () => {};

function pngPixels(file) {
  const img = nativeImage.createFromPath(file);
  const size = img.getSize();
  const bgra = img.toBitmap();
  return { size, bgra };
}

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const run = code => win.webContents.executeJavaScript('(async()=>{' + code + '})()');
    try {
      const schematicFile = process.env.LITEMATIC_TEST_SCHEMATIC || [
        path.join(repo, 'tools/verify/fly-output/inspection.litematic'),
        path.join(repo, 'tools/verify/verification-output/pipeline-home/pipeline.litematic'),
        path.join(repo, 'docs/examples/功能演示.litematic'),
      ].find(p => fs.existsSync(p));
      if (!schematicFile) throw Error('No test schematic fixture found');

      // 1. Frameless window + custom window controls + base-select CSS support
      const bounds = win.getBounds();
      const contentBounds = win.getContentBounds();
      assert.equal(bounds.height, contentBounds.height, 'Expected frameless BrowserWindow content height == bounds height');

      const uiCheck = await run(`
        await window.__uiReady;
        await window.engine.loadResources(null);
        await loadFile(${JSON.stringify(schematicFile)});
        if (!state.viewReady) throw Error('GPU preview not ready');
        const supportsBaseSelect = CSS.supports('appearance', 'base-select');
        const selectStyles = ['#exportMode', '#bgMode', '#size', '#selectionMode'].map(sel => {
          const el = document.querySelector(sel);
          return { sel, appearance: getComputedStyle(el).appearance };
        });
        const controls = ['#winMinimize', '#winMaximize', '#winClose', '#btnCheckUpdate'].map(s => !!document.querySelector(s));
        const upStatus = await window.updaterApi.status();
        if (upStatus.distribution !== 'portable' || upStatus.canPatch !== false) {
          throw Error('Unexpected distribution in source tree: ' + JSON.stringify(upStatus));
        }
        return { supportsBaseSelect, selectStyles, controls, totalBlocks: state.info.totalBlocks };
      `);
      assert.equal(uiCheck.supportsBaseSelect, true, 'Chromium must support appearance: base-select');
      for (const s of uiCheck.selectStyles) {
        assert.equal(s.appearance, 'base-select', `${s.sel} did not get appearance: base-select`);
      }
      assert.deepEqual(uiCheck.controls, [true, true, true, true], 'Missing top-right window/update controls');

      // Toggle maximize via custom button
      await run(`document.getElementById('winMaximize').click(); await new Promise(r => setTimeout(r, 150));`);
      const maxState = await run(`return { cls: document.body.classList.contains('is-maximized'), attr: document.getElementById('winMaximize').dataset.maximized };`);
      assert.equal(win.isMaximized(), true, '#winMaximize did not maximize window');
      assert.equal(maxState.cls, true, 'is-maximized class missing');
      assert.equal(maxState.attr, 'true', 'data-maximized attr missing');
      await run(`document.getElementById('winMaximize').click(); await new Promise(r => setTimeout(r, 150));`);
      assert.equal(win.isMaximized(), false, '#winMaximize did not restore window');

      // 2. Toolbar layout at 980x660 with #exportMode + #btnSheetMode + #bgMode + no blue focus border
      win.setSize(980, 660);
      await run(`await new Promise(r => setTimeout(r, 120));`);
      const toolbarLayout = await run(`
        const ids = ['btnStopRender', 'exportMode', 'btnSheetMode', 'bgMode', 'btnImportBackground', 'btnToggleConsole', 'btnFullscreen'];
        const rects = ids.map(id => {
          const el = document.getElementById(id);
          const r = el.getBoundingClientRect();
          return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });
        for (let i = 1; i < rects.length; i++) {
          if (rects[i - 1].right > rects[i].left + 1) {
            throw Error('Toolbar overlap: ' + JSON.stringify({ a: rects[i - 1], b: rects[i] }));
          }
        }
        const tail = rects[rects.length - 1];
        if (tail.right > window.innerWidth + 1) throw Error('Toolbar clipped: ' + tail.right + ' > ' + window.innerWidth);
        els.exportMode.focus();
        const focusedStyle = getComputedStyle(els.exportMode);
        if (focusedStyle.outlineStyle !== 'none' || focusedStyle.borderColor.includes('77, 140, 224') || focusedStyle.boxShadow.includes('44, 109, 194')) {
          throw Error('Blue focus border still present on select: ' + JSON.stringify({ outline: focusedStyle.outline, border: focusedStyle.borderColor, shadow: focusedStyle.boxShadow }));
        }
        els.exportMode.blur();
        return rects;
      `);

      // 3. --dev Hot-Reload CSS HMR check (preserves state.viewReady)
      const stylePath = path.join(root, 'webapp/renderer/style.css');
      const cssBefore = await run(`return document.querySelector('link[href*="style.css"]').getAttribute('href');`);
      const originalCss = fs.readFileSync(stylePath);
      fs.writeFileSync(stylePath, originalCss);
      await run(`
        const end = Date.now() + 4000;
        while (Date.now() < end) {
          if (document.querySelector('link[href*="style.css"]').getAttribute('href') !== ${JSON.stringify(cssBefore)}) break;
          await new Promise(r => setTimeout(r, 50));
        }
      `);
      const hmrCheck = await run(`
        return {
          hrefAfter: document.querySelector('link[href*="style.css"]').getAttribute('href'),
          stillReady: state.viewReady,
        };
      `);
      assert.notEqual(hmrCheck.hrefAfter, cssBefore, 'CSS hot-reload did not bust stylesheet cache');
      assert.equal(hmrCheck.stillReady, true, 'CSS hot-reload dropped WebGL scene state');

      // 4. GPU Fast Export PNG + GIF + exportMode persistence
      await run(`
        els.exportMode.value = 'cpu';
        els.exportMode.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 60));
      `);
      assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).exportMode, 'cpu', 'exportMode=cpu not persisted');
      await run(`
        els.exportMode.value = 'gpu';
        els.exportMode.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 60));
      `);
      assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).exportMode, 'gpu', 'exportMode=gpu not persisted');

      const gpuCheckerPng = path.join(out, 'gpu-checker.png');
      const gpuWhitePng = path.join(out, 'gpu-white.png');
      const gpuGifPath = path.join(out, 'gpu-anim.gif');
      await run(`
        els.bgMode.value = 'checker'; els.bgMode.dispatchEvent(new Event('change'));
        await exportPng({ size: 256, mode: 'gpu', out: ${JSON.stringify(gpuCheckerPng)} });
        els.bgMode.value = 'white'; els.bgMode.dispatchEvent(new Event('change'));
        await exportPng({ size: 256, mode: 'gpu', out: ${JSON.stringify(gpuWhitePng)} });
        els.bgMode.value = 'checker'; els.bgMode.dispatchEvent(new Event('change'));
        const submitted = await exportGif({ size: 128, frames: 8, delay: 2, mode: 'gpu', out: ${JSON.stringify(gpuGifPath)} });
        if (!submitted?.id) throw Error('GPU GIF export did not return job id');
        const endGif = Date.now() + 120000;
        while (!['completed', 'failed', 'cancelled'].includes(exportJobs.get(submitted.id)?.state)) {
          if (Date.now() > endGif) throw Error('GPU GIF background encode timeout');
          await new Promise(r => setTimeout(r, 25));
        }
        const gifJob = exportJobs.get(submitted.id);
        if (!gifJob || gifJob.state !== 'completed' || !gifJob.result?.gpu) {
          throw Error('GPU GIF export unexpected result: ' + JSON.stringify(gifJob));
        }
      `);
      const checkerDecoded = pngPixels(gpuCheckerPng);
      const whiteDecoded = pngPixels(gpuWhitePng);
      assert.equal(checkerDecoded.size.width, 256);
      assert.equal(whiteDecoded.size.width, 256);
      let hasTransparent = false, hasOpaque = false;
      for (let i = 3; i < checkerDecoded.bgra.length; i += 4) {
        if (checkerDecoded.bgra[i] === 0) hasTransparent = true;
        if (checkerDecoded.bgra[i] > 240) hasOpaque = true;
      }
      assert.equal(hasTransparent && hasOpaque, true, 'GPU checker PNG must contain both transparent background and opaque model pixels');
      let allOpaqueWhite = true;
      for (let i = 3; i < whiteDecoded.bgra.length; i += 4) {
        if (whiteDecoded.bgra[i] !== 255) { allOpaqueWhite = false; break; }
      }
      assert.equal(allOpaqueWhite, true, 'GPU white background PNG must have alpha=255 everywhere');
      assert.equal(fs.readFileSync(gpuGifPath).subarray(0, 6).toString('ascii'), 'GIF89a', 'Invalid GIF89a header');

      // 5. Expanded command router (/ level-1, // level-2, Tab, History, Bulk Edit + Undo/Redo)
      const cmdReport = await run(`
        const execCmd = async (text) => {
          selectionUi.command.value = text;
          await submitCommand();
          if (!selectionUi.feedback.classList.contains('hidden')) {
            throw Error('Command "' + text + '" failed: ' + selectionUi.feedback.textContent);
          }
        };

        $('openCommand').click();
        if (selectionUi.command.value !== '/') throw Error('Default command prefix should be /');

        // Tab autocomplete & error retention + history recall
        selectionUi.command.value = '/clear';
        selectionUi.command.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        if (selectionUi.command.value !== '/clearsearch ') throw Error('Tab completion failed: ' + selectionUi.command.value);

        // /commands & /help & /pos
        await execCmd('/help');
        await execCmd('/help //set');
        await execCmd('/pos');

        // Camera & view commands
        await execCmd('/view top');
        if (Number(els.slant.value) !== 89) throw Error('/view top did not update slant');
        await execCmd('/zoom 1.5');
        if (Math.abs(state.zoom - 1.5) > 1e-4) throw Error('/zoom failed');
        await execCmd('/fly on');
        if (!state.fly) throw Error('/fly on failed');
        await execCmd('/tp 2 5 4 90 -15');
        if (Math.abs(state.flyPos[0] - 2) > 1e-4 || Math.abs(state.flyPos[1] - 5) > 1e-4) throw Error('/tp failed');
        await execCmd('/fly off');
        if (state.fly) throw Error('/fly off failed');

        // View distance, background, search, sidebar, console, layer
        await execCmd('/vd 12');
        if (state.viewDistance !== 12) throw Error('/vd 12 failed');
        await execCmd('/bg sky');
        if (els.bgMode.value !== 'sky') throw Error('/bg sky failed');
        await execCmd('/bg checker');
        await execCmd('/sidebar off');
        if (!state.sidebarCollapsed) throw Error('/sidebar off failed');
        await execCmd('/sidebar on');
        if (state.sidebarCollapsed) throw Error('/sidebar on failed');
        await execCmd('/console off');
        if (!$('debugConsole').classList.contains('hidden')) throw Error('/console off failed');
        await execCmd('/console on');
        await execCmd('/search stone');
        if (window.blockSearch.active) {
          await execCmd('/locate 1');
          await execCmd('/fly off');
          await execCmd('/clearsearch');
        }
        await execCmd('/layer 1');
        if (state.selection.mode !== 'layer' || state.selection.layer !== 1) throw Error('/layer 1 failed');
        await execCmd('/layer off');

        // Level-2 selection manipulation & stats
        await execCmd('//pos1 0 0 0');
        await execCmd('//pos2 2 1 2');
        if (state.selection.corners[0].join(',') !== '0,0,0' || state.selection.corners[1].join(',') !== '2,1,2') {
          throw Error('//pos1 //pos2 mismatch');
        }
        await execCmd('//expand 1 up');
        if (state.selection.corners[1][1] !== 2) throw Error('//expand failed');
        await execCmd('//contract 1 down');
        if (state.selection.corners[1][1] !== 1 || state.selection.corners[0][1] !== 0) {
          throw Error('//contract down did not pull top boundary down: ' + JSON.stringify(state.selection.corners));
        }
        await execCmd('//expand 1 down');
        if (state.selection.corners[0][1] !== -1) throw Error('//expand down failed');
        await execCmd('//contract 1 up');
        if (state.selection.corners[0][1] !== 0) throw Error('//contract up failed');
        await execCmd('//shift 1 east');
        if (state.selection.corners[0][0] !== 1 || state.selection.corners[1][0] !== 3) throw Error('//shift failed');
        await execCmd('//shift 1 west');
        await execCmd('//outset 1 -h');
        if (state.selection.corners[0][0] !== -1 || state.selection.corners[1][0] !== 3 || state.selection.corners[1][1] !== 1) {
          throw Error('//outset -h failed');
        }
        await execCmd('//inset 1 -h');
        if (state.selection.corners[0].join(',') !== '0,0,0' || state.selection.corners[1].join(',') !== '2,1,2') {
          throw Error('//inset -h failed');
        }
        await execCmd('//size');
        await execCmd('//count 石头');
        await execCmd('//distr');

        // Level-2 3D edit //set -> //replace -> //undo -> //redo -> //undo
        const originalBlocks = state.info.totalBlocks;
        await execCmd('//set 石头');
        const afterSet = state.info.totalBlocks;
        if (afterSet === originalBlocks) {
          // If selection happened to be all stone already, fill with oak_planks instead to observe diff
          await execCmd('//set oak_planks[axis=y]');
        }
        await execCmd('//replace glass');
        await execCmd('//undo');
        await execCmd('//redo');
        await execCmd('//undo');
        await execCmd('//undo');
        if (state.info.totalBlocks !== originalBlocks && afterSet !== originalBlocks) {
          throw Error('//undo did not restore original block count: ' + state.info.totalBlocks + ' vs ' + originalBlocks);
        }

        // ArrowUp history recall & invalid command preservation
        selectionUi.command.value = '';
        selectionUi.command.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        const recalled = selectionUi.command.value;
        selectionUi.command.value = '/no_such_command_xyz';
        await submitCommand();
        const errPreserved = selectionUi.command.value === '/no_such_command_xyz' && !selectionUi.feedback.classList.contains('hidden');
        selectionUi.command.value = '';
        commandFeedback();
        await execCmd('//desel');
        return { originalBlocks, afterSet, finalBlocks: state.info.totalBlocks, recalled, errPreserved };
      `);
      assert.equal(cmdReport.errPreserved, true, 'Invalid command should keep input & show feedback');
      assert.equal(cmdReport.recalled, '//undo', 'ArrowUp did not recall last command');

      // 6. WikiRenderer-26.3 view presets, adaptive layout, & pure 导出模式 auto-export on drop/open
      const dropDir = path.join(out, 'sheet-drop');
      fs.mkdirSync(dropDir, { recursive: true });
      const dropCopy = path.join(dropDir, 'demo-card.litematic');
      fs.copyFileSync(schematicFile, dropCopy);

      const customOutDir = path.join(out, 'configured-sheet-dir');
      fs.mkdirSync(customOutDir, { recursive: true });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [customOutDir] });

      const sheetCheck = await run(`
        // Check preset library & controls
        if (!window.ViewPresets || window.ViewPresets.LIST.length < 15) {
          throw Error('Expected >= 15 WikiRenderer/KCL view presets');
        }
        els.viewPreset.value = 'dimetric_wiki';
        els.viewPreset.dispatchEvent(new Event('change'));
        if (Number(els.rotation.value) !== 135 || Number(els.slant.value) !== 30) {
          throw Error('Wiki default preset failed: ' + els.rotation.value + '/' + els.slant.value);
        }
        els.rotate90.click();
        if (Number(els.rotation.value) !== 225) throw Error('rotate90 failed: ' + els.rotation.value);
        els.flipSlant.click();
        if (Number(els.slant.value) !== 89) throw Error('flipSlant failed: ' + els.slant.value);

        // Adaptive layout check: flat schematic vs tall schematic must adapt width vs height ratio
        const flat = SheetExporter.computeAdaptiveLayout({ size: { x: 40, y: 4, z: 12 } }, ViewPresets.find('front'), ViewPresets.find('back'), 2048);
        const tall = SheetExporter.computeAdaptiveLayout({ size: { x: 6, y: 40, z: 6 } }, ViewPresets.find('front'), ViewPresets.find('back'), 2048);
        if (!(flat.panelW1 > flat.panelH && tall.panelH > tall.panelW1)) {
          throw Error('Adaptive aspect ratio failed: ' + JSON.stringify({ flat, tall }));
        }

        // Configure custom default save folder + custom dual views + enable pure 导出模式
        $('btnSheetDirBrowse').click();
        await new Promise(r => setTimeout(r, 80));
        if ($('sheetOutputDir').value !== ${JSON.stringify(customOutDir)}) {
          throw Error('sheetOutputDir UI did not update: ' + $('sheetOutputDir').value);
        }
        els.sheetView1.value = 'iso_wiki';
        els.sheetView1.dispatchEvent(new Event('change'));
        els.sheetView2.value = 'top';
        els.sheetView2.dispatchEvent(new Event('change'));
        els.sheetMode.click();
        if (!state.sheetMode || els.sheetMode.getAttribute('aria-pressed') !== 'true') {
          throw Error('导出模式 toggle failed');
        }
        await loadFile(${JSON.stringify(dropCopy)});
        if (state.viewReady) throw Error('导出模式 should not mount interactive 3D viewport on open');
        if (!state.lastSheet || !state.lastSheet.out || $('sheetResultPanel').classList.contains('hidden')) {
          const tail = Array.from(els.log.children).slice(-6).map(el => el.textContent);
          throw Error('导出模式 did not output showcase sheet automatically: ' + JSON.stringify({ status: els.status.textContent, lastSheet: state.lastSheet, hidden: $('sheetResultPanel').classList.contains('hidden'), tail }));
        }
        // Check 3D canvas hidden in export mode & wheel zoom works on showcase image without zooming background 3D camera
        const glDisplay = getComputedStyle(els.gl).display;
        if (glDisplay !== 'none') throw Error('3D canvas must stay display:none in export mode, got ' + glDisplay);
        const initialCamZoom = state.zoom;
        const stageEl = $('sheetResultStage');
        stageEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, clientX: 500, clientY: 300, bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 40));
        const zoomedLabel = $('sheetZoomLabel')?.textContent;
        const zoomedTransform = $('sheetResultImage')?.style.transform || '';
        if (!zoomedLabel || zoomedLabel === '适应' || !zoomedTransform.includes('scale(')) {
          throw Error('Showcase image wheel zoom failed: ' + JSON.stringify({ zoomedLabel, zoomedTransform }));
        }
        if (Math.abs(state.zoom - initialCamZoom) > 1e-6) {
          throw Error('Showcase wheel leaked to 3D camera zoom: ' + state.zoom);
        }
        stageEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        if ($('sheetZoomLabel')?.textContent !== '适应') {
          throw Error('Showcase dblclick did not reset zoom: ' + $('sheetZoomLabel')?.textContent);
        }

        const firstOut = state.lastSheet.out;
        const firstDims = { w: state.lastSheet.width, h: state.lastSheet.height, v1: state.lastSheet.view1.id, v2: state.lastSheet.view2.id, copied: state.lastSheet.copied };

        // Change #size to 512 and 2048 and click #btnRender (重新渲染) -> must resize showcase & NOT build 3D view behind
        els.size.value = '512';
        els.size.dispatchEvent(new Event('change'));
        await rebuildPreview();
        const smallDims = { w: state.lastSheet.width, h: state.lastSheet.height };
        if (state.viewReady) throw Error('#btnRender in 导出模式 built 3D model behind panel!');
        els.size.value = '2048';
        els.size.dispatchEvent(new Event('change'));
        await rebuildPreview();
        const largeDims = { w: state.lastSheet.width, h: state.lastSheet.height };
        if (!(smallDims.w < firstDims.w && firstDims.w < largeDims.w)) {
          throw Error('Resolution setting did not scale showcase dimensions: ' + JSON.stringify({ smallDims, firstDims, largeDims }));
        }
        els.size.value = '1024';

        // Reset default save folder back to empty and verify UI label
        $('btnSheetDirReset').click();
        await new Promise(r => setTimeout(r, 60));
        const resetLabel = $('sheetOutputDir').value;

        // Test REAL pointerdown -> pointerup -> click on #btnSheetExit exits 导出模式 and rebuilds 3D preview
        const exitBtn = $('btnSheetExit');
        const br = exitBtn.getBoundingClientRect();
        const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
        exitBtn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
        exitBtn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, clientX: cx, clientY: cy, bubbles: true, cancelable: true }));
        exitBtn.click();
        if (state.sheetMode) throw Error('#btnSheetExit did not exit 导出模式');
        const end3d = Date.now() + 60000;
        while (!state.viewReady || state.rendering) {
          if (Date.now() > end3d) throw Error('Exiting 导出模式 did not rebuild 3D preview');
          await new Promise(r => setTimeout(r, 30));
        }
        return { firstOut, firstDims, smallDims, largeDims, zoomedLabel, resetLabel, rebuiltInteractive: state.viewReady };
      `);
      assert.equal(path.dirname(sheetCheck.firstOut), customOutDir, 'Configured default output folder not used: ' + sheetCheck.firstOut);
      assert.equal(fs.existsSync(sheetCheck.firstOut), true, 'Auto showcase PNG missing on disk: ' + sheetCheck.firstOut);
      const sheetImg = pngPixels(sheetCheck.firstOut);
      assert.equal(sheetImg.size.width, sheetCheck.firstDims.w);
      assert.equal(sheetImg.size.height, sheetCheck.firstDims.h);
      assert.equal(sheetCheck.firstDims.copied, true, 'Expected clipboard copy flag to be true');
      const clipItems = typeof clipboard.read === 'function' ? await clipboard.read() : [];
      assert.equal(clipItems.length > 0 && clipItems[0].types.includes('image/png'), true, 'Expected image/png item in system clipboard');
      const clipBlob = await clipItems[0].getType('image/png');
      const clipImg = nativeImage.createFromBuffer(Buffer.from(await clipBlob.arrayBuffer()));
      assert.equal(clipImg.isEmpty(), false, 'Expected non-empty decoded clipboard PNG');
      assert.equal(clipImg.getSize().width, sheetCheck.largeDims.w);
      assert.equal(clipImg.getSize().height, sheetCheck.largeDims.h);
      assert.equal(sheetCheck.firstDims.v1, 'iso_wiki');
      assert.equal(sheetCheck.firstDims.v2, 'top');
      assert.equal(sheetCheck.resetLabel, '与投影同目录');
      assert.equal(sheetCheck.rebuiltInteractive, true);
      const persistedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      assert.equal(persistedSettings.sheetView1, 'iso_wiki');
      assert.equal(persistedSettings.sheetView2, 'top');
      assert.equal(persistedSettings.sheetOutputDir, '');

      const summary = {
        pass: true,
        frameless: true,
        supportsBaseSelect: true,
        noSelectBlueRing: true,
        toolbarCount: toolbarLayout.length,
        hotReload: true,
        gpuExportPngGif: true,
        sheetMode: {
          ...sheetCheck.firstDims,
          smallW: sheetCheck.smallDims.w,
          largeW: sheetCheck.largeDims.w,
          zoomedLabel: sheetCheck.zoomedLabel,
          rebuiltInteractive: sheetCheck.rebuiltInteractive,
        },
        commands: cmdReport,
      };
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary));
      app.quit();
    } catch (error) {
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ pass: false, error: error.stack || error.message }, null, 2));
      console.error(error);
      app.exit(1);
    }
  });
});

require(path.join(root, 'webapp/main.js'));
setTimeout(() => { console.error('UI upgrade verification timed out'); app.exit(1); }, 300000).unref();
