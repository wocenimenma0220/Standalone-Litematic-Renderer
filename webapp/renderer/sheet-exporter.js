'use strict';

/** 自适应展示图导出器与可视化排版渲染引擎（与 SheetStyle 共享配置定义）。 */
(function (root) {
  let brandIconPromise = null;
  const cachedImageMap = new Map();

  function loadImageUrl(url) {
    if (!url) return Promise.resolve(null);
    if (cachedImageMap.has(url)) return cachedImageMap.get(url);
    const p = new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    cachedImageMap.set(url, p);
    if (cachedImageMap.size > 64) {
      const first = cachedImageMap.keys().next().value;
      if (first) cachedImageMap.delete(first);
    }
    return p;
  }

  function loadBrandIcon() {
    if (!brandIconPromise) {
      brandIconPromise = new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '../icon.png';
      });
    }
    return brandIconPromise;
  }

  function resolveGameVersion(info, defaultGameVersion) {
    return root.SheetStyle.resolveGameVersion(info, defaultGameVersion);
  }

  function resolveSchematicFormat(file, info) {
    return root.SheetStyle.resolveSchematicFormat(file, info);
  }

  function resolveViewSpec(viewSpec, currentYaw = 45, currentSlant = 30) {
    if (viewSpec && typeof viewSpec === 'object' && viewSpec.mode === 'custom') {
      const yaw = Math.round((((Number(viewSpec.yaw) || 0) % 360) + 360) % 360 * 10) / 10;
      const slant = Math.max(-89, Math.min(89, Math.round((Number(viewSpec.slant) || 0) * 10) / 10));
      return {
        id: 'custom',
        label: `自定义 (${yaw}° / ${slant}°)`,
        short: '自定义视角',
        yaw,
        slant,
        tag: viewSpec.tag || '视图',
      };
    }
    const presetKey = typeof viewSpec === 'string' ? viewSpec : (viewSpec?.preset || 'dimetric_front');
    const resolved = root.ViewPresets.resolve(presetKey, currentYaw, currentSlant);
    return {
      ...resolved,
      tag: (typeof viewSpec === 'object' && viewSpec?.tag) ? viewSpec.tag : '视图',
    };
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

  function computeAdaptiveLayout(info, view1, view2, gpuMaxEdge, rawSize = '1024', panelLayout = 'dual') {
    const size = info?.size || { x: 12, y: 8, z: 10 };
    const sx = Math.max(1, Number(size.x) || 1);
    const sy = Math.max(1, Number(size.y) || 1);
    const sz = Math.max(1, Number(size.z) || 1);
    const single = panelLayout === 'single';
    const stacked = panelLayout === 'stacked';
    const e1 = projectedExtent(view1.yaw, view1.slant, sx, sy, sz);
    const e2 = single ? e1 : projectedExtent(view2.yaw, view2.slant, sx, sy, sz);

    const req = rawSize === 'lossless' ? 4096 : Math.max(256, Number(rawSize) || 1024);
    const resScale = Math.max(0.5, Math.min(5.0, req / 1024));
    const maxExtent = Math.max(e1.spanW, e2.spanW, e1.spanH, e2.spanH);
    let ppb = Math.max(10 * resScale, Math.min(48 * resScale, (single ? 760 * resScale : 560 * resScale) / maxExtent));
    const maxW = Math.min(5600, Math.round((single || stacked ? 2100 : 1360) * resScale));
    const maxH = Math.min(4400, Math.round(1080 * resScale));

    const padX = Math.round(56 * Math.min(3.5, resScale));
    const padY = Math.round(56 * Math.min(3.5, resScale));
    const rawW1 = e1.spanW * ppb + padX;
    const rawW2 = e2.spanW * ppb + padX;
    const rawH = Math.max(e1.spanH, e2.spanH) * ppb + padY;
    const shrink = Math.min(1, maxW / Math.max(rawW1, rawW2), maxH / rawH);
    ppb *= shrink;

    const minEdgeScale = Math.min(2.2, Math.max(0.6, resScale));
    let panelW1 = Math.max(Math.round((single ? 760 : 360) * minEdgeScale), Math.round(e1.spanW * ppb + padX));
    let panelW2 = single ? 0 : Math.max(Math.round(360 * minEdgeScale), Math.round(e2.spanW * ppb + padX));
    let panelH = Math.max(Math.round((single ? 440 : 280) * minEdgeScale), Math.round(Math.max(e1.spanH, e2.spanH) * ppb + padY));

    if (stacked) {
      const unified = Math.max(panelW1, panelW2);
      panelW1 = unified;
      panelW2 = unified;
    }

    let outerPad = Math.round(Math.max(18, Math.min(96, (single ? panelW1 : panelW1 + panelW2) * 0.025)));
    let gap = Math.round(Math.max(14, Math.min(72, (single ? panelW1 : panelW1 + panelW2) * 0.018)));
    const minCardW = Math.round(960 * Math.min(2.5, Math.max(0.6, resScale)));
    const basePanelsW = single || stacked ? panelW1 : (panelW1 + panelW2 + gap);
    if (basePanelsW + outerPad * 2 < minCardW) {
      const deficit = minCardW - (basePanelsW + outerPad * 2);
      if (single || stacked) {
        panelW1 += deficit;
        if (stacked) panelW2 = panelW1;
      } else {
        panelW1 += Math.floor(deficit / 2);
        panelW2 += Math.ceil(deficit / 2);
      }
    }

    let cardW = (single || stacked ? panelW1 : (panelW1 + panelW2 + gap)) + outerPad * 2;
    const maxCanvasW = 12288;
    if (cardW > maxCanvasW) {
      const clamp = (maxCanvasW - outerPad * 2 - (single || stacked ? 0 : gap)) / (single || stacked ? panelW1 : (panelW1 + panelW2));
      panelW1 = Math.max(240, Math.floor(panelW1 * clamp));
      panelW2 = single ? 0 : (stacked ? panelW1 : Math.max(240, Math.floor(panelW2 * clamp)));
      panelH = Math.max(200, Math.floor(panelH * clamp));
      outerPad = Math.round(Math.max(18, Math.min(96, cardW * 0.025)));
      gap = Math.round(Math.max(14, Math.min(72, cardW * 0.018)));
      cardW = (single || stacked ? panelW1 : (panelW1 + panelW2 + gap)) + outerPad * 2;
    }

    return {
      panelW1,
      panelW2,
      panelH,
      outerPad,
      gap,
      cardW,
      panelLayout,
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

  /** 无投影打开时，在预览设置中绘制随俯仰/旋转角变化的示例微型 Minecraft 小屋以直观对比角度。 */
  function renderSampleDioramaPanel(viewSpec, width, height) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    const yaw = ((viewSpec.yaw || 0) * Math.PI) / 180;
    const pitch = ((viewSpec.slant || 0) * Math.PI) / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    function proj(x, y, z) {
      const rx = x * cy - z * sy;
      const rz = x * sy + z * cy;
      const ry = y * cp - rz * sp;
      const depth = y * sp + rz * cp;
      return { rx, ry, depth };
    }

    const voxels = [];
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 2; z++) {
        voxels.push({ x, y: -1, z, top: '#5e9d38', side: '#6b4d33', dark: '#543c27' });
      }
    }
    for (let y = 0; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          if (Math.abs(x) === 1 || Math.abs(z) === 1) {
            voxels.push({ x, y, z, top: '#b8945c', side: '#9f7b47', dark: '#7c5f34' });
          }
        }
      }
    }
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        voxels.push({ x, y: 2, z, top: '#9c4333', side: '#833528', dark: '#64261c' });
      }
    }
    voxels.push({ x: 0, y: 3, z: 0, top: '#b8503e', side: '#9c4333', dark: '#793125' });

    const scale = Math.min(width, height) / 9;
    const cx = width / 2;
    const cyMid = height / 2 + scale * 0.4;
    const faces = [
      { n: [0, 1, 0], pts: [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]], shade: 'top' },
      { n: [0, -1, 0], pts: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]], shade: 'dark' },
      { n: [1, 0, 0], pts: [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]], shade: 'side' },
      { n: [-1, 0, 0], pts: [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]], shade: 'dark' },
      { n: [0, 0, 1], pts: [[0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5]], shade: 'side' },
      { n: [0, 0, -1], pts: [[-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5]], shade: 'dark' },
    ];

    const quads = [];
    for (const v of voxels) {
      for (const f of faces) {
        const pn = proj(f.n[0], f.n[1], f.n[2]);
        if (pn.depth <= 0.02) continue;
        const projected = f.pts.map(p => proj(v.x + p[0], v.y + p[1], v.z + p[2]));
        const avgDepth = projected.reduce((s, q) => s + q.depth, 0) / 4;
        quads.push({ projected, depth: avgDepth, fill: v[f.shade] });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);

    for (const q of quads) {
      ctx.beginPath();
      q.projected.forEach((p, idx) => {
        const px = cx + p.rx * scale;
        const py = cyMid - p.ry * scale;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = q.fill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    return c;
  }

  async function renderPanel({ viewSpec, width, height, activeGpuView, useGpu, info, lighting, selection, previewOnly = false }) {
    if (!info) {
      return renderSampleDioramaPanel(viewSpec, width, height);
    }
    if (useGpu) {
      let targetView = activeGpuView;
      if (!targetView && !previewOnly) {
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
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawBadgeBox(ctx, text, x, y, scale, { bg = '#272930', border = '#3c3f4b', fg = '#d8dade', font } = {}) {
    ctx.font = font || `600 ${Math.round(13 * scale)}px "Microsoft YaHei UI", "Segoe UI", sans-serif`;
    const padX = Math.round(10 * scale);
    const h = Math.round(26 * scale);
    const w = Math.ceil(ctx.measureText(text).width + padX * 2);
    roundRectPath(ctx, x, y, w, h, 3);
    ctx.fillStyle = bg;
    ctx.fill();
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = Math.max(1, scale * 0.9);
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + h / 2 + 0.5);
    return { w, h };
  }

  function fitText(ctx, str, maxW) {
    const raw = String(str ?? '');
    if (!maxW || ctx.measureText(raw).width <= maxW) return raw;
    let out = raw;
    while (out.length > 1 && ctx.measureText(out + '…').width > maxW) {
      out = out.slice(0, -1);
    }
    return out === raw ? out : out + '…';
  }

  async function resolveElementImage(el, info, sheetAssets) {
    if (el.source === 'schematicPreview') {
      if (info?.previewImageDataUrl) {
        return await loadImageUrl(info.previewImageDataUrl);
      }
      return await loadBrandIcon();
    }
    if (el.source === 'asset' && el.assetId && sheetAssets?.[el.assetId]) {
      return await loadImageUrl(sheetAssets[el.assetId]);
    }
    if (el.source === 'app' || el.kind === 'icon') {
      return await loadBrandIcon();
    }
    return null;
  }

  async function composeSheet({
    file,
    info,
    defaultGameVersion,
    packs = [],
    panelImg1,
    panelImg2,
    view1,
    view2,
    layout,
    sheetStyle,
    sheetAssets = {},
    skipPngEncode = false,
  }) {
    const style = root.SheetStyle.normalizeSheetStyle(sheetStyle);
    const S = Math.max(0.75, Math.min(3.6, layout.cardW / 1280));
    const hasVisibleHeaderEl = style.elements.some(e => e.visible && e.band === 'header');
    const headerBarH = Math.round(56 * S);
    const headerBandH = (style.showHeaderBar || hasVisibleHeaderEl) ? Math.round(130 * S) : Math.round(24 * S);
    const panelsTop = headerBandH;
    const stacked = style.panelLayout === 'stacked';
    const single = style.panelLayout === 'single';
    const panelsBlockH = stacked ? (layout.panelH * 2 + layout.gap) : layout.panelH;

    const hasFooterContent = style.elements.some(e => e.visible && e.band === 'footer') || style.showFooterBox;
    const footerPadTop = Math.round(18 * S);
    const footerBase = hasFooterContent ? root.SheetStyle.computeFooterBaseHeight(style) : 24;
    const footerH = Math.round(footerBase * S);
    const footerTop = panelsTop + panelsBlockH + footerPadTop;
    const totalW = layout.cardW;
    const totalH = footerTop + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');

    // 1. Canvas Background
    if (style.bgMode === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, totalW, totalH);
      grad.addColorStop(0, style.bgColor);
      grad.addColorStop(1, style.bgColor2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, totalW, totalH);
    } else if (style.bgMode === 'image') {
      ctx.fillStyle = style.bgColor;
      ctx.fillRect(0, 0, totalW, totalH);
      const bgImg = style.bgAssetId ? await loadImageUrl(sheetAssets?.[style.bgAssetId]) : null;
      if (bgImg) {
        const ratio = Math.max(totalW / bgImg.width, totalH / bgImg.height);
        const dw = bgImg.width * ratio;
        const dh = bgImg.height * ratio;
        ctx.drawImage(bgImg, (totalW - dw) / 2, (totalH - dh) / 2, dw, dh);
      }
    } else if (style.bgMode !== 'transparent') {
      ctx.fillStyle = style.bgColor;
      ctx.fillRect(0, 0, totalW, totalH);
    }

    // 2. Top Launcher Header Bar Backdrop
    if (style.showHeaderBar) {
      ctx.fillStyle = style.headerBg;
      ctx.fillRect(0, 0, totalW, headerBarH);
      const barT = Math.max(3, Math.round(3 * S));
      ctx.fillStyle = style.headerAccent;
      ctx.fillRect(0, headerBarH - barT, totalW, barT);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(0, headerBarH - barT, totalW, 1);
    }

    // 3. Viewport Panel(s)
    const panels = [];
    if (single) {
      panels.push({ img: panelImg1, spec: view1, x: layout.outerPad, y: panelsTop, w: layout.panelW1, h: layout.panelH, tag: view1.tag || '视图 1' });
    } else if (stacked) {
      panels.push({ img: panelImg1, spec: view1, x: layout.outerPad, y: panelsTop, w: layout.panelW1, h: layout.panelH, tag: view1.tag || '视图 1' });
      panels.push({ img: panelImg2, spec: view2, x: layout.outerPad, y: panelsTop + layout.panelH + layout.gap, w: layout.panelW2, h: layout.panelH, tag: view2.tag || '视图 2' });
    } else {
      panels.push({ img: panelImg1, spec: view1, x: layout.outerPad, y: panelsTop, w: layout.panelW1, h: layout.panelH, tag: view1.tag || '视图 1' });
      panels.push({ img: panelImg2, spec: view2, x: layout.outerPad + layout.panelW1 + layout.gap, y: panelsTop, w: layout.panelW2, h: layout.panelH, tag: view2.tag || '视图 2' });
    }

    for (const p of panels) {
      roundRectPath(ctx, p.x, p.y, p.w, p.h, 4);
      if (style.panelBgMode === 'radial') {
        const rad = ctx.createRadialGradient(
          p.x + p.w * 0.5, p.y + p.h * 0.5, Math.min(p.w, p.h) * 0.08,
          p.x + p.w * 0.5, p.y + p.h * 0.5, Math.max(p.w, p.h) * 0.72
        );
        rad.addColorStop(0, '#272a33');
        rad.addColorStop(1, style.panelBgColor || '#1b1d23');
        ctx.fillStyle = rad;
        ctx.fill();
      } else if (style.panelBgMode === 'solid') {
        ctx.fillStyle = style.panelBgColor || '#1b1d23';
        ctx.fill();
      }

      if (style.showPanelBorder) {
        ctx.strokeStyle = style.panelBorderColor || '#383b46';
        ctx.lineWidth = Math.max(1.2, 1.5 * S * 0.8);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(p.x + 2, p.y + 1, p.w - 4, 1);
      }

      if (p.img) {
        const fitScale = Math.min(1, p.w / p.img.width, p.h / p.img.height);
        const drawW = Math.round(p.img.width * fitScale);
        const drawH = Math.round(p.img.height * fitScale);
        const drawX = Math.round(p.x + (p.w - drawW) / 2);
        const drawY = Math.round(p.y + (p.h - drawH) / 2);
        ctx.save();
        roundRectPath(ctx, p.x + 2, p.y + 2, p.w - 4, p.h - 4, 3);
        ctx.clip();
        ctx.drawImage(p.img, drawX, drawY, drawW, drawH);
        ctx.restore();
      }

      if (style.showAngleBadges) {
        const badge = `${p.tag} · ${p.spec.short} (${Math.round(p.spec.yaw)}° / ${Math.round(p.spec.slant)}°)`;
        drawBadgeBox(ctx, badge, p.x + Math.round(12 * S), p.y + Math.round(12 * S), S * 0.9, {
          bg: 'rgba(18, 19, 23, 0.78)',
          border: '#444856',
          fg: '#d4d8e2',
        });
      }
    }

    // 4. Footer Metadata Card Container
    if (style.showFooterBox && footerH > Math.round(48 * S)) {
      const metaBoxX = layout.outerPad;
      const metaBoxW = totalW - layout.outerPad * 2;
      const metaBoxH = footerH - Math.round(22 * S);
      roundRectPath(ctx, metaBoxX, footerTop, metaBoxW, metaBoxH, 4);
      ctx.fillStyle = style.footerBoxBg || '#1b1d23';
      ctx.fill();
      ctx.strokeStyle = style.footerBoxBorder || '#2f323c';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 5. Draggable Elements (icons, images, texts, all metadata fields)
    const fieldCtx = {
      file,
      info,
      defaultGameVersion,
      packs,
      view1,
      view2,
      panelLayout: style.panelLayout,
      now: new Date(),
    };
    const sorted = [...style.elements].filter(e => e.visible).sort((a, b) => (a.z || 0) - (b.z || 0));
    const boxes = [];

    for (const el of sorted) {
      const anchorX = el.x * totalW;
      const anchorY = el.band === 'header'
        ? el.y * headerBandH
        : (el.band === 'footer' ? footerTop + el.y * (footerH - (style.showFooterBox ? Math.round(22 * S) : 0)) : panelsTop + el.y * panelsBlockH);

      if (el.kind === 'icon' || el.kind === 'image') {
        const img = await resolveElementImage(el, info, sheetAssets);
        const targetSize = Math.round(el.size * S);
        let drawW = targetSize;
        let drawH = targetSize;
        if (img && img.width > 0 && img.height > 0) {
          const ratio = img.width / img.height;
          if (ratio >= 1) {
            drawW = targetSize;
            drawH = Math.max(8, Math.round(targetSize / ratio));
          } else {
            drawH = targetSize;
            drawW = Math.max(8, Math.round(targetSize * ratio));
          }
        }
        const drawX = Math.round(el.anchor === 'right' ? anchorX - drawW : el.anchor === 'center' ? anchorX - drawW / 2 : anchorX);
        const drawY = Math.round(anchorY - drawH / 2);
        ctx.save();
        ctx.globalAlpha = el.opacity ?? 1;
        ctx.imageSmoothingEnabled = !el.pixelated;
        if (img) {
          ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
          ctx.fillStyle = 'rgba(60, 133, 39, 0.28)';
          ctx.strokeStyle = '#5ac43f';
          ctx.lineWidth = 1.5;
          ctx.fillRect(drawX, drawY, drawW, drawH);
          ctx.strokeRect(drawX, drawY, drawW, drawH);
        }
        ctx.restore();
        boxes.push({
          id: el.id,
          x: drawX,
          y: drawY,
          w: drawW,
          h: drawH,
          vx: drawX,
          vy: drawY,
          vw: drawW,
          vh: drawH,
          anchorX,
          anchorY,
          band: el.band,
        });
        continue;
      }

      // Text / Metadata Field
      const fs = Math.max(9, Math.round((el.fontSize || 15) * S));
      const isMono = el.fieldKey === 'dimensions';
      const fontFamily = isMono ? 'Consolas, "Microsoft YaHei UI", monospace' : '"Microsoft YaHei UI", "Segoe UI", sans-serif';
      const labelText = (el.kind === 'field' && el.showLabel !== false && el.label) ? `${el.label}：` : '';
      let valueText = '';
      if (el.kind === 'field') {
        valueText = el.overrideText
          ? el.overrideText
          : `${el.prefix || ''}${root.SheetStyle.formatFieldValue(el.fieldKey, fieldCtx)}${el.suffix || ''}`;
      } else {
        valueText = el.text || '';
      }

      const labelFont = `500 ${fs}px ${fontFamily}`;
      const valueFont = `${el.bold ? 700 : 500} ${fs}px ${fontFamily}`;
      ctx.font = labelFont;
      const labelW = labelText ? ctx.measureText(labelText).width : 0;

      const maxPxW = Math.max(60 * S, (el.maxWidth || 0.45) * totalW);
      const padX = el.styleVariant === 'pill' ? Math.round(11 * S) : el.styleVariant === 'card' ? Math.round(12 * S) : 0;
      const padY = el.styleVariant === 'pill' ? Math.round(5 * S) : el.styleVariant === 'card' ? Math.round(7 * S) : Math.round(2 * S);
      const accentGap = (el.accentColor && (el.styleVariant === 'row' || el.styleVariant === 'card')) ? Math.round(9 * S) : 0;

      ctx.font = valueFont;
      const availForVal = Math.max(24 * S, maxPxW - labelW - padX * 2 - accentGap);
      const fittedVal = fitText(ctx, valueText, availForVal);
      const valW = ctx.measureText(fittedVal).width;

      const contentW = Math.ceil(labelW + valW + (labelW && valW ? 2 : 0));
      const boxW = Math.ceil(contentW + padX * 2 + accentGap);
      const boxH = Math.ceil(Math.max(fs * 1.38, el.styleVariant === 'pill' ? 26 * S : fs * 1.4) + (el.styleVariant === 'card' ? padY : 0));

      const leftX = Math.round(el.anchor === 'right' ? anchorX - boxW : el.anchor === 'center' ? anchorX - boxW / 2 : anchorX);
      const topY = Math.round(anchorY - boxH / 2);

      if (el.bgColor || el.borderColor) {
        roundRectPath(ctx, leftX, topY, boxW, boxH, el.styleVariant === 'pill' ? 3 : 2);
        if (el.bgColor) {
          ctx.fillStyle = el.bgColor;
          ctx.fill();
        }
        if (el.borderColor) {
          ctx.strokeStyle = el.borderColor;
          ctx.lineWidth = Math.max(1, S * 0.8);
          ctx.stroke();
        }
      }

      if (el.accentColor && (el.styleVariant === 'row' || el.styleVariant === 'card')) {
        const barW = Math.max(3, Math.round(3 * S));
        const barH = Math.round(Math.max(12 * S, fs * 0.95));
        ctx.fillStyle = el.accentColor;
        ctx.fillRect(leftX + padX, Math.round(anchorY - barH / 2), barW, barH);
      }

      const textStartX = leftX + padX + accentGap;
      ctx.textBaseline = 'middle';
      if (labelText) {
        ctx.font = labelFont;
        ctx.fillStyle = el.labelColor || '#9aa0ad';
        ctx.fillText(labelText, textStartX, anchorY);
      }
      ctx.font = valueFont;
      ctx.fillStyle = el.color || '#eef0f4';
      ctx.fillText(fittedVal, textStartX + labelW + (labelW ? 2 : 0), anchorY);

      boxes.push({
        id: el.id,
        x: Math.max(0, leftX - 4),
        y: Math.max(0, topY - 4),
        w: Math.max(18, boxW + 8),
        h: Math.max(16, boxH + 8),
        vx: leftX,
        vy: topY,
        vw: boxW,
        vh: boxH,
        anchorX,
        anchorY,
        band: el.band,
      });
    }

    const footerInnerH = footerH - (style.showFooterBox ? Math.round(22 * S) : 0);
    const bands = {
      headerBarH,
      headerBandH,
      panelsTop,
      panelsBlockH,
      footerTop,
      footerH,
      footerInnerH,
      outerPad: layout.outerPad,
      scale: S,
      totalW,
      totalH,
      panels: panels.map(p => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    };
    if (skipPngEncode) {
      return { canvas, previewUrl: canvas.toDataURL('image/png'), width: totalW, height: totalH, bands, boxes };
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(Error('PNG 图像编码失败'))), 'image/png');
    });
    return {
      arrayBuffer: await blob.arrayBuffer(),
      previewUrl: canvas.toDataURL('image/png'),
      width: totalW,
      height: totalH,
      bands,
      boxes,
    };
  }

  /** 为「导出模式设置」可视化编辑器渲染即时预览与元素交互命中框。 */
  async function renderStudioPreview({
    file = null,
    info = null,
    defaultGameVersion = '',
    packs = [],
    currentYaw = 45,
    currentSlant = 30,
    sheetStyle,
    sheetAssets = {},
    activeGpuView = null,
    realLighting = true,
    lightingEnabled = true,
    selection = null,
    useGpu = true,
  }) {
    const style = root.SheetStyle.normalizeSheetStyle(sheetStyle);
    const view1 = resolveViewSpec(style.view1, currentYaw, currentSlant);
    const view2 = resolveViewSpec(style.view2, currentYaw, currentSlant);
    const gpuLimit = activeGpuView ? root.GpuExporter.maxEdge(activeGpuView) : 2048;
    const layout = computeAdaptiveLayout(info, view1, view2, gpuLimit, '1024', style.panelLayout);

    // Keep interactive preview responsive by rendering panels up to 760px edge inside modal
    const previewScale = Math.min(1, 900 / Math.max(layout.panelW1, layout.panelH, 1));
    const pw1 = Math.max(180, Math.round(layout.panelW1 * previewScale));
    const pw2 = layout.panelW2 ? Math.max(180, Math.round(layout.panelW2 * previewScale)) : 0;
    const ph = Math.max(140, Math.round(layout.panelH * previewScale));

    const common = {
      activeGpuView: activeGpuView && !activeGpuView.destroyed ? activeGpuView : null,
      useGpu: !!useGpu && !activeGpuView?.stream,
      info,
      lighting: { file, realLighting, lightingEnabled },
      selection,
      previewOnly: true,
    };
    const panelImg1 = await renderPanel({ ...common, viewSpec: view1, width: pw1, height: ph });
    const panelImg2 = pw2 > 0 ? await renderPanel({ ...common, viewSpec: view2, width: pw2, height: ph }) : null;
    try {
      return await composeSheet({
        file,
        info,
        defaultGameVersion,
        packs,
        panelImg1,
        panelImg2,
        view1,
        view2,
        layout,
        sheetStyle: style,
        sheetAssets,
        skipPngEncode: true,
      });
    } finally {
      if (typeof panelImg1?.close === 'function') panelImg1.close();
      if (typeof panelImg2?.close === 'function') panelImg2.close();
    }
  }

  async function exportSheet({
    file,
    info,
    defaultGameVersion,
    packs = [],
    currentYaw = 45,
    currentSlant = 30,
    sheetView1 = 'dimetric_front',
    sheetView2 = 'dimetric_back',
    sheetStyle = null,
    sheetAssets = {},
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
    const style = root.SheetStyle.normalizeSheetStyle(sheetStyle);
    const v1Spec = sheetView1 && sheetView1 !== style.view1.preset && style.view1.mode !== 'custom'
      ? { ...style.view1, preset: sheetView1, mode: 'preset' }
      : style.view1;
    const v2Spec = sheetView2 && sheetView2 !== style.view2.preset && style.view2.mode !== 'custom'
      ? { ...style.view2, preset: sheetView2, mode: 'preset' }
      : style.view2;

    const view1 = resolveViewSpec(v1Spec, currentYaw, currentSlant);
    const view2 = resolveViewSpec(v2Spec, currentYaw, currentSlant);
    const useGpu = !useCpuOnly && exportMode === 'gpu' && !activeGpuView?.stream;
    const gpuLimit = activeGpuView ? root.GpuExporter.maxEdge(activeGpuView) : 8192;
    const layout = computeAdaptiveLayout(info, view1, view2, useGpu ? gpuLimit : 4096, rawSize, style.panelLayout);

    const common = {
      activeGpuView: activeGpuView && !activeGpuView.destroyed ? activeGpuView : null,
      useGpu,
      info,
      lighting: { file, realLighting, lightingEnabled },
      selection,
    };
    const panelImg1 = await renderPanel({ ...common, viewSpec: view1, width: layout.panelW1, height: layout.panelH });
    const panelImg2 = layout.panelW2 > 0
      ? await renderPanel({ ...common, viewSpec: view2, width: layout.panelW2, height: layout.panelH })
      : null;
    let sheet;
    try {
      sheet = await composeSheet({
        file,
        info,
        defaultGameVersion,
        packs,
        panelImg1,
        panelImg2,
        view1,
        view2,
        layout,
        sheetStyle: style,
        sheetAssets,
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
    renderStudioPreview,
    invalidateCache,
    computeAdaptiveLayout,
    resolveViewSpec,
    resolveGameVersion,
    resolveSchematicFormat,
  };
})(typeof window !== 'undefined' ? window : globalThis);
