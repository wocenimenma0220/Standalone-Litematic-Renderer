'use strict';
/** 参考 Java 26.3 的世界阶段、计划刻和邻居更新器，以显式任务支持逐事件推进和中途保存。 */
(function(root) {
  const Support=typeof module!=='undefined'?require('./board-support.js'):root.BoardSupport;
  const DIR={west:[-1,0,0],east:[1,0,0],down:[0,-1,0],up:[0,1,0],north:[0,0,-1],south:[0,0,1]};
  const NC=['west','east','down','up','north','south'], PP=['west','east','north','south','down','up'];
  const OPP={west:'east',east:'west',down:'up',up:'down',north:'south',south:'north'};
  const PHASES=['WTU','TT','CT','BE','EU','TE','AT'];
  const clone=value=>JSON.parse(JSON.stringify(value)), key=p=>p.join(','), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const sameCell=(a,b)=>!a&&!b||!!a&&!!b&&a.id===b.id&&Object.keys(a.states).length===Object.keys(b.states).length&&Object.entries(a.states).every(([k,v])=>b.states[k]===v);
  const offset=(p,d)=>p.map((v,i)=>v+DIR[d][i]);
  const bulb=id=>id?.endsWith('copper_bulb');
  const diode=id=>id==='repeater'||id==='comparator';
  const SUPPORTED=['redstone_block','lever','repeater','observer','redstone_lamp','copper_bulb'];
  class TimingWorld {
    constructor(plane=null){this.plane=plane;this.cells=new Map();this.time=0;this.phase='AT';this.tasks=[];this.scheduled=[];this.selected=[];this.events=[];this.tickers=[];this.trace=[];this.serial=0;this.order=0;this.parent=null;this.halted=false;this.steps=0;this.revision=0;}
    inPlane(p){return this.plane==='side'?p[2]===0:this.plane==='top'?p[1]===0:true;}
    support(p,type='RIGID'){return this.plane==='top'||Support.sturdy(this.get(offset(p,'down')),'up',type);}
    get(p){return this.inPlane(p)?this.cells.get(key(p)):undefined;}
    record(kind,data={}){const row={id:++this.serial,parent:this.parent,gt:this.time,phase:this.phase,kind,...clone(data)};this.trace.push(row);if(this.trace.length>2000)this.trace.splice(0,this.trace.length-2000);this.revision++;return row.id;}
    push(tasks){for(let i=tasks.length-1;i>=0;i--)this.tasks.push({...clone(tasks[i]),parent:this.parent});}
    nc(p,skip,block=this.get(p)?.id||'air'){return NC.filter(d=>d!==skip).map(d=>({kind:'NC',pos:offset(p,d),source:p,direction:OPP[d],block}));}
    pp(p){return PP.map(d=>({kind:'PP',pos:offset(p,d),source:p,direction:OPP[d]}));}
    outputTasks(p,s){const target=offset(p,OPP[s.states.facing]);return [{kind:'NC',pos:target,source:p,block:s.id},...this.nc(target,s.states.facing,s.id)];}
    connected(s){return s.states.face==='floor'?'up':s.states.face==='ceiling'?'down':s.states.facing;}
    canAttach(p,s,get=q=>this.get(q)){const rule=Support.requirement(s);if(!rule)return true;if(this.plane==='top'&&rule.toward==='down')return true;const below=get(offset(p,rule.toward));return !!rule.blocks?.includes(below?.id)||rule.types.some(type=>Support.sturdy(below,OPP[rule.toward],type));}
    isConductor(p){return Support.conductor(this.get(p));}
    own(p,d,direct=false){const s=this.get(p);if(!s)return 0;if(s.id==='redstone_block')return direct?0:15;
      if(s.id==='lever')return s.states.powered==='true'&&(!direct||this.connected(s)===d)?15:0;
      if(s.id==='repeater'||s.id==='observer')return s.states.powered==='true'&&s.states.facing===d?15:0;return 0;}
    signal(p,d){let power=this.own(p,d);if(this.isConductor(p))for(const side of NC)power=Math.max(power,this.own(offset(p,side),side,true));return power;}
    powered(p){return NC.some(d=>this.signal(offset(p,d),d)>0);}
    input(p,s){const d=s.states.facing,q=offset(p,d);return Math.max(this.signal(q,d),this.get(q)?.id==='redstone_wire'?Number(this.get(q).states.power):0)>0;}
    locked(p,s){const sides=['north','south'].includes(s.states.facing)?['west','east']:['north','south'];return sides.some(d=>diode(this.get(offset(p,d))?.id)&&this.own(offset(p,d),d,true)>0);}
    hasScheduled(p,type){return this.scheduled.some(t=>key(t.pos)===key(p)&&t.type===type);}
    willTick(p,type){return this.selected.some(t=>key(t.pos)===key(p)&&t.type===type);}
    schedule(p,type,delay,priority=0){if(this.hasScheduled(p,type)){this.record('计划刻去重',{pos:p,type});return;}
      const tick={pos:[...p],type,triggerTick:this.time+delay,priority,subTickOrder:this.order++,parent:this.parent};this.scheduled.push(tick);this.record('登记计划刻',tick);}
    blockEvent(p,type,action,data=0){const event={pos:[...p],type,action,data};if(this.events.some(e=>same(e.event,event))){this.record('方块事件去重',event);return;}this.events.push({event,parent:this.parent});this.record('登记方块事件',event);}
    set(p,cell,flags=3,placed=false){this.push([{kind:'set',pos:p,cell,flags,placed}]);}
    change(p,s,values,flags=2){this.set(p,{id:s.id,states:{...s.states,...values}},flags);}
    edit(p,cell){if(this.tasks.length||this.phase!=='AT')throw new Error('请先推进到本刻结束，再编辑方块');if(cell&&!this.canAttach(p,cell))throw new Error('该朝向的支撑面不满足附着要求，请检查方向、附着面及支撑方块状态');this.steps=0;this.parent=null;this.record('玩家编辑',{pos:p});this.set(p,cell,3,true);}
    toggle(p){const s=this.get(p);if(s?.id!=='lever')return false;if(this.tasks.length||this.phase!=='AT')throw new Error('请先推进到本刻结束，再操作拉杆');if(!this.canAttach(p,s)){this.record('拉杆附着方向不匹配',{pos:p});return false;}this.parent=this.record('拉杆交互',{pos:p});this.push([{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,powered:String(s.states.powered!=='true')}},flags:3},...this.nc(p),...this.nc(offset(p,OPP[this.connected(s)]),undefined,s.id)]);this.steps=0;return true;}
    write(t){if(!this.inPlane(t.pos)){this.record('面外写入已忽略',{pos:t.pos});return;}const old=this.get(t.pos),s=t.cell;if(sameCell(old,s))return;const before=old?clone(old):null;
      if(s)this.cells.set(key(t.pos),clone(s));else this.cells.delete(key(t.pos));
      this.record('状态变化',{pos:t.pos,before,after:s||null,flags:t.flags});
      const tasks=[];
      if(diode(old?.id)&&old.id!==s?.id)tasks.push(...this.outputTasks(t.pos,old));
      if(old?.id==='lever'&&old.id!==s?.id&&old.states.powered==='true')tasks.push(...this.nc(t.pos),...this.nc(offset(t.pos,OPP[this.connected(old)])));
      if(diode(s?.id))tasks.push(...this.outputTasks(t.pos,s));
      if(s&&old?.id!==s.id)tasks.push({kind:'onPlace',pos:t.pos});
      tasks.push({kind:'afterSet',pos:t.pos,cell:s||null,before,flags:t.flags});
      if(t.placed&&diode(s?.id))tasks.push({kind:'placed',pos:t.pos});
      this.push(tasks);
    }
    neighbor(t){const s=this.get(t.pos);if(!s)return;
      if(t.kind==='PP'){
        if(s.id==='observer'&&s.states.facing===t.direction&&s.states.powered!=='true')this.schedule(t.pos,s.id,2);
        if(s.id==='repeater'){
          if(t.direction==='down'&&!this.support(t.pos)){this.set(t.pos,null);return;}
          const locked=String(this.locked(t.pos,s));if(locked!==s.states.locked)this.change(t.pos,s,{locked},2);
        }return;
      }
      if(s.id==='redstone_lamp'){if(this.powered(t.pos)!==(s.states.lit==='true')){if(s.states.lit==='true')this.schedule(t.pos,s.id,4);else this.change(t.pos,s,{lit:'true'});}}
      if(bulb(s.id)){const on=this.powered(t.pos);if(on!==(s.states.powered==='true'))this.change(t.pos,s,{powered:String(on),lit:on?String(s.states.lit!=='true'):s.states.lit},3);}
      if(s.id==='repeater'&&!this.support(t.pos)){this.push([{kind:'set',pos:t.pos,cell:null,flags:3},...NC.flatMap(d=>this.nc(offset(t.pos,d)))]);return;}
      if(s.id==='repeater'&&!this.locked(t.pos,s)&&this.input(t.pos,s)!==(s.states.powered==='true')&&!this.willTick(t.pos,s.id)){
        const out=OPP[s.states.facing],next=this.get(offset(t.pos,out));const priority=diode(next?.id)&&next.states.facing!==out?-3:s.states.powered==='true'?-2:-1;
        this.schedule(t.pos,s.id,Number(s.states.delay)*2,priority);
      }
    }
    tickBlock(t){const s=this.get(t.pos);if(s?.id!==t.type){this.record('计划刻失效',{pos:t.pos,type:t.type});return;}
      if(s.id==='observer'){const on=s.states.powered!=='true';this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,powered:String(on)}},flags:2},...(on?[{kind:'schedule',pos:t.pos,type:s.id,delay:2}]:[]),...this.outputTasks(t.pos,s)]);}
      if(s.id==='redstone_lamp'&&s.states.lit==='true'&&!this.powered(t.pos))this.change(t.pos,s,{lit:'false'});
      if(s.id==='repeater'&&!this.locked(t.pos,s)){
        const on=s.states.powered==='true',input=this.input(t.pos,s);
        if(on&&!input)this.change(t.pos,s,{powered:'false'});
        else if(!on){this.change(t.pos,s,{powered:'true'});if(!input)this.schedule(t.pos,s.id,Number(s.states.delay)*2,-2);}
      }
    }
    execute(t){this.parent=this.record(t.kind,{...t,parent:t.parent??null});
      if(t.kind==='set')this.write(t);
      else if(t.kind==='afterSet'){
        // onPlace 可能替换当前位置，外层 setBlock 必须重新读取状态。
        if(sameCell(this.get(t.pos),t.cell)){const tasks=[];if(t.flags&1){tasks.push(...this.nc(t.pos,undefined,t.before?.id||'air'));if(t.cell&&this.analog&&this.analog(t.pos)!==null)tasks.push({kind:'比较器更新',pos:t.pos});}if(!(t.flags&16))tasks.push(...(this.indirectTasks?.(t.pos,t.before)||[]),...this.pp(t.pos),...(this.indirectTasks?.(t.pos,t.cell)||[]));this.push(tasks);}
      }
      else if(t.kind==='NC'||t.kind==='PP')this.neighbor(t);
      else if(t.kind==='schedule')this.schedule(t.pos,t.type,t.delay,t.priority);
      else if(t.kind==='TT')this.tickBlock(t);
      else if(t.kind==='onPlace'){
        const s=this.get(t.pos);if(bulb(s?.id))this.neighbor({kind:'NC',pos:t.pos});
        if(s?.id==='redstone_lamp'&&this.powered(t.pos))this.change(t.pos,s,{lit:'true'});
        if(s?.id==='observer'&&s.states.powered==='true'&&!this.hasScheduled(t.pos,s.id))this.push([{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,powered:'false'}},flags:18},...this.outputTasks(t.pos,s)]);
      }else if(t.kind==='placed'){const s=this.get(t.pos);if(s?.id==='repeater'&&this.input(t.pos,s))this.schedule(t.pos,s.id,1);}
    }
    collect(){// 二维世界将所有区段视为已加载，仍保留按区段排空计划刻的顺序。
      const groups=new Map();for(const tick of this.scheduled){const k=`${Math.floor(tick.pos[0]/16)},${Math.floor(tick.pos[2]/16)}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(tick);}
      const full=(a,b)=>a.triggerTick-b.triggerTick||a.priority-b.priority||a.subTickOrder-b.subTickOrder;
      const intra=(a,b)=>a.priority-b.priority||a.subTickOrder-b.subTickOrder;
      for(const list of groups.values())list.sort(full);
      const chosen=[];while(chosen.length<65536){const ready=[...groups.values()].filter(g=>g.length&&g[0].triggerTick<=this.time);if(!ready.length)break;ready.sort((a,b)=>intra(a[0],b[0]));chosen.push(ready[0].shift());}
      const orders=new Set(chosen.map(t=>t.subTickOrder));this.scheduled=this.scheduled.filter(t=>!orders.has(t.subTickOrder));this.selected=chosen;
    }
    stepEvent(){if(this.halted)return false;if(++this.steps>100000){this.halted=true;this.record('执行预算耗尽');return false;}
      if(this.tasks.length){this.execute(this.tasks.pop());return true;}
      this.parent=null;
      if(this.phase==='TT'&&this.selected.length){const tick=this.selected.shift();this.execute({kind:'TT',...tick});return true;}
      if(this.phase==='BE'&&this.events.length){const item=this.events[0];this.halted=true;this.record('未实现的方块事件，已暂停',{...item.event,parent:item.parent});return false;}
      const index=PHASES.indexOf(this.phase);this.phase=PHASES[(index+1)%PHASES.length];
      if(this.phase==='WTU'){this.time++;this.steps=0;}
      this.record('阶段',{name:this.phase});if(this.phase==='TT')this.collect();return true;
    }
    stepPhase(){const phase=this.phase;let n=0;do{if(!this.stepEvent())break;}while(this.phase===phase&&++n<100001);}
    finish(){let n=0;while((this.tasks.length||this.phase!=='AT')&&n++<100001)if(!this.stepEvent())break;}
    tick(){if(this.halted)return;this.finish();if(this.halted)return;this.stepEvent();this.finish();}
    snapshot(){return clone({version:1,plane:this.plane,cells:[...this.cells],time:this.time,phase:this.phase,tasks:this.tasks,scheduled:this.scheduled,selected:this.selected,events:this.events,tickers:this.tickers,trace:this.trace,serial:this.serial,order:this.order,parent:this.parent,halted:this.halted,steps:this.steps,revision:this.revision});}
    restore(data){
      if(!data||data.version!==1||!PHASES.includes(data.phase)||!Number.isSafeInteger(data.time)||data.time<0)throw new Error('时序存档无效');
      for(const name of ['cells','tasks','scheduled','selected','events','tickers','trace'])if(!Array.isArray(data[name])||data[name].length>150000)throw new Error('时序队列无效');
      const pos=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isSafeInteger);
      const state=s=>s&&typeof s.id==='string'&&s.states&&typeof s.states==='object'&&!Array.isArray(s.states)&&Object.values(s.states).every(v=>typeof v==='string')&&(!['repeater','observer','lever'].includes(s.id)||DIR[s.states.facing])&&(s.id!=='repeater'||['1','2','3','4'].includes(s.states.delay));
      for(const entry of data.cells){if(!Array.isArray(entry)||entry.length!==2)throw new Error('时序方块无效');const [k,s]=entry;if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!pos(k.split(',').map(Number))||!state(s))throw new Error('时序方块无效');}
      for(const t of [...data.tasks,...data.scheduled,...data.selected])if(!pos(t.pos))throw new Error('时序坐标无效');
      for(const t of data.tasks)if(!['set','afterSet','NC','PP','比较器更新','onPlace','placed','schedule',...(api.EXTRA_TASKS||[])].includes(t.kind)||(t.cell!=null&&!state(t.cell))||(t.before!=null&&!state(t.before))||(t.oldState!=null&&!state(t.oldState))||(t.direction!=null&&!Object.hasOwn(DIR,t.direction))||(['set','afterSet'].includes(t.kind)&&!Number.isSafeInteger(t.flags)))throw new Error('更新任务无效');
      for(const t of [...data.scheduled,...data.selected])if(!Number.isSafeInteger(t.triggerTick)||!Number.isSafeInteger(t.subTickOrder)||!Number.isInteger(t.priority)||t.priority < -3||t.priority>3)throw new Error('计划刻无效');
      for(const item of data.events)if(!pos(item.event?.pos)||typeof item.event.type!=='string')throw new Error('方块事件无效');
      for(const name of ['serial','order','steps','revision'])if(!Number.isSafeInteger(data[name])||data[name]<0)throw new Error('时序计数无效');
      const saved=clone(data);this.cells=new Map(saved.cells);for(const name of ['time','phase','tasks','scheduled','selected','events','tickers','trace','serial','order','parent','halted','steps','revision'])this[name]=saved[name];
      if(data.plane!=null&&!['top','side'].includes(data.plane))throw new Error('二维平面无效');this.plane=data.plane??null;
    }
  }
  const to3=(x,y,view)=>view==='top'?[x,0,y]:[x,-y,0];
  const to2=(p,view)=>view==='top'?(p[1]===0?[p[0],p[2]]:null):(p[2]===0?[p[0],-p[1]]:null);
  const api={TimingWorld,NC,PP,PHASES,DIR,OPP,SUPPORTED,to3,to2,diode};if(typeof module!=='undefined')module.exports=api;else root.BoardTiming=api;
})(typeof window!=='undefined'?window:globalThis);
