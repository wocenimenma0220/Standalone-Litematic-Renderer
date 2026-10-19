'use strict';
/* FaceAttachedHorizontalDirectionalBlock uses FULL; DiodeBlock uses RIGID;
 * BasePressurePlateBlock accepts RIGID or CENTER. These are support shapes,
 * independent of light occlusion, redstone conduction and visible model faces. */
(function(root){
  const data=typeof module!=='undefined'?require('./board-support-data.js'):root.BoardSupportData;
  const directions=['down','up','north','south','west','east'],types=['FULL','CENTER','RIGID'];
  function maskOf(cell){
    if(!cell)return 0;let mask=data[cell.id];
    if(mask&&typeof mask==='object')mask=mask.values[mask.keys.map((k,i)=>String(cell.states?.[k]??mask.defaults[i])).join(',')];
    return typeof mask==='number'?mask:0;
  }
  function sturdy(cell,direction,type='FULL'){
    const mask=maskOf(cell);
    const d=directions.indexOf(direction),t=types.indexOf(type);
    return d>=0&&t>=0&&typeof mask==='number'&&!!(mask&(1<<(t*6+d)));
  }
  function requirement(cell){
    if(!cell)return null;
    const {id,states={}}=cell;
    if(id==='lever'||id.endsWith('_button'))return {toward:states.face==='floor'?'down':states.face==='ceiling'?'up':({north:'south',south:'north',east:'west',west:'east'}[states.facing||'north']),types:['FULL']};
    if(id==='repeater'||id==='comparator')return {toward:'down',types:['RIGID']};
    if(id.endsWith('_pressure_plate'))return {toward:'down',types:['RIGID','CENTER']};
    if(id==='redstone_wire')return {toward:'down',types:['FULL'],blocks:['hopper']};
    if(id==='redstone_torch')return {toward:'down',types:['CENTER']};
    if(id==='redstone_wall_torch')return {toward:({north:'south',south:'north',east:'west',west:'east'}[states.facing||'north']),types:['FULL']};
    if(['rail','powered_rail','activator_rail','detector_rail'].includes(id))return {toward:'down',types:['RIGID']};
    return null;
  }
  const conductor=cell=>!!(maskOf(cell)&(1<<18));
  const wireConnects=(cell,direction)=>{const bit=direction==null?25:19+directions.indexOf(direction);return bit>=19&&!!(maskOf(cell)&(1<<bit));};
  const api={sturdy,requirement,conductor,wireConnects};if(typeof module!=='undefined')module.exports=api;else root.BoardSupport=api;
})(typeof window!=='undefined'?window:globalThis);
