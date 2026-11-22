'use strict';

/** 导出模式设置（设置 → 导出模式设置…）：实时预览、拖动排版、投影全部信息控制、插图、背景色与视角角度。 */
(function initSheetStudioUi() {
  const byId = id => document.getElementById(id);

  const studio = {
    draftStyle: null,
    draftAssets: {},
    selectedId: null,
    lastResult: null,
    lastGuides: null,
    renderTimer: 0,
    renderSeq: 0,
    rendering: false,
    pendingRender: false,
    dragState: null,
    splitDrag: null,
    smartSnap: true,
    showGrid: false,
    zoom: 1,
    inspectorWidth: 460,
    resizeObserver: null,
    initialized: false,
  };

  function openDialogClean(dlg) {
    if (!dlg) return;
    if (typeof toggleFileMenu === 'function') toggleFileMenu(false);
    if (typeof toggleSettingsMenu === 'function') toggleSettingsMenu(false);
    if (typeof pauseFlyLook === 'function') pauseFlyLook();
    if (typeof closeInspector === 'function') closeInspector();
    // 使用非模态 show() 停靠在顶部标题栏下方，保证外层标题栏最大化/最小化/全屏按钮始终可直接点击
    if (!dlg.open) dlg.show();
    dlg.focus({ preventScroll: true });
    syncFullscreenButton();
  }

  function syncFullscreenButton() {
    const btn = byId('studioFullscreenBtn');
    if (!btn) return;
    const fs = !!state.fullscreen;
    btn.textContent = fs ? '退出全屏 (F11)' : '全屏 (F11)';
    btn.setAttribute('aria-pressed', String(fs));
  }

  function applyStageZoom() {
    const img = byId('studioPreviewImg');
    const stage = byId('studioStage');
    const lbl = byId('studioZoomReset');
    if (img && studio.lastResult && stage) {
      const availW = Math.max(180, stage.clientWidth - 36);
      const availH = Math.max(140, stage.clientHeight - 36);
      const fit = Math.min(availW / studio.lastResult.width, availH / studio.lastResult.height, 1);
      const isFit = Math.abs(studio.zoom - 1) < 0.02;
      const scale = fit * (isFit ? 1 : studio.zoom);
      img.style.width = `${Math.max(120, Math.round(studio.lastResult.width * scale))}px`;
      img.style.height = `${Math.max(90, Math.round(studio.lastResult.height * scale))}px`;
      img.classList.toggle('is-zoomed', !isFit);
      stage.classList.toggle('is-zoomed', !isFit);
    }
    if (lbl) lbl.textContent = Math.abs(studio.zoom - 1) < 0.02 ? '适应' : `${Math.round(studio.zoom * 100)}%`;
    renderOverlay();
    renderStaticGrid();
  }

  function applyInspectorWidth(widthPx, savePreference = false) {
    const shell = byId('studioShell');
    if (!shell) return;
    const maxW = Math.max(360, Math.min(720, Math.round(window.innerWidth * 0.56)));
    const clamped = Math.max(330, Math.min(maxW, Math.round(widthPx)));
    if (savePreference) studio.inspectorWidth = clamped;
    shell.style.setProperty('--studio-inspector-w', `${clamped}px`);
    requestAnimationFrame(() => {
      if (studio.lastResult) applyStageZoom();
      else {
        renderOverlay();
        renderStaticGrid();
      }
    });
  }

  function setStatus(msg, isErr = false) {
    const el = byId('studioStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'muted small' + (isErr ? ' err' : '');
  }

  function switchTab(tab) {
    const map = [
      ['elements', 'studioTabElements', 'studioPanelElements'],
      ['angles', 'studioTabAngles', 'studioPanelAngles'],
      ['background', 'studioTabBackground', 'studioPanelBackground'],
    ];
    for (const [key, btnId, panelId] of map) {
      const active = key === tab;
      byId(btnId)?.classList.toggle('is-active', active);
      byId(btnId)?.setAttribute('aria-selected', String(active));
      byId(panelId)?.classList.toggle('hidden', !active);
    }
  }

  function fillPresetSelect(sel, reverse = false) {
    if (!sel || !window.ViewPresets) return;
    sel.replaceChildren();
    sel.add(new Option(reverse ? '跟随当前视角背面' : '跟随当前交互视角', reverse ? 'current_reverse' : 'current'));
    for (const p of window.ViewPresets.LIST) {
      sel.add(new Option(p.label, p.id));
    }
    sel.add(new Option('自定义角度（下方滑块）', 'custom'));
  }

  function selectedElement() {
    if (!studio.draftStyle || !studio.selectedId) return null;
    return studio.draftStyle.elements.find(e => e.id === studio.selectedId) || null;
  }

  function elementDisplayTitle(el) {
    if (!el) return '';
    if (el.title) return el.title;
    if (el.kind === 'icon') return '左上角图标';
    if (el.kind === 'image') return '插入图片';
    if (el.kind === 'field') {
      const meta = window.SheetStyle.SHEET_FIELD_CATALOG.find(f => f.key === el.fieldKey);
      return el.label || meta?.label || el.fieldKey;
    }
    return el.text ? el.text.slice(0, 14) : '自定义文字';
  }

  function syncAngleControls() {
    const st = studio.draftStyle;
    if (!st) return;
    byId('studioPanelLayout').value = st.panelLayout || 'dual';
    byId('studioShowAngleBadges').checked = st.showAngleBadges !== false;

    const v2Card = byId('studioView2Card');
    if (v2Card) v2Card.classList.toggle('studio-card-dimmed', st.panelLayout === 'single');

    for (const [key, prefix] of [['view1', 'studioView1'], ['view2', 'studioView2']]) {
      const v = st[key];
      const presetSel = byId(prefix + 'Preset');
      if (presetSel) {
        presetSel.value = v.mode === 'custom' ? 'custom' : v.preset;
      }
      const yawInput = byId(prefix + 'Yaw');
      const slantInput = byId(prefix + 'Slant');
      const resolved = window.SheetExporter.resolveViewSpec(
        v,
        Number(els.rotation?.value) || 45,
        Number(els.slant?.value) || 30
      );
      const yawVal = v.mode === 'custom' ? v.yaw : resolved.yaw;
      const slantVal = v.mode === 'custom' ? v.slant : resolved.slant;
      if (yawInput) yawInput.value = String(Math.round(yawVal));
      if (slantInput) slantInput.value = String(Math.round(slantVal));
      const yLbl = byId(prefix + 'YawVal');
      const sLbl = byId(prefix + 'SlantVal');
      if (yLbl) yLbl.textContent = `${Math.round(yawVal)}°`;
      if (sLbl) sLbl.textContent = `${Math.round(slantVal)}°`;
      const tagIn = byId(prefix + 'Tag');
      if (tagIn) tagIn.value = v.tag || '';
    }
  }

  function syncBackgroundControls() {
    const st = studio.draftStyle;
    if (!st) return;
    byId('studioBgMode').value = st.bgMode || 'solid';
    byId('studioBgColor').value = (st.bgColor || '#15161a').slice(0, 7);
    byId('studioBgColor2').value = (st.bgColor2 || '#1d2230').slice(0, 7);
    byId('studioBgColor2Wrap')?.classList.toggle('hidden', st.bgMode !== 'gradient');
    byId('studioBgImgRow')?.classList.toggle('hidden', st.bgMode !== 'image');

    byId('studioShowHeaderBar').checked = st.showHeaderBar !== false;
    byId('studioHeaderBg').value = (st.headerBg || '#1e2027').slice(0, 7);
    byId('studioHeaderAccent').value = (st.headerAccent || '#3c8527').slice(0, 7);

    byId('studioShowFooterBox').checked = st.showFooterBox !== false;
    byId('studioFooterBg').value = (st.footerBoxBg || '#1b1d23').slice(0, 7);
    byId('studioFooterBorder').value = (st.footerBoxBorder || '#2f323c').slice(0, 7);
    byId('studioFooterCols').value = String(st.footerColumns || 2);

    byId('studioPanelBgMode').value = st.panelBgMode || 'radial';
    byId('studioPanelBgColor').value = (st.panelBgColor || '#21232b').slice(0, 7);
    byId('studioPanelBorderColor').value = (st.panelBorderColor || '#383b46').slice(0, 7);
    byId('studioShowPanelBorder').checked = st.showPanelBorder !== false;
  }

  function syncInspector() {
    const el = selectedElement();
    const emptyEl = byId('studioPropsEmpty');
    const bodyEl = byId('studioPropsBody');
    const titleEl = byId('studioSelName');
    const btnCenter = byId('studioCenterEl');
    const btnUp = byId('studioLayerUp');
    const btnDown = byId('studioLayerDown');
    const btnToggle = byId('studioToggleEl');
    const btnDel = byId('studioDeleteEl');

    if (!el) {
      if (titleEl) titleEl.textContent = '未选中元素（点击预览画布中任意元素）';
      emptyEl?.classList.remove('hidden');
      bodyEl?.classList.add('hidden');
      if (btnCenter) btnCenter.disabled = true;
      if (btnUp) btnUp.disabled = true;
      if (btnDown) btnDown.disabled = true;
      if (btnToggle) btnToggle.disabled = true;
      btnDel?.classList.add('hidden');
      return;
    }

    if (titleEl) titleEl.textContent = `当前选中：${elementDisplayTitle(el)}`;
    emptyEl?.classList.add('hidden');
    bodyEl?.classList.remove('hidden');
    if (btnCenter) btnCenter.disabled = false;
    if (btnUp) btnUp.disabled = false;
    if (btnDown) btnDown.disabled = false;
    if (btnToggle) {
      btnToggle.disabled = false;
      btnToggle.textContent = el.visible ? '隐藏' : '显示';
    }

    const isBuiltinCore = ['el_icon', 'el_brand', 'el_subtitle', 'el_title', 'el_dim_pill', 'el_blocks_pill', 'el_regions_pill'].includes(el.id);
    if (btnDel) btnDel.classList.toggle('hidden', isBuiltinCore);

    byId('studioElBand').value = el.band || 'footer';
    byId('studioElX').value = String(Math.round((el.x || 0) * 100));
    byId('studioElY').value = String(Math.round((el.y || 0) * 100));

    const isImageKind = el.kind === 'icon' || el.kind === 'image';
    byId('studioTextGroup')?.classList.toggle('hidden', isImageKind);
    byId('studioImageGroup')?.classList.toggle('hidden', !isImageKind);

    if (isImageKind) {
      byId('studioIconSourceRow')?.classList.toggle('hidden', el.kind !== 'icon');
      byId('studioElImgSource').value = el.source || 'app';
      byId('studioElPixelated').checked = el.pixelated !== false;
      byId('studioElImgSize').value = String(el.size || 30);
      byId('studioElImgSizeVal').textContent = String(el.size || 30);
      const opPct = Math.round((el.opacity ?? 1) * 100);
      byId('studioElOpacity').value = String(opPct);
      byId('studioElOpacityVal').textContent = `${opPct}%`;
    } else {
      const isField = el.kind === 'field';
      byId('studioFieldLabelRow')?.classList.toggle('hidden', !isField);
      byId('studioAffixRow')?.classList.toggle('hidden', !isField);
      byId('studioElTextTitle').textContent = isField ? '覆盖内容' : '显示文字';
      if (isField) {
        byId('studioElLabel').value = el.label ?? '';
        byId('studioElShowLabel').checked = el.showLabel !== false;
        byId('studioElText').value = el.overrideText || '';
        byId('studioElText').placeholder = '留空则自动读取投影真实数据';
        byId('studioElPrefix').value = el.prefix || '';
        byId('studioElSuffix').value = el.suffix || '';
      } else {
        byId('studioElText').value = el.text || '';
        byId('studioElText').placeholder = '输入要展示的文字';
      }
      byId('studioElVariant').value = el.styleVariant || 'row';
      byId('studioElAnchor').value = el.anchor || 'left';
      byId('studioElFontSize').value = String(el.fontSize || 15);
      byId('studioElFontVal').textContent = String(el.fontSize || 15);
      byId('studioElBold').checked = el.bold !== false;
      const maxPct = Math.round((el.maxWidth || 0.45) * 100);
      byId('studioElMaxW').value = String(maxPct);
      byId('studioElMaxWVal').textContent = `${maxPct}%`;
      byId('studioElColor').value = (el.color || '#eef0f4').slice(0, 7);
      byId('studioElLabelColor').value = (el.labelColor || '#9aa0ad').slice(0, 7);
      byId('studioElAccentColor').value = (el.accentColor || '#3c8527').slice(0, 7);
      byId('studioElBgColor').value = (el.bgColor || '#23262f').slice(0, 7);
      byId('studioElBorderColor').value = (el.borderColor || '#3f4452').slice(0, 7);
    }
  }

  function renderFieldCatalog() {
    const host = byId('studioFieldCatalog');
    if (!host || !studio.draftStyle) return;
    host.replaceChildren();

    const fieldCtx = {
      file: state.file,
      info: state.info,
      defaultGameVersion: state.defaultGameVersion,
      packs: state.packs,
      view1: window.SheetExporter.resolveViewSpec(studio.draftStyle.view1, Number(els.rotation?.value) || 45, Number(els.slant?.value) || 30),
      view2: window.SheetExporter.resolveViewSpec(studio.draftStyle.view2, Number(els.rotation?.value) || 45, Number(els.slant?.value) || 30),
      panelLayout: studio.draftStyle.panelLayout,
    };

    const makeSectionTitle = text => {
      const h = document.createElement('div');
      h.className = 'studio-catalog-group';
      h.textContent = text;
      return h;
    };

    // 1. Core template & custom elements (icon, brand, subtitle, custom texts, uploaded images)
    const customAndCore = studio.draftStyle.elements.filter(
      e => e.kind === 'icon' || e.kind === 'image' || e.kind === 'text' || ['el_title', 'el_dim_pill', 'el_blocks_pill', 'el_regions_pill'].includes(e.id)
    );
    if (customAndCore.length) {
      host.append(makeSectionTitle('画布基础元素与插图 / 自定义文字'));
      for (const el of customAndCore) {
        const row = document.createElement('div');
        row.className = 'studio-catalog-row' + (studio.selectedId === el.id ? ' is-selected' : '');
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!el.visible;
        chk.addEventListener('change', () => {
          el.visible = chk.checked;
          if (chk.checked) studio.selectedId = el.id;
          renderFieldCatalog();
          syncInspector();
          schedulePreviewRender(20);
        });
        const label = document.createElement('span');
        label.className = 'studio-cat-name';
        label.textContent = elementDisplayTitle(el);
        const val = document.createElement('span');
        val.className = 'studio-cat-val';
        val.textContent = el.kind === 'image' ? '插图' : el.kind === 'icon' ? '图标' : (el.text || el.fieldKey || '');
        row.append(chk, label, val);
        row.addEventListener('click', e => {
          if (e.target === chk) return;
          studio.selectedId = el.id;
          renderFieldCatalog();
          syncInspector();
          renderOverlay();
        });
        host.append(row);
      }
    }

    // 2. Complete schematic stored field catalog
    host.append(makeSectionTitle('投影文件保存的全部信息（勾选加入画布并拖动）'));
    for (const meta of window.SheetStyle.SHEET_FIELD_CATALOG) {
      // Find associated metaRow element (prefer footer metaRow rather than top pills)
      const existing = studio.draftStyle.elements.find(
        e => e.kind === 'field' && e.fieldKey === meta.key && !['el_title', 'el_dim_pill', 'el_blocks_pill', 'el_regions_pill'].includes(e.id)
      );
      const checked = !!(existing && existing.visible);
      const row = document.createElement('div');
      row.className = 'studio-catalog-row' + (existing && studio.selectedId === existing.id ? ' is-selected' : '');

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = checked;
      chk.addEventListener('change', () => {
        if (chk.checked) {
          let target = existing;
          if (!target) {
            target = createFooterFieldElement(meta);
            studio.draftStyle.elements.push(target);
          } else {
            target.visible = true;
          }
          studio.selectedId = target.id;
        } else if (existing) {
          existing.visible = false;
        }
        renderFieldCatalog();
        syncInspector();
        schedulePreviewRender(20);
      });

      const nameSpan = document.createElement('span');
      nameSpan.className = 'studio-cat-name';
      nameSpan.textContent = meta.label;

      const valSpan = document.createElement('span');
      valSpan.className = 'studio-cat-val';
      const formatted = window.SheetStyle.formatFieldValue(meta.key, fieldCtx);
      valSpan.textContent = formatted;
      valSpan.title = formatted;

      row.append(chk, nameSpan, valSpan);
      row.addEventListener('click', e => {
        if (e.target === chk) return;
        if (existing) {
          if (!existing.visible) existing.visible = true;
          studio.selectedId = existing.id;
          renderFieldCatalog();
          syncInspector();
          schedulePreviewRender(20);
        } else {
          chk.checked = true;
          chk.dispatchEvent(new Event('change'));
        }
      });
      host.append(row);
    }
  }

  function createFooterFieldElement(meta) {
    const visibleFooter = studio.draftStyle.elements.filter(e => e.visible && e.band === 'footer');
    const cols = Math.max(1, Math.min(3, Number(studio.draftStyle.footerColumns) || 2));
    const idx = visibleFooter.length;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const totalRows = Math.max(2, Math.ceil((idx + 1) / cols));
    const colStarts = cols === 1 ? [0.04] : cols === 2 ? [0.038, 0.515] : [0.036, 0.355, 0.675];
    return {
      id: `el_field_${meta.key}_${Date.now().toString(36).slice(-4)}`,
      kind: 'field',
      role: 'metaRow',
      fieldKey: meta.key,
      title: meta.label,
      visible: true,
      label: meta.label,
      showLabel: true,
      prefix: '',
      suffix: '',
      overrideText: '',
      styleVariant: 'row',
      fontSize: 15,
      bold: true,
      color: '#eef0f4',
      labelColor: '#9aa0ad',
      bgColor: '',
      borderColor: '',
      accentColor: '#3c8527',
      band: 'footer',
      x: colStarts[col],
      y: Math.min(0.9, Math.max(0.14, Math.round(((row + 0.5) / totalRows) * 1000) / 1000)),
      anchor: 'left',
      maxWidth: cols === 1 ? 0.92 : cols === 2 ? 0.44 : 0.29,
      z: 30 + idx,
    };
  }

  function renderOverlay() {
    if (studio.dragState) return;
    const overlay = byId('studioOverlay');
    const img = byId('studioPreviewImg');
    const res = studio.lastResult;
    if (!overlay || !img || !res) return;

    overlay.replaceChildren();

    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    if (!dispW || !dispH || !res.width || !res.height) return;
    const sx = dispW / res.width;
    const sy = dispH / res.height;

    for (const box of res.boxes || []) {
      const el = studio.draftStyle.elements.find(item => item.id === box.id);
      if (!el) continue;
      const div = document.createElement('div');
      div.className = 'studio-hitbox' + (studio.selectedId === el.id ? ' is-selected' : '');
      div.dataset.elId = el.id;
      div.style.left = `${Math.round(box.x * sx)}px`;
      div.style.top = `${Math.round(box.y * sy)}px`;
      div.style.width = `${Math.max(16, Math.round(box.w * sx))}px`;
      div.style.height = `${Math.max(14, Math.round(box.h * sy))}px`;

      const tag = document.createElement('span');
      tag.className = 'studio-hitbox-tag' + (box.x > res.width * 0.65 ? ' is-right-edge' : '');
      tag.textContent = elementDisplayTitle(el);
      div.append(tag);

      div.addEventListener('pointerdown', e => startDragElement(e, el, div, box));
      div.addEventListener('dblclick', e => {
        e.stopPropagation();
        studio.selectedId = el.id;
        switchTab('elements');
        syncInspector();
        const focusTarget = (el.kind === 'field' ? byId('studioElLabel') : byId('studioElText'));
        if (focusTarget && el.kind !== 'icon' && el.kind !== 'image') {
          focusTarget.focus();
          focusTarget.select();
        }
      });
      overlay.append(div);
    }
  }

  function renderStaticGrid() {
    const layer = byId('studioGridLayer');
    const img = byId('studioPreviewImg');
    const res = studio.lastResult;
    if (!layer) return;
    layer.classList.toggle('hidden', !studio.showGrid);
    if (!studio.showGrid || !img || !res?.bands) return;
    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    if (!dispW || !dispH) return;
    const sx = dispW / res.width;
    const sy = dispH / res.height;
    const b = res.bands;

    layer.replaceChildren();
    const addV = (x, cls) => {
      const el = document.createElement('div');
      el.className = 'studio-grid-line-v ' + cls;
      el.style.left = `${Math.round(x * sx)}px`;
      layer.append(el);
    };
    const addH = (y, cls) => {
      const el = document.createElement('div');
      el.className = 'studio-grid-line-h ' + cls;
      el.style.top = `${Math.round(y * sy)}px`;
      layer.append(el);
    };

    // Canvas center, rule-of-thirds, outer safe margins, and panel centers
    addV(b.totalW * 0.5, 'is-major');
    addV(b.totalW / 3, 'is-minor');
    addV((b.totalW * 2) / 3, 'is-minor');
    if (b.outerPad) {
      addV(b.outerPad, 'is-margin');
      addV(b.totalW - b.outerPad, 'is-margin');
    }
    for (const p of b.panels || []) {
      addV(p.x + p.w * 0.5, 'is-minor');
    }

    addH(b.headerBarH * 0.5, 'is-minor');
    addH(b.panelsTop, 'is-margin');
    addH(b.panelsTop + b.panelsBlockH * 0.5, 'is-major');
    addH(b.panelsTop + b.panelsBlockH, 'is-margin');
    addH(b.footerTop, 'is-margin');
    addH(b.footerTop + (b.footerInnerH || b.footerH) * 0.5, 'is-minor');
  }

  function clearSmartGuides() {
    studio.lastGuides = null;
    byId('studioGuidesLayer')?.replaceChildren();
  }

  /**
   * 类似 Photoshop / PowerPoint 的多轴智能对齐与等距磁吸引擎：
   * 同时检测元素边缘/中线对齐、同行/同列等间距分布，以及画布/视口/页脚全局参考线。
   */
  function computeSmartSnap(curRect, others, bands, thresholdPx = 7) {
    const vCandidates = [];
    const hCandidates = [];
    const S = bands.scale || 1;
    const footerInnerH = bands.footerInnerH || bands.footerH;

    // 1. 元素对元素对齐（最高优先级 priority=0）
    for (const o of others) {
      const oL = o.vx, oCX = o.vx + o.vw / 2, oR = o.vx + o.vw;
      const oT = o.vy, oCY = o.vy + o.vh / 2, oB = o.vy + o.vh;

      const xPairs = [
        [curRect.left, oL, '左对齐'],
        [curRect.cx, oCX, '水平居中'],
        [curRect.right, oR, '右对齐'],
        [curRect.left, oR, '边缘贴合'],
        [curRect.right, oL, '边缘贴合'],
      ];
      for (const [src, dst, label] of xPairs) {
        const diff = dst - src;
        if (Math.abs(diff) <= thresholdPx) {
          vCandidates.push({
            priority: 0,
            dist: Math.abs(diff),
            delta: diff,
            pos: dst,
            kind: 'element',
            label,
            spanStart: Math.min(curRect.top, oT) - 10,
            spanEnd: Math.max(curRect.bottom, oB) + 10,
          });
        }
      }

      const yPairs = [
        [curRect.cy, oCY, '同行居中'],
        [curRect.top, oT, '顶对齐'],
        [curRect.bottom, oB, '底对齐'],
        [curRect.top, oB, '上下贴合'],
        [curRect.bottom, oT, '上下贴合'],
      ];
      for (const [src, dst, label] of yPairs) {
        const diff = dst - src;
        if (Math.abs(diff) <= thresholdPx) {
          hCandidates.push({
            priority: 0,
            dist: Math.abs(diff),
            delta: diff,
            pos: dst,
            kind: 'element',
            label,
            spanStart: Math.min(curRect.left, oL) - 10,
            spanEnd: Math.max(curRect.right, oR) + 10,
          });
        }
      }
    }

    // 2. 横向等距分布（同行多个元素之间等间距，priority=1）
    const rowPeers = others
      .filter(o => Math.min(curRect.bottom, o.vy + o.vh) - Math.max(curRect.top, o.vy) > -10)
      .sort((a, b) => a.vx - b.vx);
    for (let i = 0; i < rowPeers.length - 1; i++) {
      const a = rowPeers[i], b = rowPeers[i + 1];
      const aR = a.vx + a.vw, bL = b.vx, bR = b.vx + b.vw;
      const gap = bL - aR;
      if (gap >= 4 && gap <= 280) {
        // 拖到 B 右侧保持相同间距 gap
        const dRight = (bR + gap) - curRect.left;
        if (Math.abs(dRight) <= thresholdPx + 1) {
          vCandidates.push({
            priority: 1,
            dist: Math.abs(dRight),
            delta: dRight,
            pos: bR + gap,
            kind: 'spacing',
            label: `等距 ${Math.round(gap)}px`,
            spacingBars: [
              { x1: aR, x2: bL, y: curRect.cy, gap: Math.round(gap) },
              { x1: bR, x2: bR + gap, y: curRect.cy, gap: Math.round(gap) },
            ],
          });
        }
        // 拖到 A 左侧保持相同间距 gap
        const dLeft = (a.vx - gap) - curRect.right;
        if (Math.abs(dLeft) <= thresholdPx + 1) {
          vCandidates.push({
            priority: 1,
            dist: Math.abs(dLeft),
            delta: dLeft,
            pos: a.vx - gap,
            kind: 'spacing',
            label: `等距 ${Math.round(gap)}px`,
            spacingBars: [
              { x1: a.vx - gap, x2: a.vx, y: curRect.cy, gap: Math.round(gap) },
              { x1: aR, x2: bL, y: curRect.cy, gap: Math.round(gap) },
            ],
          });
        }
      }
      // 拖到 A 与 B 正中间等分两侧空隙
      const avail = bL - aR - curRect.vw;
      if (avail >= 8 && avail <= 400) {
        const halfGap = avail / 2;
        const dMid = (aR + halfGap) - curRect.left;
        if (Math.abs(dMid) <= thresholdPx + 1) {
          vCandidates.push({
            priority: 1,
            dist: Math.abs(dMid),
            delta: dMid,
            pos: aR + halfGap + curRect.vw / 2,
            kind: 'spacing',
            label: `居中平分 ${Math.round(halfGap)}px`,
            spacingBars: [
              { x1: aR, x2: aR + halfGap, y: curRect.cy, gap: Math.round(halfGap) },
              { x1: aR + halfGap + curRect.vw, x2: bL, y: curRect.cy, gap: Math.round(halfGap) },
            ],
          });
        }
      }
    }

    // 3. 纵向等距分布（同列多个元素之间等间距，priority=1）
    const colPeers = others
      .filter(o => Math.min(curRect.right, o.vx + o.vw) - Math.max(curRect.left, o.vx) > -10)
      .sort((a, b) => a.vy - b.vy);
    for (let i = 0; i < colPeers.length - 1; i++) {
      const a = colPeers[i], b = colPeers[i + 1];
      const aB = a.vy + a.vh, bT = b.vy, bB = b.vy + b.vh;
      const gap = bT - aB;
      if (gap >= 3 && gap <= 200) {
        const dBelow = (bB + gap) - curRect.top;
        if (Math.abs(dBelow) <= thresholdPx + 1) {
          hCandidates.push({
            priority: 1,
            dist: Math.abs(dBelow),
            delta: dBelow,
            pos: bB + gap,
            kind: 'spacing',
            label: `等距 ${Math.round(gap)}px`,
            spacingBars: [
              { y1: aB, y2: bT, x: curRect.cx, gap: Math.round(gap) },
              { y1: bB, y2: bB + gap, x: curRect.cx, gap: Math.round(gap) },
            ],
          });
        }
        const dAbove = (a.vy - gap) - curRect.bottom;
        if (Math.abs(dAbove) <= thresholdPx + 1) {
          hCandidates.push({
            priority: 1,
            dist: Math.abs(dAbove),
            delta: dAbove,
            pos: a.vy - gap,
            kind: 'spacing',
            label: `等距 ${Math.round(gap)}px`,
            spacingBars: [
              { y1: a.vy - gap, y2: a.vy, x: curRect.cx, gap: Math.round(gap) },
              { y1: aB, y2: bT, x: curRect.cx, gap: Math.round(gap) },
            ],
          });
        }
      }
    }

    // 4. 画布、边距、视口与页脚全局基准参考线（priority=2）
    const pad = bands.outerPad || 24;
    const innerPad = pad + Math.round(16 * S);
    const vCanvasLines = [
      { pos: bands.totalW * 0.5, edges: ['cx'], label: '画布中线' },
      { pos: bands.totalW / 3, edges: ['cx', 'left'], label: '三分线 1/3' },
      { pos: (bands.totalW * 2) / 3, edges: ['cx', 'right'], label: '三分线 2/3' },
      { pos: bands.totalW * 0.25, edges: ['cx'], label: '四分线 1/4' },
      { pos: bands.totalW * 0.75, edges: ['cx'], label: '四分线 3/4' },
      { pos: pad, edges: ['left'], label: '左安全边距' },
      { pos: bands.totalW - pad, edges: ['right'], label: '右安全边距' },
      { pos: innerPad, edges: ['left'], label: '信息栏左边' },
      { pos: bands.totalW - innerPad, edges: ['right'], label: '信息栏右边' },
    ];
    for (const p of bands.panels || []) {
      vCanvasLines.push(
        { pos: p.x, edges: ['left'], label: '视口左边' },
        { pos: p.x + p.w * 0.5, edges: ['cx'], label: '视口中线' },
        { pos: p.x + p.w, edges: ['right'], label: '视口右边' }
      );
    }
    for (const ln of vCanvasLines) {
      for (const edge of ln.edges) {
        const src = curRect[edge];
        const diff = ln.pos - src;
        if (Math.abs(diff) <= thresholdPx) {
          vCandidates.push({
            priority: 2,
            dist: Math.abs(diff),
            delta: diff,
            pos: ln.pos,
            kind: 'canvas',
            label: ln.label,
            spanStart: 0,
            spanEnd: bands.totalH,
          });
        }
      }
    }

    const hCanvasLines = [
      { pos: bands.headerBarH * 0.5, edges: ['cy'], label: '顶栏垂直居中' },
      { pos: bands.headerBandH * 0.71, edges: ['cy'], label: '标题行中线' },
      { pos: bands.panelsTop, edges: ['top'], label: '视口顶边' },
      { pos: bands.panelsTop + bands.panelsBlockH * 0.5, edges: ['cy'], label: '视口水平中线' },
      { pos: bands.panelsTop + bands.panelsBlockH, edges: ['bottom'], label: '视口底边' },
      { pos: bands.footerTop, edges: ['top'], label: '底栏顶边' },
      { pos: bands.footerTop + footerInnerH * 0.5, edges: ['cy'], label: '底栏水平居中' },
      { pos: bands.footerTop + footerInnerH * 0.28, edges: ['cy'], label: '底栏上行' },
      { pos: bands.footerTop + footerInnerH * 0.72, edges: ['cy'], label: '底栏下行' },
      { pos: bands.footerTop + footerInnerH, edges: ['bottom'], label: '底栏底边' },
    ];
    for (const ln of hCanvasLines) {
      for (const edge of ln.edges) {
        const src = curRect[edge];
        const diff = ln.pos - src;
        if (Math.abs(diff) <= thresholdPx) {
          hCandidates.push({
            priority: 2,
            dist: Math.abs(diff),
            delta: diff,
            pos: ln.pos,
            kind: 'canvas',
            label: ln.label,
            spanStart: 0,
            spanEnd: bands.totalW,
          });
        }
      }
    }

    const pickBest = list => {
      if (!list.length) return null;
      list.sort((a, b) => (a.priority - b.priority) || (a.dist - b.dist));
      const best = list[0];
      // 合并同一坐标处匹配到的多条元素参考线，让一条线连贯穿过所有对齐元素
      const samePos = list.filter(item => item.kind === best.kind && Math.abs(item.pos - best.pos) <= 1.5);
      if (best.kind === 'element' && samePos.length > 1) {
        return {
          ...best,
          spanStart: Math.min(...samePos.map(i => i.spanStart)),
          spanEnd: Math.max(...samePos.map(i => i.spanEnd)),
        };
      }
      return best;
    };

    const bestV = pickBest(vCandidates);
    const bestH = pickBest(hCandidates);
    return {
      dx: bestV ? bestV.delta : 0,
      dy: bestH ? bestH.delta : 0,
      vGuide: bestV,
      hGuide: bestH,
    };
  }

  function renderSmartGuides(snap, res) {
    const layer = byId('studioGuidesLayer');
    const img = byId('studioPreviewImg');
    if (!layer || !img || !res) return;
    layer.replaceChildren();
    studio.lastGuides = snap;
    if (!snap) return;

    const sx = img.clientWidth / res.width;
    const sy = img.clientHeight / res.height;

    const appendVertical = g => {
      if (!g) return;
      if (g.kind === 'spacing' && g.spacingBars) {
        for (const bar of g.spacingBars) {
          const left = Math.round(Math.min(bar.x1, bar.x2) * sx);
          const width = Math.max(2, Math.round(Math.abs(bar.x2 - bar.x1) * sx));
          const top = Math.round(bar.y * sy);
          const el = document.createElement('div');
          el.className = 'studio-spacing-bar is-h';
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
          el.style.width = `${width}px`;
          const pill = document.createElement('span');
          pill.className = 'studio-spacing-pill';
          pill.textContent = `${bar.gap}px`;
          el.append(pill);
          layer.append(el);
        }
        return;
      }
      const line = document.createElement('div');
      line.className = `studio-guide-v is-${g.kind}`;
      line.style.left = `${Math.round(g.pos * sx)}px`;
      const topPx = Math.max(0, Math.round((g.spanStart ?? 0) * sy));
      const botPx = Math.min(img.clientHeight, Math.round((g.spanEnd ?? res.height) * sy));
      line.style.top = `${topPx}px`;
      line.style.height = `${Math.max(12, botPx - topPx)}px`;
      if (g.label) {
        const badge = document.createElement('span');
        badge.className = `studio-guide-badge is-${g.kind}`;
        badge.textContent = g.label;
        line.append(badge);
      }
      layer.append(line);
    };

    const appendHorizontal = g => {
      if (!g) return;
      if (g.kind === 'spacing' && g.spacingBars) {
        for (const bar of g.spacingBars) {
          const top = Math.round(Math.min(bar.y1, bar.y2) * sy);
          const height = Math.max(2, Math.round(Math.abs(bar.y2 - bar.y1) * sy));
          const left = Math.round(bar.x * sx);
          const el = document.createElement('div');
          el.className = 'studio-spacing-bar is-v';
          el.style.left = `${left}px`;
          el.style.top = `${top}px`;
          el.style.height = `${height}px`;
          const pill = document.createElement('span');
          pill.className = 'studio-spacing-pill';
          pill.textContent = `${bar.gap}px`;
          el.append(pill);
          layer.append(el);
        }
        return;
      }
      const line = document.createElement('div');
      line.className = `studio-guide-h is-${g.kind}`;
      line.style.top = `${Math.round(g.pos * sy)}px`;
      const leftPx = Math.max(0, Math.round((g.spanStart ?? 0) * sx));
      const rightPx = Math.min(img.clientWidth, Math.round((g.spanEnd ?? res.width) * sx));
      line.style.left = `${leftPx}px`;
      line.style.width = `${Math.max(12, rightPx - leftPx)}px`;
      if (g.label) {
        const badge = document.createElement('span');
        badge.className = `studio-guide-badge is-${g.kind}`;
        badge.textContent = g.label;
        line.append(badge);
      }
      layer.append(line);
    };

    appendVertical(snap.vGuide);
    appendHorizontal(snap.hGuide);
  }

  function startDragElement(e, el, hitboxDiv, box) {
    if (e.button !== 0 || !studio.lastResult) return;
    e.preventDefault();
    e.stopPropagation();
    studio.selectedId = el.id;
    renderFieldCatalog();
    syncInspector();

    const overlay = byId('studioOverlay');
    for (const node of overlay.querySelectorAll('.studio-hitbox')) {
      node.classList.toggle('is-selected', node === hitboxDiv);
    }

    const img = byId('studioPreviewImg');
    const dispW = img.clientWidth;
    const dispH = img.clientHeight;
    const res = studio.lastResult;
    const bands = res.bands;
    const scaleX = res.width / dispW;
    const scaleY = res.height / dispH;

    const footerInnerH = bands.footerInnerH || Math.max(24, bands.footerH - 18);
    const startAnchorX = box.anchorX ?? (el.x * res.width);
    const startAnchorY = box.anchorY ?? (
      el.band === 'header'
        ? el.y * bands.headerBandH
        : el.band === 'footer'
          ? bands.footerTop + el.y * footerInnerH
          : bands.panelsTop + el.y * bands.panelsBlockH
    );

    const others = (res.boxes || [])
      .filter(b => b.id !== el.id)
      .map(b => ({
        id: b.id,
        vx: b.vx ?? b.x,
        vy: b.vy ?? b.y,
        vw: b.vw ?? b.w,
        vh: b.vh ?? b.h,
      }));

    studio.dragState = {
      el,
      hitboxDiv,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startAnchorX,
      startAnchorY,
      startVx: box.vx ?? box.x,
      startVy: box.vy ?? box.y,
      vw: box.vw ?? box.w,
      vh: box.vh ?? box.h,
      startHitLeft: parseFloat(hitboxDiv.style.left) || 0,
      startHitTop: parseFloat(hitboxDiv.style.top) || 0,
      dispW,
      dispH,
      scaleX,
      scaleY,
      bands,
      res,
      others,
      moved: false,
    };
    try { hitboxDiv.setPointerCapture(e.pointerId); } catch {}
  }

  function applySheetPointToElement(el, anchorX, anchorY, bands) {
    const nextX = Math.max(0.01, Math.min(0.99, anchorX / Math.max(1, bands.totalW)));
    const sheetY = Math.max(6, Math.min(bands.totalH - 6, anchorY));
    if (sheetY <= bands.panelsTop) {
      el.band = 'header';
      el.y = Math.max(0.04, Math.min(0.96, sheetY / Math.max(20, bands.headerBandH)));
    } else if (sheetY >= bands.footerTop) {
      el.band = 'footer';
      const innerH = Math.max(28, bands.footerInnerH || (bands.footerH - 18));
      el.y = Math.max(0.04, Math.min(0.96, (sheetY - bands.footerTop) / innerH));
    } else {
      el.band = 'canvas';
      el.y = Math.max(0.02, Math.min(0.98, (sheetY - bands.panelsTop) / Math.max(40, bands.panelsBlockH)));
    }
    el.x = Math.round(nextX * 10000) / 10000;
    el.y = Math.round(el.y * 10000) / 10000;
  }

  function moveDragElement(e) {
    const d = studio.dragState;
    if (!d) return;
    const dxDisp = e.clientX - d.startClientX;
    const dyDisp = e.clientY - d.startClientY;
    if (!d.moved && Math.hypot(dxDisp, dyDisp) < 2) return;
    d.moved = true;

    let dxSheet = dxDisp * d.scaleX;
    let dySheet = dyDisp * d.scaleY;

    const rawRect = {
      left: d.startVx + dxSheet,
      cx: d.startVx + dxSheet + d.vw / 2,
      right: d.startVx + dxSheet + d.vw,
      top: d.startVy + dySheet,
      cy: d.startVy + dySheet + d.vh / 2,
      bottom: d.startVy + dySheet + d.vh,
      vw: d.vw,
      vh: d.vh,
    };

    let snap = null;
    if (studio.smartSnap && !e.altKey) {
      const thresholdSheet = Math.max(6, Math.min(11, 7.5 * d.scaleX));
      snap = computeSmartSnap(rawRect, d.others, d.bands, thresholdSheet);
      dxSheet += snap.dx;
      dySheet += snap.dy;
      renderSmartGuides(snap, d.res);
    } else {
      clearSmartGuides();
    }

    applySheetPointToElement(d.el, d.startAnchorX + dxSheet, d.startAnchorY + dySheet, d.bands);

    d.hitboxDiv.style.left = `${Math.round(d.startHitLeft + dxSheet / d.scaleX)}px`;
    d.hitboxDiv.style.top = `${Math.round(d.startHitTop + dySheet / d.scaleY)}px`;
    byId('studioElBand').value = d.el.band;
    byId('studioElX').value = String(Math.round(d.el.x * 100));
    byId('studioElY').value = String(Math.round(d.el.y * 100));
  }

  function endDragElement(e) {
    const d = studio.dragState;
    if (!d) return;
    studio.dragState = null;
    clearSmartGuides();
    try {
      if (e?.pointerId !== undefined && d.hitboxDiv.hasPointerCapture(e.pointerId)) {
        d.hitboxDiv.releasePointerCapture(e.pointerId);
      }
    } catch {}
    if (d.moved) {
      renderFieldCatalog();
      schedulePreviewRender(0);
    }
  }

  function schedulePreviewRender(delayMs = 50) {
    clearTimeout(studio.renderTimer);
    studio.renderTimer = setTimeout(() => runStudioPreview(), delayMs);
  }

  async function runStudioPreview() {
    if (!studio.draftStyle || !byId('sheetStudioDialog')?.open) return;
    if (studio.rendering) {
      studio.pendingRender = true;
      return;
    }
    studio.rendering = true;
    const seq = ++studio.renderSeq;
    try {
      const hasLiveSchem = !!(state.file && state.info);
      const useGpu = hasLiveSchem && state.viewReady && !state.cpuPreview && state.view && !state.view.destroyed;
      const res = await window.SheetExporter.renderStudioPreview({
        file: state.file,
        info: state.info,
        defaultGameVersion: state.defaultGameVersion,
        packs: state.packs,
        currentYaw: Number(els.rotation?.value) || 45,
        currentSlant: Number(els.slant?.value) || 30,
        sheetStyle: studio.draftStyle,
        sheetAssets: studio.draftAssets,
        activeGpuView: useGpu ? state.view : null,
        realLighting: !!els.realLighting?.checked,
        lightingEnabled: els.lightingEnabled?.checked !== false,
        useGpu,
      });
      if (seq !== studio.renderSeq || !byId('sheetStudioDialog')?.open) return;
      studio.lastResult = res;
      const img = byId('studioPreviewImg');
      if (img) {
        const afterLoad = () => applyStageZoom();
        img.src = res.previewUrl;
        img.onload = afterLoad;
        if (img.complete) afterLoad();
      }
      const badge = byId('studioDimsBadge');
      if (badge) {
        badge.textContent = hasLiveSchem
          ? `实时预览 · ${res.width}×${res.height}`
          : `示例预览（打开投影后显示实体结构）· ${res.width}×${res.height}`;
      }
    } catch (err) {
      setStatus('预览刷新失败：' + err.message, true);
    } finally {
      studio.rendering = false;
      if (studio.pendingRender) {
        studio.pendingRender = false;
        runStudioPreview();
      }
    }
  }

  async function openStudio() {
    const dlg = byId('sheetStudioDialog');
    if (!dlg) return;
    studio.draftStyle = window.SheetStyle.normalizeSheetStyle(state.sheetStyle || window.SheetStyle.DEFAULT_SHEET_STYLE);
    // Reflect any recent sidebar sheetView changes when view is still preset mode
    if (studio.draftStyle.view1.mode !== 'custom' && els.sheetView1?.value) {
      studio.draftStyle.view1.preset = els.sheetView1.value;
    }
    if (studio.draftStyle.view2.mode !== 'custom' && els.sheetView2?.value) {
      studio.draftStyle.view2.preset = els.sheetView2.value;
    }
    studio.draftAssets = { ...(state.sheetAssets || {}) };
    studio.selectedId = studio.draftStyle.elements.find(e => e.visible)?.id || null;
    studio.lastResult = null;
    studio.zoom = 1;
    clearSmartGuides();
    byId('studioPreviewImg')?.removeAttribute('src');
    byId('studioOverlay')?.replaceChildren();
    byId('studioGridLayer')?.replaceChildren();
    applyInspectorWidth(window.innerWidth <= 1080 ? Math.min(studio.inspectorWidth, 380) : studio.inspectorWidth, false);
    applyStageZoom();

    fillPresetSelect(byId('studioView1Preset'), false);
    fillPresetSelect(byId('studioView2Preset'), true);
    syncAngleControls();
    syncBackgroundControls();

    const dirIn = byId('studioOutputDir');
    if (dirIn) dirIn.value = state.sheetOutputDir || '与投影同目录';
    const copyChk = byId('studioCopyClipboard');
    if (copyChk) copyChk.checked = state.sheetCopyClipboard !== false;

    const expBtn = byId('studioExportNow');
    if (expBtn) expBtn.disabled = !(state.file && state.info) || state.rendering || state.scenePreparing;

    setStatus(state.info ? `已载入投影「${state.info.name}」的真实信息字段` : '当前未打开投影，使用示例方块与数据实时预览');
    switchTab('elements');
    renderFieldCatalog();
    syncInspector();
    openDialogClean(dlg);
    await runStudioPreview();
  }

  async function saveDraftToApp() {
    const clean = window.SheetStyle.normalizeSheetStyle(studio.draftStyle);
    state.sheetStyle = clean;
    state.sheetAssets = { ...studio.draftAssets };
    if (clean.view1.mode !== 'custom' && els.sheetView1) {
      state.sheetView1 = clean.view1.preset;
      els.sheetView1.value = clean.view1.preset;
    }
    if (clean.view2.mode !== 'custom' && els.sheetView2) {
      state.sheetView2 = clean.view2.preset;
      els.sheetView2.value = clean.view2.preset;
    }
    const copy = !!byId('studioCopyClipboard')?.checked;
    state.sheetCopyClipboard = copy;
    if (byId('sheetCopyClipboard')) byId('sheetCopyClipboard').checked = copy;

    await window.appUi.setSheetSettings({
      sheetStyle: clean,
      sheetView1: state.sheetView1,
      sheetView2: state.sheetView2,
      sheetCopyClipboard: copy,
    });
    log('已保存导出模式可视化排版与样式配置。', 'ok');
  }

  function wireControls() {
    if (studio.initialized) return;
    studio.initialized = true;

    // Top bar Settings dropdown + Sidebar button
    byId('menuSheetSettings')?.addEventListener('click', () => {
      if (typeof toggleSettingsMenu === 'function') toggleSettingsMenu(false);
      openStudio();
    });
    byId('btnOpenSheetStudio')?.addEventListener('click', () => openStudio());

    byId('menuSettingsVersionMap')?.addEventListener('click', () => {
      if (typeof toggleSettingsMenu === 'function') toggleSettingsMenu(false);
      window.McVersionUi?.openVersionMappingDialog?.();
    });
    byId('menuSettingsMcLink')?.addEventListener('click', () => {
      if (typeof toggleSettingsMenu === 'function') toggleSettingsMenu(false);
      window.McVersionUi?.openMcLinkDialog?.();
    });
    byId('menuSettingsKeys')?.addEventListener('click', () => {
      if (typeof toggleSettingsMenu === 'function') toggleSettingsMenu(false);
      byId('menuKeys')?.click();
    });

    byId('studioClose')?.addEventListener('click', () => byId('sheetStudioDialog')?.close());
    byId('studioCancel')?.addEventListener('click', () => byId('sheetStudioDialog')?.close());
    byId('studioFullscreenBtn')?.addEventListener('click', () => {
      if (typeof setFullscreen === 'function') setFullscreen(!state.fullscreen);
    });

    byId('studioToggleSnap')?.addEventListener('click', () => {
      studio.smartSnap = !studio.smartSnap;
      const btn = byId('studioToggleSnap');
      if (btn) {
        btn.textContent = studio.smartSnap ? '智能对齐: 开' : '智能对齐: 关';
        btn.setAttribute('aria-pressed', String(studio.smartSnap));
      }
      if (!studio.smartSnap) clearSmartGuides();
    });

    byId('studioToggleGrid')?.addEventListener('click', () => {
      studio.showGrid = !studio.showGrid;
      const btn = byId('studioToggleGrid');
      if (btn) btn.setAttribute('aria-pressed', String(studio.showGrid));
      renderStaticGrid();
    });

    byId('studioZoomIn')?.addEventListener('click', () => {
      studio.zoom = Math.min(2.5, Math.round((studio.zoom + 0.25) * 100) / 100);
      applyStageZoom();
    });
    byId('studioZoomOut')?.addEventListener('click', () => {
      studio.zoom = Math.max(0.6, Math.round((studio.zoom - 0.25) * 100) / 100);
      applyStageZoom();
    });
    byId('studioZoomReset')?.addEventListener('click', () => {
      studio.zoom = 1;
      applyStageZoom();
    });

    byId('studioStage')?.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = studio.zoom * (e.deltaY < 0 ? 1.12 : 0.89);
      studio.zoom = Math.max(0.6, Math.min(2.5, Math.round(next * 100) / 100));
      applyStageZoom();
    }, { passive: false });

    // Resizable divider between preview canvas and right inspector
    byId('studioSplitter')?.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const curW = byId('studioShell')?.querySelector('.studio-inspector')?.getBoundingClientRect().width || studio.inspectorWidth;
      studio.splitDrag = { startX: e.clientX, startW: curW };
      byId('studioSplitter')?.classList.add('is-dragging');
      try { byId('studioSplitter').setPointerCapture(e.pointerId); } catch {}
    });
    window.addEventListener('pointermove', e => {
      if (!studio.splitDrag) return;
      const dx = studio.splitDrag.startX - e.clientX;
      applyInspectorWidth(studio.splitDrag.startW + dx, true);
    });
    const endSplit = e => {
      if (!studio.splitDrag) return;
      studio.splitDrag = null;
      byId('studioSplitter')?.classList.remove('is-dragging');
      try {
        if (e?.pointerId !== undefined && byId('studioSplitter')?.hasPointerCapture(e.pointerId)) {
          byId('studioSplitter').releasePointerCapture(e.pointerId);
        }
      } catch {}
    };
    window.addEventListener('pointerup', endSplit);
    window.addEventListener('pointercancel', endSplit);

    // ResizeObserver keeps preview fit, hitboxes & grid pixel-aligned when maximizing/fullscreening/resizing
    if (typeof ResizeObserver !== 'undefined' && byId('studioStage')) {
      studio.resizeObserver = new ResizeObserver(() => {
        if (byId('sheetStudioDialog')?.open && !studio.dragState && studio.lastResult) {
          applyStageZoom();
        }
      });
      studio.resizeObserver.observe(byId('studioStage'));
    }

    // Keyboard shortcuts while Studio workspace is open (F11 fullscreen, Esc close, Arrow 1px/5px nudge)
    window.addEventListener('keydown', e => {
      const dlg = byId('sheetStudioDialog');
      if (!dlg?.open) return;
      // Do not intercept if a modal dialog is open on top of Studio
      const otherModalOpen = [...document.querySelectorAll('dialog[open]')].some(d => d !== dlg);
      if (otherModalOpen) return;

      if (e.code === 'F11') {
        e.preventDefault();
        if (!e.repeat && typeof setFullscreen === 'function') setFullscreen(!state.fullscreen);
        return;
      }
      const tag = e.target?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape' && !inInput) {
        e.preventDefault();
        if (state.fullscreen && typeof setFullscreen === 'function') setFullscreen(false);
        else dlg.close();
        return;
      }
      if (!inInput && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const el = selectedElement();
        const res = studio.lastResult;
        if (!el || !res?.bands) return;
        const box = (res.boxes || []).find(b => b.id === el.id);
        if (!box) return;
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        let ax = box.anchorX ?? (el.x * res.width);
        let ay = box.anchorY ?? (res.height * 0.5);
        if (e.key === 'ArrowLeft') ax -= step;
        if (e.key === 'ArrowRight') ax += step;
        if (e.key === 'ArrowUp') ay -= step;
        if (e.key === 'ArrowDown') ay += step;
        applySheetPointToElement(el, ax, ay, res.bands);
        syncInspector();
        schedulePreviewRender(30);
      }
    });

    byId('studioTabElements')?.addEventListener('click', () => switchTab('elements'));
    byId('studioTabAngles')?.addEventListener('click', () => switchTab('angles'));
    byId('studioTabBackground')?.addEventListener('click', () => switchTab('background'));

    byId('studioOverlay')?.addEventListener('pointerdown', e => {
      if (e.target === byId('studioOverlay')) {
        studio.selectedId = null;
        renderFieldCatalog();
        syncInspector();
        renderOverlay();
      }
    });
    window.addEventListener('pointermove', moveDragElement);
    window.addEventListener('pointerup', endDragElement);
    window.addEventListener('pointercancel', endDragElement);
    window.addEventListener('resize', () => {
      if (byId('sheetStudioDialog')?.open) {
        applyInspectorWidth(window.innerWidth <= 1080 ? Math.min(studio.inspectorWidth, 380) : studio.inspectorWidth, false);
      }
    });

    // Toolbar buttons
    byId('studioAddText')?.addEventListener('click', () => {
      if (!studio.draftStyle) return;
      const el = {
        id: 'el_txt_' + Date.now().toString(36),
        kind: 'text',
        role: 'customText',
        title: '自定义文字',
        visible: true,
        text: '自定义水印 / 说明文字',
        fontSize: 16,
        bold: true,
        color: '#ffffff',
        labelColor: '#9aa0ad',
        bgColor: '',
        borderColor: '',
        accentColor: '#3c8527',
        styleVariant: 'row',
        band: 'footer',
        x: 0.04,
        y: 0.86,
        anchor: 'left',
        maxWidth: 0.5,
        z: 50 + studio.draftStyle.elements.length,
      };
      studio.draftStyle.elements.push(el);
      studio.selectedId = el.id;
      switchTab('elements');
      renderFieldCatalog();
      syncInspector();
      schedulePreviewRender(10);
      setStatus('已添加自定义文字，可在画布中直接拖动或编辑内容。');
    });

    byId('studioAddImage')?.addEventListener('click', async () => {
      if (!studio.draftStyle) return;
      try {
        const res = await window.appUi.chooseSheetAsset();
        if (!res || res.canceled) return;
        studio.draftAssets[res.id] = res.dataUrl;
        const el = {
          id: 'el_img_' + Date.now().toString(36),
          kind: 'image',
          role: 'customImage',
          title: res.name,
          visible: true,
          source: 'asset',
          assetId: res.id,
          band: 'canvas',
          x: 0.96,
          y: 0.88,
          anchor: 'right',
          size: Math.min(160, Math.max(48, Math.round(res.width * 0.4))),
          opacity: 0.95,
          pixelated: false,
          z: 60 + studio.draftStyle.elements.length,
        };
        studio.draftStyle.elements.push(el);
        studio.selectedId = el.id;
        switchTab('elements');
        renderFieldCatalog();
        syncInspector();
        schedulePreviewRender(10);
        setStatus(`已插入图片「${res.name}」，可在画布上拖动位置或调整大小。`);
      } catch (err) {
        setStatus('插入图片失败：' + err.message, true);
      }
    });

    byId('studioArrangeFooter')?.addEventListener('click', () => {
      if (!studio.draftStyle) return;
      window.SheetStyle.arrangeFooterElements(studio.draftStyle);
      syncInspector();
      schedulePreviewRender(10);
      setStatus('已自动将底部启用信息按网格整齐排布。');
    });

    byId('studioCenterEl')?.addEventListener('click', () => {
      const el = selectedElement();
      if (!el) return;
      el.x = 0.5;
      el.anchor = 'center';
      syncInspector();
      schedulePreviewRender(10);
    });

    byId('studioResetStyle')?.addEventListener('click', () => {
      studio.draftStyle = window.SheetStyle.cloneSheetStyle(window.SheetStyle.DEFAULT_SHEET_STYLE);
      studio.selectedId = studio.draftStyle.elements[0]?.id || null;
      syncAngleControls();
      syncBackgroundControls();
      renderFieldCatalog();
      syncInspector();
      schedulePreviewRender(10);
      setStatus('已恢复默认 Ore UI 展示图排版样式。');
    });

    // Selected element controls
    const onElProp = (fn, renderDelay = 30) => {
      const el = selectedElement();
      if (!el) return;
      fn(el);
      renderFieldCatalog();
      schedulePreviewRender(renderDelay);
    };

    byId('studioLayerUp')?.addEventListener('click', () => onElProp(el => { el.z = Math.min(999, (el.z || 20) + 5); }, 10));
    byId('studioLayerDown')?.addEventListener('click', () => onElProp(el => { el.z = Math.max(1, (el.z || 20) - 5); }, 10));
    byId('studioToggleEl')?.addEventListener('click', () => {
      onElProp(el => { el.visible = !el.visible; }, 10);
      syncInspector();
    });
    byId('studioDeleteEl')?.addEventListener('click', () => {
      const el = selectedElement();
      if (!el || !studio.draftStyle) return;
      studio.draftStyle.elements = studio.draftStyle.elements.filter(item => item.id !== el.id);
      studio.selectedId = null;
      renderFieldCatalog();
      syncInspector();
      schedulePreviewRender(10);
    });

    byId('studioElLabel')?.addEventListener('input', e => onElProp(el => { if (el.kind === 'field') el.label = e.target.value; }));
    byId('studioElShowLabel')?.addEventListener('change', e => onElProp(el => { if (el.kind === 'field') el.showLabel = e.target.checked; }, 10));
    byId('studioElText')?.addEventListener('input', e => onElProp(el => {
      if (el.kind === 'field') el.overrideText = e.target.value;
      else el.text = e.target.value;
    }));
    byId('studioElPrefix')?.addEventListener('input', e => onElProp(el => { el.prefix = e.target.value; }));
    byId('studioElSuffix')?.addEventListener('input', e => onElProp(el => { el.suffix = e.target.value; }));
    byId('studioElVariant')?.addEventListener('change', e => onElProp(el => { el.styleVariant = e.target.value; }, 10));
    byId('studioElAnchor')?.addEventListener('change', e => onElProp(el => { el.anchor = e.target.value; }, 10));
    byId('studioElFontSize')?.addEventListener('input', e => {
      byId('studioElFontVal').textContent = e.target.value;
      onElProp(el => { el.fontSize = Number(e.target.value) || 15; }, 40);
    });
    byId('studioElBold')?.addEventListener('change', e => onElProp(el => { el.bold = e.target.checked; }, 10));
    byId('studioElMaxW')?.addEventListener('input', e => {
      byId('studioElMaxWVal').textContent = e.target.value + '%';
      onElProp(el => { el.maxWidth = (Number(e.target.value) || 44) / 100; }, 40);
    });
    byId('studioElColor')?.addEventListener('input', e => onElProp(el => { el.color = e.target.value; }, 40));
    byId('studioElLabelColor')?.addEventListener('input', e => onElProp(el => { el.labelColor = e.target.value; }, 40));
    byId('studioElAccentColor')?.addEventListener('input', e => onElProp(el => { el.accentColor = e.target.value; }, 40));
    byId('studioClearAccent')?.addEventListener('click', () => onElProp(el => { el.accentColor = ''; }, 10));
    byId('studioElBgColor')?.addEventListener('input', e => onElProp(el => { el.bgColor = e.target.value; }, 40));
    byId('studioClearBg')?.addEventListener('click', () => onElProp(el => { el.bgColor = ''; }, 10));
    byId('studioElBorderColor')?.addEventListener('input', e => onElProp(el => { el.borderColor = e.target.value; }, 40));
    byId('studioClearBorder')?.addEventListener('click', () => onElProp(el => { el.borderColor = ''; }, 10));

    byId('studioElImgSource')?.addEventListener('change', async e => {
      const el = selectedElement();
      if (!el) return;
      if (e.target.value === 'asset' && !el.assetId) {
        try {
          const res = await window.appUi.chooseSheetAsset();
          if (res && !res.canceled) {
            studio.draftAssets[res.id] = res.dataUrl;
            el.assetId = res.id;
          } else {
            e.target.value = el.source;
            return;
          }
        } catch (err) {
          setStatus('选择图标失败：' + err.message, true);
          e.target.value = el.source;
          return;
        }
      }
      el.source = e.target.value;
      schedulePreviewRender(10);
    });

    byId('studioElReplaceImg')?.addEventListener('click', async () => {
      const el = selectedElement();
      if (!el) return;
      try {
        const res = await window.appUi.chooseSheetAsset();
        if (!res || res.canceled) return;
        studio.draftAssets[res.id] = res.dataUrl;
        el.source = 'asset';
        el.assetId = res.id;
        syncInspector();
        schedulePreviewRender(10);
      } catch (err) {
        setStatus('替换图片失败：' + err.message, true);
      }
    });

    byId('studioElPixelated')?.addEventListener('change', e => onElProp(el => { el.pixelated = e.target.checked; }, 10));
    byId('studioElImgSize')?.addEventListener('input', e => {
      byId('studioElImgSizeVal').textContent = e.target.value;
      onElProp(el => { el.size = Number(e.target.value) || 30; }, 40);
    });
    byId('studioElOpacity')?.addEventListener('input', e => {
      byId('studioElOpacityVal').textContent = e.target.value + '%';
      onElProp(el => { el.opacity = (Number(e.target.value) || 100) / 100; }, 40);
    });

    byId('studioElBand')?.addEventListener('change', e => onElProp(el => { el.band = e.target.value; }, 10));
    byId('studioElX')?.addEventListener('change', e => onElProp(el => { el.x = Math.max(0, Math.min(1, Number(e.target.value) / 100)); }, 10));
    byId('studioElY')?.addEventListener('change', e => onElProp(el => { el.y = Math.max(0.02, Math.min(0.98, Number(e.target.value) / 100)); }, 10));

    // Angles & Output tab
    byId('studioPanelLayout')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.panelLayout = e.target.value;
      syncAngleControls();
      renderFieldCatalog();
      schedulePreviewRender(10);
    });
    byId('studioShowAngleBadges')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.showAngleBadges = e.target.checked;
      schedulePreviewRender(10);
    });

    for (const [key, prefix] of [['view1', 'studioView1'], ['view2', 'studioView2']]) {
      byId(prefix + 'Preset')?.addEventListener('change', e => {
        if (!studio.draftStyle) return;
        const v = studio.draftStyle[key];
        const val = e.target.value;
        if (val === 'custom') {
          v.mode = 'custom';
        } else {
          v.mode = 'preset';
          v.preset = val;
          const resolved = window.SheetExporter.resolveViewSpec(
            v,
            Number(els.rotation?.value) || 45,
            Number(els.slant?.value) || 30
          );
          v.yaw = resolved.yaw;
          v.slant = resolved.slant;
        }
        syncAngleControls();
        renderFieldCatalog();
        schedulePreviewRender(20);
      });

      const onCustomAngle = () => {
        if (!studio.draftStyle) return;
        const v = studio.draftStyle[key];
        v.mode = 'custom';
        v.yaw = Number(byId(prefix + 'Yaw').value) || 0;
        v.slant = Number(byId(prefix + 'Slant').value) || 0;
        byId(prefix + 'YawVal').textContent = `${v.yaw}°`;
        byId(prefix + 'SlantVal').textContent = `${v.slant}°`;
        byId(prefix + 'Preset').value = 'custom';
        renderFieldCatalog();
        schedulePreviewRender(90);
      };
      byId(prefix + 'Yaw')?.addEventListener('input', onCustomAngle);
      byId(prefix + 'Slant')?.addEventListener('input', onCustomAngle);
      byId(prefix + 'Tag')?.addEventListener('input', e => {
        if (!studio.draftStyle) return;
        studio.draftStyle[key].tag = e.target.value;
        schedulePreviewRender(50);
      });
    }

    byId('studioDirBrowse')?.addEventListener('click', async () => {
      const res = await window.shellApi.chooseSheetDir?.();
      if (res && typeof res.dir === 'string') {
        if (typeof applySheetOutputDir === 'function') applySheetOutputDir(res.dir);
        byId('studioOutputDir').value = res.dir;
      }
    });
    byId('studioDirReset')?.addEventListener('click', async () => {
      await window.appUi.setSheetSettings?.({ sheetOutputDir: '' });
      if (typeof applySheetOutputDir === 'function') applySheetOutputDir('');
      byId('studioOutputDir').value = '与投影同目录';
    });

    // Background & Look tab
    byId('studioBgMode')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.bgMode = e.target.value;
      syncBackgroundControls();
      schedulePreviewRender(10);
    });
    byId('studioBgColor')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.bgColor = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioBgColor2')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.bgColor2 = e.target.value;
      schedulePreviewRender(40);
    });
    for (const sw of document.querySelectorAll('#studioBgSwatches button[data-bg]')) {
      sw.style.background = sw.dataset.bg;
      sw.addEventListener('click', () => {
        if (!studio.draftStyle) return;
        studio.draftStyle.bgColor = sw.dataset.bg;
        if (studio.draftStyle.bgMode === 'transparent') studio.draftStyle.bgMode = 'solid';
        syncBackgroundControls();
        schedulePreviewRender(10);
      });
    }
    byId('studioChooseBgImg')?.addEventListener('click', async () => {
      if (!studio.draftStyle) return;
      try {
        const res = await window.appUi.chooseSheetAsset();
        if (!res || res.canceled) return;
        studio.draftAssets[res.id] = res.dataUrl;
        studio.draftStyle.bgAssetId = res.id;
        studio.draftStyle.bgMode = 'image';
        syncBackgroundControls();
        schedulePreviewRender(10);
      } catch (err) {
        setStatus('选择背景图失败：' + err.message, true);
      }
    });
    byId('studioClearBgImg')?.addEventListener('click', () => {
      if (!studio.draftStyle) return;
      studio.draftStyle.bgAssetId = '';
      studio.draftStyle.bgMode = 'solid';
      syncBackgroundControls();
      schedulePreviewRender(10);
    });

    byId('studioShowHeaderBar')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.showHeaderBar = e.target.checked;
      schedulePreviewRender(10);
    });
    byId('studioHeaderBg')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.headerBg = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioHeaderAccent')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.headerAccent = e.target.value;
      schedulePreviewRender(40);
    });

    byId('studioShowFooterBox')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.showFooterBox = e.target.checked;
      schedulePreviewRender(10);
    });
    byId('studioFooterBg')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.footerBoxBg = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioFooterBorder')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.footerBoxBorder = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioFooterCols')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.footerColumns = Number(e.target.value) || 2;
      window.SheetStyle.arrangeFooterElements(studio.draftStyle);
      syncInspector();
      schedulePreviewRender(10);
    });

    byId('studioPanelBgMode')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.panelBgMode = e.target.value;
      schedulePreviewRender(10);
    });
    byId('studioPanelBgColor')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.panelBgColor = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioPanelBorderColor')?.addEventListener('input', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.panelBorderColor = e.target.value;
      schedulePreviewRender(40);
    });
    byId('studioShowPanelBorder')?.addEventListener('change', e => {
      if (!studio.draftStyle) return;
      studio.draftStyle.showPanelBorder = e.target.checked;
      schedulePreviewRender(10);
    });

    // Save / Export buttons
    byId('studioSaveApply')?.addEventListener('click', async () => {
      try {
        await saveDraftToApp();
        byId('sheetStudioDialog')?.close();
        if (state.sheetMode && state.file && !state.rendering && !state.scenePreparing && typeof exportShowcaseSheet === 'function') {
          await exportShowcaseSheet({ auto: true });
        }
      } catch (err) {
        setStatus('保存配置失败：' + err.message, true);
      }
    });

    byId('studioExportNow')?.addEventListener('click', async () => {
      try {
        await saveDraftToApp();
        byId('sheetStudioDialog')?.close();
        if (typeof exportShowcaseSheet === 'function') {
          await exportShowcaseSheet({ auto: false });
        }
      } catch (err) {
        setStatus('导出失败：' + err.message, true);
      }
    });
  }

  wireControls();

  window.SheetStudioUi = {
    openStudio,
    initFromSettings(settings) {
      if (settings?.sheetStyle && window.SheetStyle) {
        state.sheetStyle = window.SheetStyle.normalizeSheetStyle(settings.sheetStyle);
      }
      if (settings?.sheetAssets) {
        state.sheetAssets = { ...settings.sheetAssets };
      }
    },
    getState() {
      return studio;
    },
  };
})();
