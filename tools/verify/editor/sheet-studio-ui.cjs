'use strict';

const { app, BrowserWindow, dialog, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = process.argv[2] || path.resolve(__dirname, '../../..');
const out = path.join(__dirname, '../sheet-studio-output');
process.argv = process.argv.slice(0, 2);

fs.mkdirSync(out, { recursive: true });
for (const f of ['01-studio-empty.png', '02-studio-customized.png', '03-exported-sheet.png', '04-studio-smart-guides.png', 'rich-meta.litematic', 'rich-meta_双视角展示图.png', 'custom-badge.png', 'result.json']) {
  try { fs.unlinkSync(path.join(out, f)); } catch {}
}
try { fs.unlinkSync(path.join(out, 'settings/ui.json')); } catch {}
try { fs.rmSync(path.join(out, 'settings'), { recursive: true, force: true }); } catch {}
fs.mkdirSync(path.join(out, 'settings'), { recursive: true });
fs.writeFileSync(path.join(out, 'settings/ui.json'), JSON.stringify({ hideWelcome: true, sheetMode: false }));
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
function nbtLong(val) {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(val), 0);
  return b;
}
function nbtDouble(val) {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(val, 0);
  return b;
}
function nbtCompound(fields) {
  return Buffer.concat([...fields, Buffer.from([0])]);
}
function nbtList(elemType, payloads) {
  return Buffer.concat([Buffer.from([elemType]), nbtInt(payloads.length), ...payloads]);
}
function nbtIntArray(ints) {
  const b = Buffer.alloc(4 + ints.length * 4);
  b.writeInt32BE(ints.length, 0);
  for (let i = 0; i < ints.length; i++) b.writeInt32BE(ints[i] | 0, 4 + i * 4);
  return b;
}
function nbtLongArray(longs) {
  const b = Buffer.alloc(4 + longs.length * 8);
  b.writeInt32BE(longs.length, 0);
  for (let i = 0; i < longs.length; i++) b.writeBigInt64BE(BigInt(longs[i]), 4 + i * 8);
  return b;
}

function buildRichLitematic() {
  const xyz = (x, y, z) => nbtCompound([nbtField(3, 'x', nbtInt(x)), nbtField(3, 'y', nbtInt(y)), nbtField(3, 'z', nbtInt(z))]);
  const paletteEntry = name => nbtCompound([nbtField(8, 'Name', nbtUtf8(name))]);
  const previewPixels = Array.from({ length: 16 * 16 }, (_, idx) => (idx % 3 === 0 ? 0xff3c8527 : 0xff2b2d34));

  const region = nbtCompound([
    nbtField(10, 'Position', xyz(0, 0, 0)),
    nbtField(10, 'Size', xyz(4, 2, 2)),
    nbtField(9, 'BlockStatePalette', nbtList(10, [
      paletteEntry('minecraft:air'),
      paletteEntry('minecraft:stone'),
      paletteEntry('minecraft:chest'),
    ])),
    nbtField(12, 'BlockStates', nbtLongArray([0x0000000000000121n])),
    nbtField(9, 'TileEntities', nbtList(10, [
      nbtCompound([nbtField(8, 'id', nbtUtf8('minecraft:chest')), nbtField(3, 'x', nbtInt(1)), nbtField(3, 'y', nbtInt(0)), nbtField(3, 'z', nbtInt(0))]),
    ])),
    nbtField(9, 'Entities', nbtList(10, [
      nbtCompound([
        nbtField(8, 'id', nbtUtf8('minecraft:armor_stand')),
        nbtField(9, 'Pos', nbtList(6, [nbtDouble(2.5), nbtDouble(1.0), nbtDouble(1.5)])),
      ]),
    ])),
    nbtField(9, 'PendingBlockTicks', nbtList(10, [
      nbtCompound([nbtField(3, 'x', nbtInt(0)), nbtField(3, 'y', nbtInt(0)), nbtField(3, 'z', nbtInt(0))]),
    ])),
  ]);

  const rootTag = nbtField(10, '', nbtCompound([
    nbtField(3, 'Version', nbtInt(6)),
    nbtField(3, 'SubVersion', nbtInt(1)),
    nbtField(3, 'MinecraftDataVersion', nbtInt(4671)),
    nbtField(10, 'Metadata', nbtCompound([
      nbtField(8, 'Name', nbtUtf8('全信息排版测试建筑')),
      nbtField(8, 'Author', nbtUtf8('LiteBuilder')),
      nbtField(8, 'Description', nbtUtf8('包含容器、实体、计划刻与缩略图的完整元数据投影')),
      nbtField(3, 'RegionCount', nbtInt(1)),
      nbtField(3, 'TotalBlocks', nbtInt(3)),
      nbtField(3, 'TotalVolume', nbtInt(16)),
      nbtField(4, 'TimeCreated', nbtLong(1750000000000)),
      nbtField(4, 'TimeModified', nbtLong(1760000000000)),
      nbtField(11, 'PreviewImageData', nbtIntArray(previewPixels)),
      nbtField(10, 'EnclosingSize', xyz(4, 2, 2)),
    ])),
    nbtField(10, 'Regions', nbtCompound([
      nbtField(10, '主结构区', region),
    ])),
  ]));
  return zlib.gzipSync(rootTag);
}

