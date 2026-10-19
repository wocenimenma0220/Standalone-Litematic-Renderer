'use strict';
const assert=require('node:assert/strict');
const B=require('../../webapp/renderer/board-pistons.js'),Support=require('../../webapp/renderer/board-support.js');
const {TimingWorld,wireCell}=B,c=(id,states={})=>({id,states}),put=(w,p,s)=>w.cells.set(p.join(','),s);
const finish=w=>{w.finish();assert(!w.halted,JSON.stringify(w.trace.slice(-4)));};
const edit=(w,p,s)=>{w.edit(p,s);finish(w);};
const power=(w,p)=>Number(w.get(p)?.states.power||0),ticks=(w,n)=>{for(let i=0;i<n;i++){w.tick();assert(!w.halted);}};
const tests=[],test=(name,fn)=>tests.push([name,fn]);
test('十字粉默认放置、右键点粉；点粉不向侧面输出但仍向下强充能',()=>{
  const w=new TimingWorld();put(w,[0,-1,0],c('redstone_block'));edit(w,[0,0,0],wireCell());assert.equal(power(w,[0,0,0]),15);assert.equal(w.own([0,0,0],'east'),15);assert.equal(w.own([0,0,0],'up',true),15);assert.equal(w.own([0,0,0],'down'),0);assert(w.interactAt([0,0,0]));finish(w);for(const d of ['east','west','north','south']){assert.equal(w.get([0,0,0]).states[d],'none');assert.equal(w.own([0,0,0],d),0);}assert.equal(w.own([0,0,0],'up',true),15);assert(w.interactAt([0,0,0]));finish(w);assert.equal(w.own([0,0,0],'east'),15);
});
test('15级起逐格减1，超过15格无电，撤电后反馈链完全退电',()=>{
  const w=new TimingWorld('top');for(let x=0;x<18;x++)edit(w,[x,0,0],wireCell());edit(w,[-1,0,0],c('redstone_block'));for(let x=0;x<18;x++)assert.equal(power(w,[x,0,0]),Math.max(15-x,0));assert.equal(w.time,0);edit(w,[-1,0,0],null);for(let x=0;x<18;x++)assert.equal(power(w,[x,0,0]),0);
});
test('分支取最大强度，多电源撤掉一端后由剩余电源重新衰减',()=>{
  const w=new TimingWorld('top');for(let x=0;x<9;x++)edit(w,[x,0,0],wireCell());for(let z=1;z<4;z++)edit(w,[4,0,z],wireCell());edit(w,[-1,0,0],c('redstone_block'));edit(w,[9,0,0],c('redstone_block'));assert.equal(power(w,[4,0,0]),11);assert.equal(power(w,[4,0,3]),8);edit(w,[-1,0,0],null);for(let x=0;x<9;x++)assert.equal(power(w,[x,0,0]),15-(8-x));assert.equal(power(w,[4,0,3]),8);edit(w,[9,0,0],null);assert([...w.cells.values()].every(s=>!B.isWire(s)||s.states.power==='0'));
});
test('带回路的线网不会自供电，外部电源计算屏蔽全部红石粉输出',()=>{
  const w=new TimingWorld('top');for(const p of [[0,0,0],[1,0,0],[1,0,1],[0,0,1]])edit(w,p,wireCell());edit(w,[-1,0,0],c('redstone_block'));assert.equal(power(w,[1,0,1]),13);edit(w,[-1,0,0],null);assert([...w.cells.values()].every(s=>s.states.power==='0'));
  const v=new TimingWorld();put(v,[0,-1,0],c('stone'));put(v,[0,0,0],wireCell(15,'side'));v.wireUpdate([0,0,0]);finish(v);assert.equal(power(v,[0,0,0]),0);
});
test('原版自动形成直线/拐角，连接中的线粉不会被强制点化',()=>{
  const w=new TimingWorld('top');edit(w,[0,0,0],wireCell());assert(w.interactAt([0,0,0]));finish(w);edit(w,[1,0,0],wireCell());assert.deepEqual(['north','east','south','west'].map(d=>w.get([0,0,0]).states[d]),['none','side','none','side']);assert.equal(w.interactAt([0,0,0]),false);edit(w,[0,0,1],wireCell());assert.deepEqual(['north','east','south','west'].map(d=>w.get([0,0,0]).states[d]),['none','side','side','none']);
});
test('中继器只沿轴接线，侦测器只在输出面接线',()=>{
  const w=new TimingWorld('top');put(w,[1,0,0],c('repeater',{facing:'north',powered:'false',delay:'1',locked:'false'}));assert.equal(w.wireConnectingSide([0,0,0],'east'),'none');put(w,[1,0,0],c('repeater',{facing:'east'}));assert.equal(w.wireConnectingSide([0,0,0],'east'),'side');put(w,[1,0,0],c('observer',{facing:'west'}));assert.equal(w.wireConnectingSide([0,0,0],'east'),'none');put(w,[1,0,0],c('observer',{facing:'east'}));assert.equal(w.wireConnectingSide([0,0,0],'east'),'side');
});
test('高低线攀爬及退电；低线头顶导体阻止爬升',()=>{
  const w=new TimingWorld('side');put(w,[0,-1,0],c('stone'));put(w,[1,0,0],c('stone'));edit(w,[0,0,0],wireCell());edit(w,[1,1,0],wireCell());edit(w,[-1,0,0],c('redstone_block'));assert.equal(w.get([0,0,0]).states.east,'up');assert.equal(power(w,[1,1,0]),14);edit(w,[0,1,0],c('stone'));assert.notEqual(w.get([0,0,0]).states.east,'up');assert.equal(power(w,[1,1,0]),0);edit(w,[0,1,0],null);assert.equal(power(w,[1,1,0]),14);edit(w,[-1,0,0],null);assert.equal(power(w,[1,1,0]),0);
});
test('红石粉支撑要求完整上表面或漏斗，支持移除后脱落并退电',()=>{
  const w=new TimingWorld('side');for(const [id,states,valid]of [['glass',{},true],['hopper',{facing:'down'},true],['oak_slab',{type:'top'},true],['oak_slab',{type:'bottom'},false],['oak_leaves',{},false]]){put(w,[0,-1,0],c(id,states));assert.equal(w.canAttach([0,0,0],wireCell()),valid,id);}
  put(w,[0,-1,0],c('stone'));put(w,[1,-1,0],c('stone'));edit(w,[0,0,0],wireCell());edit(w,[1,0,0],wireCell());edit(w,[-1,0,0],c('redstone_block'));assert.equal(power(w,[1,0,0]),14);edit(w,[0,-1,0],null);assert(!w.get([0,0,0]));assert.equal(power(w,[1,0,0]),0);
});
test('方块导电属性来自原版状态，透明方块不因能支撑而导电',()=>{
  for(const [id,conducts]of [['oak_planks',true],['white_concrete',true],['glass',false],['redstone_block',false],['copper_bulb',false]])assert.equal(Support.conductor(c(id)),conducts,id);
  assert(Support.conductor(c('oak_slab',{type:'double'})));assert(!Support.conductor(c('oak_slab',{type:'top'})));
  const w=new TimingWorld('side');put(w,[-1,-1,0],c('stone'));put(w,[0,-1,0],c('oak_planks'));put(w,[1,-1,0],c('redstone_lamp',{lit:'false'}));edit(w,[0,0,0],wireCell());edit(w,[-1,0,0],c('redstone_block'));assert.equal(w.get([1,-1,0]).states.lit,'true');edit(w,[0,-1,0],c('glass'));ticks(w,4);assert.equal(w.get([1,-1,0]).states.lit,'false');
});
test('红石粉驱动灯/漏斗及二极管，中继器与比较器仍按原版延迟',()=>{
  for(const id of ['redstone_lamp','hopper','repeater','comparator']){const w=new TimingWorld('top');edit(w,[0,0,0],wireCell());edit(w,[1,0,0],c(id,{facing:'west',enabled:'true',lit:'false',powered:'false',delay:'1',locked:'false',mode:'compare'}));edit(w,[-1,0,0],c('redstone_block'));if(id==='redstone_lamp')assert.equal(w.get([1,0,0]).states.lit,'true');else if(id==='hopper')assert.equal(w.get([1,0,0]).states.enabled,'false');else{assert.equal(w.get([1,0,0]).states.powered,'false');ticks(w,1);assert.equal(w.get([1,0,0]).states.powered,'false');ticks(w,1);assert.equal(w.get([1,0,0]).states.powered,'true');}}
});
test('线更新通知顺序与本地Java HashSet/BlockPos运行结果一致',()=>{
  const samples=[[[0,0,0],[[0,0,0],[0,0,-1],[-1,0,0],[0,0,1],[1,0,0],[0,-1,0],[0,1,0]]],[[-17,0,16],[[-17,-1,16],[-17,0,17],[-16,0,16],[-17,1,16],[-17,0,15],[-18,0,16],[-17,0,16]]],[[192,5,-192],[[192,4,-192],[192,5,-191],[193,5,-192],[192,5,-192],[192,6,-192],[192,5,-193],[191,5,-192]]]];for(const [p,expected]of samples)assert.deepEqual(B.wireNotificationPositions(p),expected);
});
test('传播事件中途保存恢复后，状态/队列/事件轨迹与连续推进一致',()=>{
  const w=new TimingWorld('top');for(let x=0;x<8;x++)edit(w,[x,0,0],wireCell());edit(w,[-1,0,0],c('redstone_block'));w.edit([-1,0,0],null);for(let i=0;i<27;i++)assert(w.stepEvent());const saved=w.snapshot(),frozen=JSON.stringify(saved),other=new TimingWorld();other.restore(saved);finish(w);finish(other);assert.equal(JSON.stringify(saved),frozen);assert.deepEqual(other.snapshot(),w.snapshot());
});
for(const [name,fn]of tests){fn();console.log('PASS '+name);}console.log(tests.length+' wire regression groups passed');
