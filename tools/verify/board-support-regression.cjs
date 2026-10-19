'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Support=require('../../webapp/renderer/board-support.js'),data=require('../../webapp/renderer/board-support-data.js');
const {TimingWorld,DIR,OPP}=require('../../webapp/renderer/board-pistons.js');
const c=(id,states={})=>({id,states}),put=(w,p,cell)=>w.cells.set(p.join(','),cell);
const edit=(w,p,cell)=>{w.edit(p,cell);w.finish();assert(!w.halted);};
const tests=[],test=(name,fn)=>tests.push([name,fn]);
test('目录全部原版方块使用支撑数据，物品框实体和未知方块不假定实心',()=>{
  const ctx={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../../webapp/renderer/board-catalog.js'),'utf8'),ctx);
  for(const b of ctx.window.BoardCatalog)if(!['item_frame','glow_item_frame'].includes(b.id))assert(Object.hasOwn(data,b.id),b.id);
  for(const id of ['stone','redstone_block','glass','oak_planks','white_concrete','obsidian'])for(const d of Object.keys(DIR))assert(Support.sturdy(c(id),d));
  for(const id of ['chest','oak_leaves','air','unknown_block'])for(const d of Object.keys(DIR))assert(!Support.sturdy(c(id),d));
});
test('拉杆和按钮六向附着：只检查附着方块朝向元件的一面',()=>{
  for(const id of ['lever','stone_button','oak_button'])for(const d of Object.keys(DIR)){
    const w=new TimingWorld(),states={face:d==='down'?'floor':d==='up'?'ceiling':'wall',facing:['down','up'].includes(d)?'north':OPP[d],powered:'false'},cell=c(id,states);
    put(w,DIR[OPP[d]],c('stone'));assert(!w.canAttach([0,0,0],cell));w.cells.clear();put(w,DIR[d],c('redstone_block'));assert(w.canAttach([0,0,0],cell));edit(w,[0,0,0],cell);assert(w.get([0,0,0]));
  }
});
test('台阶底/顶/双层分别提供下/上/所有完整支撑面',()=>{
  for(const [type,valid]of [['bottom',['down']],['top',['up']],['double',Object.keys(DIR)]])for(const d of Object.keys(DIR))assert.equal(Support.sturdy(c('oak_slab',{type}),d),valid.includes(d),type+' '+d);
  const w=new TimingWorld('side');put(w,[0,-1,0],c('oak_slab',{type:'bottom'}));assert.throws(()=>edit(w,[0,0,0],c('lever',{face:'floor'})),/支撑/);
  edit(w,[0,-1,0],c('oak_slab',{type:'top'}));edit(w,[0,0,0],c('lever',{face:'floor',facing:'north',powered:'false'}));assert(w.get([0,0,0]));
});
test('楼梯按方向/上下半部判断，完整背面可以贴按钮',()=>{
  for(const facing of ['north','south','east','west'])for(const half of ['top','bottom']){
    const stair=c('oak_stairs',{facing,half,shape:'straight'});assert(Support.sturdy(stair,facing));assert(!Support.sturdy(stair,OPP[facing]));assert.equal(Support.sturdy(stair,'up','RIGID'),half==='top');
    const w=new TimingWorld();put(w,DIR[OPP[facing]],stair);assert(w.canAttach([0,0,0],c('oak_button',{face:'wall',facing})));
  }
});
test('压力板接受中心/刚性支撑，中继器/比较器要求刚性支撑',()=>{
  const w=new TimingWorld('side');for(const [id,plate,diode]of [['oak_fence',true,false],['hopper',true,true],['glass',true,true],['oak_leaves',false,false],['honey_block',false,false]]){
    put(w,[0,-1,0],c(id));assert.equal(w.canAttach([0,0,0],c('stone_pressure_plate')),plate,id);assert.equal(w.canAttach([0,0,0],c('repeater')),diode,id);assert.equal(w.canAttach([0,0,0],c('comparator')),diode,id);
    if(id==='oak_fence')assert(!w.canAttach([0,0,0],c('lever',{face:'floor'})));
  }
});
test('支撑面状态改变立即脱落，移除无关邻居不脱落',()=>{
  for(const id of ['lever','stone_button','stone_pressure_plate','repeater','comparator']){
    const w=new TimingWorld('side');put(w,[0,-1,0],c('oak_slab',{type:'top'}));edit(w,[0,0,0],c(id,{face:'floor',facing:'east',powered:'false',delay:'1',locked:'false',mode:'compare'}));edit(w,[1,0,0],c('glass'));edit(w,[1,0,0],null);assert(w.get([0,0,0]),id);
    edit(w,[0,-1,0],c('oak_slab',{type:'bottom'}));assert(!w.get([0,0,0]),id);
  }
});
test('拆除激活拉杆的支撑，元件脱落并更新旧充能邻居',()=>{
  const w=new TimingWorld('side');put(w,[0,0,0],c('stone'));put(w,[-1,0,0],c('redstone_lamp',{lit:'false'}));edit(w,[1,0,0],c('lever',{face:'wall',facing:'east',powered:'false'}));w.toggle([1,0,0]);w.finish();assert.equal(w.get([-1,0,0]).states.lit,'true');edit(w,[0,0,0],null);assert(!w.get([1,0,0]));for(let i=0;i<4;i++)w.tick();assert.equal(w.get([-1,0,0]).states.lit,'false');
});
test('俯视仅地面隐式支撑，天花板/墙面不凭空附着',()=>{
  const w=new TimingWorld('top');assert(w.canAttach([0,0,0],c('lever',{face:'floor'})));assert(!w.canAttach([0,0,0],c('lever',{face:'ceiling'})));assert(!w.canAttach([0,0,0],c('lever',{face:'wall',facing:'north'})));put(w,[0,0,1],c('glass'));assert(w.canAttach([0,0,0],c('lever',{face:'wall',facing:'north'})));assert.equal(w.cells.size,1);
});
for(const [name,fn]of tests){fn();console.log('PASS '+name);}console.log(tests.length+' support regression groups passed');
