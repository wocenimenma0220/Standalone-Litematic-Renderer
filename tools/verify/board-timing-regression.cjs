'use strict';
const assert=require('node:assert/strict');
const {TimingWorld,NC,PP,to3,to2}=require('../../webapp/renderer/board-timing.js');
const cell=(id,states={})=>({id,states});
const put=(w,p,id,states={})=>w.cells.set(p.join(','),cell(id,states));
const edit=(w,p,s)=>{w.edit(p,s);w.finish();assert(!w.halted);};
const tests=[];const test=(name,run)=>tests.push([name,run]);
test('六向 NC/PP 顺序和三维投影',()=>{
  const w=new TimingWorld();edit(w,[0,0,0],cell('stone'));
  assert.deepEqual(w.trace.filter(r=>r.kind==='NC').map(r=>r.direction),NC.map(d=>({west:'east',east:'west',down:'up',up:'down',north:'south',south:'north'})[d]));
  assert.deepEqual(w.trace.filter(r=>r.kind==='PP').map(r=>r.pos),PP.map(d=>({west:[-1,0,0],east:[1,0,0],north:[0,0,-1],south:[0,0,1],down:[0,-1,0],up:[0,1,0]})[d]));
  for(const view of ['top','side'])assert.deepEqual(to2(to3(2,-3,view),view),[2,-3]);
});
test('刻阶段完整推进，连续运行和事件单步一致',()=>{
  const a=new TimingWorld(),b=new TimingWorld();a.tick();do{b.stepEvent();}while(b.phase!=='AT');
  assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.trace.filter(r=>r.kind==='阶段').map(r=>r.name),['WTU','TT','CT','BE','EU','TE','AT']);assert.equal(a.time,1);
});
test('红石灯瞬亮、4gt 延迟灭、重供电取消熄灭',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'redstone_lamp',{lit:'false'});edit(w,[1,0,0],cell('redstone_block'));assert.equal(w.get([0,0,0]).states.lit,'true');
  edit(w,[1,0,0],null);for(let i=0;i<3;i++)w.tick();assert.equal(w.get([0,0,0]).states.lit,'true');w.tick();assert.equal(w.get([0,0,0]).states.lit,'false');
  edit(w,[1,0,0],cell('redstone_block'));edit(w,[1,0,0],null);w.tick();edit(w,[1,0,0],cell('redstone_block'));for(let i=0;i<4;i++)w.tick();assert.equal(w.get([0,0,0]).states.lit,'true');
});
test('铜灯仅上升沿翻转，同刻多次翻转',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'copper_bulb',{lit:'false',powered:'false'});
  edit(w,[1,0,0],cell('redstone_block'));assert.equal(w.get([0,0,0]).states.lit,'true');edit(w,[1,0,0],null);assert.equal(w.get([0,0,0]).states.lit,'true');assert.equal(w.get([0,0,0]).states.powered,'false');
  edit(w,[1,0,0],cell('redstone_block'));assert.equal(w.get([0,0,0]).states.lit,'false');assert.equal(w.time,0);
});
test('侦测器只响应检测面 PP，2gt 亮/2gt 灭，输出相反方向',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'observer',{facing:'west',powered:'false'});put(w,[1,0,0],'redstone_lamp',{lit:'false'});
  w.push([{kind:'NC',pos:[0,0,0],source:[-1,0,0],direction:'west'}]);w.finish();assert.equal(w.scheduled.length,0);
  edit(w,[-1,0,0],cell('stone'));assert.equal(w.scheduled.length,1);w.tick();assert.equal(w.get([0,0,0]).states.powered,'false');w.tick();assert.equal(w.get([0,0,0]).states.powered,'true');assert.equal(w.get([1,0,0]).states.lit,'true');w.tick();w.tick();assert.equal(w.get([0,0,0]).states.powered,'false');
  const rows=w.trace.filter(r=>r.gt===2);const state=rows.findIndex(r=>r.kind==='状态变化'&&r.pos.join(',')==='0,0,0');const pp=rows.findIndex((r,i)=>i>state&&r.kind==='PP');const nc=rows.findIndex((r,i)=>i>state&&r.kind==='NC');assert(pp>state&&nc>pp,'observer PP precedes output NC');
});
test('中继器保留同刻消失的输入短脉冲',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'repeater',{facing:'east',delay:'2',powered:'false',locked:'false'});put(w,[0,-1,0],'stone');
  edit(w,[1,0,0],cell('redstone_block'));edit(w,[1,0,0],null);assert.equal(w.scheduled.length,1);assert.equal(w.scheduled[0].priority,-1);
  for(let i=0;i<4;i++)w.tick();assert.equal(w.get([0,0,0]).states.powered,'true');assert.equal(w.scheduled[0].priority,-2);for(let i=0;i<4;i++)w.tick();assert.equal(w.get([0,0,0]).states.powered,'false');
});
test('计划刻位置/类型去重、优先级、跨区块到期头比较',()=>{
  const w=new TimingWorld();w.schedule([0,0,0],'a',1,0);w.schedule([0,0,0],'a',2,-3);assert.equal(w.scheduled.length,1);
  w.schedule([1,0,0],'b',1,-2);w.schedule([16,0,0],'c',1,-3);w.tick();assert.deepEqual(w.trace.filter(r=>r.kind==='TT').map(r=>r.type),['c','b','a']);
  const v=new TimingWorld();v.schedule([0,0,0],'old',0,0);v.schedule([1,0,0],'new',1,-3);v.schedule([16,0,0],'other',1,-1);v.tick();assert.deepEqual(v.trace.filter(r=>r.kind==='TT').map(r=>r.type),['other','old','new']);
});
test('本刻计划刻收集后新登记不插入本刻',()=>{
  const w=new TimingWorld();w.schedule([0,0,0],'a',1);w.stepEvent();w.stepEvent();assert.equal(w.selected.length,1);assert.equal(w.hasScheduled([0,0,0],'a'),false);assert(w.willTick([0,0,0],'a'));w.schedule([0,0,0],'a',0);w.finish();assert.equal(w.scheduled.length,1);w.tick();assert.equal(w.scheduled.length,0);
});
test('更新链中途保存恢复，轨迹和队列一致',()=>{
  const a=new TimingWorld();put(a,[0,0,0],'copper_bulb',{lit:'false',powered:'false'});a.edit([1,0,0],cell('redstone_block'));a.stepEvent();a.stepEvent();
  const b=new TimingWorld();b.restore(a.snapshot());a.finish();b.finish();a.tick();b.tick();assert.deepEqual(b.snapshot(),a.snapshot());assert(a.trace.some(r=>r.parent));
  const invalid=a.snapshot();invalid.scheduled=[{pos:['bad'],priority:0}];assert.throws(()=>b.restore(invalid));
});
test('强弱充能区分：拉杆附着块、红石块无强输出',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'stone');put(w,[0,1,0],'lever',{face:'floor',powered:'true',facing:'north'});assert.equal(w.signal([0,0,0],'west'),15);
  put(w,[0,1,0],'redstone_block');assert.equal(w.signal([0,0,0],'west'),0);
});
test('中继器失去支撑和侧面锁定',()=>{
  const w=new TimingWorld();put(w,[0,0,0],'repeater',{facing:'east',delay:'1',powered:'false',locked:'false'});put(w,[0,-1,0],'stone');put(w,[0,0,1],'repeater',{facing:'south',delay:'1',powered:'true',locked:'false'});put(w,[0,-1,1],'stone');
  edit(w,[1,0,0],cell('redstone_block'));assert.equal(w.scheduled.length,0);assert(w.locked([0,0,0],w.get([0,0,0])));
  edit(w,[0,-1,0],null);assert.equal(w.get([0,0,0]),undefined);
});
test('未实现的方块事件保留队列并停止；存档拒绝非法方向',()=>{
  const w=new TimingWorld();w.blockEvent([0,0,0],'bell',0,5);w.blockEvent([0,0,0],'bell',0,5);assert.equal(w.events.length,1);w.tick();assert(w.halted);assert.equal(w.events.length,1);
  const saved=new TimingWorld().snapshot();saved.cells=[['0,0,0',cell('observer',{facing:'invalid',powered:'false'})]];assert.throws(()=>new TimingWorld().restore(saved));
});
test('放置回调替换状态后，外层 setBlock 不再发送旧状态更新',()=>{
  const w=new TimingWorld();put(w,[1,0,0],'redstone_block');edit(w,[0,0,0],cell('copper_bulb',{lit:'false',powered:'false'}));
  assert.equal(w.get([0,0,0]).states.lit,'true');assert.equal(w.trace.filter(r=>r.kind==='PP'&&r.source.join(',')==='0,0,0').length,6);
  const v=new TimingWorld();put(v,[0,0,0],'observer',{facing:'west',powered:'false'});v.set([-1,0,0],cell('stone'),18);v.finish();assert.equal(v.scheduled.length,0,'known-shape flag suppresses PP');
});
for(const [name,run]of tests){run();console.log('PASS '+name);}console.log(`${tests.length} timing regression groups passed`);
