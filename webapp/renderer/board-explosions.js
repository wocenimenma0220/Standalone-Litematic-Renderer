'use strict';
/** 爆炸拆成可保存的射线、实体影响及方块破坏任务，避免单次事件执行全部工作。 */
(function(root){
 function install(B){
  const P=B.TimingWorld.prototype,F=Math.fround,key=p=>p.join(','),clone=v=>JSON.parse(JSON.stringify(v));
  const rays=[];for(let x=0;x<16;x++)for(let y=0;y<16;y++)for(let z=0;z<16;z++)if([x,y,z].some(v=>v===0||v===15)){
   const v=[x,y,z].map(n=>F(F(F(n/15)*2)-1)),length=Math.hypot(...v);rays.push(v.map(n=>n/length*F(.3)));
  }
  const segmentBox=(from,to,b)=>{let lo=0,hi=1;for(let a=0;a<3;a++){const d=to[a]-from[a];if(Math.abs(d)<1e-12){if(from[a]<b[a]+1e-8||from[a]>b[a+3]-1e-8)return false;}else{const t0=(b[a]-from[a])/d,t1=(b[a+3]-from[a])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(hi<lo)return false;}}return hi>1e-7&&lo<1-1e-7;};
  B.segmentHitsBox=segmentBox;
  B.EXTRA_TASKS.push('爆炸射线','爆炸实体影响','爆炸实体命中','爆炸方块阶段','爆炸完成','爆炸连锁点燃');
  P.ensureExplosions=function(){this.explosions??=new Map();this.nextExplosionId??=1;this.explosionEffects??=[];};
  P.rayOccluded=function(from,to){
   const p=from.map(Math.floor),end=to.map(Math.floor),delta=to.map((v,i)=>v-from[i]),step=delta.map(Math.sign),tDelta=delta.map(v=>v?Math.abs(1/v):Infinity),next=delta.map((v,i)=>v?((p[i]+(v>0?1:0))-from[i])/v:Infinity);
   const checkedMoving=new Set();
   for(let n=0;n<2048;n++){
    if(this.collisionBoxesAt(p).some(box=>segmentBox(from,to,box)))return true;
    // 移动碰撞盒会跨出所属方块；射线不进入所属格时也必须检查。
    if(this.moving?.size)for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){const q=[p[0]+x,p[1]+y,p[2]+z],k=key(q);if(!checkedMoving.has(k)&&this.moving.has(k)){checkedMoving.add(k);if(this.collisionBoxesAt(q).some(box=>segmentBox(from,to,box)))return true;}}
    if(p.every((v,i)=>v===end[i]))return false;const a=next.indexOf(Math.min(...next));if(next[a]>1)return false;p[a]+=step[a];next[a]+=tDelta[a];
   }return true;
  };
  P.explosionExposure=function(center,e){const b=B.aabb(e),steps=[0,1,2].map(a=>1/((b[a+3]-b[a])*2+1)),offset=[(1-Math.floor(1/steps[0])*steps[0])/2,0,(1-Math.floor(1/steps[2])*steps[2])/2];let seen=0,total=0;
   for(let x=0;x<=1;x+=steps[0])for(let y=0;y<=1;y+=steps[1])for(let z=0;z<=1;z+=steps[2]){const f=[x,y,z],point=f.map((v,a)=>b[a]+(b[a+3]-b[a])*v+offset[a]);if(!this.rayOccluded(point,center))seen++;total++;}return total?F(seen/total):0;
  };
  P.explosionResistance=function(p,source){const s=this.simulationCell(p),f=this.fluidState(p);if(!s&&!f)return null;
   if(source.type==='tnt_minecart'&&source.fuse>=0&&(B.isRail(s?.id)||B.isRail(this.simulationCell([p[0],p[1]+1,p[2]])?.id)))return 0;
   return Math.max(B.physics(s)[4]||0,f?100:0);
  };
  P.explodeEntity=function(e){this.ensureFluids();this.ensureExplosions();if(!this.rules.tntExplodes)return;
   let power=e.explosionPower??4;if(e.type==='tnt_minecart'){const speed=Math.min(5,Math.sqrt(e.explosionSpeedSqr??(e.velocity[0]**2+e.velocity[2]**2)));power=F(power+(e.explosionSpeedFactor??1)*this.entityRandomDouble(e)*1.5*speed);}
   power=F(Math.max(0,Math.min(128,power)));const center=[...e.pos];if(e.type==='primed_tnt')center[1]+=e.height*.0625;
   const id=this.nextExplosionId++,job={id,source:clone(e),center,power,ray:0,affected:[],stage:'rays'};this.explosions.set(id,job);
   this.record('实体爆炸',{pos:center.map(Math.floor),entity:e.id,strength:power});this.explosionEffects.push({id,center,power,time:this.time});this.explosionEffects=this.explosionEffects.filter(v=>this.time-v.time<=10).slice(-64);
   this.push([{kind:'爆炸射线',pos:center.map(Math.floor),explosionId:id}]);return id;
  };
  P.traceExplosionBatch=function(job){const affected=new Set(job.affected),last=Math.min(rays.length,job.ray+32);
   for(;job.ray<last;job.ray++){const dir=rays[job.ray],pos=[...job.center];let energy=F(job.power*F(F(.7)+F(this.deviceNext(24)/16777216*F(.6))));
    while(energy>0){const p=pos.map(Math.floor);if(p.some(v=>Math.abs(v)>512))break;const resistance=this.explosionResistance(p,job.source);
     if(resistance!==null)energy=F(energy-F(F(F(resistance)+F(.3))*F(.3)));
     if(energy>0)affected.add(key(p));for(let a=0;a<3;a++)pos[a]+=dir[a];energy=F(energy-F(.22500001));
    }
   }job.affected=[...affected];
   this.push([{kind:job.ray<rays.length?'爆炸射线':'爆炸实体影响',pos:job.center.map(Math.floor),explosionId:job.id}]);
  };
  P.hurtEntity=function(e,damage,source){if(!this.entities.has(e.id)||e.type==='primed_tnt')return;
   this.record('实体受伤',{pos:e.pos.map(Math.floor),entity:e.id,damage,source:source?.id??null});
   if(e.type==='tnt_minecart'){if(source?.type==='projectile'&&['arrow','spectral_arrow','tipped_arrow'].includes(source.projectile)&&(source.onFire||source.burning||source.fireTicks>0)){e.explosionSpeedSqr=source.velocity.reduce((n,v)=>n+v*v,0);this.removeEntity(e.id);this.explodeEntity(e);return;}if(e.fuse<0){e.fuse=this.entityRandomInt(e,20)+this.entityRandomInt(e,20);e.ignitionSource=source?.id??null;}return;}
   if(B.isMinecart(e.type)||B.isBoat(e.type)){e.damage=(e.damage||0)+damage*10;if(e.damage<=40)return;}
   else{e.health=(e.health??(e.type==='item'?5:e.type==='iron_golem'?100:e.type==='snow_golem'?4:16))-damage;if(e.health>0)return;}
   if(e.container)for(const item of e.container.slots)if(item)this.spawnEntity('item',e.pos,{item:clone(item)});
   this.removeEntity(e.id);
  };
  P.hitExplosionEntity=function(job,e){if(!e||e.id===job.source.id||e.ignoreExplosion)return;const R=F(job.power*2);if(R<1e-5)return;
   const distance=Math.hypot(...e.pos.map((v,a)=>v-job.center[a]))/R;if(distance>1)return;
   const exposure=this.explosionExposure(job.center,e),p=(1-distance)*exposure,eye=e.type==='primed_tnt'?0:e.eyeHeight??e.height*.85,dir=e.pos.map((v,a)=>v+(a===1?eye:0)-job.center[a]),length=Math.hypot(...dir);
   const impulse=dir.map(v=>length?v/length*p*(1-(e.explosionKnockbackResistance||0)):0);if(this.plane==='side')impulse[2]=0;
   this.hurtEntity(e,F((p*p+p)/2*7*R+1),job.source);
   if(this.entities.has(e.id)){for(let a=0;a<3;a++)e.velocity[a]+=impulse[a];e.awake=true;this.record('爆炸冲量',{pos:e.pos.map(Math.floor),entity:e.id,exposure,impulse});}
  };
  P.explosionBlockOrder=function(positions){
   // 复现普通 Java HashMap 桶的遍历，再用同一世界随机源洗牌。
   let capacity=16;while(positions.length>capacity*.75)capacity*=2;const buckets=Array.from({length:capacity},()=>[]);
   for(const k of positions){const [x,y,z]=k.split(',').map(Number),hash=(Math.imul((y+Math.imul(z,31))|0,31)+x)|0;buckets[(hash^(hash>>>16))&(capacity-1)].push(k);}
   const list=buckets.flat();for(let i=list.length;i>1;i--){const j=this.deviceNextInt(i);[list[i-1],list[j]]=[list[j],list[i-1]];}return list;
  };
  P.destroyExplosionBlock=function(t){const s=this.get(t.pos),job=this.explosions?.get(t.explosionId);if(!s)return;
   if(job?.source.type==='tnt_minecart'&&job.source.fuse>=0&&(B.isRail(s.id)||B.isRail(this.get([t.pos[0],t.pos[1]+1,t.pos[2]])?.id)))return;
   if(B.physics(s)[1])return;
   if(s.id==='tnt')this.push([{kind:'set',pos:t.pos,cell:null,flags:3},{kind:'爆炸连锁点燃',pos:t.pos}]);
   else{if(!this.rules?.tntExplosionDropDecay||!job||this.deviceNext(24)/16777216<1/Math.max(1,job.power))this.dropBlock(t.pos,s);this.set(t.pos,null);}
  };
  const execute=P.execute,snapshot=P.snapshot,restore=P.restore;
  P.execute=function(t){
   if(t.kind==='爆炸破坏'){this.destroyExplosionBlock(t);return;}
   if(t.kind==='爆炸连锁点燃'){const e=this.spawnPrimedTnt(t.pos);e.fuse=this.deviceNextInt(20)+10;return;}
   if(['爆炸射线','爆炸实体影响','爆炸实体命中','爆炸方块阶段','爆炸完成'].includes(t.kind)){
    this.ensureExplosions();const job=this.explosions.get(t.explosionId);if(!job)return;
    if(t.kind==='爆炸射线'){this.traceExplosionBatch(job);return;}
    if(t.kind==='爆炸实体影响'){job.stage='entities';const ids=[...this.entities.keys()].filter(id=>id!==job.source.id);this.push([...ids.map(entityId=>({kind:'爆炸实体命中',pos:t.pos,entityId,explosionId:job.id})),{kind:'爆炸方块阶段',pos:t.pos,explosionId:job.id}]);return;}
    if(t.kind==='爆炸实体命中'){this.hitExplosionEntity(job,this.entities.get(t.entityId));return;}
    if(t.kind==='爆炸方块阶段'){job.stage='blocks';const positions=this.explosionBlockOrder(job.affected);this.push([...positions.map(k=>({kind:'爆炸破坏',pos:k.split(',').map(Number),explosionId:job.id})),{kind:'爆炸完成',pos:t.pos,explosionId:job.id}]);return;}
    this.record('爆炸完成',{pos:t.pos,explosionId:job.id,affected:job.affected.length});this.explosions.delete(job.id);return;
   }return execute.call(this,t);
  };
  P.snapshot=function(){this.ensureExplosions();return {...snapshot.call(this),explosions:clone({version:1,nextId:this.nextExplosionId,jobs:[...this.explosions],effects:this.explosionEffects})};};
  P.restore=function(data){const v=data.explosions;if(v){if(v.version!==1||!Number.isSafeInteger(v.nextId)||v.nextId<1||!Array.isArray(v.jobs)||v.jobs.length>4096||!Array.isArray(v.effects)||v.effects.length>64)throw Error('爆炸存档无效');
    for(const [id,j]of v.jobs)if(!Number.isSafeInteger(id)||id!==j.id||!Array.isArray(j.center)||j.center.length!==3||!j.center.every(Number.isFinite)||!Number.isFinite(j.power)||j.power<0||j.power>128||!Number.isInteger(j.ray)||j.ray<0||j.ray>rays.length||!Array.isArray(j.affected)||j.affected.length>150000||j.affected.some(k=>!(/^-?\d+,-?\d+,-?\d+$/.test(k))||k.split(',').some(n=>!Number.isSafeInteger(Number(n))))||!j.source||!Array.isArray(j.source.velocity)||j.source.velocity.length!==3||!j.source.velocity.every(Number.isFinite))throw Error('爆炸任务无效');
    for(const e of v.effects)if(!Array.isArray(e.center)||e.center.length!==3||!e.center.every(Number.isFinite)||!Number.isFinite(e.power)||!Number.isSafeInteger(e.time))throw Error('爆炸显示状态无效');}
   restore.call(this,data);this.explosions=new Map(clone(v?.jobs||[]));this.nextExplosionId=v?.nextId||1;this.explosionEffects=clone(v?.effects||[]);
  };
 }
 if(typeof module!=='undefined')module.exports=install;else root.BoardExplosions=install;
})(typeof window!=='undefined'?window:globalThis);
