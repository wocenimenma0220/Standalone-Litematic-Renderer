'use strict';

(() => {
  const DIRECTION_AXES = new Map([
    ['e', [0, 1, '东 (+X)']], ['east', [0, 1, '东 (+X)']], ['东', [0, 1, '东 (+X)']],
    ['w', [0, -1, '西 (-X)']], ['west', [0, -1, '西 (-X)']], ['西', [0, -1, '西 (-X)']],
    ['u', [1, 1, '上 (+Y)']], ['up', [1, 1, '上 (+Y)']], ['上', [1, 1, '上 (+Y)']],
    ['d', [1, -1, '下 (-Y)']], ['down', [1, -1, '下 (-Y)']], ['下', [1, -1, '下 (-Y)']],
    ['s', [2, 1, '南 (+Z)']], ['south', [2, 1, '南 (+Z)']], ['南', [2, 1, '南 (+Z)']],
    ['n', [2, -1, '北 (-Z)']], ['north', [2, -1, '北 (-Z)']], ['北', [2, -1, '北 (-Z)']],
  ]);

  const COMMAND_SPECS = [
    { group: 'level1', cmd: '/help', syntax: '/help [指令]', desc: '显示一级全局指令与二级选区指令目录，或查看指定指令说明' },
    { group: 'level1', cmd: '/commands', syntax: '/commands', desc: '打开指令帮助面板' },
    { group: 'level1', cmd: '/pos', syntax: '/pos', desc: '显示当前坐标、相机视角、选区边界与投影摘要' },
    { group: 'level1', cmd: '/tp', syntax: '/tp <x> <y> <z> [yaw] [pitch]', desc: '进入漫游并传送相机至目标坐标（支持 ~ 相对偏移）' },
    { group: 'level1', cmd: '/view', syntax: '/view <预设名 | yaw pitch>', desc: '切换 WikiRenderer/KCL 预设视角或指定方位角/俯仰角' },
    { group: 'level1', cmd: '/zoom', syntax: '/zoom <倍率>', desc: '设置环绕视图缩放倍率（0.05 – 20）' },
    { group: 'level1', cmd: '/fly', syntax: '/fly [on|off]', desc: '开启、关闭或切换第一人称漫游' },
    { group: 'level1', cmd: '/vd', syntax: '/vd <视距>', desc: '设置大投影分块预览视距（1 – 128 区块）' },
    { group: 'level1', cmd: '/search', syntax: '/search <名称或ID>', desc: '按中文名称或方块 ID 搜索并在 3D 视图高亮匹配方块' },
    { group: 'level1', cmd: '/clearsearch', syntax: '/clearsearch', desc: '清除方块搜索高亮状态' },
    { group: 'level1', cmd: '/locate', syntax: '/locate [序号]', desc: '飞往定位当前搜索结果中的第 N 个匹配方块' },
    { group: 'level1', cmd: '/bg', syntax: '/bg <checker|sky|white|dark|color|image> [#颜色]', desc: '切换视图与导出的背景模式或自选背景颜色' },
    { group: 'level1', cmd: '/light', syntax: '/light <bright|smooth|off>', desc: '切换明亮光照、平滑光照或关闭光照后重建视图' },
    { group: 'level1', cmd: '/layer', syntax: '/layer <Y|off>', desc: '开启逐层渲染并跳至指定 Y 层，或切回区域框选模式' },
    { group: 'level1', cmd: '/tool', syntax: '/tool <selection|edit|none>', desc: '切换选择渲染工具、更改投影工具或退出工具模式' },
    { group: 'level1', cmd: '/export', syntax: '/export <png|gif|sheet> [分辨率] [gpu|cpu]', desc: '导出 PNG、360° GIF 或双视角展示图' },
    { group: 'level1', cmd: '/sheet', syntax: '/sheet [主视角] [副视角]', desc: '按自适应尺寸生成并复制双视角展示图 PNG' },
    { group: 'level1', cmd: '/sheetmode', syntax: '/sheetmode [on|off]', desc: '开启或关闭纯粹导出模式（拖入即出展示图）' },
    { group: 'level1', cmd: '/materials', syntax: '/materials [close]', desc: '打开或关闭当前投影的材料统计弹窗' },
    { group: 'level1', cmd: '/fullscreen', syntax: '/fullscreen [on|off]', desc: '切换窗口全屏状态' },
    { group: 'level1', cmd: '/sidebar', syntax: '/sidebar [on|off]', desc: '展开或收起左侧控制面板' },
    { group: 'level1', cmd: '/console', syntax: '/console [on|off]', desc: '显示或隐藏底部日志与指令面板' },
    { group: 'level1', cmd: '/reload', syntax: '/reload', desc: '强制重新构建当前三维或软件预览场景' },
    { group: 'level1', cmd: '/stop', syntax: '/stop', desc: '强制停止当前正在进行的预览或大投影加载' },
    { group: 'level1', cmd: '/update', syntax: '/update', desc: '检查 GitHub 版本更新（安装版自动补丁 / ZIP 版引导下载）' },

    { group: 'level2', cmd: '//select', syntax: '//select <1|2> [X Y Z]', desc: '设置渲染范围角点 1 或 2（需开启选择渲染工具）' },
    { group: 'level2', cmd: '//pos1', syntax: '//pos1 [X Y Z]', desc: '开启选区工具并设置角点 1（支持 ~ 与准星方块）' },
    { group: 'level2', cmd: '//pos2', syntax: '//pos2 [X Y Z]', desc: '开启选区工具并设置角点 2（支持 ~ 与准星方块）' },
    { group: 'level2', cmd: '//desel', syntax: '//desel', desc: '清除当前两个选区角点并还原选区状态' },
    { group: 'level2', cmd: '//expand', syntax: '//expand <数量> [n|s|w|e|u|d|方向]', desc: '沿指定方向或当前视线方向扩展选区' },
    { group: 'level2', cmd: '//contract', syntax: '//contract <数量> [n|s|w|e|u|d|方向]', desc: '沿指定方向或当前视线方向收缩选区' },
    { group: 'level2', cmd: '//shift', syntax: '//shift <数量> [n|s|w|e|u|d|方向]', desc: '整体移动当前选区' },
    { group: 'level2', cmd: '//outset', syntax: '//outset <数量> [-h|-v]', desc: '向各方向（或仅水平/仅垂直）同步扩展选区' },
    { group: 'level2', cmd: '//inset', syntax: '//inset <数量> [-h|-v]', desc: '向内部同步收缩选区' },
    { group: 'level2', cmd: '//size', syntax: '//size', desc: '统计当前选区的三维跨度、体积与方块占空比' },
    { group: 'level2', cmd: '//count', syntax: '//count [名称或ID]', desc: '统计当前选区内匹配方块或非空气方块数量' },
    { group: 'level2', cmd: '//distr', syntax: '//distr', desc: '分析当前选区内各方块的分布占比排行' },
    { group: 'level2', cmd: '//set', syntax: '//set <方块[属性]>', desc: '用指定方块（含中文名、ID、air 与状态属性）填充选区' },
    { group: 'level2', cmd: '//replace', syntax: '//replace [原方块] <目标方块[属性]>', desc: '替换选区内全部非空气方块或指定原方块' },
    { group: 'level2', cmd: '//undo', syntax: '//undo', desc: '撤销最近一次投影或选区批量修改' },
    { group: 'level2', cmd: '//redo', syntax: '//redo', desc: '重做已撤销的投影修改' },
  ];

  let blockLookup = null;
  function getBlockLookup() {
    if (blockLookup) return blockLookup;
    const byId = new Map();
    const byName = new Map();
    for (const b of window.BoardCatalog || []) {
      byId.set(b.id, b);
      byName.set(b.name.toLowerCase(), b);
    }
    byId.set('air', { id: 'air', name: '空气', defaults: {} });
    byId.set('cave_air', { id: 'cave_air', name: '洞穴空气', defaults: {} });
    byId.set('void_air', { id: 'void_air', name: '虚空空气', defaults: {} });
    byName.set('空气', { id: 'air', name: '空气', defaults: {} });
    blockLookup = { byId, byName };
    return blockLookup;
  }

  function parseBlockSpec(rawToken) {
    const raw = String(rawToken || '').trim();
    if (!raw) throw Error('请指定方块名称或 ID');
    const bracket = raw.indexOf('[');
    let head = bracket >= 0 ? raw.slice(0, bracket).trim() : raw;
    let statePart = '';
    if (bracket >= 0) {
      if (!raw.endsWith(']')) throw Error('方块属性语法缺少闭合括号 ]');
      statePart = raw.slice(bracket + 1, -1).trim();
    }

    const { byId, byName } = getBlockLookup();
    const lowerHead = head.toLowerCase();
    const stripped = lowerHead.startsWith('minecraft:') ? lowerHead.slice('minecraft:'.length) : lowerHead;
    let resolvedId = null;
    let def = null;

    if (byId.has(stripped)) {
      def = byId.get(stripped);
      resolvedId = 'minecraft:' + def.id;
    } else if (byName.has(lowerHead)) {
      def = byName.get(lowerHead);
      resolvedId = 'minecraft:' + def.id;
    } else if (/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/i.test(head)) {
      resolvedId = head.includes(':') ? lowerHead : 'minecraft:' + lowerHead;
    } else {
      throw Error('未识别的方块名称或 ID：' + head);
    }

    const states = def?.defaults ? { ...def.defaults } : {};
    if (statePart) {
      for (const item of statePart.split(',')) {
        const pair = item.trim();
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq <= 0 || eq === pair.length - 1) throw Error('无效的方块状态参数：' + pair);
        const key = pair.slice(0, eq).trim().toLowerCase();
        const val = pair.slice(eq + 1).trim().toLowerCase();
        if (!/^[a-z0-9_]+$/.test(key) || !/^[a-z0-9_-]{1,64}$/.test(val)) {
          throw Error('无效的方块状态键值对：' + pair);
        }
        states[key] = val;
      }
    }
    return { id: resolvedId, states, label: def ? `${def.name} (${resolvedId})` : resolvedId };
  }

  function parseCoord(token, originValue, integer = false) {
    const raw = String(token || '').trim();
    if (!raw) throw Error('缺少坐标参数');
    if (raw.startsWith('~')) {
      const offsetText = raw.slice(1);
      const offset = offsetText ? Number(offsetText) : 0;
      if (!Number.isFinite(offset)) throw Error('无效的相对坐标：' + raw);
      const base = integer ? Math.floor(originValue) : originValue;
      const value = base + offset;
      return integer ? Math.round(value) : value;
    }
    const num = Number(raw);
    if (!Number.isFinite(num)) throw Error('无效的坐标数值：' + raw);
    if (integer) {
      if (!Number.isInteger(num) || Math.abs(num) > 30000000) throw Error('角点坐标必须是 -30000000 到 30000000 间的整数');
      return num;
    }
    return num;
  }

  function requireSchematic() {
    if (!state.file || !state.info) throw Error('请先打开一个投影或结构文件');
  }

  function requireGpuReady() {
    requireSchematic();
    if (!state.viewReady || state.cpuPreview || !state.view) throw Error('此指令需要 GPU 三维预览就绪');
  }

  function resolveRegionCorners() {
    requireGpuReady();
    const sel = state.selection;
    if (sel.corners[0] && sel.corners[1]) {
      const a = sel.corners[0], b = sel.corners[1];
      return {
        min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
        max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
      };
    }
    if (sel.mode === 'layer' && state.view) {
      return {
        min: [Math.floor(state.view.min[0]), sel.layer, Math.floor(state.view.min[2])],
        max: [Math.ceil(state.view.max[0]) - 1, sel.layer, Math.ceil(state.view.max[2]) - 1],
      };
    }
    throw Error('请先用 //pos1 与 //pos2（或 //select）设置两个选区角点');
  }

  function cornersToBounds(corners) {
    return {
      min: corners.min.slice(),
      max: corners.max.map(v => v + 1),
    };
  }

  function applyCorners(min, max) {
    if (!state.selection.enabled) {
      state.selection.enabled = true;
    }
    state.selection.mode = 'region';
    state.selection.setCorner(0, min);
    state.selection.setCorner(1, max);
    selectionChanged();
  }

  function resolveDirection(dirToken) {
    if (dirToken && dirToken !== 'me') {
      const hit = DIRECTION_AXES.get(dirToken.toLowerCase());
      if (!hit) throw Error('未知方向：' + dirToken + '（可用 n/s/w/e/u/d 或 北/南/西/东/上/下）');
      return hit;
    }
    const dir = state.view?._viewDir?.();
    if (!dir || dir.length !== 3) throw Error('无法确定当前视线方向');
    const ax = Math.abs(dir[0]), ay = Math.abs(dir[1]), az = Math.abs(dir[2]);
    let axis = 2, sign = Math.sign(dir[2]) || 1;
    if (ay >= ax && ay >= az) { axis = 1; sign = Math.sign(dir[1]) || 1; }
    else if (ax >= az) { axis = 0; sign = Math.sign(dir[0]) || 1; }
    const names = [sign > 0 ? '东 (+X)' : '西 (-X)', sign > 0 ? '上 (+Y)' : '下 (-Y)', sign > 0 ? '南 (+Z)' : '北 (-Z)'];
    return [axis, sign, names[axis]];
  }

  function parseBoolToggle(arg, current) {
    if (!arg) return !current;
    const low = arg.toLowerCase();
    if (['on', 'true', '1', 'enable', 'open', 'show'].includes(low)) return true;
    if (['off', 'false', '0', 'disable', 'close', 'hide'].includes(low)) return false;
    throw Error('参数只支持 on 或 off：' + arg);
  }

  async function setCornerCmd(index, args) {
    requireGpuReady();
    if (!state.selection.enabled) await toggleSelection(true);
    if (state.selection.mode === 'layer') {
      state.selection.mode = 'region';
      selectionChanged();
    }
    if (args.length === 0) {
      await selectCorner(index, undefined, undefined, true);
      return;
    }
    if (args.length !== 3) throw Error(`用法：//pos${index + 1} [X Y Z]（支持 ~ 相对坐标）`);
    const base = state.fly ? state.flyPos : (state.view?.center || [0, 0, 0]);
    const xyz = [0, 1, 2].map(i => parseCoord(args[i], base[i], true));
    state.selection.setCorner(index, xyz);
    selectionChanged();
    log(`角点 ${index + 1}：${xyz.join(', ')}`, 'ok');
  }

  async function execute(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    const tokens = trimmed.split(/\s+/);
    const cmd = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    if (cmd === '//select') {
      return await runSelectionCommand(trimmed);
    }

    if (cmd === '//pos1') return await setCornerCmd(0, args);
    if (cmd === '//pos2') return await setCornerCmd(1, args);
    if (cmd === '//desel' || cmd === '//deselect') {
      resetSelection();
      log('已清空选区角点。', 'ok');
      return;
    }

    if (cmd === '//expand' || cmd === '//contract' || cmd === '//shift') {
      const amount = Number(args[0]);
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) {
        throw Error(`用法：${cmd} <非零整数> [方向]`);
      }
      const [axis, sign, dirName] = resolveDirection(args[1]);
      const box = resolveRegionCorners();
      const nextMin = box.min.slice(), nextMax = box.max.slice();
      if (cmd === '//shift') {
        nextMin[axis] += amount * sign;
        nextMax[axis] += amount * sign;
        applyCorners(nextMin, nextMax);
        log(`已将选区沿 ${dirName} 平移 ${amount} 格 → [${nextMin.join(',')}] 到 [${nextMax.join(',')}]`, 'ok');
        return;
      }
      if (cmd === '//expand') {
        if (amount > 0) {
          if (sign > 0) nextMax[axis] += amount;
          else nextMin[axis] -= amount;
        } else {
          if (sign > 0) nextMin[axis] -= amount;
          else nextMax[axis] += amount;
        }
        applyCorners(nextMin, nextMax);
        log(`已将选区向 ${dirName} 扩展 ${amount} 格 → [${nextMin.join(',')}] 到 [${nextMax.join(',')}]`, 'ok');
        return;
      }
      // //contract
      if (sign > 0) nextMin[axis] += amount;
      else nextMax[axis] -= amount;
      if (nextMin[axis] > nextMax[axis]) throw Error('收缩幅度超过选区厚度');
      applyCorners(nextMin, nextMax);
      log(`已将选区向 ${dirName} 收缩 ${amount} 格 → [${nextMin.join(',')}] 到 [${nextMax.join(',')}]`, 'ok');
      return;
    }

    if (cmd === '//outset' || cmd === '//inset') {
      const amount = Number(args[0]);
      if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000) {
        throw Error(`用法：${cmd} <正整数> [-h|-v]`);
      }
      const flag = (args[1] || '').toLowerCase();
      if (flag && flag !== '-h' && flag !== '-v') throw Error('可选参数只支持 -h（仅水平）或 -v（仅垂直）');
      const box = resolveRegionCorners();
      const delta = cmd === '//outset' ? amount : -amount;
      const nextMin = box.min.slice(), nextMax = box.max.slice();
      for (let axis = 0; axis < 3; axis++) {
        if (flag === '-h' && axis === 1) continue;
        if (flag === '-v' && axis !== 1) continue;
        nextMin[axis] -= delta;
        nextMax[axis] += delta;
        if (nextMin[axis] > nextMax[axis]) throw Error('内缩幅度超过选区厚度');
      }
      applyCorners(nextMin, nextMax);
      log(`已${cmd === '//outset' ? '外扩' : '内缩'}选区 ${amount} 格 → [${nextMin.join(',')}] 到 [${nextMax.join(',')}]`, 'ok');
      return;
    }

    if (cmd === '//size' || cmd === '//count' || cmd === '//distr') {
      const box = resolveRegionCorners();
      const bounds = cornersToBounds(box);
      const query = cmd === '//count' && args.length ? args.join(' ') : null;
      const stats = await window.engine.selectionStats({ selection: bounds, query });
      const dims = [box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1];
      if (cmd === '//size') {
        log(`选区尺寸：${dims.join(' × ')} · 体积 ${stats.volume.toLocaleString()} 格 · 非空气 ${stats.nonAir.toLocaleString()} 格（空气 ${stats.air.toLocaleString()} 格 · ${stats.uniqueBlocks} 种方块）`, 'ok');
      } else if (cmd === '//count') {
        log(`选区统计${query ? ` [${query}]` : '（全部非空气方块）'}：匹配 ${stats.matched.toLocaleString()} 格 / 总体积 ${stats.volume.toLocaleString()} 格`, 'ok');
      } else {
        const list = (stats.distribution || []).slice(0, 12).map((row, idx) => {
          const pct = stats.nonAir ? ((row.count / stats.nonAir) * 100).toFixed(1) : '0.0';
          return `${idx + 1}. ${row.name} (${row.id}): ${row.count.toLocaleString()} (${pct}%)`;
        });
        log(`选区方块分布（非空气共 ${stats.nonAir.toLocaleString()} 格）：\n` + (list.length ? list.join('\n') : '选区内全为空气'), 'ok');
      }
      return;
    }

    if (cmd === '//set') {
      if (args.length !== 1) throw Error('用法：//set <方块[属性]>（支持中文方块名、ID 或 air）');
      const box = resolveRegionCorners();
      const bounds = cornersToBounds(box);
      const spec = parseBlockSpec(args[0]);
      const result = await window.projectionEditor.applyExternal(
        () => window.engine.editRegion({ action: 'set', selection: bounds, target: { id: spec.id, states: spec.states } }),
        res => `已填充 ${(res.count || 0).toLocaleString()} 格为 ${spec.label}`
      );
      log(`//set 完成：变更 ${(result?.count || 0).toLocaleString()} 格为 ${spec.label}（撤销栈 ${result?.undo ?? 0}）`, result?.changed ? 'ok' : undefined);
      return;
    }

    if (cmd === '//replace') {
      if (args.length < 1 || args.length > 2) throw Error('用法：//replace [原方块] <目标方块[属性]>');
      const box = resolveRegionCorners();
      const bounds = cornersToBounds(box);
      const fromSpec = args.length === 2 ? parseBlockSpec(args[0]) : null;
      const toSpec = parseBlockSpec(args[args.length - 1]);
      const result = await window.projectionEditor.applyExternal(
        () => window.engine.editRegion({
          action: 'replace',
          selection: bounds,
          ...(fromSpec ? { from: fromSpec.id } : {}),
          target: { id: toSpec.id, states: toSpec.states },
        }),
        res => `已替换 ${(res.count || 0).toLocaleString()} 格为 ${toSpec.label}`
      );
      log(`//replace 完成：${fromSpec ? fromSpec.label : '所有非空气方块'} → ${toSpec.label}，变更 ${(result?.count || 0).toLocaleString()} 格（撤销栈 ${result?.undo ?? 0}）`, result?.changed ? 'ok' : undefined);
      return;
    }

    if (cmd === '//undo' || cmd === '//redo') {
      const action = cmd.slice(2);
      const result = await window.projectionEditor.applyExternal(
        () => window.engine.editBlock({ action }),
        action === 'undo' ? '已撤销上一步修改。' : '已重做上一步修改。'
      );
      if (!result?.changed) {
        log(action === 'undo' ? '没有可撤销的修改。' : '没有可重做的修改。');
      } else {
        log(`${action === 'undo' ? '已撤销' : '已重做'}上一步修改（撤销栈 ${result.undo} · 重做栈 ${result.redo}）。`, 'ok');
      }
      return;
    }

    // --- 一级全局指令 (/) ---
    if (cmd === '/help' || cmd === '/?') {
      if (args[0]) {
        const needle = args[0].toLowerCase();
        const found = COMMAND_SPECS.find(c => c.cmd === needle || c.cmd === '/' + needle || c.cmd === '//' + needle);
        if (!found) throw Error('未找到指令说明：' + args[0]);
        log(`${found.syntax}\n${found.desc}`, 'ok');
        return;
      }
      const l1 = COMMAND_SPECS.filter(c => c.group === 'level1').map(c => c.cmd).join(' ');
      const l2 = COMMAND_SPECS.filter(c => c.group === 'level2').map(c => c.cmd).join(' ');
      log(`一级全局指令：${l1}\n二级选区指令：${l2}\n输入 /help <指令> 查看详情，或 /commands 打开完整说明窗。`, 'ok');
      return;
    }

    if (cmd === '/commands') {
      openShortcutDialog($('commandsDialog'));
      return;
    }

    if (cmd === '/pos') {
      requireSchematic();
      const s = state.info.size || {};
      const lines = [`投影：${state.info.name}（${s.x} × ${s.y} × ${s.z}，共 ${state.info.totalBlocks} 方块）`];
      if (state.fly) {
        const degYaw = ((-state.flyYaw * 180) / Math.PI).toFixed(1);
        const degPitch = ((state.flyPitch * 180) / Math.PI).toFixed(1);
        lines.push(`漫游位置：${state.flyPos.map(v => v.toFixed(2)).join(', ')} · Yaw ${degYaw}° · Pitch ${degPitch}°`);
      } else {
        lines.push(`环绕视角：Yaw ${els.rotation.value}° · Pitch ${els.slant.value}° · Zoom ${state.zoom.toFixed(2)}×`);
      }
      if (state.selection?.corners?.some(Boolean)) {
        const cText = state.selection.corners.map((p, i) => `角点${i + 1}=${p ? p.join(',') : '未设'}`).join('  ');
        lines.push(`当前选区：${cText}`);
      }
      log(lines.join('\n'), 'ok');
      return;
    }

    if (cmd === '/tp') {
      requireGpuReady();
      if (args.length < 3 || args.length > 5) throw Error('用法：/tp <x> <y> <z> [yaw] [pitch]');
      const wasFly = state.fly;
      if (!wasFly) setFly(true);
      const base = state.flyPos || [0, 0, 0];
      const nextPos = [0, 1, 2].map(i => parseCoord(args[i], base[i], false));
      state.flyPos = nextPos;
      if (args.length >= 4) {
        const yawDeg = Number(args[3]);
        if (!Number.isFinite(yawDeg)) throw Error('无效 Yaw 角度：' + args[3]);
        state.flyYaw = -(yawDeg * Math.PI) / 180;
      }
      if (args.length >= 5) {
        const pitchDeg = Number(args[4]);
        if (!Number.isFinite(pitchDeg)) throw Error('无效 Pitch 角度：' + args[4]);
        const clamped = Math.max(-85, Math.min(85, pitchDeg));
        state.flyPitch = (clamped * Math.PI) / 180;
      }
      state.flyDirty = true;
      updateCoordinates();
      drawView();
      log(`已传送漫游视角至 (${nextPos.map(v => v.toFixed(2)).join(', ')})`, 'ok');
      return;
    }

    if (cmd === '/view') {
      const preset = args.length === 1 ? window.ViewPresets?.find(args[0]) : null;
      if (preset) {
        applyViewAngles(preset.yaw, preset.slant);
        log(`已切换为${preset.label}`, 'ok');
        return;
      }
      if (args.length === 2) {
        const yaw = Number(args[0]), pitch = Number(args[1]);
        if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw Error('用法：/view <预设名 | yaw pitch>');
        applyViewAngles(yaw, pitch);
        log(`已设置环绕视角 Yaw ${els.rotation.value}° · Pitch ${els.slant.value}°`, 'ok');
        return;
      }
      throw Error('用法：/view <iso|dimetric|dimetric_wiki|front|back|left|right|top|bottom> 或 /view <yaw> <pitch>');
    }

    if (cmd === '/zoom') {
      const z = Number(args[0]);
      if (!Number.isFinite(z) || z < 0.05 || z > 20) throw Error('用法：/zoom <倍率>（范围 0.05 – 20）');
      if (state.fly) setFly(false);
      state.zoom = z;
      els.zoom.value = String(z);
      syncAngleLabels();
      applyZoomToPreview();
      log(`缩放倍率已设置为 ${z.toFixed(2)}×`, 'ok');
      return;
    }

    if (cmd === '/fly') {
      requireGpuReady();
      const target = parseBoolToggle(args[0], state.fly);
      setFly(target);
      log(target ? '已进入自由漫游模式。' : '已退出自由漫游模式。', 'ok');
      return;
    }

    if (cmd === '/vd') {
      const val = Number(args[0]);
      if (!Number.isInteger(val) || val < 1 || val > 128) throw Error('用法：/vd <视距>（1 – 128 区块整数）');
      await saveViewDistance(val);
      log(`预览视距已调整为 ${val} 区块`, 'ok');
      return;
    }

    if (cmd === '/search') {
      const query = args.join(' ').trim();
      if (!query) throw Error('用法：/search <方块中文名称或 ID>');
      const res = await window.blockSearch.runQuery(query);
      if (!res?.total) log(`未找到匹配「${query}」的方块。`);
      else log(`搜索「${query}」命中 ${res.total.toLocaleString()} 个方块，输入 /locate [序号] 可定位。`, 'ok');
      return;
    }

    if (cmd === '/clearsearch') {
      window.blockSearch?.clear();
      log('已清除方块搜索高亮。', 'ok');
      return;
    }

    if (cmd === '/locate') {
      const idx = args[0] !== undefined ? Number(args[0]) : 1;
      if (!Number.isInteger(idx) || idx < 1) throw Error('用法：/locate [正整数序号]');
      const hit = await window.blockSearch.locateAt(idx);
      log(`已定位第 ${hit.index} / ${hit.total} 个匹配：${hit.result.name} @ (${hit.result.position.join(', ')})`, 'ok');
      return;
    }

    if (cmd === '/bg') {
      const mode = (args[0] || '').toLowerCase();
      if (!['checker', 'sky', 'white', 'dark', 'color', 'image'].includes(mode)) {
        throw Error('用法：/bg <checker|sky|white|dark|color|image> [#hex]');
      }
      if (mode === 'image' && !state.background) throw Error('请先通过工具栏「导入背景…」选择图片');
      if (mode === 'color' && args[1]) {
        const hex = args[1].startsWith('#') ? args[1] : '#' + args[1];
        if (!/^#[0-9a-f]{6}$/i.test(hex)) throw Error('颜色请使用 6 位十六进制格式，如 #224466');
        els.bg.value = hex;
      }
      els.bgMode.value = mode;
      els.bgMode.dispatchEvent(new Event('change'));
      log(`背景模式已切换为 ${mode}`, 'ok');
      return;
    }

    if (cmd === '/light') {
      const mode = (args[0] || '').toLowerCase();
      if (!['bright', 'smooth', 'off'].includes(mode)) throw Error('用法：/light <bright|smooth|off>');
      const lightingEnabled = mode !== 'off';
      const realLighting = mode === 'smooth';
      els.lightingEnabled.checked = lightingEnabled;
      els.realLighting.checked = realLighting;
      await window.appUi.setLightingEnabled(lightingEnabled);
      await window.appUi.setRealLighting(realLighting);
      updateButtons();
      if (state.file) await buildView({ preserveCamera: true });
      log(`光照模式已切换为：${mode === 'off' ? '关闭光照' : mode === 'smooth' ? '平滑光照' : '明亮光照'}`, 'ok');
      return;
    }

    if (cmd === '/layer') {
      requireGpuReady();
      const arg = (args[0] || '').toLowerCase();
      if (!arg || arg === 'off') {
        state.selection.mode = 'region';
        selectionChanged();
        log('已退出逐层模式，切换为区域框选模式。', 'ok');
        return;
      }
      const y = Number(arg);
      if (!Number.isInteger(y) || Math.abs(y) > 30000000) throw Error('用法：/layer <整数Y高度 | off>');
      if (!state.selection.enabled) await toggleSelection(true);
      state.selection.mode = 'layer';
      state.selection.renderEnabled = true;
      state.selection.layer = y;
      selectionChanged();
      log(`已启用逐层渲染：Y = ${y}`, 'ok');
      return;
    }

    if (cmd === '/tool') {
      const target = (args[0] || '').toLowerCase();
      if (target === 'none' || target === 'off') {
        if (state.selection.enabled) await toggleSelection(false);
        if (window.projectionEditor?.enabled) await window.projectionEditor.toggle(false);
        log('已关闭当前三维交互工具。', 'ok');
        return;
      }
      if (target === 'selection' || target === 'sel') {
        await toggleSelection(true);
        log('已开启选择渲染工具。', 'ok');
        return;
      }
      if (target === 'edit') {
        await window.projectionEditor.toggle(true);
        log('已开启更改投影工具。', 'ok');
        return;
      }
      throw Error('用法：/tool <selection|edit|none>');
    }

    if (cmd === '/export') {
      requireSchematic();
      const kind = (args[0] || '').toLowerCase();
      if (kind === 'sheet') {
        await exportShowcaseSheet({ auto: false, ...(args[1] ? { view1: args[1] } : {}), ...(args[2] ? { view2: args[2] } : {}) });
        return;
      }
      if (kind !== 'png' && kind !== 'gif') throw Error('用法：/export <png|gif|sheet> [分辨率] [gpu|cpu]');
      const opts = {};
      for (const a of args.slice(1)) {
        const low = a.toLowerCase();
        if (low === 'gpu' || low === 'cpu') opts.mode = low;
        else if (low === 'lossless' || (/^\d+$/.test(low) && Number(low) >= 64 && Number(low) <= 16384)) opts.size = low;
        else throw Error('未知导出参数：' + a);
      }
      if (kind === 'png') await exportPng(opts);
      else await exportGif(opts);
      return;
    }

    if (cmd === '/sheet') {
      requireSchematic();
      await exportShowcaseSheet({
        auto: true,
        ...(args[0] ? { view1: args[0] } : {}),
        ...(args[1] ? { view2: args[1] } : {}),
      });
      return;
    }

    if (cmd === '/sheetmode') {
      const target = parseBoolToggle(args[0], state.sheetMode);
      setSheetMode(target);
      return;
    }

    if (cmd === '/materials') {
      requireSchematic();
      const dlg = $('materialDialog');
      if ((args[0] || '').toLowerCase() === 'close') {
        if (dlg.open) dlg.close();
        return;
      }
      els.materials.click();
      return;
    }

    if (cmd === '/fullscreen') {
      const target = parseBoolToggle(args[0], state.fullscreen);
      await setFullscreen(target);
      return;
    }

    if (cmd === '/sidebar') {
      const show = parseBoolToggle(args[0], !state.sidebarCollapsed);
      applySidebarCollapsed(!show);
      await window.appUi.setSidebarCollapsed(state.sidebarCollapsed).catch(() => {});
      return;
    }

    if (cmd === '/console') {
      const show = parseBoolToggle(args[0], !$('debugConsole').classList.contains('hidden'));
      setConsoleHidden(!show);
      return;
    }

    if (cmd === '/reload') {
      requireSchematic();
      await rebuildPreview();
      return;
    }

    if (cmd === '/stop') {
      await stopRendering();
      return;
    }

    if (cmd === '/update') {
      if (typeof window.openUpdateDialog === 'function') {
        await window.openUpdateDialog({ triggerCheck: true });
      }
      return;
    }

    if (trimmed.startsWith('//')) throw Error(`未知二级指令「${cmd}」，输入 /help 查看全部支持指令`);
    if (trimmed.startsWith('/')) throw Error(`未知一级指令「${cmd}」，输入 /help 查看全部支持指令`);
    throw Error('指令需以 /（一级全局指令）或 //（二级选区/编辑指令）开头');
  }

  function complete(inputText) {
    const raw = String(inputText || '');
    const endsWithSpace = /\s$/.test(raw);
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (!raw.trim() || (!endsWithSpace && parts.length === 1)) {
      const prefix = parts[0]?.toLowerCase() || '/';
      const matches = COMMAND_SPECS.map(s => s.cmd).filter(c => c.startsWith(prefix));
      if (!matches.length) return null;
      return { completion: commonPrefix(matches) + (matches.length === 1 ? ' ' : ''), candidates: matches };
    }
    const cmd = parts[0].toLowerCase();
    const argIndex = endsWithSpace ? parts.length - 1 : parts.length - 2;
    const prefix = (endsWithSpace ? '' : parts[parts.length - 1]).toLowerCase();
    let pool = [];
    if (cmd === '/view' || cmd === '/sheet') pool = (window.ViewPresets?.LIST || []).map(p => p.id).concat(cmd === '/sheet' ? ['current', 'current_reverse'] : []);
    else if (cmd === '/bg') pool = ['checker', 'sky', 'white', 'dark', 'color', 'image'];
    else if (cmd === '/light') pool = ['bright', 'smooth', 'off'];
    else if (cmd === '/export') pool = argIndex === 0 ? ['png', 'gif', 'sheet'] : ['1024', '2048', '4096', 'lossless', 'gpu', 'cpu'];
    else if (cmd === '/tool') pool = ['selection', 'edit', 'none'];
    else if (['//expand', '//contract', '//shift'].includes(cmd) && argIndex === 1) pool = ['north', 'south', 'west', 'east', 'up', 'down'];
    else if (['//outset', '//inset'].includes(cmd) && argIndex === 1) pool = ['-h', '-v'];
    else if (['//set', '//replace', '//count', '/search'].includes(cmd)) {
      const { byId } = getBlockLookup();
      const stripped = prefix.startsWith('minecraft:') ? prefix.slice(10) : prefix;
      pool = Array.from(byId.keys()).filter(id => id.startsWith(stripped)).slice(0, 30);
    }
    if (!pool.length) return null;
    const candidates = pool.filter(item => item.startsWith(prefix) || (prefix.startsWith('minecraft:') && item.startsWith(prefix.slice(10))));
    if (!candidates.length) return null;
    const stem = endsWithSpace ? raw : raw.slice(0, raw.length - (parts[parts.length - 1]?.length || 0));
    const common = commonPrefix(candidates);
    return { completion: stem + common + (candidates.length === 1 ? ' ' : ''), candidates };
  }

  function commonPrefix(list) {
    if (!list.length) return '';
    let p = list[0];
    for (let i = 1; i < list.length; i++) {
      while (p && !list[i].startsWith(p)) p = p.slice(0, -1);
    }
    return p;
  }

  window.CommandRouter = {
    execute,
    complete,
    specs: COMMAND_SPECS,
  };
})();
