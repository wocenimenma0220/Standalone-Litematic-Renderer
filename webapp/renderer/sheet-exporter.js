'use strict';

/** 自适应双视角展示图导出器：结合 KCL 展示卡信息结构与启动器 Ore UI 视觉重构排版。 */
(function (root) {
  const MC_DATA_VERSIONS = [
    [5023, '26.3'],
    [4790, '26.1.2'],
    [4786, '26.1.1'],
    [4780, '26.1'],
    [4690, '26.0'],
    [4671, '1.21.11'],
    [4556, '1.21.10'],
    [4440, '1.21.8'],
    [4435, '1.21.6'],
    [4325, '1.21.5'],
    [4189, '1.21.4'],
    [4082, '1.21.3'],
    [4080, '1.21.2'],
    [3955, '1.21.1'],
    [3953, '1.21'],
    [3839, '1.20.6'],
    [3700, '1.20.4'],
    [3578, '1.20.2'],
    [3465, '1.20.1'],
    [3337, '1.19.4'],
    [3120, '1.19.2'],
    [2975, '1.19'],
    [2865, '1.18.2'],
    [2730, '1.17.1'],
    [2586, '1.16.5'],
    [2230, '1.15.2'],
    [1976, '1.14.4'],
    [1631, '1.13.2'],
    [1343, '1.12.2'],
  ];

  let iconPromise = null;
  function loadBrandIcon() {
    if (!iconPromise) {
      iconPromise = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '../icon.png';
      });
    }
    return iconPromise;
  }

  function resolveGameVersion(info, defaultGameVersion) {
    const dv = Number(info?.minecraftDataVersion) || 0;
    if (dv > 0) {
      for (const [ver, label] of MC_DATA_VERSIONS) {
        if (dv === ver) return label;
      }
      if (dv >= 5000 && defaultGameVersion) return defaultGameVersion;
      return `Data v${dv}`;
    }
    return defaultGameVersion || '未知版本';
  }

  function resolveSchematicFormat(file, info) {
    const lower = String(file || '').toLowerCase();
    const ver = Number(info?.schematicVersion) || 0;
    if (lower.endsWith('.schem')) return `Sponge Schem v${ver || 2}`;
    if (lower.endsWith('.schematic')) return 'MCEdit Schematic';
    if (lower.endsWith('.nbt')) return 'Structure NBT';
    return ver > 0 ? `Litematica v${ver}` : 'Litematica';
  }

  function formatTimestamp(date = new Date()) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    const tz = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tz}`;
  }

  function projectedExtent(yawDeg, slantDeg, sx, sy, sz) {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (slantDeg * Math.PI) / 180;
    const cy = Math.cos(yaw), syaw = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const spanW = Math.abs(cy) * sx + Math.abs(syaw) * sz;
    const spanH = Math.abs(sp * syaw) * sx + Math.abs(cp) * sy + Math.abs(sp * cy) * sz;
    return { spanW: Math.max(1, spanW), spanH: Math.max(1, spanH) };
  }

  function computeAdaptiveLayout(info, view1, view2, gpuMaxEdge, rawSize = '1024') {
    const size = info?.size || { x: 1, y: 1, z: 1 };
    const sx = Math.max(1, Number(size.x) || 1);
    const sy = Math.max(1, Number(size.y) || 1);
    const sz = Math.max(1, Number(size.z) || 1);
    const e1 = projectedExtent(view1.yaw, view1.slant, sx, sy, sz);
    const e2 = projectedExtent(view2.yaw, view2.slant, sx, sy, sz);

    const req = rawSize === 'lossless' ? 4096 : Math.max(256, Number(rawSize) || 1024);
    const resScale = Math.max(0.5, Math.min(5.0, req / 1024));
    const maxExtent = Math.max(e1.spanW, e2.spanW, e1.spanH, e2.spanH);
    let ppb = Math.max(10 * resScale, Math.min(48 * resScale, (560 * resScale) / maxExtent));
    const maxW = Math.min(5600, Math.round(1360 * resScale));
    const maxH = Math.min(4400, Math.round(1080 * resScale));

    const padX = Math.round(56 * Math.min(3.5, resScale));
    const padY = Math.round(56 * Math.min(3.5, resScale));
    const rawW1 = e1.spanW * ppb + padX;
    const rawW2 = e2.spanW * ppb + padX;
    const rawH = Math.max(e1.spanH, e2.spanH) * ppb + padY;
    const shrink = Math.min(1, maxW / Math.max(rawW1, rawW2), maxH / rawH);
    ppb *= shrink;

    const minEdgeScale = Math.min(2.2, Math.max(0.6, resScale));
    let panelW1 = Math.max(Math.round(360 * minEdgeScale), Math.round(e1.spanW * ppb + padX));
    let panelW2 = Math.max(Math.round(360 * minEdgeScale), Math.round(e2.spanW * ppb + padX));
    let panelH = Math.max(Math.round(280 * minEdgeScale), Math.round(Math.max(e1.spanH, e2.spanH) * ppb + padY));

    let outerPad = Math.round(Math.max(18, Math.min(96, (panelW1 + panelW2) * 0.025)));
    let gap = Math.round(Math.max(14, Math.min(72, (panelW1 + panelW2) * 0.018)));
    const minCardW = Math.round(960 * Math.min(2.5, Math.max(0.6, resScale)));
    if (panelW1 + panelW2 + outerPad * 2 + gap < minCardW) {
      const deficit = minCardW - (panelW1 + panelW2 + outerPad * 2 + gap);
      panelW1 += Math.floor(deficit / 2);
      panelW2 += Math.ceil(deficit / 2);
    }

    // 保底限制整张展示卡不超过 Chromium 2D Canvas 安全尺寸上限
    let cardW = panelW1 + panelW2 + outerPad * 2 + gap;
    const maxCanvasW = 12288;
    if (cardW > maxCanvasW) {
      const clamp = (maxCanvasW - outerPad * 2 - gap) / (panelW1 + panelW2);
      panelW1 = Math.max(240, Math.floor(panelW1 * clamp));
      panelW2 = Math.max(240, Math.floor(panelW2 * clamp));
      panelH = Math.max(200, Math.floor(panelH * clamp));
      outerPad = Math.round(Math.max(18, Math.min(96, (panelW1 + panelW2) * 0.025)));
      gap = Math.round(Math.max(14, Math.min(72, (panelW1 + panelW2) * 0.018)));
      cardW = panelW1 + panelW2 + outerPad * 2 + gap;
    }

    return {
      panelW1,
      panelW2,
      panelH,
      outerPad,
      gap,
      cardW,
    };
  }

  function rgbaToCanvas(rgba, width, height) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(width, height);
    img.data.set(rgba);
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function pngBufferToImage(arrayBuffer) {
    return await createImageBitmap(new Blob([arrayBuffer], { type: 'image/png' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
  }

  let offscreenHost = null;
  async function acquireTempGpuView(info, lighting) {
    if (!offscreenHost) {
      const canvas = document.createElement('canvas');
      offscreenHost = { canvas, view: null, key: '' };
    }
    const key = [info?.path || '', lighting.realLighting, lighting.lightingEnabled].join('|');
    if (offscreenHost.view && offscreenHost.key === key && !offscreenHost.view.destroyed) {
      return offscreenHost.view;
    }
    if (offscreenHost.view) {
      offscreenHost.view.destroy();
      offscreenHost.view = null;
    }
    const view = new root.GpuView(offscreenHost.canvas);
    const scene = await window.engine.exportScene({
      realLighting: lighting.realLighting,
      lightingEnabled: lighting.lightingEnabled,
      streaming: false,
    });
    if (['LMESH5', 'LMESH6', 'LMESH7'].includes(scene.meshFormat) || !scene.meshArrayBuffer) {
      view.destroy();
      return null;
    }
    const bitmap = await pngBufferToImage(scene.atlasArrayBuffer);
    try {
      view.uploadMesh(scene.meshArrayBuffer);
      view.uploadAtlas(bitmap);
    } finally {
      bitmap.close();
    }
    offscreenHost.view = view;
    offscreenHost.key = key;
    return view;
  }

  function invalidateCache() {
    if (offscreenHost?.view) {
      offscreenHost.view.destroy();
      offscreenHost.view = null;
      offscreenHost.key = '';
    }
  }

  async function renderPanel({ viewSpec, width, height, activeGpuView, useGpu, info, lighting, selection }) {
    if (useGpu) {
      let targetView = activeGpuView;
      if (!targetView) {
        try {
          targetView = await acquireTempGpuView({ ...info, path: lighting.file }, lighting);
        } catch {
          targetView = null;
        }
      }
      if (targetView) {
        const edgeLimit = root.GpuExporter.maxEdge(targetView);
        if (edgeLimit && width <= edgeLimit && height <= edgeLimit) {
          const rgba = await root.GpuExporter.renderFrameRgba({
            view: targetView,
            width,
            height,
            rotationDeg: viewSpec.yaw,
            slantDeg: viewSpec.slant,
            transparent: true,
            backgroundMode: 'checker',
            backgroundColor: 0,
            backgroundDataUrl: null,
            selection,
          });
          return rgbaToCanvas(rgba, width, height);
        }
      }
    }
    const panel = await window.exportsApi.renderCpuPanel({
      width,
      height,
      rotation: viewSpec.yaw,
      slant: viewSpec.slant,
      realLighting: lighting.realLighting,
      lightingEnabled: lighting.lightingEnabled,
      ...(selection ? { selection } : {}),
    });
    return await pngBufferToImage(panel.arrayBuffer);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPill(ctx, text, x, y, scale, { bg = '#272930', border = '#3c3f4b', fg = '#d8dade', font } = {}) {
    ctx.font = font || `600 ${Math.round(13 * scale)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
    const padX = Math.round(10 * scale);
    const h = Math.round(26 * scale);
    const w = Math.ceil(ctx.measureText(text).width + padX * 2);
    roundRectPath(ctx, x, y, w, h, 3);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + h / 2 + 0.5);
    return w;
  }

  async function composeSheet({
    file,
    info,
    defaultGameVersion,
    panelImg1,
    panelImg2,
    view1,
    view2,
    layout,
  }) {
    const icon = await loadBrandIcon();
    const S = Math.max(0.75, Math.min(3.6, layout.cardW / 1280));
    const headerH = Math.round(56 * S);
    const titleBandH = Math.round(74 * S);
    const footerH = Math.round(108 * S);
    const totalW = layout.cardW;
    const panelsTop = headerH + titleBandH;
    const footerTop = panelsTop + layout.panelH + Math.round(18 * S);
    const totalH = footerTop + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // Deep charcoal canvas backdrop (Ore UI Dark Studio)
    ctx.fillStyle = '#15161a';
    ctx.fillRect(0, 0, totalW, totalH);

    // Top Launcher Header Bar
    const hdrGrad = ctx.createLinearGradient(0, 0, totalW, headerH);
    hdrGrad.addColorStop(0, '#1e2027');
    hdrGrad.addColorStop(1, '#18191e');
    ctx.fillStyle = hdrGrad;
    ctx.fillRect(0, 0, totalW, headerH);

    // Emerald Ore UI accent bar along header bottom
    ctx.fillStyle = '#3c8527';
    ctx.fillRect(0, headerH - Math.max(3, Math.round(3 * S)), totalW, Math.max(3, Math.round(3 * S)));
    ctx.fillStyle = '#5ac43f';
    ctx.fillRect(0, headerH - Math.max(3, Math.round(3 * S)), totalW, 1);

    let cursorX = layout.outerPad;
    const iconSize = Math.round(30 * S);
    if (icon) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(icon, cursorX, Math.round((headerH - iconSize) / 2) - 1, iconSize, iconSize);
      ctx.imageSmoothingEnabled = true;
      cursorX += iconSize + Math.round(12 * S);
    }

    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5f6f8';
    ctx.font = `700 ${Math.round(21 * S)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
    const brandName = '投影预览';
    ctx.fillText(brandName, cursorX, Math.round(headerH / 2) - 1);
    cursorX += Math.ceil(ctx.measureText(brandName).width + Math.round(12 * S));

    ctx.fillStyle = '#9ca1ae';
    ctx.font = `500 ${Math.round(13 * S)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
    ctx.fillText('LiteKinda · Litematic Render', cursorX, Math.round(headerH / 2));

    // Right-aligned dimension summary pill in header
    const size = info?.size || { x: 0, y: 0, z: 0 };
    const dimText = `${size.x} × ${size.y} × ${size.z}`;
    ctx.font = `600 ${Math.round(13 * S)}px Consolas, "Microsoft YaHei UI", monospace`;
    const dimW = Math.ceil(ctx.measureText(dimText).width + Math.round(22 * S));
    drawPill(ctx, dimText, totalW - layout.outerPad - dimW, Math.round((headerH - 26 * S) / 2), S, {
      bg: '#23262f',
      border: '#3f4452',
      fg: '#e4e7ee',
      font: `600 ${Math.round(13 * S)}px Consolas, "Microsoft YaHei UI", monospace`,
    });

    // Schematic Title & Stats Row
    const stem = String(file || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Unnamed';
    const rawName = info?.name && info.name !== '?' ? info.name : stem;
    const titleY = headerH + Math.round(titleBandH * 0.44);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(25 * S)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
    const maxTitleW = totalW - layout.outerPad * 2 - Math.round(320 * S);
    let displayTitle = rawName;
    while (displayTitle.length > 1 && ctx.measureText(displayTitle).width > maxTitleW) {
      displayTitle = displayTitle.slice(0, -1);
    }
    if (displayTitle !== rawName) displayTitle += '…';
    ctx.fillText(displayTitle, layout.outerPad, titleY);

    // Quick block/region metric pills at right side of title row
    const blocksLabel = `${Number(info?.totalBlocks || 0).toLocaleString()} 方块`;
    const regionsLabel = `${Number(info?.regionCount || 1)} 区域`;
    ctx.font = `600 ${Math.round(13 * S)}px "Microsoft YaHei UI", sans-serif`;
    const rW = Math.ceil(ctx.measureText(regionsLabel).width + Math.round(20 * S));
    const bW = Math.ceil(ctx.measureText(blocksLabel).width + Math.round(20 * S));
    const pillY = titleY - Math.round(13 * S);
    drawPill(ctx, regionsLabel, totalW - layout.outerPad - rW, pillY, S, { bg: '#22252c', border: '#383c48', fg: '#b8bdc9' });
    drawPill(ctx, blocksLabel, totalW - layout.outerPad - rW - bW - Math.round(8 * S), pillY, S, { bg: '#21331d', border: '#3c8527', fg: '#9ce680' });

    // Dual Adaptive Viewport Panels
    const panels = [
      { img: panelImg1, spec: view1, x: layout.outerPad, w: layout.panelW1, tag: '视图 1' },
      { img: panelImg2, spec: view2, x: layout.outerPad + layout.panelW1 + layout.gap, w: layout.panelW2, tag: '视图 2' },
    ];
    for (const p of panels) {
      roundRectPath(ctx, p.x, panelsTop, p.w, layout.panelH, 4);
      const rad = ctx.createRadialGradient(
        p.x + p.w * 0.5, panelsTop + layout.panelH * 0.5, Math.min(p.w, layout.panelH) * 0.08,
        p.x + p.w * 0.5, panelsTop + layout.panelH * 0.5, Math.max(p.w, layout.panelH) * 0.72
      );
      rad.addColorStop(0, '#272a33');
      rad.addColorStop(1, '#1b1d23');
      ctx.fillStyle = rad;
      ctx.fill();
      ctx.strokeStyle = '#383b46';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Subtle inner top bevel
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(p.x + 2, panelsTop + 1, p.w - 4, 1);

      // Draw rendered schematic at exact computed aspect
      const imgW = p.img.width;
      const imgH = p.img.height;
      const drawX = Math.round(p.x + (p.w - imgW) / 2);
      const drawY = Math.round(panelsTop + (layout.panelH - imgH) / 2);
      ctx.save();
      roundRectPath(ctx, p.x + 2, panelsTop + 2, p.w - 4, layout.panelH - 4, 3);
      ctx.clip();
      ctx.drawImage(p.img, drawX, drawY);
      ctx.restore();

      // Top-left discreet perspective pill inside panel
      const badge = `${p.tag} · ${p.spec.short} (${Math.round(p.spec.yaw)}° / ${Math.round(p.spec.slant)}°)`;
      drawPill(ctx, badge, p.x + Math.round(12 * S), panelsTop + Math.round(12 * S), S * 0.9, {
        bg: 'rgba(18, 19, 23, 0.78)',
        border: '#444856',
        fg: '#d4d8e2',
      });
    }

    // Bottom Metadata Grid Card (preserves all KCL fields clearly)
    const metaBoxX = layout.outerPad;
    const metaBoxW = totalW - layout.outerPad * 2;
    const metaBoxH = footerH - Math.round(22 * S);
    roundRectPath(ctx, metaBoxX, footerTop, metaBoxW, metaBoxH, 4);
    ctx.fillStyle = '#1b1d23';
    ctx.fill();
    ctx.strokeStyle = '#2f323c';
    ctx.lineWidth = 1;
    ctx.stroke();

    const author = info?.author && info.author !== '?' && info.author.trim() ? info.author.trim() : '未填写';
    const metaCells = [
      ['作者', author],
      ['投影版本', resolveSchematicFormat(file, info)],
      ['游戏版本', resolveGameVersion(info, defaultGameVersion)],
      ['生成时间', formatTimestamp()],
    ];

    const colW = metaBoxW / 2;
    const rowH = metaBoxH / 2;
    for (let i = 0; i < metaCells.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cellX = metaBoxX + col * colW + Math.round(20 * S);
      const cellY = footerTop + row * rowH + rowH / 2;

      ctx.fillStyle = '#3c8527';
      ctx.fillRect(cellX - Math.round(10 * S), cellY - Math.round(7 * S), Math.max(3, Math.round(3 * S)), Math.round(14 * S));

      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#9aa0ad';
      ctx.font = `500 ${Math.round(15 * S)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
      const label = metaCells[i][0] + '：';
      ctx.fillText(label, cellX, cellY);
      const labelW = ctx.measureText(label).width;

      ctx.fillStyle = '#eef0f4';
      ctx.font = `600 ${Math.round(15 * S)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
      ctx.fillText(metaCells[i][1], cellX + labelW + 2, cellY);
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(Error('PNG 图像编码失败'))), 'image/png');
    });
    return {
      arrayBuffer: await blob.arrayBuffer(),
      previewUrl: canvas.toDataURL('image/png'),
      width: totalW,
      height: totalH,
    };
  }

  async function exportSheet({
    file,
    info,
    defaultGameVersion,
    currentYaw = 45,
    currentSlant = 30,
    sheetView1 = 'dimetric_front',
    sheetView2 = 'dimetric_back',
    exportMode = 'gpu',
    realLighting = true,
    lightingEnabled = true,
    activeGpuView = null,
    selection = null,
    useCpuOnly = false,
    out = null,
    copyClipboard = true,
    rawSize = '1024',
  }) {
    const t0 = performance.now();
    const view1 = root.ViewPresets.resolve(sheetView1, currentYaw, currentSlant);
    const view2 = root.ViewPresets.resolve(sheetView2, currentYaw, currentSlant);
    const useGpu = !useCpuOnly && exportMode === 'gpu' && !activeGpuView?.stream;
    const gpuLimit = activeGpuView ? root.GpuExporter.maxEdge(activeGpuView) : 8192;
    const layout = computeAdaptiveLayout(info, view1, view2, useGpu ? gpuLimit : 4096, rawSize);

    const common = {
      activeGpuView: activeGpuView && !activeGpuView.destroyed ? activeGpuView : null,
      useGpu,
      info,
      lighting: { file, realLighting, lightingEnabled },
      selection,
    };
    const panelImg1 = await renderPanel({ ...common, viewSpec: view1, width: layout.panelW1, height: layout.panelH });
    const panelImg2 = await renderPanel({ ...common, viewSpec: view2, width: layout.panelW2, height: layout.panelH });
    let sheet;
    try {
      sheet = await composeSheet({
        file,
        info,
        defaultGameVersion,
        panelImg1,
        panelImg2,
        view1,
        view2,
        layout,
      });
    } finally {
      if (typeof panelImg1?.close === 'function') panelImg1.close();
      if (typeof panelImg2?.close === 'function') panelImg2.close();
    }
    const saved = await window.exportsApi.saveSheetPng({
      sourceFile: file,
      out,
      pngBuffer: sheet.arrayBuffer,
      width: sheet.width,
      height: sheet.height,
      copyClipboard,
    });
    return {
      ...saved,
      width: sheet.width,
      height: sheet.height,
      view1,
      view2,
      elapsedMs: Math.round(performance.now() - t0),
      previewUrl: sheet.previewUrl,
    };
  }

  root.SheetExporter = {
    exportSheet,
    invalidateCache,
    computeAdaptiveLayout,
    resolveGameVersion,
    resolveSchematicFormat,
  };
})(typeof window !== 'undefined' ? window : globalThis);
