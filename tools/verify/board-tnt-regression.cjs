'use strict';
const assert=require('node:assert/strict'),B=require('../../webapp/renderer/board-world-features.js'),{TimingWorld}=B,F=Math.fround;
const cell=(id,states={})=>({id,states:{...B.BLOCK_DEFAULTS[id],...states}}),put=(w,p,id,s)=>w.cells.set(p.join(','),cell(id,s));
const tick=(w,n=1)=>{for(let i=0;i<n;i++){w.tick();assert(!w.halted,JSON.stringify(w.trace.slice(-2)));}},finish=w=>{w.finish();assert(!w.halted);},test=(name,fn)=>{fn();console.log('PASS '+name);};
const tnt=(w,pos,options={})=>w.spawnEntity('primed_tnt',pos,{velocity:[0,0,0],...options});
test('独立Java 26.3夹具逐条核对射线集合、破坏顺序及随机数消费',()=>{
 const reference=require('./fixtures/tnt-fluid-26.3.json'),crypto=require('node:crypto');
 for(const wet of [false,true]){const w=new TimingWorld();put(w,[1,0,0],'stone');put(w,[-1,0,0],'obsidian');put(w,[0,0,1],'oak_slab',{waterlogged:String(wet)});const id=w.explodeEntity(tnt(w,[.5,0,.5])),job=w.explosions.get(id);while(job.ray<1352)w.stepEvent();const order=w.explosionBlockOrder(job.affected),expected=reference[wet?'wetRayReference':'dryRayReference'];assert.equal(job.affected.length,expected.affectedCount);assert.equal(crypto.createHash('sha256').update(order.join(';')).digest('hex'),expected.orderSha256);assert.equal(w.deviceNextInt(1000000),expected.randomAfterShuffle);}
});
test('供电放置及邻居供电点燃一次，禁用规则不点燃',()=>{
 for(const placement of [true,false]){const w=new TimingWorld('side');if(placement)put(w,[1,0,0],'redstone_block');else put(w,[0,0,0],'tnt');w.edit(placement?[0,0,0]:[1,0,0],cell(placement?'tnt':'redstone_block'));finish(w);assert(!w.get([0,0,0]));assert.equal(w.entities.size,1);assert.equal([...w.entities.values()][0].fuse,80);}
 const w=new TimingWorld('side');w.ensureFluids();w.rules.tntExplodes=false;put(w,[1,0,0],'redstone_block');w.edit([0,0,0],cell('tnt'));finish(w);assert(w.get([0,0,0]));assert.equal(w.entities.size,0);
});
test('默认尺寸、随机初速、侧视法向约束及同种子重放',()=>{
 const a=new TimingWorld('side'),b=new TimingWorld('side');const e=a.spawnPrimedTnt([0,2,0]),f=b.spawnPrimedTnt([0,2,0]);assert.deepEqual(e.velocity,f.velocity);assert.equal(e.width,F(.98));assert.equal(e.velocity[1],F(.2));assert.equal(e.velocity[2],0);assert.equal(e.fuse,80);assert(Math.abs(e.velocity[0])<=.02);
 const top=new TimingWorld('top'),t=top.spawnPrimedTnt([0,0,0]);assert(Math.abs(Math.hypot(t.velocity[0],t.velocity[2])-.02)<1e-12);
});
test('80gt引信和干地逐刻轨迹',()=>{
 const w=new TimingWorld('side'),e=tnt(w,[.5,100,.5],{velocity:[.1,.2,0]});let y=100,vy=.2,x=.5,vx=.1;
 for(let i=0;i<79;i++){vy-=.04;y+=vy;x+=vx;vy*=F(.98);vx*=F(.98);tick(w);assert(Math.abs(e.pos[0]-x)<1e-10);assert(Math.abs(e.pos[1]-y)<1e-10);}assert(w.entities.has(e.id));tick(w);assert(!w.entities.has(e.id));
});
test('TNT落地水平阻力使用0.7而非物品0.6',()=>{const w=new TimingWorld('top'),e=tnt(w,[.5,0,.5],{velocity:[.1,0,0]});tick(w);assert.equal(e.velocity[0],.1*F(.98)*.7);});
test('原版流向与流体高度夹具',()=>{
 const w=new TimingWorld('side');put(w,[0,0,0],'water');put(w,[-1,0,0],'stone');put(w,[1,0,0],'water',{level:'4'});assert.deepEqual(w.fluidFlow([0,0,0]),[1,0,0]);assert.equal(w.fluidHeight([0,0,0]),F(8/9));put(w,[0,1,0],'water');assert.equal(w.fluidHeight([0,0,0]),1);
 const f=new TimingWorld('side');put(f,[0,0,0],'water',{level:'8'});put(f,[-1,0,0],'stone');assert.deepEqual(f.fluidFlow([0,0,0]),[0,-1,0]);
});
test('静水无虚假水平力，流水在移动后给TNT加0.014速度',()=>{
 const w=new TimingWorld('top');put(w,[-1,0,0],'stone');put(w,[0,0,0],'water');put(w,[1,0,0],'water',{level:'4'});const e=tnt(w,[.5,0,.5]);tick(w);assert.equal(e.pos[0],.5);assert(Math.abs(e.velocity[0]-.014)<1e-12);tick(w);assert(e.pos[0]>.5);
 const v=new TimingWorld('top');for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)put(v,[x,0,z],'water');const f=tnt(v,[.5,0,.5]);tick(v);assert.equal(f.velocity[0],0);assert.equal(f.velocity[2],0);
});
test('流体5gt计划刻、面外限制、源移除退流与俯视虚拟地面',()=>{
 const w=new TimingWorld('top');w.edit([0,0,0],cell('water'));finish(w);tick(w,4);assert.equal([...w.cells.values()].filter(s=>s.id==='water').length,1);tick(w);assert(w.get([1,0,0]));assert([...w.cells.keys()].every(k=>k.split(',')[1]==='0'));
 w.edit([0,0,0],null);finish(w);tick(w,50);assert(![...w.cells.values()].some(s=>s.id==='water'));
 const v=new TimingWorld('side');put(v,[0,2,0],'water');tick(v,10);assert(v.get([0,0,0]));assert([...v.cells.keys()].every(k=>k.endsWith(',0')));
});
test('双水源转换与关闭转换规则',()=>{const w=new TimingWorld('top');put(w,[-1,0,0],'water');put(w,[1,0,0],'water');assert(w.newFluidState([0,0,0],'water').source);w.rules.waterSourceConversion=false;assert(!w.newFluidState([0,0,0],'water').source);});
test('水流碰撞面考虑台阶、完整方块及含水容器',()=>{
 const w=new TimingWorld('side');put(w,[1,0,0],'stone');assert(!w.fluidPassesFace([0,0,0],[1,0,0],'east'));put(w,[1,0,0],'oak_slab',{type:'bottom'});assert(w.fluidPassesFace([0,0,0],[1,0,0],'east'));assert(!w.canHoldFluid([1,0,0],'water',false));assert(w.canHoldFluid([1,0,0],'water',true));
});
test('水岩浆接触按方向凝固，特殊地面材质使用原版导出参数',()=>{const w=new TimingWorld('side');put(w,[0,0,0],'lava');w.edit([1,0,0],cell('water'));finish(w);assert.equal(w.get([0,0,0]).id,'obsidian');const v=new TimingWorld('side');put(v,[0,1,0],'lava');put(v,[0,0,0],'water');v.spreadFluid([0,1,0],v.fluidState([0,1,0]));finish(v);assert.equal(v.get([0,0,0]).id,'stone');assert.equal(B.entityMaterial(cell('honey_block'))[1],F(.4));assert.equal(B.entityMaterial(cell('slime_block'))[2],1);});
test('爆心偏移、含水台阶100抗性及黑曜石保护',()=>{
 const w=new TimingWorld('side');put(w,[0,0,0],'oak_slab',{waterlogged:'true',type:'bottom'});put(w,[1,0,0],'obsidian');const e=tnt(w,[.5,.5,.5]);const id=w.explodeEntity(e);assert.equal(w.explosions.get(id).center[1],.5+F(.98)*.0625);assert.equal(w.explosionResistance([0,0,0],e),100);finish(w);assert(w.get([0,0,0]));assert(w.get([1,0,0]));
});
test('原版碰撞射线暴露度：空气1、墙0、水1、低爆心台阶0',()=>{
 const e={pos:[2.5,0,.5],width:.98,height:.98},center=[.5,F(.98)*.0625,.5];for(const [id,expected]of [['air',1],['stone',0],['water',1],['oak_slab',0]]){const w=new TimingWorld('side');if(id!=='air')put(w,[1,0,0],id);assert.equal(w.explosionExposure(center,e),expected,id);}
});
test('移动活塞碰撞盒跨格仍遮挡爆炸射线',()=>{const w=new TimingWorld();w.ensurePistons();put(w,[1,0,0],'moving_piston',{facing:'east',type:'normal'});w.moving.set('1,0,0',{pos:[1,0,0],movedState:cell('stone'),direction:'east',extending:true,source:false,progress:.5,progressO:0});assert(w.rayOccluded([.6,.5,-.5],[.6,.5,1.5]));});
test('爆炸先计算实体再破坏墙，无墙可加速另一颗TNT',()=>{
 for(const wall of [false,true]){const w=new TimingWorld('side');if(wall)put(w,[1,0,0],'stone');const source=tnt(w,[.5,0,.5],{fuse:0}),target=tnt(w,[2.5,0,.5],{fuse:40});tick(w);if(wall)assert.equal(target.velocity[0],0);else assert(target.velocity[0]>.5);assert(w.entities.has(target.id));assert(!w.entities.has(source.id));}
});
test('水中爆炸不毁方块但仍有实体冲量',()=>{
 const w=new TimingWorld('top');put(w,[0,0,0],'water');put(w,[1,0,0],'stone');const source=tnt(w,[.5,0,.5]),target=tnt(w,[.5,0,2.5]);w.explodeEntity(source);finish(w);assert(w.get([1,0,0]));assert(target.velocity[2]>.5);
});
test('连锁短引信10至29gt，实体出生当刻不额外更新',()=>{
 const w=new TimingWorld('top');put(w,[1,0,0],'tnt');tnt(w,[.5,0,.5],{fuse:0});tick(w);const e=[...w.entities.values()].find(e=>e.type==='primed_tnt');assert(e);assert(e.fuse>=10&&e.fuse<=29);assert.equal(e.age,0);assert(!w.get([1,0,0]));
});
test('伤害和冲量分离，TNT免伤、物品与无护甲实体受伤',()=>{const w=new TimingWorld('top'),a=tnt(w,[2.5,0,.5]),b=w.spawnEntity('piglin',[2.5,0,.5]),source=tnt(w,[.5,0,.5]);w.explodeEntity(source);finish(w);assert(w.entities.has(a.id));assert(!w.entities.has(b.id));});
test('发射器与手持打火石入口、summon tnt别名',()=>{
 const w=new TimingWorld('top');put(w,[0,0,0],'tnt');assert(w.interactAt([0,0,0],{id:'flint_and_steel'}));finish(w);assert(!w.get([0,0,0]));w.emitDispensed([2,0,0],cell('dispenser',{facing:'east'}),{id:'tnt',max:64},'primed_tnt');assert.equal(w.entities.size,2);assert([...w.entities.values()].every(e=>e.velocity.some(v=>v!==0)));assert.equal(w.runBoardCommand('summon tnt 5 0 0',[0,0,0]),1);
});
test('燃烧箭命中TNT点燃，普通箭不点燃',()=>{for(const onFire of [true,false]){const w=new TimingWorld('side');put(w,[1,0,0],'tnt');w.spawnEntity('projectile',[.5,.4,.5],{projectile:'arrow',onFire,velocity:[1,0,0],width:.5,height:.5});tick(w);assert.equal(!!w.get([1,0,0]),!onFire);}});
test('气泡柱接触和掉落物浮力与TNT重力分开',()=>{const w=new TimingWorld('top');put(w,[0,0,0],'bubble_column',{drag:'false'});const e=tnt(w,[.5,.1,.5]);tick(w);assert(e.velocity[1]>0);const v=new TimingWorld('top');put(v,[0,0,0],'water');const i=v.spawnEntity('item',[.5,.1,.5],{item:{id:'stone',count:1,max:64}});tick(v);assert(i.velocity[1]>0);});
test('点燃TNT矿车保护铁轨及轨下方块',()=>{const w=new TimingWorld('side');put(w,[0,0,0],'rail');put(w,[0,-1,0],'stone');const e=w.spawnEntity('tnt_minecart',[.5,.0625,.5],{fuse:0});w.explodeEntity(e);finish(w);assert(w.get([0,0,0]));assert(w.get([0,-1,0]));});
test('TNT矿车速度增幅、实体随机源可保存',()=>{const w=new TimingWorld('top'),e=w.spawnEntity('tnt_minecart',[.5,0,.5],{velocity:[2,0,0],fuse:0});const id=w.explodeEntity(e);assert(w.explosions.get(id).power>=4);assert(w.explosions.get(id).power<=7);assert(e.randomState);});
test('TNT矿车碰撞、坠落与燃烧箭引爆',()=>{
 const wall=new TimingWorld('top');put(wall,[1,0,0],'stone');const c=wall.spawnEntity('tnt_minecart',[.5,0,.5],{velocity:[.3,0,0]});tick(wall);assert(!wall.entities.has(c.id));assert(wall.trace.some(t=>t.kind==='实体爆炸'));
 const falling=new TimingWorld('top'),f=falling.spawnEntity('tnt_minecart',[.5,4,.5]);tick(falling,30);assert(!falling.entities.has(f.id));assert(falling.trace.some(t=>t.kind==='实体爆炸'));
 const arrow=new TimingWorld('side'),cart=arrow.spawnEntity('tnt_minecart',[2,.01,.5]);arrow.spawnEntity('projectile',[.5,.3,.5],{projectile:'arrow',onFire:true,velocity:[2,0,0],width:.5,height:.5});tick(arrow);assert(!arrow.entities.has(cart.id));
});
test('流体TT、实体EU、爆炸射线与方块破坏中途保存精确续算',()=>{
 for(const stage of ['fluid','entity','rays','blocks']){const w=new TimingWorld('top');put(w,[0,0,0],'water');put(w,[4,0,0],'tnt');put(w,[3,0,0],'glass');tnt(w,[2.5,0,.5],{fuse:stage==='rays'||stage==='blocks'?0:20});
  if(stage==='fluid'){tick(w,4);while(!(w.phase==='TT'&&!w.selected.length))w.stepEvent();}
  else if(stage==='entity'){while(w.phase!=='EU')w.stepEvent();}
  else{while(![...w.explosions?.values()||[]].some(j=>stage==='rays'?j.ray>0:j.stage==='blocks')){w.stepEvent();assert(!w.halted);}}
  const v=new TimingWorld();v.restore(w.snapshot());assert.deepEqual(v.snapshot(),w.snapshot());finish(w);finish(v);tick(w,8);tick(v,8);assert.deepEqual(v.snapshot(),w.snapshot(),stage);
 }
});
test('旧快照缺少新模块可迁移，非法数值拒绝',()=>{const w=new TimingWorld('top');tnt(w,[.5,0,.5]);const s=w.snapshot();delete s.fluids;delete s.explosions;s.entities.items[0][1].fuse=-1;const v=new TimingWorld();v.restore(s);assert.equal([...v.entities.values()][0].fuse,80);const bad=w.snapshot();bad.entities.items[0][1].explosionPower=Infinity;assert.throws(()=>v.restore(bad));});
test('事件预算中止后保留爆炸游标并可继续',()=>{const w=new TimingWorld('top');w.explodeEntity(tnt(w,[.5,0,.5]));w.steps=100000;w.stepEvent();assert(w.halted);assert(w.explosions.size);assert(w.resumeSimulationBudget());finish(w);assert.equal(w.explosions.size,0);});
test('设置TNT引信及速度原子验证，最后10gt显示膨胀',()=>{const w=new TimingWorld('side'),e=tnt(w,[.5,0,.5]);assert.throws(()=>w.setEntityProperties(e.id,{fuse:-2,velocity0:1}));assert.equal(e.fuse,80);w.setEntityProperties(e.id,{fuse:5,velocity0:.25});assert.equal(e.velocity[0],.25);assert(B.tntVisual(e).scale>1);assert(w.entityAt([.5,.5,.5]));});
test('爆炸按时间片推进与连续推进结果一致，坏尺寸和坏射线游标拒绝',()=>{const a=new TimingWorld('top');for(let x=0;x<8;x++)tnt(a,[x+.5,0,.5],{fuse:0});const b=new TimingWorld();b.restore(a.snapshot());tick(a);let complete=false,count=0;while(!complete){complete=b.runSimulationSlice(.01);assert(++count<10000);}assert.deepEqual(b.snapshot(),a.snapshot());assert(count>1);const bad=a.snapshot();bad.entities.items=[[100,{id:100,type:'item',pos:[0,0,0],velocity:[0,0,0],width:-1,height:1}]];assert.throws(()=>b.restore(bad));const pending=new TimingWorld('top');pending.explodeEntity(tnt(pending,[.5,0,.5]));const invalid=pending.snapshot();invalid.explosions.jobs[0][1].ray=-1;assert.throws(()=>b.restore(invalid));});
console.log('29 TNT / 流体 / 爆炸回归组通过');
