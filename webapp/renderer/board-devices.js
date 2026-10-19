'use strict';
/* Java 26.3 RedstoneTorchBlock/RedstoneWallTorchBlock, DispenserBlock,
 * DropperBlock and DispenserBlockEntity.getRandomSlot. */
(function(root){
  const B=typeof module!=='undefined'?require('./board-analog.js'):root.BoardTiming;
  const {TimingWorld,DIR,OPP}=B,P=TimingWorld.prototype,key=p=>p.join(','),copy=x=>JSON.parse(JSON.stringify(x));
  const at=(p,d)=>p.map((v,i)=>v+DIR[d][i]),V=['down','up','north','south','west','east'];
  const torch=id=>['redstone_torch','redstone_wall_torch'].includes(id),dispenser=id=>['dispenser','dropper'].includes(id);
  Object.assign(B,{isTorch:torch,isDispenser:dispenser});B.EXTRA_TASKS.push('发射执行','投掷完成');
  const old={};for(const n of ['own','neighbor','tickBlock','write','execute','snapshot','restore'])old[n]=P[n];
  P.ensureDevices=function(){if(!this.torchToggles)this.torchToggles=[];if(!this.deviceOutputs)this.deviceOutputs=[];if(!this.deviceRandom)this.deviceRandom=String((263n^0x5deece66dn)&((1n<<48n)-1n));};
  P.deviceNext=function(bits){this.ensureDevices();const seed=(BigInt(this.deviceRandom)*0x5deece66dn+11n)&((1n<<48n)-1n);this.deviceRandom=String(seed);return Number(seed>>BigInt(48-bits));};
  P.deviceNextInt=function(bound){if((bound&-bound)===bound)return Math.floor(bound*this.deviceNext(31)/2147483648);let bits,value;do{bits=this.deviceNext(31);value=bits%bound;}while((bits-value+(bound-1))>=2147483648);return value;};
  P.randomDispenseSlot=function(c){let slot=-1,odds=1;for(let i=0;i<c.slots.length;i++)if(c.slots[i]&&this.deviceNextInt(odds++)===0)slot=i;return slot;};
  P.torchInput=function(p,s){const d=s.id==='redstone_wall_torch'?OPP[s.states.facing]:'down';return this.signal(at(p,d),d)>0;};
  P.torchNotifications=function(p){return V.flatMap(d=>this.nc(at(p,d),undefined,this.get(p)?.id||'redstone_torch'));};
  P.own=function(p,d,direct=false){const s=this.get(p);if(torch(s?.id))return s.states.lit!=='false'&&(!direct||d==='down')&&d!==(s.id==='redstone_wall_torch'?s.states.facing:'up')?15:0;return old.own.call(this,p,d,direct);};
  P.neighbor=function(t){const s=this.get(t.pos);if(torch(s?.id)){
      if(t.kind==='PP'){const attached=s.id==='redstone_wall_torch'?OPP[s.states.facing]:'down';if(t.direction===attached&&!this.canAttach(t.pos,s))this.set(t.pos,null);}
      else if((s.states.lit!=='false')===this.torchInput(t.pos,s)&&!this.willTick(t.pos,s.id))this.schedule(t.pos,s.id,2);return;
    }
    if(dispenser(s?.id)&&t.kind==='NC'){const powered=this.powered(t.pos)||this.powered(at(t.pos,'up'));this.record('发射器准连接检查',{pos:t.pos,powered,triggered:s.states.triggered==='true'});if(powered&&s.states.triggered!=='true'){this.schedule(t.pos,s.id,4);this.change(t.pos,s,{triggered:'true'},2);}else if(!powered&&s.states.triggered==='true')this.change(t.pos,s,{triggered:'false'},2);return;}
    return old.neighbor.call(this,t);
  };
  P.tickBlock=function(t){const s=this.get(t.pos);if(s?.id!==t.type)return old.tickBlock.call(this,t);if(torch(s.id)){
      this.ensureDevices();this.torchToggles=this.torchToggles.filter(e=>this.time-e.when<=60);const input=this.torchInput(t.pos,s),count=()=>this.torchToggles.filter(e=>key(e.pos)===key(t.pos)).length;
      if(s.states.lit!=='false'&&input){this.torchToggles.push({pos:[...t.pos],when:this.time});this.change(t.pos,s,{lit:'false'},3);if(count()>=8){this.record('红石火把烧毁',{pos:t.pos,restart:this.time+160});this.schedule(t.pos,s.id,160);}}
      else if(s.states.lit==='false'&&!input&&count()<8)this.change(t.pos,s,{lit:'true'},3);return;
    }
    if(dispenser(s.id)){this.push([{kind:'发射执行',pos:t.pos}]);return;}return old.tickBlock.call(this,t);
  };
  P.write=function(t){const before=this.get(t.pos),serial=this.serial;old.write.call(this,t);if(this.serial===serial)return;const s=this.get(t.pos);if(torch(s?.id)&&before?.id===s.id)this.push(this.torchNotifications(t.pos));if(torch(before?.id)&&before.id!==s?.id&&!(t.flags&64)&&(t.flags&1))this.push(this.torchNotifications(t.pos));};
  P.emitDispensed=function(p,s,item,kind='item'){this.ensureDevices();const output={id:this.serial+1,gt:this.time,pos:at(p,s.states.facing),source:[...p],direction:s.states.facing,kind,item:{...item,count:1}};const {kind:entityKind,...data}=output;this.record(kind==='projectile'?'发射弹射物':kind==='primed_tnt'?'发射点燃TNT':'投出物品',{...data,entityKind});this.deviceOutputs.push(output);if(this.deviceOutputs.length>1000)this.deviceOutputs.shift();};
  P.insertDispensed=function(from,to,item,direction){const targets=this.slotsFor(to,direction),dest=this.containerAt(to);if(!dest)return false;for(const r of targets){const target=r.container.slots[r.index];if(!this.accepts(to,r,item,direction)||target&&((B.sameItem?!B.sameItem(target,item):target.id!==item.id||target.max!==item.max))|| (target?.count||0)>=this.inventoryLimit(to,r.index,item))continue;
      const empty=targets.every(r=>!r.container.slots[r.index]);r.container.slots[r.index]={...item,count:(target?.count||0)+1};if(dest.type==='hopper'&&empty&&dest.cooldown<=8)dest.cooldown=8;this.record('投掷器传输',{pos:from,target:to,item:item.id,slot:r.index});this.inventoryChanged(to,[r.index]);return true;}return false;
  };
  P.dispense=function(p){const s=this.get(p);if(!dispenser(s?.id))return;const c=this.containerAt(p),slot=this.randomDispenseSlot(c);if(slot<0){this.record('发射器空响',{pos:p,type:s.id});return;}const item={...c.slots[slot]},q=at(p,s.states.facing),target=this.get(q);let consume=true,remainder=null;
    const special=s.id==='dispenser'&&this.dispenseSpecial?.(p,s,item,slot);if(special){consume=special.consume;remainder=special.remainder||null;}else if(s.id==='dropper'&&(B.containerSize(target?.id)||this.entityContainerAt?.(q))&&!['ender_chest','lectern','item_frame','glow_item_frame'].includes(target?.id)){consume=this.insertDispensed(p,q,item,OPP[s.states.facing]);}
    else if(s.id==='dispenser'){
      const filled=['water_bucket','lava_bucket','powder_snow_bucket'].includes(item.id),fluid={water_bucket:'water',lava_bucket:'lava',powder_snow_bucket:'powder_snow'}[item.id];
      if(filled&&(!target||target.id===fluid||target.states.waterlogged==='false'&&fluid==='water')){if(target?.states.waterlogged==='false'&&fluid==='water')this.change(q,target,{waterlogged:'true'},3);else this.set(q,{id:fluid,states:fluid==='powder_snow'?{}:{level:'0'}},3);remainder={id:'bucket',max:16,count:1};this.record('发射器倒桶',{pos:p,target:q,fluid});}
      else if(item.id==='bucket'&&(target?.id==='water'&&target.states.level==='0'||target?.id==='lava'&&target.states.level==='0'||target?.id==='powder_snow'||target?.states.waterlogged==='true')){const id=target.states.waterlogged==='true'?'water_bucket':target.id+'_bucket';if(target.states.waterlogged==='true')this.change(q,target,{waterlogged:'false'},3);else this.set(q,null);remainder={id,max:1,count:1};this.record('发射器收桶',{pos:p,target:q,item:id});}
      else if(item.id==='flint_and_steel'){consume=false;if(target?.id==='tnt'){this.set(q,null);this.emitDispensed(p,s,{id:'tnt',max:64},'primed_tnt');}else if(target&&target.states.lit==='false'&&target.states.waterlogged!=='true'&&(['campfire','soul_campfire','candle'].includes(target.id)||target.id.endsWith('_candle')||target.id.endsWith('candle_cake')))this.change(q,target,{lit:'true'},3);else if(!target&&this.support(q,'CENTER'))this.set(q,{id:'fire',states:{age:'0',north:'false',south:'false',east:'false',west:'false',up:'false'}},3);this.record('发射器使用打火石',{pos:p,target:q});}
      else if(item.id==='shears'){consume=false;if(['beehive','bee_nest'].includes(target?.id)&&Number(target.states.honey_level)>=5){this.change(q,target,{honey_level:'0'},3);for(let i=0;i<3;i++)this.emitDispensed(p,s,{id:'honeycomb',max:64});}this.record('发射器使用剪刀',{pos:p,target:q});}
      else if(item.id==='bone_meal'){consume=false;this.record('发射器骨粉无可用目标',{pos:p,target:q});}
      else if(item.id==='tnt')this.emitDispensed(p,s,item,'primed_tnt');
      else this.emitDispensed(p,s,item,['arrow','tipped_arrow','spectral_arrow','egg','blue_egg','brown_egg','snowball','experience_bottle','splash_potion','lingering_potion','firework_rocket','fire_charge','wind_charge'].includes(item.id)?'projectile':'item');
    }else this.emitDispensed(p,s,item);
    // Container.setItem calls setChanged even when a full target rejected the item.
    if(consume){c.slots[slot]=item.count>1?{...item,count:item.count-1}:remainder;if(remainder&&item.count>1){let left=true;for(let i=0;i<c.slots.length&&left;i++){const r=c.slots[i];if(!r||r.id===remainder.id&&r.count<r.max){c.slots[i]={...remainder,count:(r?.count||0)+1};left=false;}}if(left)this.emitDispensed(p,s,remainder);}}
    this.push([{kind:'投掷完成',pos:p,slot}]);
  };
  P.execute=function(t){if(t.kind==='发射执行'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.dispense(t.pos);return;}if(t.kind==='投掷完成'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.inventoryChanged(t.pos,[t.slot]);return;}old.execute.call(this,t);if(t.kind==='onPlace'&&torch(this.get(t.pos)?.id))this.push(this.torchNotifications(t.pos));};
  P.snapshot=function(){this.ensureDevices();return {...old.snapshot.call(this),devices:copy({version:1,toggles:this.torchToggles,outputs:this.deviceOutputs,random:this.deviceRandom})};};
  P.restore=function(data){const d=data.devices;if(d&&(d.version!==1||!Array.isArray(d.toggles)||!Array.isArray(d.outputs)||d.outputs.length>1000||!/^\d{1,15}$/.test(d.random)||BigInt(d.random)>=(1n<<48n)))throw Error('火把和发射器存档无效');if(d)for(const e of [...d.toggles,...d.outputs])if(!Array.isArray(e.pos)||e.pos.length!==3||!e.pos.every(Number.isSafeInteger))throw Error('发射器坐标无效');old.restore.call(this,data);this.torchToggles=copy(d?.toggles||[]);this.deviceOutputs=copy(d?.outputs||[]);this.deviceRandom=d?.random||null;this.ensureDevices();};
  B.SUPPORTED.push('redstone_torch','redstone_wall_torch','dispenser','dropper');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
