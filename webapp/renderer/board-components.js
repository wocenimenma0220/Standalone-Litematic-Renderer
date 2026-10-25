'use strict';
/** 参考 Java 26.3 比较器、漏斗、按钮和压力板规则；压力接触可由界面输入。 */
(function(root){
  const B=typeof module!=='undefined'?require('./board-timing.js'):root.BoardTiming;
  const {TimingWorld,DIR,OPP,NC,diode}=B,P=TimingWorld.prototype;
  const key=p=>p.join(','),copy=x=>JSON.parse(JSON.stringify(x)),at=(p,d,n=1)=>p.map((v,i)=>v+DIR[d][i]*n);
  const button=id=>id?.endsWith('_button'),plate=id=>id?.endsWith('_pressure_plate');
  const furnace=id=>['furnace','blast_furnace','smoker'].includes(id),chest=id=>id==='chest'||id==='trapped_chest'||id?.endsWith('copper_chest');
  const size=id=>id==='hopper'?5:chest(id)||id==='barrel'||id==='ender_chest'||id?.endsWith('shulker_box')?27:['dispenser','dropper','crafter'].includes(id)?9:furnace(id)||id?.endsWith('_shelf')?3:id==='brewing_stand'?5:id==='chiseled_bookshelf'?6:['lectern','jukebox','decorated_pot','item_frame','glow_item_frame'].includes(id)?1:0;
  const clockwise={north:'east',east:'south',south:'west',west:'north'};
  const maxStack=id=>/(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots|shulker_box|boat|raft|minecart)$/.test(id)||['bow','crossbow','shield','elytra','potion','splash_potion','lingering_potion','water_bucket','lava_bucket'].includes(id)?1:/(sign|banner)$/.test(id)||['snowball','ender_pearl','egg','bucket','honey_bottle','armor_stand'].includes(id)?16:64;
  const fuel=id=>['coal','charcoal','coal_block','blaze_rod','lava_bucket','bamboo','stick','dried_kelp_block','scaffolding'].includes(id)||/(planks|log|wood|stem|hyphae|sapling|slab|stairs|fence|fence_gate|boat|chest_boat|sign|hanging_sign|button|pressure_plate|wool|carpet)$/.test(id)&&!id.startsWith('crimson')&&!id.startsWith('warped')&&!id.startsWith('stone');
  Object.assign(B,{containerSize:size,isButton:button,isPlate:plate,maxStack,EXTRA_TASKS:['TE实体','比较器刷新','漏斗输出','漏斗吸入','漏斗结束','音符盒演奏请求']});
  const original={};for(const name of ['own','neighbor','tickBlock','execute','write','stepEvent','snapshot','restore','input'])original[name]=P[name];
  P.ensureComponents=function(){if(this.containers)return;this.containers=new Map();this.outputs=new Map();this.contacts=new Map();this.entityToken=0;for(const [k,s]of this.cells)if(this.inPlane(k.split(',').map(Number))&&size(s.id))this.containerAt(k.split(',').map(Number));};
  P.addTicker=function(p,kind){const k=key(p);const entity={pos:[...p],kind,token:++this.entityToken};this.tickers.push(entity);return entity.token;};
  P.containerAt=function(p){this.ensureComponents();const s=this.get(p);if(!s||!size(s.id))return null;let c=this.containers.get(key(p));if(!c||c.type!==s.id){c={type:s.id,slots:Array(size(s.id)).fill(null),cooldown:-1,lastTick:-1,token:0};this.containers.set(key(p),c);if(s.id==='hopper')c.token=this.addTicker(p,'hopper');}return c;};
  P.inventoryRefs=function(p){const c=this.containerAt(p);if(!c)return [];const s=this.get(p),list=[{pos:p,container:c}];
    if(chest(s.id)&&['left','right'].includes(s.states.type)){
      const d=s.states.type==='left'?clockwise[s.states.facing]:OPP[clockwise[s.states.facing]],q=at(p,d),other=this.get(q);
      if(other?.id===s.id&&other.states.facing===s.states.facing&&other.states.type===(s.states.type==='left'?'right':'left')){const pair={pos:q,container:this.containerAt(q)};if(s.states.type==='right')list.push(pair);else list.unshift(pair);}
    }return list.flatMap(({pos,container})=>container.slots.map((_,index)=>({pos,container,index})));
  };
  P.analog=function(p){const s=this.get(p);if(!s)return null;if(s.id.endsWith('copper_bulb'))return s.states.lit==='true'?15:0;
    const refs=this.inventoryRefs(p);if(refs.length){if(s.id==='crafter')return refs.filter(r=>r.container.slots[r.index]||r.container.disabled?.includes(r.index)).length;let sum=0,filled=false;for(const r of refs){const item=r.container.slots[r.index];if(item){sum=Math.fround(sum+Math.fround(item.count/item.max));filled=true;}}return Math.floor(Math.fround(Math.fround(sum/refs.length)*14))+(filled?1:0);}return null;};
  P.sideSignal=function(p,s){const sides=['north','south'].includes(s.states.facing)?['west','east']:['north','south'];return Math.max(...sides.map(d=>{const q=at(p,d),c=this.get(q);if(c?.id==='redstone_block')return 15;if(c?.id==='redstone_wire')return Number(c.states.power);return this.own(q,d,true);}));};
  P.comparatorInput=function(p,s){const q=at(p,s.states.facing),target=this.get(q);let value=Math.max(this.signal(q,s.states.facing),target?.id==='redstone_wire'?Number(target.states.power):0),analog=this.analog(q);if(analog!==null)return analog;if(value<15&&this.isConductor(q)){analog=this.analog(at(q,s.states.facing));if(analog!==null)value=analog;}return value;};
  P.comparatorValue=function(p,s){const input=this.comparatorInput(p,s),side=this.sideSignal(p,s);return input===0||side>input?0:s.states.mode==='subtract'?input-side:input;};
  P.comparatorOn=function(p,s){const input=this.comparatorInput(p,s),side=this.sideSignal(p,s);return input>0&&(input>side||input===side&&s.states.mode==='compare');};
  P.prioritize=function(p,s){const out=OPP[s.states.facing],next=this.get(at(p,out));return diode(next?.id)&&next.states.facing!==out;};
  P.checkComparator=function(p,s){this.ensureComponents();if(!this.support(p)){this.set(p,null);return;}if(!this.willTick(p,s.id)&&(this.comparatorValue(p,s)!==(this.outputs.get(key(p))||0)||(s.states.powered==='true')!==this.comparatorOn(p,s)))this.schedule(p,s.id,2,this.prioritize(p,s)?-1:0);};
  P.refreshComparator=function(p){const s=this.get(p);if(s?.id!=='comparator')return;this.ensureComponents();const value=this.comparatorValue(p,s),old=this.outputs.get(key(p))||0;this.outputs.set(key(p),value);this.record('比较器输出',{pos:p,before:old,after:value});
    if(value!==old||s.states.mode==='compare'){const powered=String(this.comparatorOn(p,s));this.push([...(s.states.powered!==powered?[{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,powered}},flags:2}]:[]),...this.outputTasks(p,s)]);}
  };
  B.CUD_ORDER=['north','east','south','west'];
  P.comparatorUpdates=function(p){const tasks=[];for(const d of B.CUD_ORDER){let q=at(p,d),s=this.get(q);if(this.isConductor(q)){q=at(q,d);s=this.get(q);}if(s?.id==='comparator')tasks.push({kind:'NC',pos:q,source:p,direction:OPP[d],block:this.get(p)?.id||'air'});}this.push(tasks);};
  P.input=function(p,s){return s.id==='comparator'?this.comparatorInput(p,s)>0:original.input.call(this,p,s);};
  P.own=function(p,d,direct=false){const s=this.get(p);if(s?.id==='comparator'){this.ensureComponents();return s.states.powered==='true'&&s.states.facing===d?(this.outputs.get(key(p))||0):0;}
    if(button(s?.id))return s.states.powered==='true'&&(!direct||this.connected(s)===d)?15:0;
    if(plate(s?.id)){const power='power'in s.states?Number(s.states.power):s.states.powered==='true'?15:0;return !direct||d==='up'?power:0;}
    return original.own.call(this,p,d,direct);
  };
  P.neighbor=function(t){const s=this.get(t.pos);if(!s)return;
    if(s.id==='note_block'&&t.kind==='NC'){const powered=this.powered(t.pos);if(powered!==(s.states.powered==='true')){if(powered)this.requestNote(t.pos);this.change(t.pos,s,{powered:String(powered)},3);}return;}
    if(s.id==='comparator'){if(t.kind==='NC')this.checkComparator(t.pos,s);else if(t.direction==='down'&&!this.support(t.pos))this.set(t.pos,null);return;}
    if(s.id==='hopper'&&t.kind==='NC'){const enabled=String(!this.powered(t.pos));if(enabled!==s.states.enabled)this.change(t.pos,s,{enabled},2);return;}
    if(t.kind==='PP'&&(s.id==='lever'||button(s.id)||plate(s.id))){const attached=button(s.id)||s.id==='lever'?OPP[this.connected(s)]:'down';if(t.direction===attached&&!this.canAttach(t.pos,s))this.set(t.pos,null);return;}
    return original.neighbor.call(this,t);
  };
  P.inputUpdates=function(p,s){return [...this.nc(p,undefined,s.id),...this.nc(at(p,button(s.id)||s.id==='lever'?OPP[this.connected(s)]:'down'),undefined,s.id)];};
  P.pressButton=function(p){const s=this.get(p);if(!button(s?.id)||s.states.powered==='true'||!this.canAttach(p,s))return false;const delay=['stone_button','polished_blackstone_button'].includes(s.id)?20:30;this.parent=this.record('按钮按下',{pos:p,delay});this.push([{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,powered:'true'}},flags:3},...this.inputUpdates(p,s),{kind:'schedule',pos:p,type:s.id,delay}]);return true;};
  P.setContact=function(p,count,kind='living'){const s=this.get(p);if(!plate(s?.id))return false;if(!Number.isSafeInteger(count)||count<0||count>10000||!['living','item'].includes(kind))throw new Error('踩压数量无效');this.ensureComponents();this.contacts.set(key(p),{count,kind});this.record('模拟踩压',{pos:p,count,contactKind:kind});const power='power'in s.states?Number(s.states.power):s.states.powered==='true'?15:0;if(!power)this.checkPlate(p);return true;};
  P.checkPlate=function(p){const s=this.get(p);if(!plate(s?.id))return;this.ensureComponents();const c=this.contacts.get(key(p))||{count:0,kind:'living'},weighted='power'in s.states,max=s.id==='heavy_weighted_pressure_plate'?150:15;
    const count=['stone_pressure_plate','polished_blackstone_pressure_plate'].includes(s.id)&&c.kind!=='living'?0:c.count;
    const value=weighted?Math.ceil(Math.min(count,max)/max*15):count>0?15:0,old=weighted?Number(s.states.power):s.states.powered==='true'?15:0;
    const tasks=[];if(value!==old)tasks.push({kind:'set',pos:p,cell:{id:s.id,states:{...s.states,...(weighted?{power:String(value)}:{powered:String(value>0)})}},flags:2},...this.inputUpdates(p,s));if(value>0)tasks.push({kind:'schedule',pos:p,type:s.id,delay:weighted?10:20});this.push(tasks);
  };
  P.interactAt=function(p){if(this.tasks.length||this.phase!=='AT'||this.halted)throw new Error('请先推进到本刻结束');this.steps=0;const s=this.get(p);if(!s)return false;if(s.id==='lever')return this.toggle(p);if(button(s.id))return this.pressButton(p);if(plate(s.id)){this.ensureComponents();return this.setContact(p,(this.contacts.get(key(p))?.count||0)>0?0:1);}
    if(s.id==='note_block'){this.parent=this.record('音符盒调音',{pos:p,note:(Number(s.states.note||0)+1)%25});this.push([{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,note:String((Number(s.states.note||0)+1)%25)}},flags:3},{kind:'音符盒演奏请求',pos:p}]);return true;}
    if(s.id==='comparator'){this.parent=this.record('切换比较器模式',{pos:p});this.push([{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,mode:s.states.mode==='compare'?'subtract':'compare'}},flags:2},{kind:'比较器刷新',pos:p}]);return true;}if(s.id==='repeater'){this.parent=this.record('切换中继器挡位',{pos:p});this.change(p,s,{delay:String(Number(s.states.delay)%4+1)},3);return true;}return false;
  };
  P.tickBlock=function(t){const s=this.get(t.pos);if(s?.id===t.type){if(s.id==='comparator'){this.refreshComparator(t.pos);return;}if(button(s.id)){if(s.states.powered==='true')this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,powered:'false'}},flags:3},...this.inputUpdates(t.pos,s)]);return;}if(plate(s.id)){this.checkPlate(t.pos);return;}}return original.tickBlock.call(this,t);};
  P.write=function(t){this.ensureComponents();const old=this.get(t.pos);original.write.call(this,t);const s=this.get(t.pos);if(old?.id!==s?.id){this.containers.delete(key(t.pos));this.outputs.delete(key(t.pos));this.contacts.delete(key(t.pos));this.tickers=this.tickers.filter(x=>key(x.pos)!==key(t.pos));if(size(s?.id))this.containerAt(t.pos);
      if(size(old?.id))this.push([{kind:'比较器更新',pos:t.pos}]);
      if((button(old?.id)||plate(old?.id))&&(old.states.powered==='true'||Number(old.states.power)>0))this.push(this.inputUpdates(t.pos,old));
    }
  };
  P.setInventorySlots=function(p,changes,disabled){if(this.tasks.length||this.phase!=='AT'||this.halted)throw new Error('请先推进到本刻结束');const refs=this.inventoryRefs(p),seen=new Set(),crafter=this.get(p)?.id==='crafter',container=crafter?this.containerAt(p):null;
    const planned=changes.map(({index,item})=>{const r=refs[index];if(!r||seen.has(index))throw new Error('容器槽位无效');seen.add(index);let normalized=null;if(item&&item.count){const id=String(item.id).replace(/^minecraft:/,'');if(!/^[a-z0-9_]+$/.test(id))throw new Error('物品 ID 无效');const max=item.max??maxStack(id);if(![1,16,64,99].includes(max)||!Number.isInteger(item.count)||item.count<1||item.count>max)throw new Error('物品数量超过堆叠上限');normalized={...copy(item),id,count:item.count,max};}return {r,normalized};});
    if(disabled!==undefined&&(!crafter||!Array.isArray(disabled)||disabled.some(i=>!Number.isInteger(i)||i<0||i>8)||new Set(disabled).size!==disabled.length))throw Error('合成器禁用槽位无效');
    const nextDisabled=crafter?[...(disabled??container.disabled??[])].filter(i=>disabled!==undefined||!planned.some(v=>v.r.index===i&&v.normalized)):null;
    if(nextDisabled?.some(i=>{const change=planned.find(v=>v.r.index===i);return change?change.normalized:container.slots[i];}))throw Error('只能锁定空槽位');
    this.steps=0;const updates=new Map();for(const {r,normalized}of planned){const before=copy(r.container.slots[r.index]);r.container.slots[r.index]=normalized;this.record('容器编辑',{pos:r.pos,slot:r.index,before,after:normalized});const update=updates.get(key(r.pos))||{pos:r.pos,indices:[]};update.indices.push(r.index);updates.set(key(r.pos),update);}if(crafter&&JSON.stringify(container.disabled||[])!==JSON.stringify(nextDisabled)){container.disabled=nextDisabled;this.record('合成器槽位锁定',{pos:p,disabled:nextDisabled});if(!updates.has(key(p)))updates.set(key(p),{pos:p,indices:[]});}for(const {pos,indices} of updates.values())this.inventoryChanged(pos,indices);
  };
  P.inventoryChanged=function(p){this.comparatorUpdates(p);};
  P.setInventorySlot=function(p,index,item){this.setInventorySlots(p,[{index,item}]);};
  P.setCrafterSlotState=function(p,index,enabled){const c=this.containerAt(p);if(c?.type!=='crafter'||!Number.isInteger(index)||index<0||index>8)throw Error('合成器槽位无效');const disabled=new Set(c.disabled||[]);if(enabled)disabled.delete(index);else disabled.add(index);this.setInventorySlots(p,[],[...disabled].sort((a,b)=>a-b));};
  P.slotsFor=function(p,d){const refs=this.inventoryRefs(p),s=this.get(p);if(furnace(s?.id)&&d)return (d==='up'?[0]:d==='down'?[2,1]:[1]).map(i=>refs[i]);if(s?.id==='brewing_stand'&&d)return (d==='up'?[3]:d==='down'?[0,1,2,3]:[0,1,2,4]).map(i=>refs[i]);return refs;};
  P.accepts=function(p,r,item,d){const id=this.get(p)?.id;if(r.container.disabled?.includes(r.index))return false;if(furnace(id))return r.index===0||r.index===1&&fuel(item.id);if(id==='brewing_stand')return r.index===4?item.id==='blaze_powder':r.index<3?!r.container.slots[r.index]&&['potion','splash_potion','lingering_potion','glass_bottle'].includes(item.id):['nether_wart','redstone','glowstone_dust','gunpowder','dragon_breath','fermented_spider_eye','sugar','rabbit_foot','blaze_powder','spider_eye','magma_cream','ghast_tear','phantom_membrane','turtle_helmet','pufferfish','glistering_melon_slice','golden_carrot'].includes(item.id);
    if(id?.endsWith('shulker_box')&&item.id.endsWith('shulker_box'))return false;return true;};
  P.transferOne=function(from,to,direction,pull=false){const source=this.slotsFor(from,pull?'down':null),targets=this.slotsFor(to,pull?null:direction),src=this.containerAt(from),dest=this.containerAt(to);if(!src||!dest)return false;
    for(const r of source){const item=r.container.slots[r.index];if(!item)continue;const sourceType=this.get(from)?.id;if(pull&&furnace(sourceType)&&r.index===1&&!['bucket','water_bucket'].includes(item.id))continue;if(pull&&sourceType==='brewing_stand'&&r.index===3&&item.id!=='glass_bottle')continue;
      for(const target of targets){const current=target.container.slots[target.index];if(!this.accepts(to,target,item,direction)||current&&((B.sameItem?!B.sameItem(current,item):current.id!==item.id||current.max!==item.max)||current.count>=current.max))continue;
        if(current&&current.count>=(this.inventoryLimit?.(to,target.index,item)??item.max))continue;
        const empty=targets.every(x=>!x.container.slots[x.index]);target.container.slots[target.index]=current?{...current,count:current.count+1}:{...item,count:1};r.container.slots[r.index]=item.count===1?null:{...item,count:item.count-1};
        if(this.get(to)?.id==='hopper'&&empty&&dest.cooldown<=8)dest.cooldown=8-(this.get(from)?.id==='hopper'&&dest.lastTick>=src.lastTick?1:0);
        this.record('漏斗传输',{pos:from,target:to,item:item.id,count:1,sourceSlot:r.index,targetSlot:target.index});this.inventoryChanged(from,[r.index]);this.inventoryChanged(to,[target.index]);return true;
      }
    }return false;
  };
  P.tickEntity=function(t){const s=this.get(t.pos),c=this.containerAt(t.pos);if(t.entityKind!=='hopper'||s?.id!=='hopper'||c?.token!==t.token)return;
    c.cooldown--;c.lastTick=this.time;this.record('漏斗冷却',{pos:t.pos,cooldown:c.cooldown,enabled:s.states.enabled});if(c.cooldown>0)return;c.cooldown=0;if(s.states.enabled==='false')return;
    c.movedThisTick=false;this.push(['漏斗输出','漏斗吸入','漏斗结束'].map(kind=>({kind,pos:t.pos,token:t.token})));
  };
  P.requestNote=function(p){const s=this.get(p);if(s?.id==='note_block'&&!this.get(at(p,'up')))this.blockEvent(p,'note_block',0,0);};
  P.execute=function(t){if(t.kind==='音符盒演奏请求'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.requestNote(t.pos);return;}if(['漏斗输出','漏斗吸入','漏斗结束'].includes(t.kind)){const s=this.get(t.pos),c=this.containerAt(t.pos);if(s?.id!=='hopper'||c?.token!==t.token)return;this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});
      if(t.kind==='漏斗输出'&&c.slots.some(Boolean))c.movedThisTick=this.transferOne(t.pos,at(t.pos,s.states.facing),OPP[s.states.facing]);
      if(t.kind==='漏斗吸入'&&c.slots.some(item=>!item||item.count<item.max))c.movedThisTick=this.transferOne(at(t.pos,'up'),t.pos,'down',true)||c.movedThisTick;
      if(t.kind==='漏斗结束'){if(c.movedThisTick)c.cooldown=8;delete c.movedThisTick;}return;
    }if(t.kind==='比较器更新'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.comparatorUpdates(t.pos);return;}if(t.kind==='比较器刷新'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.refreshComparator(t.pos);return;}if(t.kind==='TE实体'){this.parent=this.record('TE方块实体',{pos:t.pos,entityKind:t.entityKind,parent:t.parent});this.tickEntity(t);return;}
    const s=this.get(t.pos);if(t.kind==='placed'&&s?.id==='comparator'){if(this.comparatorInput(t.pos,s)>0)this.schedule(t.pos,s.id,1);return;}
    original.execute.call(this,t);
    if(t.kind==='onPlace'&&s?.id==='hopper')this.neighbor({kind:'NC',pos:t.pos});
  };
  P.stepEvent=function(){this.ensureComponents();if(!this.halted&&!this.tasks.length&&this.phase==='BE'&&this.events[0]?.event.type==='note_block'){if(++this.steps>100000){this.halted=true;this.record('执行预算耗尽');return false;}const {event,parent}=this.events.shift(),s=this.get(event.pos);this.parent=parent;this.record(s?.id==='note_block'?'音符盒演奏':'方块事件失效',{pos:event.pos,note:Number(s?.states.note||0),instrument:s?.states.instrument||'harp',pitch:2**((Number(s?.states.note||0)-12)/12)});return true;}const before=this.phase,result=original.stepEvent.call(this);if(result&&before!==this.phase&&this.phase==='TE'){for(const [k,s]of this.cells)if(s.id==='hopper'&&this.inPlane(k.split(',').map(Number)))this.containerAt(k.split(',').map(Number));this.push(this.tickers.map(t=>({kind:'TE实体',pos:t.pos,entityKind:t.kind,token:t.token})));}return result;};
  P.snapshot=function(){this.ensureComponents();return {...original.snapshot.call(this),components:copy({version:1,containers:[...this.containers],outputs:[...this.outputs],contacts:[...this.contacts],entityToken:this.entityToken})};};
  P.restore=function(data){const extra=data.components;if(extra){if(extra.version!==1||!Array.isArray(extra.containers)||!Array.isArray(extra.outputs)||!Array.isArray(extra.contacts)||extra.containers.length>150000||!Number.isSafeInteger(extra.entityToken)||extra.entityToken<0)throw new Error('容器时序存档无效');
      for(const [k,c]of extra.containers){if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!size(c?.type)||!Array.isArray(c.slots)||c.slots.length!==size(c.type)||!Number.isSafeInteger(c.cooldown)||!Number.isSafeInteger(c.lastTick)||!Number.isSafeInteger(c.token))throw new Error('容器数据无效');for(const item of c.slots)if(item&&(!/^[a-z0-9_]+$/.test(item.id)||!Number.isInteger(item.max)||item.max<1||item.max>99||!Number.isInteger(item.count)||item.count<1||item.count>item.max))throw new Error('容器物品无效');if(c.disabled!==undefined&&(c.type!=='crafter'||!Array.isArray(c.disabled)||new Set(c.disabled).size!==c.disabled.length||c.disabled.some(i=>!Number.isInteger(i)||i<0||i>8||c.slots[i])))throw Error('合成器禁用槽位无效');}
      for(const [k,v]of extra.outputs)if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!Number.isInteger(v)||v<0||v>15)throw new Error('比较器数据无效');
      for(const [k,v]of extra.contacts)if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!Number.isInteger(v.count)||v.count<0||v.count>10000||!['living','item'].includes(v.kind))throw new Error('压力板数据无效');
    }
    original.restore.call(this,data);if(extra){this.containers=new Map(copy(extra.containers));this.outputs=new Map(copy(extra.outputs));this.contacts=new Map(copy(extra.contacts));this.entityToken=extra.entityToken;}else{this.containers=null;this.ensureComponents();}
  };
  B.SUPPORTED.push('comparator','hopper','*_button','*_pressure_plate','note_block');
  if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
