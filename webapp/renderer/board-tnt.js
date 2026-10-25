'use strict';
/** TNT 与其他实体共享生成、流体、冲量和保存接口，类型自己的运动参数独立保留。 */
(function(root){
 function install(B){
  const P=B.TimingWorld.prototype,F=Math.fround,clone=v=>JSON.parse(JSON.stringify(v)),at=(p,d)=>p.map((v,i)=>v+B.DIR[d][i]);
  const defaults={primed_tnt:{width:F(.98),height:F(.98),eyeHeight:F(.15),fuse:80,explosionPower:4},item:{width:.25,height:.25,health:5},falling_block:{width:F(.98),height:F(.98)}};
  B.tntVisual=e=>({scale:1+Math.max(0,Math.min(1,1-e.fuse/10))**4*.3,lit:e.fuse>=0&&Math.floor(e.fuse/5)%2===0});
  B.ENTITY_CATALOG.push({id:'primed_tnt',name:'点燃的 TNT',entity:true,categories:['entities'],defaults:{facing:'east'},properties:{facing:['east']},facing:['east'],visuals:[],multipart:[]});
  P.randomDouble=function(){return (this.deviceNext(26)*134217728+this.deviceNext(27))/9007199254740992;};
  P.entityRandomBits=function(e,bits){const mask=(1n<<48n)-1n;let seed=e.randomState===undefined?(BigInt(e.id)*25214903917n^263n)&mask:BigInt(e.randomState);seed=(seed*25214903917n+11n)&mask;e.randomState=String(seed);return Number(seed>>BigInt(48-bits));};
  P.entityRandomDouble=function(e){return (this.entityRandomBits(e,26)*134217728+this.entityRandomBits(e,27))/9007199254740992;};
  P.entityRandomInt=function(e,bound){if((bound&-bound)===bound)return Math.floor(bound*this.entityRandomBits(e,31)/2147483648);let bits,value;do{bits=this.entityRandomBits(e,31);value=bits%bound;}while(bits-value+bound-1>=2147483648);return value;};
  const spawn=P.spawnEntity;
  P.spawnEntity=function(type,pos,options={}){if(type==='tnt')type='primed_tnt';const v={...defaults[type],...clone(options)};
   if(type==='primed_tnt'){v.width=F(.98);v.height=F(.98);v.eyeHeight=F(.15);}
   if(type==='primed_tnt'&&!v.velocity){const angle=this.randomDouble()*F(Math.PI*2);v.velocity=[-Math.sin(angle)*.02,F(.2),-Math.cos(angle)*.02];}
   if(v.velocity&&this.plane==='side')v.velocity[2]=0;
   const e=spawn.call(this,type,pos,v);if(type==='primed_tnt'||B.isMinecart(type))e.explosionPower??=4;return e;
  };
  P.spawnPrimedTnt=function(p,options={}){return this.spawnEntity('primed_tnt',p.map((v,a)=>v+(a===1?0:.5)),options);};
  P.primeTnt=function(p,owner=null){this.ensureFluids();if(!this.rules.tntExplodes||this.get(p)?.id!=='tnt')return false;
   this.spawnPrimedTnt(p,{owner});this.set(p,null);this.record('TNT点燃',{pos:p,owner,fuse:80});return true;
  };
  const neighbor=P.neighbor,execute=P.execute,tickBlock=P.tickBlock,interact=P.interactAt;
  P.neighbor=function(t){const s=this.get(t.pos);if(s?.id==='tnt'&&t.kind==='NC'&&this.powered(t.pos)){this.primeTnt(t.pos);return;}return neighbor.call(this,t);};
  P.execute=function(t){if(t.kind==='onPlace'&&this.get(t.pos)?.id==='tnt'){if(this.powered(t.pos))this.primeTnt(t.pos);else if(Object.keys(B.DIR).some(d=>['fire','soul_fire'].includes(this.get(at(t.pos,d))?.id)))this.schedule(t.pos,'tnt',30);}
   if(t.kind==='onPlace'&&['fire','soul_fire'].includes(this.get(t.pos)?.id))for(const d of Object.keys(B.DIR)){const q=at(t.pos,d);if(this.get(q)?.id==='tnt')this.schedule(q,'tnt',30);}
   return execute.call(this,t);
  };
  P.tickBlock=function(t){if(t.type==='tnt'&&this.get(t.pos)?.id==='tnt'){if(Object.keys(B.DIR).some(d=>['fire','soul_fire'].includes(this.get(at(t.pos,d))?.id))){if(this.deviceNextInt(3)===0)this.primeTnt(t.pos);else this.schedule(t.pos,'tnt',30);}return;}return tickBlock.call(this,t);};
  P.interactAt=function(p,item){if(this.get(p)?.id==='tnt'&&['flint_and_steel','fire_charge'].includes(item?.id)){if(this.phase!=='AT'||this.tasks.length||this.halted)throw Error('请先完成本刻');return this.primeTnt(p);}return interact.call(this,p,item);};
  const move=P.moveEntityBy;
  const projectile=P.tickProjectile;
  P.tickProjectile=function(e){const start=[...e.pos],velocity=[...e.velocity];projectile.call(this,e);
   if(e.stuck&&(e.onFire||e.burning||e.fireTicks>0)){const clipped=velocity.map((v,a)=>this.plane==='side'&&a===2?0:Math.abs(e.pos[a]-start[a]-v)),axis=clipped.indexOf(Math.max(...clipped)),p=e.pos.map(Math.floor);p[axis]=Math.floor(e.pos[axis]+Math.sign(velocity[axis])*(e.width/2+.001));if(this.get(p)?.id==='tnt')this.primeTnt(p,e.owner??null);}
   if(this.entities.has(e.id)&&['arrow','spectral_arrow','tipped_arrow'].includes(e.projectile)){
    const hit=[...this.entities.values()].filter(target=>target.id!==e.id&&target.id!==e.owner&&!['item','projectile','falling_block'].includes(target.type)&&B.segmentHitsBox(start,e.pos,B.aabb(target))).sort((a,b)=>Math.hypot(...a.pos.map((v,i)=>v-start[i]))-Math.hypot(...b.pos.map((v,i)=>v-start[i])))[0];
    if(hit){this.hurtEntity(hit,Math.ceil(Math.hypot(...velocity)*2),{...e,velocity});this.removeEntity(e.id);}
   }
  };
  P.moveEntityBy=function(e,delta){if(this.plane==='side')e.velocity[2]=0;const before=[...e.velocity],moved=move.call(this,e,delta);
   if(e.type==='tnt_minecart'&&e.horizontalCollision)e.collisionSpeedSqr=before[0]**2+before[2]**2;
   if(e.type==='primed_tnt'&&e.onGround){const ground=this.simulationCell([Math.floor(e.pos[0]),Math.floor(e.pos[1]-.001),Math.floor(e.pos[2])]),restitution=F(B.entityMaterial(ground)[2]*F(.8));if(restitution>0&&-before[1]>.04){const portion=moved[1]/before[1],drag=1+portion*(F(.98)-1);e.velocity[1]=(portion*.04-before[1])*drag*restitution;}}
   const here=this.simulationCell(e.pos.map(Math.floor)),below=this.simulationCell([Math.floor(e.pos[0]),Math.floor(e.pos[1]-F(.5000001)),Math.floor(e.pos[2])]);let speed=B.entityMaterial(here)[1];if(!['water','bubble_column'].includes(here?.id)&&speed===1)speed=B.entityMaterial(below)[1];e.velocity[0]*=speed;e.velocity[2]*=speed;
   return moved;
  };
  P.applyEntityContacts=function(e){const b=B.aabb(e);for(let x=Math.floor(b[0]+1e-7);x<Math.ceil(b[3]-1e-7);x++)for(let y=Math.floor(b[1]+1e-7);y<Math.ceil(b[4]-1e-7);y++)for(let z=Math.floor(b[2]+1e-7);z<Math.ceil(b[5]-1e-7);z++){
    const p=[x,y,z],s=this.get(p);if(s?.id==='bubble_column'){const down=s.states.drag==='true',top=!this.fluidState(at(p,'up'))&&!B.physics(this.simulationCell(at(p,'up')))[3].length;e.velocity[1]=down?Math.max(top?-.9:-.3,e.velocity[1]-.03):Math.min(top?1.8:.7,e.velocity[1]+(top?.1:.06));}
    if(s?.id==='cobweb')e.velocity=e.velocity.map((v,a)=>v*(a===1?.05:.25));
   }
  };
  const ordinary=P.tickOrdinaryEntity;
  P.tickOrdinaryEntity=function(id){const e=this.entities.get(id);if(!e)return;
   if(['primed_tnt','item','falling_block'].includes(e.type)){
    e.previous=[...e.pos];e.age++;const fluid=this.entityFluids(e),floating=e.type==='item'&&(fluid.water?.height>F(.1)||fluid.lava?.height>F(.1));
    if(floating){const factor=fluid.water?F(.99):F(.95);e.velocity[0]*=factor;e.velocity[2]*=factor;if(e.velocity[1]<F(.06))e.velocity[1]+=F(.0005);}else if(!e.noGravity)e.velocity[1]-=.04;
    const before=[...e.pos];this.moveEntityBy(e,e.velocity);this.applyEntityContacts(e);const ground=this.simulationCell([Math.floor(e.pos[0]),Math.floor(e.pos[1]-F(.999999)),Math.floor(e.pos[2])]),friction=B.entityMaterial(ground)[0];
    e.velocity=e.velocity.map((v,a)=>v*(e.type==='item'&&e.onGround&&a!==1?F(F(.98)*friction):F(.98)));
    if(e.onGround){if(e.type==='primed_tnt'){e.velocity[0]*=.7;e.velocity[2]*=.7;}if(e.type==='primed_tnt'||e.type==='item'&&e.velocity[1]<0)e.velocity[1]*=-.5;}
    if(e.type==='primed_tnt'){e.fuse--;if(e.fuse<=0){this.removeEntity(id);this.explodeEntity(e);return;}this.applyFluidCurrent(e);}
    else{this.applyFluidCurrent(e);if(e.type==='item'&&e.age>=6000)this.removeEntity(id);
     if(e.type==='falling_block'&&e.onGround){const p=e.pos.map(Math.floor),s=this.get(p);if(!s||['water','lava','fire'].includes(s.id)){this.set(p,e.block);this.removeEntity(id);}else{this.dropBlock(p,e.block);this.removeEntity(id);}}
     if(e.type==='item'&&e.inLava)this.hurtEntity(e,4,null);
    }
    e.fallDistance=e.onGround?0:(e.fallDistance||0)+Math.max(0,before[1]-e.pos[1]);
   }else{
    const was=[...e.pos],oldFuse=e.fuse,cart=B.isMinecart(e.type);delete e.collisionSpeedSqr;ordinary.call(this,id);if(!this.entities.has(id))return;
    if(cart){this.applyFluidCurrent(e);this.applyEntityContacts(e);const fall=(e.fallDistance||0)+Math.max(0,was[1]-e.pos[1]);e.fallDistance=e.onGround?0:fall;
     if(e.type==='tnt_minecart'&&this.rules?.tntExplodes&&(e.horizontalCollision&&(e.collisionSpeedSqr??0)>=F(.01)||e.onGround&&fall>=3)){e.explosionSpeedSqr=e.onGround&&fall>=3?(fall/10)**2:e.collisionSpeedSqr;this.removeEntity(id);this.explodeEntity(e);return;}
     if(e.type==='tnt_minecart'&&this.rules?.tntExplodes===false&&oldFuse<0)e.fuse=-1;
     if(e.type==='tnt_minecart'&&oldFuse<0&&e.fuse>=0)this.record('TNT矿车点燃',{pos:e.pos.map(Math.floor),entity:id,fuse:e.fuse});
    }else if(!e.vehicle){if(e.awake&&!['projectile'].includes(e.type)){if(!e.noGravity)e.velocity[1]-=.08;this.moveEntityBy(e,e.velocity);e.velocity=e.velocity.map((v,a)=>v*(a===1?F(.98):e.onGround?.6:F(.91)));}this.applyFluidCurrent(e);this.applyEntityContacts(e);if(e.inWater||e.inLava)e.awake=true;}
   }
   if(e.pos.some(v=>!Number.isFinite(v)||Math.abs(v)>256))this.removeEntity(id);
  };
  const entityAt=P.entityAt,view=P.entityView,properties=P.setEntityProperties,restore=P.restore;
  P.entityAt=function(point){this.ensureEntities();return [...this.entities.values()].reverse().find(e=>e.type==='primed_tnt'&&B.intersects(B.aabb(e),[point[0]-.02,point[1]-.02,point[2]-.02,point[0]+.02,point[1]+.02,point[2]+.02]))||entityAt.call(this,point);};
  P.entityView=function(id){const v=view.call(this,id),e=this.entities.get(id);if(e.type==='primed_tnt'||e.type==='tnt_minecart'){
    const fields=v.sourceFields,source=v.sourceAt;v.sourceFields=()=>[...fields(),{key:'fuse',label:'引信剩余（gt）',min:e.type==='primed_tnt'?0:-1,max:32767},{key:'explosionPower',label:'爆炸强度',min:0,max:128,step:.1},...[0,1,2].filter(a=>this.plane!=='side'||a!==2).map(a=>({key:'velocity'+a,label:['X 速度','Y 速度','Z 速度'][a]+'（格/gt）',min:-32,max:32,step:.01}))];
    v.sourceAt=()=>({...source(),fuse:e.fuse,explosionPower:e.explosionPower??4,...Object.fromEntries(e.velocity.map((n,a)=>['velocity'+a,n]))});
   }return v;
  };
  P.setEntityProperties=function(id,values){const e=this.entities.get(id);if(!e)throw Error('实体不存在');
   for(const field of ['fuse','explosionPower','velocity0','velocity1','velocity2'])if(field in values&&(!Number.isFinite(values[field])||(field==='fuse'? !Number.isInteger(values[field])||values[field]<(e.type==='primed_tnt'?0:-1)||values[field]>32767:field==='explosionPower'?values[field]<0||values[field]>128:Math.abs(values[field])>32)))throw Error('TNT 参数无效');
   properties.call(this,id,values);if('fuse'in values)e.fuse=values.fuse;if('explosionPower'in values)e.explosionPower=values.explosionPower;for(let a=0;a<3;a++)if('velocity'+a in values)e.velocity[a]=this.plane==='side'&&a===2?0:values['velocity'+a];
  };
  P.restore=function(data){if(data.entities){if(!Array.isArray(data.entities.items))throw Error('实体存档无效');for(const entry of data.entities.items){if(!Array.isArray(entry)||entry.length!==2||!entry[1])throw Error('实体存档无效');const e=entry[1];
    if(e.type==='primed_tnt'&&(!Number.isInteger(e.fuse)||e.fuse< -1||e.fuse>32767)||e.explosionPower!==undefined&&(!Number.isFinite(e.explosionPower)||e.explosionPower<0||e.explosionPower>128)||e.randomState!==undefined&&(!/^\d{1,15}$/.test(e.randomState)||BigInt(e.randomState)>=(1n<<48n)))throw Error('TNT 存档无效');
    for(const field of ['width','height'])if(e[field]!==undefined&&(!Number.isFinite(e[field])||e[field]<=0||e[field]>16))throw Error('实体尺寸无效');
    for(const field of ['eyeHeight','health','fallDistance','explosionKnockbackResistance','explosionSpeedFactor'])if(e[field]!==undefined&&!Number.isFinite(e[field]))throw Error('实体物理数据无效');
   }}
   restore.call(this,data);for(const e of this.entities.values()){if(e.type==='primed_tnt'){e.width=F(.98);e.height=F(.98);e.eyeHeight=F(.15);e.explosionPower??=4;if(e.fuse===-1)e.fuse=80;}if(this.plane==='side')e.velocity[2]=0;}
  };
  P.resumeSimulationBudget=function(){if(this.halted&&this.steps>100000){this.steps=0;this.halted=false;this.record('继续执行预算');return true;}return false;};
  P.runSimulationSlice=function(milliseconds=8){if(this.halted)return false;const now=()=>globalThis.performance?.now?.()??Date.now(),start=now();
   if(this.phase==='AT'&&!this.tasks.length)this.stepEvent();
   while(!this.halted&&(this.tasks.length||this.phase!=='AT')&&now()-start<milliseconds)this.stepEvent();
   return !this.halted&&this.phase==='AT'&&!this.tasks.length;
  };
 }
 if(typeof module!=='undefined')module.exports=install;else root.BoardTnt=install;
})(typeof window!=='undefined'?window:globalThis);
