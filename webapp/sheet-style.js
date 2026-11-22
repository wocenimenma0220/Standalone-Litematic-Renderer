'use strict';

/** 展示图排版、字段目录、背景样式与视角配置共享模型（主进程校验与前端画布共用）。 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.SheetStyle = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
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

  /** 投影与渲染中保存的全部信息字段目录。 */
  const SHEET_FIELD_CATALOG = [
    { key: 'name', label: '投影名称', category: '基础信息', sample: '红石自动分类仓库' },
    { key: 'author', label: '作者', category: '基础信息', sample: 'LiteKinda' },
    { key: 'description', label: '投影说明', category: '基础信息', sample: '自带防溢与全自动分拣模块' },
    { key: 'dimensions', label: '包围盒尺寸', category: '尺寸与规模', sample: '48 × 24 × 36' },
    { key: 'totalBlocks', label: '方块数量', category: '尺寸与规模', sample: '12,480' },
    { key: 'totalVolume', label: '总体积', category: '尺寸与规模', sample: '41,472 格' },
    { key: 'regionCount', label: '子区域数', category: '尺寸与规模', sample: '2' },
    { key: 'regionNames', label: '子区域列表', category: '结构细节', sample: '主仓库, 中控室' },
    { key: 'paletteCount', label: '方块种类', category: '结构细节', sample: '64 种（188 状态）' },
    { key: 'entityCount', label: '实体数量', category: '结构细节', sample: '12' },
    { key: 'blockEntityCount', label: '容器 / 方块实体', category: '结构细节', sample: '168' },
    { key: 'pendingTicks', label: '计划刻数量', category: '结构细节', sample: '24 (方块 20 / 流体 4)' },
    { key: 'schematicVersion', label: '投影版本', category: '版本与时间', sample: 'Litematica v6 (Sub 1)' },
    { key: 'gameVersion', label: '游戏版本', category: '版本与时间', sample: '1.21.11' },
    { key: 'dataVersion', label: '数据版本 ID', category: '版本与时间', sample: '4671' },
    { key: 'timeCreated', label: '创建时间', category: '版本与时间', sample: '2026-06-15 18:20:00' },
    { key: 'timeModified', label: '修改时间', category: '版本与时间', sample: '2026-08-01 21:05:12' },
    { key: 'exportTime', label: '生成时间', category: '版本与时间', sample: '2026-11-22 23:45:00' },
    { key: 'fileName', label: '文件名', category: '文件与渲染', sample: 'warehouse_v2.litematic' },
    { key: 'fileSize', label: '文件大小', category: '文件与渲染', sample: '184 KB' },
    { key: 'renderAngles', label: '渲染角度', category: '文件与渲染', sample: '45°/30° · 225°/30°' },
    { key: 'resourcePacks', label: '材质包', category: '文件与渲染', sample: '默认 + 2 个扩展包' },
  ];

  const FIELD_BY_KEY = new Map(SHEET_FIELD_CATALOG.map(f => [f.key, f]));

  const DEFAULT_ELEMENTS = [
    {
      id: 'el_icon',
      kind: 'icon',
      role: 'icon',
      title: '左上角图标',
      visible: true,
      source: 'app',
      assetId: '',
      band: 'header',
      x: 0.025,
      y: 0.215,
      anchor: 'left',
      size: 30,
      opacity: 1,
      pixelated: true,
      z: 10,
    },
    {
      id: 'el_brand',
      kind: 'text',
      role: 'brand',
      title: '软件名称',
      visible: true,
      text: '投影预览',
      fontSize: 21,
      bold: true,
      color: '#f5f6f8',
      bgColor: '',
      borderColor: '',
      accentColor: '',
      styleVariant: 'plain',
      band: 'header',
      x: 0.058,
      y: 0.215,
      anchor: 'left',
      maxWidth: 0.28,
      z: 11,
    },
    {
      id: 'el_subtitle',
      kind: 'text',
      role: 'subtitle',
      title: '副标题署名',
      visible: true,
      text: 'LiteKinda · Litematic Render',
      fontSize: 13,
      bold: false,
      color: '#9ca1ae',
      bgColor: '',
      borderColor: '',
      accentColor: '',
      styleVariant: 'plain',
      band: 'header',
      x: 0.145,
      y: 0.22,
      anchor: 'left',
      maxWidth: 0.32,
      z: 11,
    },
    {
      id: 'el_dim_pill',
      kind: 'field',
      role: 'dimPill',
      fieldKey: 'dimensions',
      title: '右上角尺寸标签',
      visible: true,
      label: '尺寸',
      showLabel: false,
      prefix: '',
      suffix: '',
      styleVariant: 'pill',
      fontSize: 13,
      bold: true,
      color: '#e4e7ee',
      labelColor: '#9aa0ad',
      bgColor: '#23262f',
      borderColor: '#3f4452',
      accentColor: '',
      band: 'header',
      x: 0.975,
      y: 0.215,
      anchor: 'right',
      maxWidth: 0.26,
      z: 12,
    },
    {
      id: 'el_title',
      kind: 'field',
      role: 'title',
      fieldKey: 'name',
      title: '投影主标题',
      visible: true,
      label: '名称',
      showLabel: false,
      prefix: '',
      suffix: '',
      styleVariant: 'plain',
      fontSize: 25,
      bold: true,
      color: '#ffffff',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '',
      band: 'header',
      x: 0.025,
      y: 0.71,
      anchor: 'left',
      maxWidth: 0.64,
      z: 13,
    },
    {
      id: 'el_blocks_pill',
      kind: 'field',
      role: 'blocksPill',
      fieldKey: 'totalBlocks',
      title: '方块数标签',
      visible: true,
      label: '方块',
      showLabel: false,
      prefix: '',
      suffix: ' 方块',
      styleVariant: 'pill',
      fontSize: 13,
      bold: true,
      color: '#9ce680',
      labelColor: '#9ce680',
      bgColor: '#21331d',
      borderColor: '#3c8527',
      accentColor: '',
      band: 'header',
      x: 0.892,
      y: 0.71,
      anchor: 'right',
      maxWidth: 0.2,
      z: 14,
    },
    {
      id: 'el_regions_pill',
      kind: 'field',
      role: 'regionsPill',
      fieldKey: 'regionCount',
      title: '区域数标签',
      visible: true,
      label: '区域',
      showLabel: false,
      prefix: '',
      suffix: ' 区域',
      styleVariant: 'pill',
      fontSize: 13,
      bold: true,
      color: '#b8bdc9',
      labelColor: '#b8bdc9',
      bgColor: '#22252c',
      borderColor: '#383c48',
      accentColor: '',
      band: 'header',
      x: 0.975,
      y: 0.71,
      anchor: 'right',
      maxWidth: 0.16,
      z: 14,
    },
    {
      id: 'el_field_author',
      kind: 'field',
      role: 'metaRow',
      fieldKey: 'author',
      title: '作者',
      visible: true,
      label: '作者',
      showLabel: true,
      prefix: '',
      suffix: '',
      styleVariant: 'row',
      fontSize: 15,
      bold: true,
      color: '#eef0f4',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '#3c8527',
      band: 'footer',
      x: 0.038,
      y: 0.28,
      anchor: 'left',
      maxWidth: 0.44,
      z: 20,
    },
    {
      id: 'el_field_schematicVersion',
      kind: 'field',
      role: 'metaRow',
      fieldKey: 'schematicVersion',
      title: '投影版本',
      visible: true,
      label: '投影版本',
      showLabel: true,
      prefix: '',
      suffix: '',
      styleVariant: 'row',
      fontSize: 15,
      bold: true,
      color: '#eef0f4',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '#3c8527',
      band: 'footer',
      x: 0.515,
      y: 0.28,
      anchor: 'left',
      maxWidth: 0.44,
      z: 21,
    },
    {
      id: 'el_field_gameVersion',
      kind: 'field',
      role: 'metaRow',
      fieldKey: 'gameVersion',
      title: '游戏版本',
      visible: true,
      label: '游戏版本',
      showLabel: true,
      prefix: '',
      suffix: '',
      styleVariant: 'row',
      fontSize: 15,
      bold: true,
      color: '#eef0f4',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '#3c8527',
      band: 'footer',
      x: 0.038,
      y: 0.72,
      anchor: 'left',
      maxWidth: 0.44,
      z: 22,
    },
    {
      id: 'el_field_exportTime',
      kind: 'field',
      role: 'metaRow',
      fieldKey: 'exportTime',
      title: '生成时间',
      visible: true,
      label: '生成时间',
      showLabel: true,
      prefix: '',
      suffix: '',
      styleVariant: 'row',
      fontSize: 15,
      bold: true,
      color: '#eef0f4',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '#3c8527',
      band: 'footer',
      x: 0.515,
      y: 0.72,
      anchor: 'left',
      maxWidth: 0.44,
      z: 23,
    },
  ];

  const DEFAULT_SHEET_STYLE = {
    version: 1,
    panelLayout: 'dual',
    bgMode: 'solid',
    bgColor: '#15161a',
    bgColor2: '#1d2230',
    bgAssetId: '',
    showHeaderBar: true,
    headerBg: '#1e2027',
    headerAccent: '#3c8527',
    panelBgMode: 'radial',
    panelBgColor: '#21232b',
    panelBorderColor: '#383b46',
    showPanelBorder: true,
    showAngleBadges: true,
    showFooterBox: true,
    footerBoxBg: '#1b1d23',
    footerBoxBorder: '#2f323c',
    footerColumns: 2,
    view1: { mode: 'preset', preset: 'dimetric_front', yaw: 45, slant: 30, tag: '视图 1' },
    view2: { mode: 'preset', preset: 'dimetric_back', yaw: 225, slant: 30, tag: '视图 2' },
    elements: DEFAULT_ELEMENTS,
  };

  function clamp(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function cleanHex(v, fallback = '') {
    if (typeof v !== 'string') return fallback;
    const s = v.trim();
    return /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) ? s.toLowerCase() : fallback;
  }

  function cleanStr(v, fallback = '', maxLen = 160) {
    if (typeof v !== 'string') return fallback;
    return v.slice(0, maxLen);
  }

  function cleanViewSpec(raw, def) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      mode: src.mode === 'custom' ? 'custom' : 'preset',
      preset: typeof src.preset === 'string' && /^[a-z0-9_]{1,48}$/i.test(src.preset) ? src.preset : def.preset,
      yaw: Math.round(clamp(src.yaw, -360, 360, def.yaw) * 10) / 10,
      slant: Math.round(clamp(src.slant, -89, 89, def.slant) * 10) / 10,
      tag: cleanStr(src.tag, def.tag, 24),
    };
  }

  function cleanElement(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = ['icon', 'image', 'text', 'field'].includes(raw.kind) ? raw.kind : 'text';
    const id = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(raw.id) ? raw.id : `el_${index}`;
    const band = ['header', 'canvas', 'footer'].includes(raw.band) ? raw.band : 'footer';
    const anchor = ['left', 'center', 'right'].includes(raw.anchor) ? raw.anchor : 'left';
    const base = {
      id,
      kind,
      role: cleanStr(raw.role, '', 32),
      title: cleanStr(raw.title, '', 48),
      visible: raw.visible !== false,
      band,
      x: Math.round(clamp(raw.x, 0, 1, 0.04) * 10000) / 10000,
      y: Math.round(clamp(raw.y, 0.02, 0.98, 0.5) * 10000) / 10000,
      anchor,
      z: Math.round(clamp(raw.z, 0, 999, 20 + index)),
    };
    if (kind === 'icon' || kind === 'image') {
      return {
        ...base,
        source: ['app', 'schematicPreview', 'asset'].includes(raw.source) ? raw.source : (kind === 'icon' ? 'app' : 'asset'),
        assetId: typeof raw.assetId === 'string' && /^[a-zA-Z0-9_-]{0,64}$/.test(raw.assetId) ? raw.assetId : '',
        size: Math.round(clamp(raw.size, 14, 640, kind === 'icon' ? 30 : 120)),
        opacity: Math.round(clamp(raw.opacity, 0.05, 1, 1) * 100) / 100,
        pixelated: raw.pixelated !== false,
      };
    }
    const styleVariant = ['plain', 'row', 'pill', 'card'].includes(raw.styleVariant) ? raw.styleVariant : 'row';
    const out = {
      ...base,
      styleVariant,
      fontSize: Math.round(clamp(raw.fontSize, 9, 72, 15)),
      bold: raw.bold !== false,
      color: cleanHex(raw.color, '#eef0f4'),
      labelColor: cleanHex(raw.labelColor, '#9aa0ad'),
      bgColor: raw.bgColor === '' ? '' : cleanHex(raw.bgColor, ''),
      borderColor: raw.borderColor === '' ? '' : cleanHex(raw.borderColor, ''),
      accentColor: raw.accentColor === '' ? '' : cleanHex(raw.accentColor, ''),
      maxWidth: Math.round(clamp(raw.maxWidth, 0.08, 1, 0.45) * 100) / 100,
    };
    if (kind === 'field') {
      const fk = typeof raw.fieldKey === 'string' && FIELD_BY_KEY.has(raw.fieldKey) ? raw.fieldKey : 'name';
      const meta = FIELD_BY_KEY.get(fk);
      out.fieldKey = fk;
      out.label = raw.label !== undefined ? cleanStr(raw.label, meta.label, 32) : meta.label;
      out.showLabel = raw.showLabel !== false;
      out.prefix = cleanStr(raw.prefix, '', 32);
      out.suffix = cleanStr(raw.suffix, '', 32);
      out.overrideText = cleanStr(raw.overrideText, '', 160);
    } else {
      out.text = cleanStr(raw.text, '自定义文本', 160);
    }
    return out;
  }

  function cloneSheetStyle(style = DEFAULT_SHEET_STYLE) {
    return JSON.parse(JSON.stringify(style));
  }

  function normalizeSheetStyle(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return cloneSheetStyle(DEFAULT_SHEET_STYLE);
    }
    const base = DEFAULT_SHEET_STYLE;
    const rawEls = Array.isArray(raw.elements) ? raw.elements.slice(0, 64) : base.elements;
    const seen = new Set();
    const elements = [];
    for (let i = 0; i < rawEls.length; i++) {
      const el = cleanElement(rawEls[i], i);
      if (!el || seen.has(el.id)) continue;
      seen.add(el.id);
      elements.push(el);
    }
    if (!elements.length) {
      return cloneSheetStyle(base);
    }
    return {
      version: 1,
      panelLayout: ['dual', 'single', 'stacked'].includes(raw.panelLayout) ? raw.panelLayout : base.panelLayout,
      bgMode: ['solid', 'gradient', 'transparent', 'image'].includes(raw.bgMode) ? raw.bgMode : base.bgMode,
      bgColor: cleanHex(raw.bgColor, base.bgColor),
      bgColor2: cleanHex(raw.bgColor2, base.bgColor2),
      bgAssetId: typeof raw.bgAssetId === 'string' && /^[a-zA-Z0-9_-]{0,64}$/.test(raw.bgAssetId) ? raw.bgAssetId : '',
      showHeaderBar: raw.showHeaderBar !== false,
      headerBg: cleanHex(raw.headerBg, base.headerBg),
      headerAccent: cleanHex(raw.headerAccent, base.headerAccent),
      panelBgMode: ['radial', 'solid', 'transparent'].includes(raw.panelBgMode) ? raw.panelBgMode : base.panelBgMode,
      panelBgColor: cleanHex(raw.panelBgColor, base.panelBgColor),
      panelBorderColor: cleanHex(raw.panelBorderColor, base.panelBorderColor),
      showPanelBorder: raw.showPanelBorder !== false,
      showAngleBadges: raw.showAngleBadges !== false,
      showFooterBox: raw.showFooterBox !== false,
      footerBoxBg: cleanHex(raw.footerBoxBg, base.footerBoxBg),
      footerBoxBorder: cleanHex(raw.footerBoxBorder, base.footerBoxBorder),
      footerColumns: Math.round(clamp(raw.footerColumns, 1, 3, 2)),
      view1: cleanViewSpec(raw.view1, base.view1),
      view2: cleanViewSpec(raw.view2, base.view2),
      elements,
    };
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
    const sf = String(info?.sourceFormat || '').trim();
    if (sf) return sf;
    const lower = String(file || '').toLowerCase();
    const ver = Number(info?.schematicVersion) || 0;
    const sub = Number(info?.subVersion) || 0;
    if (lower.endsWith('.schem')) return `Sponge Schem v${ver || 2}`;
    if (lower.endsWith('.schematic')) return 'MCEdit Schematic';
    if (lower.endsWith('.nbt')) return 'Structure NBT';
    if (ver > 0) return sub > 0 ? `Litematica v${ver}.${sub}` : `Litematica v${ver}`;
    return 'Litematica';
  }

  function formatTimestamp(msOrDate = new Date(), withTz = true) {
    let date;
    if (msOrDate instanceof Date) {
      date = msOrDate;
    } else {
      const n = Number(msOrDate);
      if (!Number.isFinite(n) || n <= 0) return '未记录';
      date = new Date(n);
      if (Number.isNaN(date.getTime())) return '未记录';
    }
    const pad = (v, len = 2) => String(v).padStart(len, '0');
    const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    if (!withTz) return base;
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return `${base} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '未知';
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function formatFieldValue(fieldKey, ctx = {}) {
    const info = ctx.info || null;
    const file = ctx.file || info?.path || '';
    const sample = FIELD_BY_KEY.get(fieldKey)?.sample || '—';
    if (!info) {
      if (fieldKey === 'exportTime') return formatTimestamp(ctx.now || new Date());
      if (fieldKey === 'renderAngles' && ctx.view1) {
        return ctx.panelLayout === 'single'
          ? `${Math.round(ctx.view1.yaw)}° / ${Math.round(ctx.view1.slant)}°`
          : `${Math.round(ctx.view1.yaw)}°/${Math.round(ctx.view1.slant)}° · ${Math.round(ctx.view2?.yaw ?? 225)}°/${Math.round(ctx.view2?.slant ?? 30)}°`;
      }
      if (fieldKey === 'resourcePacks' && Array.isArray(ctx.packs)) {
        return ctx.packs.length ? `默认 + ${ctx.packs.length} 个材质包` : '仅原版默认材质';
      }
      return sample;
    }

    const size = info.size || { x: 0, y: 0, z: 0 };
    const stem = String(file || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Unnamed';
    switch (fieldKey) {
      case 'name':
        return info.name && info.name !== '?' ? info.name : stem;
      case 'author':
        return info.author && info.author !== '?' && String(info.author).trim() ? String(info.author).trim() : '未填写';
      case 'description':
        return info.description && String(info.description).trim() ? String(info.description).trim() : '暂无说明';
      case 'dimensions':
        return `${size.x ?? 0} × ${size.y ?? 0} × ${size.z ?? 0}`;
      case 'totalBlocks':
        return Number(info.totalBlocks || 0).toLocaleString();
      case 'totalVolume':
        return `${Number(info.totalVolume || ((size.x || 0) * (size.y || 0) * (size.z || 0))).toLocaleString()} 格`;
      case 'regionCount':
        return String(Number(info.regionCount ?? info.regions?.length ?? 1));
      case 'regionNames': {
        const names = (info.regions || []).map(r => r.name).filter(Boolean);
        return names.length ? names.slice(0, 6).join(', ') + (names.length > 6 ? ` 等 ${names.length} 块` : '') : '默认区域';
      }
      case 'paletteCount': {
        const u = Number(info.uniqueBlockCount) || 0;
        const p = Number(info.paletteEntryCount) || 0;
        if (u > 0 && p > 0) return `${u} 种（${p} 状态）`;
        if (p > 0) return `${p} 状态`;
        return '—';
      }
      case 'entityCount':
        return String(Number(info.entityCount || 0));
      case 'blockEntityCount':
        return String(Number(info.blockEntityCount || 0));
      case 'pendingTicks': {
        const b = Number(info.pendingBlockTickCount || 0);
        const f = Number(info.pendingFluidTickCount || 0);
        return `${b + f} (方块 ${b} / 流体 ${f})`;
      }
      case 'schematicVersion':
        return resolveSchematicFormat(file, info);
      case 'gameVersion':
        return resolveGameVersion(info, ctx.defaultGameVersion);
      case 'dataVersion':
        return Number(info.minecraftDataVersion) > 0 ? String(info.minecraftDataVersion) : '未知';
      case 'timeCreated':
        return formatTimestamp(info.timeCreated, false);
      case 'timeModified':
        return formatTimestamp(info.timeModified, false);
      case 'exportTime':
        return formatTimestamp(ctx.now || new Date(), true);
      case 'fileName':
        return info.fileName || String(file || '').split(/[\\/]/).pop() || '未命名';
      case 'fileSize':
        return formatBytes(info.fileSizeBytes);
      case 'renderAngles':
        if (!ctx.view1) return '45°/30° · 225°/30°';
        return ctx.panelLayout === 'single'
          ? `${Math.round(ctx.view1.yaw)}° / ${Math.round(ctx.view1.slant)}°`
          : `${Math.round(ctx.view1.yaw)}°/${Math.round(ctx.view1.slant)}° · ${Math.round(ctx.view2?.yaw ?? 225)}°/${Math.round(ctx.view2?.slant ?? 30)}°`;
      case 'resourcePacks': {
        const packs = Array.isArray(ctx.packs) ? ctx.packs : [];
        return packs.length ? `默认 + ${packs.length} 个材质包` : '仅原版默认材质';
      }
      default:
        return sample;
    }
  }

  /** 将底部区域的字段/文本元素整齐排布成多列网格，并返回所需的最小页脚高度倍数。 */
  function arrangeFooterElements(style) {
    const cols = Math.max(1, Math.min(3, Number(style.footerColumns) || 2));
    const footerEls = (style.elements || []).filter(
      el => el.visible && el.band === 'footer'
    );
    if (!footerEls.length) return style;
    const rows = Math.max(1, Math.ceil(footerEls.length / cols));
    const colStarts = cols === 1 ? [0.04] : cols === 2 ? [0.038, 0.515] : [0.036, 0.355, 0.675];
    const maxW = cols === 1 ? 0.92 : cols === 2 ? 0.44 : 0.29;
    for (let i = 0; i < footerEls.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      footerEls[i].x = colStarts[col];
      footerEls[i].y = Math.round(((row + 0.5) / rows) * 1000) / 1000;
      footerEls[i].anchor = 'left';
      footerEls[i].maxWidth = maxW;
    }
    return style;
  }

  /** 根据底部已有元素计算所需页脚基准高度（1280 基准下）。 */
  function computeFooterBaseHeight(style) {
    const footerEls = (style?.elements || []).filter(el => el.visible && el.band === 'footer');
    if (!footerEls.length) return 28;
    const cols = Math.max(1, Math.min(3, Number(style.footerColumns) || 2));
    const rowsByCount = Math.ceil(footerEls.length / cols);
    // Estimate distinct Y rows when user arranged manually
    const yBuckets = new Set(footerEls.map(e => Math.round(e.y * 10)));
    const rows = Math.max(2, Math.min(8, Math.max(rowsByCount, yBuckets.size)));
    return Math.max(108, rows * 40 + 26);
  }

  return {
    MC_DATA_VERSIONS,
    SHEET_FIELD_CATALOG,
    DEFAULT_ELEMENTS,
    DEFAULT_SHEET_STYLE,
    normalizeSheetStyle,
    cloneSheetStyle,
    resolveGameVersion,
    resolveSchematicFormat,
    formatFieldValue,
    arrangeFooterElements,
    computeFooterBaseHeight,
  };
});