// Create a solid green+gold 32x32 PNG for custom image insertion test
function buildTinyPng() {
  const w = 32, h = 32;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const off = y * (w * 4 + 1) + 1 + x * 4;
      const border = x < 3 || y < 3 || x >= w - 3 || y >= h - 3;
      raw[off] = border ? 245 : 60;
      raw[off + 1] = border ? 196 : 165;
      raw[off + 2] = border ? 66 : 55;
      raw[off + 3] = 255;
    }
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([t, data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body), 0);
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const richFile = path.join(out, 'rich-meta.litematic');
const customImgFile = path.join(out, 'custom-badge.png');
fs.writeFileSync(richFile, buildRichLitematic());
fs.writeFileSync(customImgFile, buildTinyPng());

dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [customImgFile] });

app.once('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load', async () => {
    try {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const run = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
      const snap = async name => {
        await wait(160);
        await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
        fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
      };

      // 1. Check welcome dismiss + top Settings menu layout at 980x660
      win.setSize(980, 660);
      await wait(120);
      const layoutCheck = await run(`
        const check = (ok, m) => { if (!ok) throw Error(m); };
        await window.__uiReady;
        if (els.welcome.open) await dismissWelcome(false);
        const menuBtns = [...document.querySelectorAll('.menu .menubtn')];
        check(menuBtns.some(b => b.id === 'menuSettings' && b.textContent.trim() === '设置'), 'missing 设置 button in top bar');
        for (const b of menuBtns) {
          const r = b.getBoundingClientRect();
          check(r.height <= 34 && r.right < window.innerWidth - 60, 'menu button wrapped or overflowed: ' + b.id + ' ' + JSON.stringify(r));
        }
        return menuBtns.map(b => b.textContent.trim());
      `);

      // 2. Open 设置 -> 导出模式设置… without schematic (sample preview)
      await run(`
        document.getElementById('menuSettings').click();
        if (document.getElementById('menuSettingsDrop').classList.contains('hidden')) throw Error('settings dropdown did not open');
        document.getElementById('menuSheetSettings').click();
        const end = Date.now() + 30000;
        while (!document.getElementById('sheetStudioDialog').open || !window.SheetStudioUi.getState().lastResult || document.querySelectorAll('#studioOverlay .studio-hitbox').length < 8) {
          if (Date.now() > end) throw Error('studio empty preview timeout');
          await new Promise(r => setTimeout(r, 40));
        }
      `);
      await snap('01-studio-empty.png');

      // 3. Open rich schematic & re-open studio
      win.setSize(1280, 820);
      await wait(80);
      const metaCheck = await run(`
        document.getElementById('studioClose').click();
        await window.engine.loadResources(null);
        await loadFile(${JSON.stringify(richFile)});
        if (!state.viewReady) throw Error('rich schematic did not render');
        if (!state.info.timeCreated || !state.info.timeModified) throw Error('missing timeCreated/timeModified on state.info');
        if (state.info.entityCount !== 1 || state.info.blockEntityCount !== 1 || state.info.pendingTickCount !== 1) {
          throw Error('wrong counts on state.info: ' + JSON.stringify(state.info));
        }
        if (!state.info.previewImageDataUrl || !state.info.previewImageDataUrl.startsWith('data:image/png;base64,')) {
          throw Error('missing decoded previewImageDataUrl');
        }
        document.getElementById('menuSettings').click();
        document.getElementById('menuSheetSettings').click();
        const end = Date.now() + 30000;
        while (!document.getElementById('sheetStudioDialog').open || !window.SheetStudioUi.getState().lastResult || !document.querySelector('.studio-hitbox[data-el-id="el_field_author"]')) {
          if (Date.now() > end) throw Error('studio rich preview timeout');
          await new Promise(r => setTimeout(r, 40));
        }
        return {
          name: state.info.name,
          description: state.info.description,
          entityCount: state.info.entityCount,
          blockEntityCount: state.info.blockEntityCount,
          pendingTickCount: state.info.pendingTickCount,
          subVersion: state.info.subVersion,
        };
      `);

      // 4. Verify non-modal outer titlebar clickability, spacious inspector + splitter resize, and Photoshop/PPT smart guides!
      const workspaceCheck = await run(`
        const check = (ok, m) => { if (!ok) throw Error(m); };
        const dlg = document.getElementById('sheetStudioDialog');
        const dlgRect = dlg.getBoundingClientRect();
        check(dlgRect.top >= 37 && dlgRect.top <= 39, 'studio should dock directly under 38px titlebar, got top=' + dlgRect.top);
        check(dlgRect.width >= window.innerWidth - 2, 'studio should fill full window width: ' + dlgRect.width + ' vs ' + window.innerWidth);

        const winMax = document.getElementById('winMaximize');
        const maxR = winMax.getBoundingClientRect();
        const hitAtMax = document.elementFromPoint(Math.round(maxR.left + maxR.width / 2), Math.round(maxR.top + maxR.height / 2));
        check(hitAtMax && hitAtMax.closest('#winMaximize') === winMax, 'outer titlebar #winMaximize is blocked while studio is open! hit=' + hitAtMax?.id);

        const inspW = document.querySelector('.studio-inspector').getBoundingClientRect().width;
        check(inspW >= 430, 'inspector panel still too narrow at 1280px: ' + inspW);

        // Toggle static reference grid on then off
        document.getElementById('studioToggleGrid').click();
        check(!document.getElementById('studioGridLayer').classList.contains('hidden'), 'grid layer did not show');
        check(document.querySelectorAll('#studioGridLayer .studio-grid-line-v').length >= 4, 'missing vertical grid lines');
        document.getElementById('studioToggleGrid').click();

        return { dlgTop: dlgRect.top, dlgWidth: dlgRect.width, inspW, titlebarClickable: true };
      `);

      // Test splitter resize (widen right inspector by 60px)
      const splitInfo = await run(`
        const sp = document.getElementById('studioSplitter').getBoundingClientRect();
        return { x: Math.round(sp.left + sp.width / 2), y: Math.round(sp.top + sp.height / 2) };
      `);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: splitInfo.x, y: splitInfo.y });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: splitInfo.x, y: splitInfo.y, button: 'left', clickCount: 1 });
      await wait(30);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: splitInfo.x - 60, y: splitInfo.y, button: 'left', modifiers: ['leftButtonDown'] });
      await wait(30);
      win.webContents.sendInputEvent({ type: 'mouseUp', x: splitInfo.x - 60, y: splitInfo.y, button: 'left', clickCount: 1 });
      await wait(80);
      const splitResized = await run(`
        const nextW = Math.round(document.querySelector('.studio-inspector').getBoundingClientRect().width);
        if (nextW < ${workspaceCheck.inspW} + 35) throw Error('splitter did not widen inspector: ' + nextW);
        // Restore default width for clean preview screenshots
        document.getElementById('studioShell').style.setProperty('--studio-inspector-w', '460px');
        return nextW;
      `);
      await wait(100);

      // Test Photoshop/PowerPoint Smart Guides: drag exportTime UP onto same row as author + schematicVersion!
      const smartDrag = await run(`
        const tHit = document.querySelector('.studio-hitbox[data-el-id="el_field_exportTime"]').getBoundingClientRect();
        const aHit = document.querySelector('.studio-hitbox[data-el-id="el_field_author"]').getBoundingClientRect();
        return {
          startX: Math.round(tHit.left + tHit.width / 2),
          startY: Math.round(tHit.top + tHit.height / 2),
          targetX: Math.round(tHit.left + tHit.width / 2) - 4,
          targetY: Math.round(aHit.top + aHit.height / 2) + 2,
        };
      `);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: smartDrag.startX, y: smartDrag.startY });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: smartDrag.startX, y: smartDrag.startY, button: 'left', clickCount: 1 });
      await wait(40);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: smartDrag.targetX, y: smartDrag.targetY, button: 'left', modifiers: ['leftButtonDown'] });
      await wait(60);
      await snap('04-studio-smart-guides.png');
      const smartGuideCheck = await run(`
        const st = window.SheetStudioUi.getState();
        const hCount = document.querySelectorAll('#studioGuidesLayer .studio-guide-h').length;
        const vCount = document.querySelectorAll('#studioGuidesLayer .studio-guide-v').length;
        if (!st.lastGuides || !st.lastGuides.hGuide || hCount < 1) {
          throw Error('expected horizontal smart alignment guide during row snap: ' + JSON.stringify(st.lastGuides));
        }
        return {
          hLabel: st.lastGuides.hGuide?.label,
          hKind: st.lastGuides.hGuide?.kind,
          vLabel: st.lastGuides.vGuide?.label || null,
          hCount,
          vCount,
        };
      `);
      win.webContents.sendInputEvent({ type: 'mouseUp', x: smartDrag.targetX, y: smartDrag.targetY, button: 'left', clickCount: 1 });
      await wait(200);

      // Now drag el_field_author up into canvas area
      const dragStart = await run(`
        const st = window.SheetStudioUi.getState();
        const target = st.draftStyle.elements.find(e => e.id === 'el_field_author');
        const hit = document.querySelector('.studio-hitbox[data-el-id="el_field_author"]');
        const r = hit.getBoundingClientRect();
        return {
          beforeX: target.x,
          beforeY: target.y,
          cx: Math.round(r.left + r.width / 2),
          cy: Math.round(r.top + r.height / 2),
        };
      `);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: dragStart.cx, y: dragStart.cy });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: dragStart.cx, y: dragStart.cy, button: 'left', clickCount: 1 });
      await wait(40);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: dragStart.cx + 120, y: dragStart.cy - 90, button: 'left', modifiers: ['leftButtonDown'] });
      await wait(40);
      win.webContents.sendInputEvent({ type: 'mouseUp', x: dragStart.cx + 120, y: dragStart.cy - 90, button: 'left', clickCount: 1 });
      await wait(240);

      // 5. Verify drag moved coordinates, toggle extra fields, add custom text, insert custom image, customize bg & angles!
      const customCheck = await run(`
        const st = window.SheetStudioUi.getState();
        const afterEl = st.draftStyle.elements.find(e => e.id === 'el_field_author');
        if (Math.abs(afterEl.x - ${dragStart.beforeX}) < 0.04) {
          throw Error('real pointer drag did not move element x coordinate: ' + JSON.stringify({ before: ${dragStart.beforeX}, after: afterEl.x, band: afterEl.band }));
        }

        // Reset neatly first, then toggle rich fields (description, timeCreated, entityCount, blockEntityCount)
        document.getElementById('studioArrangeFooter').click();
        for (const key of ['description', 'timeCreated', 'entityCount', 'blockEntityCount']) {
          const rows = [...document.querySelectorAll('#studioFieldCatalog .studio-catalog-row')];
          const match = rows.find(r => r.querySelector('.studio-cat-name')?.textContent === ({
            description: '投影说明',
            timeCreated: '创建时间',
            entityCount: '实体数量',
            blockEntityCount: '容器 / 方块实体',
          }[key]));
          if (!match) throw Error('missing catalog row for ' + key);
          const chk = match.querySelector('input[type="checkbox"]');
          if (!chk.checked) {
            chk.checked = true;
            chk.dispatchEvent(new Event('change'));
          }
        }
        document.getElementById('studioArrangeFooter').click();

        // Add custom text
        document.getElementById('studioAddText').click();
        document.getElementById('studioElText').value = '自定义展示签名 · 预览测试';
        document.getElementById('studioElText').dispatchEvent(new Event('input'));
        document.getElementById('studioArrangeFooter').click();

        // Insert custom image
        document.getElementById('studioAddImage').click();
        const endImg = Date.now() + 15000;
        while (!st.draftStyle.elements.some(e => e.kind === 'image')) {
          if (Date.now() > endImg) throw Error('custom image element was not added');
          await new Promise(r => setTimeout(r, 40));
        }

        // Customize angles
        document.getElementById('studioTabAngles').click();
        const yaw1 = document.getElementById('studioView1Yaw');
        const slant1 = document.getElementById('studioView1Slant');
        yaw1.value = '120'; yaw1.dispatchEvent(new Event('input'));
        slant1.value = '25'; slant1.dispatchEvent(new Event('input'));

        // Customize background gradient
        document.getElementById('studioTabBackground').click();
        const bgMode = document.getElementById('studioBgMode');
        bgMode.value = 'gradient'; bgMode.dispatchEvent(new Event('change'));
        const c1 = document.getElementById('studioBgColor');
        const c2 = document.getElementById('studioBgColor2');
        c1.value = '#1a2736'; c1.dispatchEvent(new Event('input'));
        c2.value = '#2a1a32'; c2.dispatchEvent(new Event('input'));

        await new Promise(r => setTimeout(r, 260));
        return {
          draggedX: afterEl.x,
          draggedBand: afterEl.band,
          totalElements: st.draftStyle.elements.length,
          visibleFields: st.draftStyle.elements.filter(e => e.visible && e.kind === 'field').length,
          hasImage: st.draftStyle.elements.some(e => e.kind === 'image' && e.visible),
          view1: st.draftStyle.view1,
        };
      `);
      await snap('02-studio-customized.png');

      // 6. Save & Apply, export showcase PNG via Export Mode, verify output file & persistence
      const exportCheck = await run(`
        document.getElementById('studioSaveApply').click();
        const endDlg = Date.now() + 15000;
        while (document.getElementById('sheetStudioDialog').open) {
          if (Date.now() > endDlg) throw Error('studio dialog did not close on save');
          await new Promise(r => setTimeout(r, 30));
        }
        els.sheetMode.click();
        document.getElementById('btnSheetRegen').click();
        const endExp = Date.now() + 60000;
        while (!state.lastSheet || !state.lastSheet.out || state.rendering) {
          if (Date.now() > endExp) throw Error('sheet export did not complete');
          await new Promise(r => setTimeout(r, 40));
        }
        return {
          out: state.lastSheet.out,
          width: state.lastSheet.width,
          height: state.lastSheet.height,
          yaw1: state.lastSheet.view1.yaw,
          slant1: state.lastSheet.view1.slant,
        };
      `);
      await snap('03-exported-sheet.png');

      if (!fs.existsSync(exportCheck.out)) throw Error('exported PNG missing: ' + exportCheck.out);
      const exportedPng = nativeImage.createFromPath(exportCheck.out);
      if (exportedPng.isEmpty() || exportedPng.getSize().width !== exportCheck.width) {
        throw Error('invalid exported showcase PNG dimensions');
      }
      const savedSettings = JSON.parse(fs.readFileSync(path.join(out, 'settings/ui.json'), 'utf8'));
      if (savedSettings.sheetStyle?.bgMode !== 'gradient' || savedSettings.sheetStyle?.view1?.yaw !== 120) {
        throw Error('persisted sheetStyle missing expected updates');
      }
      const assetFiles = fs.readdirSync(path.join(out, 'settings/sheet-assets'));
      if (!assetFiles.length) throw Error('inserted sheet asset file missing from settings/sheet-assets');

      const report = { pass: true, layoutCheck, metaCheck, workspaceCheck, splitResized, smartGuideCheck, dragStart, customCheck, exportCheck, assetFiles };
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
