'use strict';

/** 统一管理相机预设，参考 WikiRenderer-26.3（默认 135°/30°、90° 像素正交与四向对角视角）及 KCL 正二测/等轴测预设。 */
(function (root) {
  const LIST = [
    { id: 'dimetric_front',   label: '二轴正向 (45° / 30°)',    short: '二轴正向', yaw: 45,   slant: 30,     aliases: ['dimetric', 'dimetric_front'] },
    { id: 'dimetric_wiki',    label: 'Wiki 默认 (135° / 30°)',  short: 'Wiki默认', yaw: 135,  slant: 30,     aliases: ['wiki', 'dimetric_wiki'] },
    { id: 'dimetric_back',    label: '二轴反向 (225° / 30°)',   short: '二轴反向', yaw: 225,  slant: 30,     aliases: ['dimetric_back', 'dimetric_reverse'] },
    { id: 'dimetric_west',    label: '二轴侧反 (315° / 30°)',   short: '二轴侧反', yaw: 315,  slant: 30,     aliases: ['dimetric_west'] },
    { id: 'dimetric_classic', label: 'KCL 正二测 (20.7° / 19.5°)', short: '正二测', yaw: 20.7, slant: 19.471, aliases: ['classic', 'dimetric_classic'] },
    { id: 'iso_front',        label: '等轴正向 (45° / 35.3°)',  short: '等轴正向', yaw: 45,   slant: 35.264, aliases: ['iso', 'isometric', 'iso_front'] },
    { id: 'iso_wiki',         label: '等轴反向 (135° / 35.3°)', short: '等轴反向', yaw: 135,  slant: 35.264, aliases: ['iso_wiki'] },
    { id: 'iso_back',         label: '等轴对角 (225° / 35.3°)', short: '等轴对角', yaw: 225,  slant: 35.264, aliases: ['iso_back', 'iso_reverse', 'isometric_reverse'] },
    { id: 'iso_west',         label: '等轴侧向 (315° / 35.3°)', short: '等轴侧向', yaw: 315,  slant: 35.264, aliases: ['iso_west'] },
    { id: 'front',            label: '正视 · 北向 (0° / 0°)',   short: '正视(北)', yaw: 0,    slant: 0,      aliases: ['front', 'north', 'side_north'] },
    { id: 'right',            label: '右视 · 东向 (90° / 0°)',  short: '右视(东)', yaw: 90,   slant: 0,      aliases: ['right', 'east', 'side_east'] },
    { id: 'back',             label: '背视 · 南向 (180° / 0°)', short: '背视(南)', yaw: 180,  slant: 0,      aliases: ['back', 'south', 'side_south'] },
    { id: 'left',             label: '左视 · 西向 (270° / 0°)', short: '左视(西)', yaw: 270,  slant: 0,      aliases: ['left', 'west', 'side_west'] },
    { id: 'top',              label: '俯视 · 顶面 (0° / 89°)',  short: '俯视(顶)', yaw: 0,    slant: 89,     aliases: ['top', 'above', 'side_above'] },
    { id: 'bottom',           label: '仰视 · 底面 (0° / -89°)', short: '仰视(底)', yaw: 0,    slant: -89,    aliases: ['bottom', 'below', 'side_below'] },
  ];

  const BY_KEY = new Map();
  for (const item of LIST) {
    BY_KEY.set(item.id, item);
    for (const alias of item.aliases) BY_KEY.set(alias, item);
  }

  function normalizeYaw(deg) {
    return ((Number(deg) || 0) % 360 + 360) % 360;
  }

  function find(key) {
    return BY_KEY.get(String(key || '').trim().toLowerCase()) || null;
  }

  function matchAngles(yawDeg, slantDeg, epsilon = 0.6) {
    const targetYaw = normalizeYaw(yawDeg);
    const targetSlant = Number(slantDeg) || 0;
    for (const item of LIST) {
      const dy = Math.abs(normalizeYaw(item.yaw) - targetYaw);
      const yawDiff = Math.min(dy, 360 - dy);
      if (yawDiff <= epsilon && Math.abs(item.slant - targetSlant) <= epsilon) {
        return item;
      }
    }
    return null;
  }

  function resolve(key, currentYaw = 45, currentSlant = 30) {
    const normKey = String(key || '').trim().toLowerCase();
    const cy = Math.round(normalizeYaw(currentYaw) * 10) / 10;
    const cs = Math.max(-89, Math.min(89, Math.round((Number(currentSlant) || 0) * 10) / 10));
    if (normKey === 'current') {
      return { id: 'current', label: '当前视角', short: '当前视角', yaw: cy, slant: cs };
    }
    if (normKey === 'current_reverse') {
      return { id: 'current_reverse', label: '当前视角背面', short: '对称背面', yaw: Math.round(normalizeYaw(cy + 180) * 10) / 10, slant: cs };
    }
    return find(normKey) || LIST[0];
  }

  root.ViewPresets = {
    LIST,
    find,
    matchAngles,
    resolve,
    normalizeYaw,
  };
})(typeof window !== 'undefined' ? window : globalThis);
