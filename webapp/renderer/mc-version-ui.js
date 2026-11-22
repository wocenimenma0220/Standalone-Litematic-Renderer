'use strict';

/** MC 本地版本目录联动、跨版本方块差异弹窗与顶部帮助面板。 */
(function initMcVersionUi() {
  const byId = id => document.getElementById(id);

  const STANDARD_RULES = [
    {
      ruleKey: 'chain',
      title: '铁链 (chain ↔ iron_chain)',
      fromId: 'minecraft:chain',
      toId: 'minecraft:iron_chain',
      changedIn: '1.21.9',
      description: '1.21.9 起将旧版铁链 minecraft:chain 更名为 minecraft:iron_chain（与铜链 copper_chain 区分）。',
    },
    {
      ruleKey: 'grass',
      title: '矮草 (grass ↔ short_grass)',
      fromId: 'minecraft:grass',
      toId: 'minecraft:short_grass',
      changedIn: '1.20.3',
      description: '1.20.3 起将旧版矮草 minecraft:grass（1.12 为 tallgrass）更名为 minecraft:short_grass。',
    },
    {
      ruleKey: 'grass_path',
      title: '草径 / 土径 (grass_path ↔ dirt_path)',
      fromId: 'minecraft:grass_path',
      toId: 'minecraft:dirt_path',
      changedIn: '1.17',
      description: '1.17 起将草径 minecraft:grass_path 更名为土径 minecraft:dirt_path。',
    },
    {
      ruleKey: 'sign',
      title: '旧版通用告示牌 (sign ↔ oak_sign)',
      fromId: 'minecraft:sign',
      toId: 'minecraft:oak_sign',
      changedIn: '1.14',
      description: '1.14 起将通用告示牌 sign / wall_sign 拆分为橡木告示牌 oak_sign / oak_wall_sign。',
    },
    {
      ruleKey: 'water_cauldron',
      title: '含水炼药锅 (cauldron[level] ↔ water_cauldron)',
      fromId: 'minecraft:cauldron',
      toId: 'minecraft:water_cauldron',
      changedIn: '1.17',
      description: '1.17 起将含水的炼药锅从 minecraft:cauldron 拆分为 minecraft:water_cauldron。',
    },
    {
      ruleKey: 'wall_connections',
      title: '墙体连接属性 (true/false ↔ low/none)',
      fromId: '*_wall[true/false]',
      toId: '*_wall[low/none]',
      changedIn: '1.16',
      description: '1.16 起将墙体连接属性值由布尔 true / false 升级为 low / tall / none。',
    },
    {
      ruleKey: 'pre113',
      title: '1.13 扁平化前旧版方块',
      fromId: '旧版 ID',
      toId: '1.13+ 标准 ID',
      changedIn: '1.13',
      description: '1.13 扁平化前的方块命名与元数据（如 lit_furnace、powered_repeater、fence、wool 等）。',
    },
  ];

  const uiState = {
    mcInfo: null,
    useLinkedMcJarAssets: false,
    versionMappingDefault: 'remap',
    versionMappingRules: {},
    versionMappingRemember: false,
    activeTab: 'packs',
    draftActions: {},
    activeCompat: null,
  };

  function openModalClean(dlg) {
    if (!dlg) return;
    if (typeof toggleFileMenu === 'function') toggleFileMenu(false);
    if (typeof pauseFlyLook === 'function') pauseFlyLook();
    if (typeof closeInspector === 'function') closeInspector();
    if (!dlg.open) dlg.showModal();
    dlg.focus({ preventScroll: true });
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function updateSidebarLinkBadge() {
    const badge = byId('mcLinkSidebarBadge');
    const detail = byId('mcLinkSidebarDetail');
    const topBtn = byId('menuMcLink');
    const mc = uiState.mcInfo;
    if (mc) {
      const ver = mc.gameVersion && mc.gameVersion !== '未识别' ? mc.gameVersion : mc.folderName;
      const loaderShort = mc.loader && !mc.loader.includes('未识别') ? mc.loader : '';
      if (badge) {
        badge.textContent = loaderShort ? `${ver} · ${loaderShort}` : ver;
        badge.classList.add('is-linked');
      }
      if (detail) {
        const enabledCount = mc.resourcepacks.filter(p => p.enabledInMc && !p.unsupported).length;
        const schText = mc.hasSchematicsDir ? ` · 投影 ${mc.schematics.length} 个` : '';
        detail.textContent = `资源包 ${mc.resourcepacks.length} 个（MC 启用 ${enabledCount}）${schText}`;
      }
      topBtn?.classList.add('is-linked');
    } else {
      if (badge) {
        badge.textContent = 'MC 未联动';
        badge.classList.remove('is-linked');
      }
      if (detail) {
        detail.textContent = '可导入 MC 版本目录同步材质包与 schematics。';
      }
      topBtn?.classList.remove('is-linked');
    }
  }

  function updateFileVersionBanner(info) {
    const banner = byId('fileVersionBanner');
    const text = byId('fileVersionBannerText');
    if (!banner || !text) return;
    const compat = info?.versionCompatibility;
    if (!info || !compat) {
      banner.classList.add('hidden');
      return;
    }
    const verText = compat.schematicVersionLabel || '未知版本';
    const diffCount = (compat.items?.length || 0) + (compat.unsupportedInTarget?.length || 0);
    if (compat.hasDifferences) {
      text.textContent = `投影 ${verText} · ${diffCount} 项差异`;
      banner.classList.add('has-diff');
    } else {
      text.textContent = `投影 ${verText} · 与 ${compat.targetVersionLabel} 兼容`;
      banner.classList.remove('has-diff');
    }
    banner.classList.remove('hidden');
  }

  function switchMcTab(tab) {
    uiState.activeTab = tab === 'schematics' ? 'schematics' : 'packs';
    const isPacks = uiState.activeTab === 'packs';
    byId('mcTabPacks')?.classList.toggle('is-active', isPacks);
    byId('mcTabSchematics')?.classList.toggle('is-active', !isPacks);
    byId('mcTabPacks')?.setAttribute('aria-selected', String(isPacks));
    byId('mcTabSchematics')?.setAttribute('aria-selected', String(!isPacks));
    byId('mcPanelPacks')?.classList.toggle('hidden', !isPacks);
    byId('mcPanelSchematics')?.classList.toggle('hidden', isPacks);
  }

  function setMcStatus(msg, isErr = false) {
    const el = byId('mcLinkStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'muted small' + (isErr ? ' err' : '');
  }

  function renderMcLinkDialog() {
    const mc = uiState.mcInfo;
    const pathInput = byId('mcLinkPathInput');
    const refreshBtn = byId('mcLinkRefreshBtn');
    const unlinkBtn = byId('mcLinkUnlinkBtn');
    const summaryGrid = byId('mcLinkSummaryGrid');
    const tabs = byId('mcLinkTabs');
    const jarCheck = byId('mcUseJarAssets');

    if (!mc) {
      if (pathInput) pathInput.value = '尚未选择 Minecraft 版本文件夹';
      if (refreshBtn) refreshBtn.disabled = true;
      if (unlinkBtn) unlinkBtn.disabled = true;
      summaryGrid?.classList.add('hidden');
      tabs?.classList.add('hidden');
      byId('mcPanelPacks')?.classList.add('hidden');
      byId('mcPanelSchematics')?.classList.add('hidden');
      return;
    }

    if (pathInput) pathInput.value = mc.root;
    if (refreshBtn) refreshBtn.disabled = false;
    if (unlinkBtn) unlinkBtn.disabled = false;
    summaryGrid?.classList.remove('hidden');
    tabs?.classList.remove('hidden');

    byId('mcStatVersion').textContent = mc.dataVersion > 0 ? `${mc.gameVersion} (${mc.dataVersion})` : mc.gameVersion;
    byId('mcStatLoader').textContent = mc.loader || '原版';
    byId('mcStatLitematica').textContent = mc.litematicaMods?.length
      ? `已安装 (${mc.litematicaMods.length})`
      : (mc.hasSchematicsDir ? '检测到 schematics' : '未检测到');
    byId('mcStatCounts').textContent = `${mc.resourcepacks.length} 包 / ${mc.hasSchematicsDir ? mc.schematics.length + ' 投影' : '无 schematics'}`;

    if (jarCheck) {
      jarCheck.checked = !!uiState.useLinkedMcJarAssets;
      jarCheck.disabled = !mc.jarPath;
      jarCheck.parentElement.title = mc.jarPath
        ? `客户端 JAR：${mc.jarPath}`
        : '该版本目录未找到客户端 JAR 文件';
    }

    renderMcPackRows(mc);
    renderMcSchematicRows(mc);
    switchMcTab(uiState.activeTab);
  }

  function renderMcPackRows(mc) {
    const host = byId('mcPackRows');
    if (!host) return;
    host.replaceChildren();

    const syncBtn = byId('mcSyncEnabledPacksBtn');
    const enabledCount = mc.resourcepacks.filter(p => p.enabledInMc && !p.unsupported).length;
    if (syncBtn) {
      syncBtn.disabled = enabledCount === 0 || state.rendering || state.scenePreparing;
      syncBtn.textContent = enabledCount > 0
        ? `一键同步 MC 已启用材质包 (${enabledCount})`
        : '一键同步 MC 已启用材质包（options.txt 未启用有效包）';
    }

    if (!mc.resourcepacks.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small mc-empty-msg';
      empty.textContent = 'resourcepacks 文件夹内没有可识别的 .zip 或文件夹材质包。';
      host.append(empty);
      return;
    }

    const importedSet = new Set((state.packs || []).map(p => p.toLowerCase()));
    for (const pack of mc.resourcepacks) {
      const row = document.createElement('div');
      row.className = 'mc-list-row';
      const main = document.createElement('div');
      main.className = 'mc-row-main';
      const titleLine = document.createElement('div');
      titleLine.className = 'mc-row-title';

      const nameEl = document.createElement('strong');
      nameEl.textContent = pack.name;
      titleLine.append(nameEl);

      const kindTag = document.createElement('span');
      kindTag.className = 'mc-pill';
      kindTag.textContent = pack.kind === 'dir' ? '文件夹' : pack.kind === 'zip' ? 'ZIP' : '不支持';
      titleLine.append(kindTag);

      if (pack.enabledInMc) {
        const onTag = document.createElement('span');
        onTag.className = 'mc-pill is-green';
        onTag.textContent = 'MC 已启用';
        titleLine.append(onTag);
      }
      if (pack.packFormat > 0) {
        const fmtTag = document.createElement('span');
        fmtTag.className = 'mc-pill';
        fmtTag.textContent = `format ${pack.packFormat}`;
        titleLine.append(fmtTag);
      }

      const sub = document.createElement('p');
      sub.className = 'muted small';
      sub.textContent = pack.description || pack.path;
      main.append(titleLine, sub);

      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      if (pack.unsupported) {
        actionBtn.textContent = '需先解压';
        actionBtn.disabled = true;
      } else if (importedSet.has(pack.path.toLowerCase())) {
        actionBtn.textContent = '已导入';
        actionBtn.disabled = true;
      } else {
        actionBtn.textContent = '导入';
        actionBtn.addEventListener('click', async () => {
          actionBtn.disabled = true;
          try {
            state.packs = await window.packs.import(pack.path);
            await reloadPackResources();
            log(`已从 MC 联动目录导入材质包：${pack.name}`, 'ok');
            setMcStatus(`已导入材质包：${pack.name}`);
            renderMcPackRows(mc);
          } catch (err) {
            setMcStatus('导入材质包失败：' + err.message, true);
            actionBtn.disabled = false;
          }
        });
      }

      row.append(main, actionBtn);
      host.append(row);
    }
  }

  function renderMcSchematicRows(mc) {
    const host = byId('mcSchematicRows');
    if (!host) return;
    host.replaceChildren();

    if (!mc.hasSchematicsDir) {
      const empty = document.createElement('p');
      empty.className = 'muted small mc-empty-msg';
      empty.textContent = '未检测到 schematics 文件夹（若尚未在游戏内保存过投影，可创建或保存后再点右上角「刷新」）。';
      host.append(empty);
      return;
    }

    const q = (byId('mcSchematicSearch')?.value || '').trim().toLowerCase();
    const filtered = mc.schematics.filter(s => !q || s.relativePath.toLowerCase().includes(q));
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small mc-empty-msg';
      empty.textContent = q ? '没有匹配筛选条件的投影文件。' : 'schematics 文件夹内暂无 .litematic / .nbt / .schem 文件。';
      host.append(empty);
      return;
    }

    for (const item of filtered.slice(0, 300)) {
      const row = document.createElement('div');
      row.className = 'mc-list-row';
      const main = document.createElement('div');
      main.className = 'mc-row-main';
      const titleLine = document.createElement('div');
      titleLine.className = 'mc-row-title';
      const nameEl = document.createElement('strong');
      nameEl.textContent = item.name;
      titleLine.append(nameEl);

      const sub = document.createElement('p');
      sub.className = 'muted small';
      sub.textContent = `${item.relativePath} · ${formatBytes(item.size)}`;
      main.append(titleLine, sub);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'primary';
      openBtn.textContent = '打开渲染';
      openBtn.addEventListener('click', () => {
        byId('mcLinkDialog')?.close();
        loadFile(item.path);
      });

      row.append(main, openBtn);
      host.append(row);
    }
    if (filtered.length > 300) {
      const note = document.createElement('p');
      note.className = 'muted small mc-empty-msg';
      note.textContent = `已显示前 300 项（共 ${filtered.length} 项），可使用上方搜索框缩小范围。`;
      host.append(note);
    }
  }

  async function refreshMcInspection(options = {}) {
    try {
      const res = await window.mcLink.inspect(options);
      uiState.useLinkedMcJarAssets = !!res.useLinkedMcJarAssets;
      if (res.linked && res.info) {
        uiState.mcInfo = res.info;
        setMcStatus(`已识别：${res.info.gameVersion} · ${res.info.loader}`);
      } else {
        uiState.mcInfo = null;
        if (res.error) setMcStatus(`已保存路径检测失败：${res.error}`, true);
        else setMcStatus('');
      }
      updateSidebarLinkBadge();
      if (byId('mcLinkDialog')?.open) renderMcLinkDialog();
      return res;
    } catch (err) {
      setMcStatus('检测 MC 目录失败：' + err.message, true);
      return null;
    }
  }

  async function chooseMcFolder() {
    const btn = byId('mcLinkChooseBtn');
    if (btn) btn.disabled = true;
    setMcStatus('正在扫描 Minecraft 目录…');
    try {
      const res = await window.mcLink.chooseDir();
      if (res.canceled) {
        setMcStatus('');
        return;
      }
      uiState.mcInfo = res.info;
      updateSidebarLinkBadge();
      renderMcLinkDialog();
      const verText = res.info.gameVersion;
      const schText = res.info.hasSchematicsDir ? `，检测到 ${res.info.schematics.length} 个投影` : '';
      const msg = `已关联 MC 版本目录：${res.info.folderName}（版本 ${verText}，${res.info.resourcepacks.length} 个材质包${schText}）`;
      log(msg, 'ok');
      setMcStatus(msg);
      if (res.updatedSchematic) {
        state.info = res.updatedSchematic;
        showFileInfo(res.updatedSchematic);
        updateFileVersionBanner(res.updatedSchematic);
        if (res.updatedSchematic.versionCompatibility?.hasDifferences) {
          openVersionMappingDialog(res.updatedSchematic.versionCompatibility);
        }
      }
    } catch (err) {
      setMcStatus(err.message, true);
      log('关联 MC 目录失败：' + err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openVersionMappingDialog(compatOverride = null) {
    const dlg = byId('versionMappingDialog');
    if (!dlg) return;
    const compat = compatOverride || state.info?.versionCompatibility || null;
    uiState.activeCompat = compat;

    const overview = byId('versionMapOverview');
    const rowsHost = byId('versionMapRows');
    const unsupportedHost = byId('versionMapUnsupported');
    const rememberBox = byId('versionMapRemember');

    if (rememberBox) rememberBox.checked = !!uiState.versionMappingRemember;

    if (overview) {
      const schemVer = compat ? (compat.schematicVersionLabel || '未知版本') : '未打开投影（编辑全局默认策略）';
      const targetVer = compat
        ? compat.targetVersionLabel
        : (uiState.mcInfo ? `${uiState.mcInfo.gameVersion} (已联动)` : '26.3 (内置默认)');
      overview.innerHTML =
        `<span>投影版本：<strong>${escapeHtml(schemVer)}</strong></span>`
        + `<span>目标版本：<strong>${escapeHtml(targetVer)}</strong></span>`
        + `<span>渲染底座：<strong>26.3</strong></span>`;
    }

    const items = (compat?.items && compat.items.length)
      ? compat.items
      : STANDARD_RULES.map(r => ({
          ...r,
          direction: 'upgrade',
          count: 0,
          currentChoice: uiState.versionMappingRules[r.ruleKey] || uiState.versionMappingDefault || 'remap',
          hasLegacyPackAsset: false,
        }));

    uiState.draftActions = { ...uiState.versionMappingRules };
    for (const item of items) {
      uiState.draftActions[item.ruleKey] = item.currentChoice || uiState.versionMappingDefault || 'remap';
    }

    const renderRows = () => {
      if (!rowsHost) return;
      rowsHost.replaceChildren();
      for (const item of items) {
        const choice = uiState.draftActions[item.ruleKey] || 'remap';
        const row = document.createElement('div');
        row.className = 'version-map-row';

        const header = document.createElement('div');
        header.className = 'version-map-row-head';
        const title = document.createElement('strong');
        title.textContent = item.title;
        header.append(title);

        if (item.count > 0) {
          const countPill = document.createElement('span');
          countPill.className = 'mc-pill is-green';
          countPill.textContent = `${item.count.toLocaleString()} 格`;
          header.append(countPill);
        }
        if (item.hasLegacyPackAsset) {
          const packPill = document.createElement('span');
          packPill.className = 'mc-pill';
          packPill.textContent = '已导入旧版资源包';
          header.append(packPill);
        }

        const desc = document.createElement('p');
        desc.className = 'muted small';
        desc.textContent = item.description || '';

        const controls = document.createElement('div');
        controls.className = 'version-map-choices';
        const remapLabel = item.direction === 'downgrade'
          ? `更改映射（→ ${item.toId} 适配联动版）`
          : `更改映射（→ ${item.toId}）`;
        const legacyLabel = item.direction === 'downgrade'
          ? `按投影原样保留（${item.fromId}）`
          : `按旧版保留（${item.fromId}）`;

        for (const [val, label] of [['remap', remapLabel], ['legacy', legacyLabel]]) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'version-choice-btn';
          btn.dataset.rule = item.ruleKey;
          btn.dataset.choice = val;
          btn.setAttribute('aria-pressed', String(choice === val));
          btn.textContent = label;
          btn.addEventListener('click', () => {
            uiState.draftActions[item.ruleKey] = val;
            renderRows();
          });
          controls.append(btn);
        }

        row.append(header, desc, controls);
        rowsHost.append(row);
      }
    };
    renderRows();

    byId('versionMapAllRemap').onclick = () => {
      for (const item of items) uiState.draftActions[item.ruleKey] = 'remap';
      renderRows();
    };
    byId('versionMapAllLegacy').onclick = () => {
      for (const item of items) uiState.draftActions[item.ruleKey] = 'legacy';
      renderRows();
    };

    if (unsupportedHost) {
      const list = compat?.unsupportedInTarget || [];
      if (list.length) {
        const preview = list.slice(0, 8).map(b => `${b.name} (${b.id} ×${b.count})`).join('、');
        const extra = list.length > 8 ? ` 等共 ${list.length} 种` : '';
        unsupportedHost.textContent = `高版本提示：当前关联 MC 版本不包含以下投影方块，渲染引擎将自动使用内置 26.3 资源展示：${preview}${extra}`;
        unsupportedHost.classList.remove('hidden');
      } else {
        unsupportedHost.textContent = '';
        unsupportedHost.classList.add('hidden');
      }
    }

    openModalClean(dlg);
  }

  async function applyVersionMappingFromDialog() {
    const dlg = byId('versionMappingDialog');
    const remember = !!byId('versionMapRemember')?.checked;
    const values = Object.values(uiState.draftActions);
    const allLegacy = values.length > 0 && values.every(v => v === 'legacy');
    const defaultAction = allLegacy ? 'legacy' : 'remap';
    const ruleActions = { ...uiState.draftActions };

    uiState.versionMappingDefault = defaultAction;
    uiState.versionMappingRules = ruleActions;
    uiState.versionMappingRemember = remember;

    try {
      const res = await window.engine.setVersionMapping({
        defaultAction,
        ruleActions,
        remember,
        persist: true,
      });
      dlg?.close();
      if (res?.info && res.info.path) {
        state.info = res.info;
        showFileInfo(res.info);
        updateFileVersionBanner(res.info);
      }
      window.SheetExporter?.invalidateCache();
      invalidateCpuPreview();
      const modeDesc = allLegacy ? '按旧版保留原 ID' : '按目标版本映射';
      log(`已应用跨版本方块策略（${modeDesc}${remember ? '，已记住设置' : ''}）。`, 'ok');

      if (state.file && !state.stopped && !state.engineNeedsOpen) {
        const waitSettled = async () => {
          const deadline = Date.now() + 15000;
          while ((state.rendering || state.scenePreparing) && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 40));
          }
        };
        await waitSettled();
        if (state.sheetMode) {
          await exportShowcaseSheet({ auto: true });
        } else {
          await buildView({ force: true, preserveCamera: true });
        }
      }
    } catch (err) {
      log('应用跨版本映射失败：' + err.message, 'err');
    }
  }

  function wireEvents() {
    byId('menuMcLink')?.addEventListener('click', async () => {
      openModalClean(byId('mcLinkDialog'));
      await refreshMcInspection();
      renderMcLinkDialog();
    });
    byId('menuLinkMcDir')?.addEventListener('click', async () => {
      if (typeof toggleFileMenu === 'function') toggleFileMenu(false);
      openModalClean(byId('mcLinkDialog'));
      await chooseMcFolder();
    });
    byId('btnSidebarMcLink')?.addEventListener('click', async () => {
      openModalClean(byId('mcLinkDialog'));
      await refreshMcInspection();
      renderMcLinkDialog();
    });
    byId('mcLinkClose')?.addEventListener('click', () => byId('mcLinkDialog')?.close());
    byId('mcLinkChooseBtn')?.addEventListener('click', chooseMcFolder);
    byId('mcLinkRefreshBtn')?.addEventListener('click', async () => {
      setMcStatus('正在刷新检测…');
      await refreshMcInspection({ force: true });
    });
    byId('mcLinkUnlinkBtn')?.addEventListener('click', async () => {
      const res = await window.mcLink.unlink();
      uiState.mcInfo = null;
      uiState.useLinkedMcJarAssets = false;
      updateSidebarLinkBadge();
      renderMcLinkDialog();
      setMcStatus('已取消 MC 目录联动。');
      log('已取消 MC 本地目录联动。');
      if (res?.reloadNeeded) await reloadPackResources();
    });

    byId('mcTabPacks')?.addEventListener('click', () => switchMcTab('packs'));
    byId('mcTabSchematics')?.addEventListener('click', () => switchMcTab('schematics'));
    byId('mcSchematicSearch')?.addEventListener('input', () => {
      if (uiState.mcInfo) renderMcSchematicRows(uiState.mcInfo);
    });

    byId('mcSyncEnabledPacksBtn')?.addEventListener('click', async () => {
      const mc = uiState.mcInfo;
      if (!mc) return;
      const paths = mc.resourcepacks.filter(p => p.enabledInMc && !p.unsupported).map(p => p.path);
      if (!paths.length) return;
      setBusy(true, '正在同步 MC 材质包…');
      try {
        state.packs = await window.mcLink.syncPacks({ paths, mode: 'replace-mc' });
        await reloadPackResources();
        renderMcPackRows(mc);
        setMcStatus(`已同步 ${paths.length} 个 MC 启用材质包（顺序与游戏内一致）。`);
        log(`已同步 MC 启用材质包（${paths.length} 个）。`, 'ok');
      } catch (err) {
        setMcStatus('同步材质包失败：' + err.message, true);
        log('同步材质包失败：' + err.message, 'err');
      } finally {
        setBusy(false);
      }
    });

    byId('mcUseJarAssets')?.addEventListener('change', async () => {
      const input = byId('mcUseJarAssets');
      const checked = !!input.checked;
      input.disabled = true;
      setBusy(true, '应用版本客户端资源…');
      try {
        await window.mcLink.setUseJarAssets(checked);
        uiState.useLinkedMcJarAssets = checked;
        await reloadPackResources();
        log(checked ? '已启用联动 MC 版本 JAR 原版贴图/模型。' : '已恢复使用软件内置 26.3 原版贴图/模型。', 'ok');
      } catch (err) {
        input.checked = !checked;
        uiState.useLinkedMcJarAssets = !checked;
        setMcStatus('切换客户端资源失败：' + err.message, true);
      } finally {
        input.disabled = !uiState.mcInfo?.jarPath;
        setBusy(false);
      }
    });

    byId('menuVersionMapping')?.addEventListener('click', () => {
      if (typeof toggleFileMenu === 'function') toggleFileMenu(false);
      openVersionMappingDialog();
    });
    byId('btnOpenVersionMapping')?.addEventListener('click', () => openVersionMappingDialog());
    byId('versionMapClose')?.addEventListener('click', () => byId('versionMappingDialog')?.close());
    byId('versionMapKeepCurrent')?.addEventListener('click', () => byId('versionMappingDialog')?.close());
    byId('versionMapApply')?.addEventListener('click', applyVersionMappingFromDialog);

    byId('menuHelp')?.addEventListener('click', () => openModalClean(byId('helpDialog')));
    byId('helpClose')?.addEventListener('click', () => byId('helpDialog')?.close());
  }

  wireEvents();

  let initialized = false;
  window.McVersionUi = {
    async initFromSettings(settings) {
      if (initialized) return;
      initialized = true;
      uiState.useLinkedMcJarAssets = !!settings?.useLinkedMcJarAssets;
      uiState.versionMappingDefault = settings?.versionMappingDefault === 'legacy' ? 'legacy' : 'remap';
      uiState.versionMappingRules = { ...(settings?.versionMappingRules || {}) };
      uiState.versionMappingRemember = settings?.versionMappingRemember === true;
      if (settings?.linkedMcDir) {
        await refreshMcInspection();
      } else {
        updateSidebarLinkBadge();
      }
    },
    handleSchematicOpened(info) {
      updateFileVersionBanner(info);
      const compat = info?.versionCompatibility;
      if (compat?.hasDifferences && !uiState.versionMappingRemember) {
        log(`检测到跨版本方块差异（投影 ${compat.schematicVersionLabel} → ${compat.targetVersionLabel}），可选择更改映射或保留旧版。`);
        openVersionMappingDialog(compat);
      }
    },
    openMcLinkDialog() {
      openModalClean(byId('mcLinkDialog'));
      return refreshMcInspection().then(() => renderMcLinkDialog());
    },
    openVersionMappingDialog,
  };
  if (window.__initialUiSettings) {
    window.McVersionUi.initFromSettings(window.__initialUiSettings);
  }
})();
