'use strict';
/* Java 26.3 ComparatorBlock, Level.updateNeighbourForOutputSignal, and the
 * individual blocks' getAnalogOutputSignal. No polling: NC/CUD causes checks. */
(function(root){
  const B=typeof module!=='undefined'?require('./board-wire.js'):root.BoardTiming;
  const {TimingWorld,DIR,OPP}=B,P=TimingWorld.prototype,key=p=>p.join(','),copy=x=>JSON.parse(JSON.stringify(x));
  const at=(p,d)=>p.map((v,i)=>v+DIR[d][i]),frame=id=>['item_frame','glow_item_frame'].includes(id);
  const songs={11:[11,71],13:[1,178],5:[15,178],blocks:[3,345],bounce:[8,234],cat:[2,185],chirp:[4,185],creator_music_box:[11,73],creator:[12,176],far:[5,174],lava_chicken:[9,134],mall:[6,197],mellohi:[7,96],otherside:[14,195],pigstep:[13,149],precipice:[13,299],relic:[14,218],stal:[8,150],strad:[9,188],tears:[10,175],wait:[12,238],ward:[10,251]};
  // Values and lengths from data/minecraft/jukebox_song/*.json in the 26.3 jar.
  B.jukeboxSongs=Object.fromEntries(Object.entries(songs).map(([id,[signal,seconds]])=>['music_disc_'+id,{signal,ticks:seconds*20+20}]));
  B.extraItems=[['book','书'],['writable_book','书与笔'],['written_book','成书'],['enchanted_book','附魔书'],['arrow','箭'],['snowball','雪球'],['egg','鸡蛋'],['bucket','铁桶'],['water_bucket','水桶'],['lava_bucket','岩浆桶'],['flint_and_steel','打火石'],['shears','剪刀'],['bone_meal','骨粉'],...Object.keys(B.jukeboxSongs).map(id=>[id,'音乐唱片 '+id.slice(11)])].map(([id,name])=>({id,name,categories:[]}));
  const old={};for(const n of ['analog','containerAt','inventoryRefs','inventoryChanged','accepts','slotsFor','own','execute','write','tickBlock','snapshot','restore','maxStack'])old[n]=P[n];
  const maxStack=B.maxStack;B.maxStack=id=>id==='written_book'?16:id.startsWith('music_disc_')||['writable_book','enchanted_book','flint_and_steel','shears'].includes(id)?1:maxStack(id);
  P.ensureAnalog=function(){this.ensureComponents();if(!this.sourceData)this.sourceData=new Map();if(!this.enderSlots){this.enderSlots=Array(27).fill(null);for(const c of this.containers.values())if(c.type==='ender_chest'){this.enderSlots=c.slots;break;}}};
  P.containerAt=function(p){const c=old.containerAt.call(this,p);if(c?.type==='ender_chest'){this.ensureAnalog();c.slots=this.enderSlots;}return c;};
  P.sourceAt=function(p){this.ensureAnalog();return this.sourceData.get(key(p))||{};};
  P.sourceFields=function(p){const id=this.get(p)?.id;
    if(id==='lectern')return [{key:'pages',label:'总页数',min:1,max:100},{key:'page',label:'当前页（从 1 开始）',min:1,max:100}];
    if(frame(id))return [{key:'rotation',label:'物品旋转',min:0,max:7},{key:'facing',label:'朝向',options:['north','south','east','west','up','down']}];
    if(id==='detector_rail')return [{key:'cart',label:'模拟矿车在轨道上',type:'checkbox'},{key:'cartSignal',label:'矿车容器信号',min:0,max:15}];
    if(['sculk_sensor','calibrated_sculk_sensor'].includes(id))return [{key:'frequency',label:'上次振动频率（激活时读取）',min:0,max:15}];
    if(id==='creaking_heart')return [{key:'linked',label:'存在绑定的嘎枝',type:'checkbox'},{key:'distance',label:'与嘎枝的距离',min:0,max:32}];
    if(['command_block','chain_command_block','repeating_command_block'].includes(id))return [{key:'successCount',label:'命令成功次数（模拟输入）',min:0,max:15}];return [];
  };
  P.setSourceData=function(p,values){if(this.tasks.length||this.phase!=='AT'||this.halted)throw Error('请先推进到本刻结束');this.ensureAnalog();const data={...(this.sourceSettingsAt?.(p)||this.sourceAt(p))};
    for(const f of this.sourceFields(p)){if(!(f.key in values))continue;let v=values[f.key];if(f.type==='checkbox'){if(typeof v!=='boolean')throw Error('信号源设置无效');}else if(f.options){if(!f.options.includes(v))throw Error('朝向无效');}else if(!Number.isInteger(v)||v<f.min||v>f.max)throw Error(f.label+'超出范围');data[f.key]=v;}
    if(this.get(p)?.id==='lectern'){data.pages=data.pages||1;data.page=Math.min(data.page||1,data.pages);}
    const previous=this.sourceAt(p);this.steps=0;this.parent=this.record('信号源设置',{pos:p,before:previous,after:data});this.sourceData.set(key(p),data);
    if(this.get(p)?.id==='lectern'&&this.get(p).states.has_book==='true'){if((data.page||1)!==(previous.page||1))this.push([{kind:'讲台翻页',pos:p}]);else this.comparatorUpdates(p);}else if(this.get(p)?.id==='detector_rail'){if(this.get(p).states.powered!=='true')this.checkDetector?.(p);}
    else if(frame(this.get(p)?.id))this.comparatorUpdates(p);
    else this.comparatorUpdates(p);
  };
  P.analog=function(p,d){const s=this.get(p);if(!s)return null;const a=this.sourceAt(p),c=B.containerSize(s.id)?this.containerAt(p):null;
    if(s.id==='ender_chest'||frame(s.id))return null;
    if(s.id==='cauldron')return 0;if(s.id==='lava_cauldron')return 3;
    if(['water_cauldron','powder_snow_cauldron','composter'].includes(s.id))return Number(s.states.level||0);
    if(['bee_nest','beehive'].includes(s.id))return Number(s.states.honey_level||0);
    if(s.id==='cake')return (7-Number(s.states.bites||0))*2;if(s.id.endsWith('candle_cake'))return 14;
    if(s.id==='end_portal_frame')return s.states.eye==='true'?15:0;
    if(s.id==='respawn_anchor')return Math.floor(Number(s.states.charges||0)/4*15);
    if(s.id.endsWith('copper_golem_statue'))return Math.max(0,['standing','sitting','running','star'].indexOf(s.states.copper_golem_pose||'standing'))+1;
    if(s.id==='chiseled_bookshelf')return (c.lastInteracted??-1)+1;
    if(s.id.endsWith('_shelf'))return d!==undefined&&d!==OPP[s.states.facing]?0:c.slots.reduce((v,item,i)=>v|(item?1<<i:0),0);
    if(s.id==='lectern')return s.states.has_book==='true'?Math.floor(Math.fround(Math.fround((a.pages||1)>1?((a.page||1)-1)/((a.pages||1)-1):1)*14))+1:0;
    if(s.id==='jukebox')return B.jukeboxSongs[c.slots[0]?.id]?.signal||0;
    if(s.id==='detector_rail')return s.states.powered==='true'&&a.cart?(a.cartSignal||0):0;
    if(['sculk_sensor','calibrated_sculk_sensor'].includes(s.id))return s.states.sculk_sensor_phase==='active'?(a.frequency||0):0;
    if(['command_block','chain_command_block','repeating_command_block'].includes(s.id))return a.successCount||0;
    if(s.id==='creaking_heart')return s.states.creaking_heart_state==='uprooted'||!a.linked?0:15-Math.floor(Math.min(32,a.distance||0)/32*15);
    if((s.id==='chest'||s.id==='trapped_chest'||s.id.endsWith('copper_chest'))&&this.inventoryRefs(p).some(r=>this.isConductor(at(r.pos,'up'))))return 0;
    return old.analog.call(this,p,d);
  };
  P.comparatorInput=function(p,s){const d=s.states.facing,q=at(p,d),target=this.get(q);let value=Math.max(this.signal(q,d),target?.id==='redstone_wire'?Number(target.states.power):0),analog=this.analog(q,OPP[d]);
    if(analog!==null)return analog;
    if(value<15&&this.isConductor(q)){const behind=at(q,d),block=this.analog(behind,OPP[d]),f=this.get(behind),a=this.sourceAt(behind),itemFrame=frame(f?.id)&&(a.facing||'north')===d?(this.containerAt(behind).slots[0]?(a.rotation||0)+1:0):null;if(block!==null||itemFrame!==null)value=Math.max(block??-2147483648,itemFrame??-2147483648);}return value;
  };
  P.inventoryLimit=function(p,index,item){const id=this.get(p)?.id;return ['lectern','jukebox','chiseled_bookshelf','item_frame','glow_item_frame'].includes(id)?1:id==='brewing_stand'&&index<3?1:item.max;};
  P.accepts=function(p,r,item,d){const id=this.get(p)?.id;if(id==='ender_chest')return d==null;
    if(id==='lectern')return d==null&&['written_book','writable_book'].includes(item.id);
    if(id==='chiseled_bookshelf')return ['book','written_book','writable_book','enchanted_book','knowledge_book'].includes(item.id);
    if(id==='jukebox')return !!B.jukeboxSongs[item.id];if(frame(id))return d==null;
    return old.accepts.call(this,p,r,item,d);
  };
  P.slotsFor=function(p,d){return ['ender_chest','lectern','item_frame','glow_item_frame'].includes(this.get(p)?.id)&&d!=null?[]:old.slotsFor.call(this,p,d);};
  P.inventoryChanged=function(p,indices=[]){const s=this.get(p),c=this.containerAt(p);if(!s||!c)return;
    if(s.id==='ender_chest')return;
    if(frame(s.id)){this.comparatorUpdates(p);return;}
    if(s.id==='chiseled_bookshelf'){if(indices.length)c.lastInteracted=indices.at(-1);this.push([{kind:'容器状态同步',pos:p}]);return;}
    if(s.id==='lectern'||s.id==='jukebox'||s.id==='brewing_stand')this.push([{kind:'容器状态同步',pos:p}]);
    if(s.id==='jukebox'){const song=B.jukeboxSongs[c.slots[0]?.id];c.songRemaining=song?song.ticks:0;this.push(this.nc(p));}
    this.comparatorUpdates(p);
  };
  const slots=P.setInventorySlots;
  P.setInventorySlots=function(p,changes,disabled){const refs=this.inventoryRefs(p),crafter=this.get(p)?.id==='crafter';for(const {index,item}of changes){const r=refs[index];if(item?.count&&r&&(!crafter&&!this.accepts(p,r,item,null)||item.count>this.inventoryLimit(p,index,{...item,max:item.max??B.maxStack(item.id)})))throw Error('该槽位不能放入此物品或数量');}return slots.call(this,p,changes,disabled);};
  P.own=function(p,d,direct=false){const s=this.get(p);if(s?.id==='lectern')return s.states.powered==='true'&&(!direct||d==='up')?15:0;if(s?.id==='jukebox')return !direct&&(this.containerAt(p).songRemaining||0)>0?15:0;return old.own.call(this,p,d,direct);};
  B.EXTRA_TASKS.push('容器状态同步','讲台翻页');
  P.execute=function(t){if(t.kind==='容器状态同步'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});const s=this.get(t.pos),c=this.containerAt(t.pos);if(!s||!c)return;const values={};if(s.id==='chiseled_bookshelf')for(let i=0;i<6;i++)values['slot_'+i+'_occupied']=String(!!c.slots[i]);if(s.id==='lectern'){values.has_book=String(!!c.slots[0]);values.powered='false';}if(s.id==='jukebox')values.has_record=String(!!c.slots[0]);if(s.id==='brewing_stand')for(let i=0;i<3;i++)values['has_bottle_'+i]=String(!!c.slots[i]);this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,...values}},flags:['chiseled_bookshelf','lectern'].includes(s.id)?3:2},...(s.id==='lectern'?this.nc(at(t.pos,'down'),undefined,s.id):[])]);return;}
    if(t.kind==='讲台翻页'){const s=this.get(t.pos);if(s?.id==='lectern'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,powered:'true'}},flags:3},...this.nc(at(t.pos,'down')),{kind:'schedule',pos:t.pos,type:s.id,delay:2}]);}return;}
    old.execute.call(this,t);
  };
  P.tickBlock=function(t){const s=this.get(t.pos);if(s?.id==='lectern'&&t.type===s.id){this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,powered:'false'}},flags:3},...this.nc(at(t.pos,'down'))]);return;}return old.tickBlock.call(this,t);};
  P.write=function(t){const before=this.get(t.pos);old.write.call(this,t);if(before?.id!==this.get(t.pos)?.id){this.ensureAnalog();this.sourceData.delete(key(t.pos));if(frame(before?.id))this.comparatorUpdates(t.pos);}};
  const tickEntity=P.tickEntity;P.tickEntity=function(t){if(t.entityKind==='jukebox'){const c=this.containerAt(t.pos);if(c?.songRemaining>0&&--c.songRemaining===0){this.record('唱片播放结束',{pos:t.pos});this.push(this.nc(t.pos));this.comparatorUpdates(t.pos);}return;}return tickEntity.call(this,t);};
  const step=P.stepEvent;P.stepEvent=function(){const before=this.phase,result=step.call(this);if(result&&before!==this.phase&&this.phase==='TE')for(const [k,c]of this.containers)if(c.type==='jukebox'&&c.songRemaining>0)this.push([{kind:'TE实体',pos:k.split(',').map(Number),entityKind:'jukebox'}]);return result;};
  P.snapshot=function(){this.ensureAnalog();return {...old.snapshot.call(this),analog:{version:1,sources:copy([...this.sourceData]),enderSlots:copy(this.enderSlots)}};};
  P.restore=function(data){const a=data.analog;if(a&&(a.version!==1||!Array.isArray(a.sources)||a.sources.length>150000||!Array.isArray(a.enderSlots)||a.enderSlots.length!==27))throw Error('信号源存档无效');if(a)for(const [k,v]of a.sources)if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!v||Object.values(v).some(x=>typeof x!=='boolean'&&typeof x!=='string'&&!Number.isFinite(x)))throw Error('信号源数据无效');old.restore.call(this,data);this.sourceData=new Map(copy(a?.sources||[]));this.enderSlots=copy(a?.enderSlots||Array(27).fill(null));for(const c of this.containers.values())if(c.type==='ender_chest')c.slots=this.enderSlots;};
  B.SUPPORTED.push('analog_sources');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
