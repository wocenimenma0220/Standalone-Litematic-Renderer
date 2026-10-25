'use strict';
/** 活塞按 26.3 底座、结构解析和移动方块刻逻辑执行，仅移动当前平面内方块。 */
(function(root){
  const B=typeof module!=='undefined'?require('./board-physics.js'):root.BoardTiming;
  const {TimingWorld,DIR,OPP,NC}=B,P=TimingWorld.prototype,key=p=>p.join(','),copy=x=>JSON.parse(JSON.stringify(x));
  const at=(p,d,n=1)=>p.map((v,i)=>v+DIR[d][i]*n),axis=d=>DIR[d].findIndex(v=>v!==0),V=['down','up','north','south','west','east'];
  const piston=id=>id==='piston'||id==='sticky_piston',sticky=id=>id==='slime_block'||id==='honey_block';
  const sticks=(a,b)=>a==='honey_block'&&b==='slime_block'||a==='slime_block'&&b==='honey_block'?false:sticky(a)||sticky(b);
  const popped=s=>B.physics(typeof s==='string'?{id:s,states:{}}:s)[0]==='POPPED';
  B.EXTRA_TASKS.push('活塞推毁掉落','BE动作','登记移动实体','活塞收回','黏性拉回判定','移动强制到位');B.isPiston=piston;
  B.pistonRenderParts=function(m){const direction=m.extending?m.direction:OPP[m.direction],pos=m.pos.map((v,i)=>v-DIR[direction][i]*(1-m.progress));if(m.source&&!m.extending&&piston(m.movedState.id))return [{pos:[...m.pos],cell:{id:m.movedState.id,states:{...m.movedState.states,extended:'true'}},baseOnly:true},{pos,cell:{id:'piston_head',states:{facing:m.movedState.states.facing,type:m.movedState.id==='sticky_piston'?'sticky':'normal',short:String(m.progress>=.5)}}}];return [{pos,cell:m.movedState}];};
  const original={};for(const name of ['neighbor','execute','stepEvent','tickEntity','write','snapshot','restore'])original[name]=P[name];
  P.ensurePistons=function(){this.ensureComponents();if(!this.moving)this.moving=new Map();};
  P.canPush=function(s,p,d,allowDestroy,connection){if(!this.inPlane(p)||p.some(v=>Math.abs(v)>192))return false;if(!s)return true;const [reaction,unbreakable,blockEntity]=B.physics(s);if(piston(s.id)){if(s.states.extended==='true')return false;}else{if(unbreakable||reaction==='IMMOVEABLE')return false;if(reaction==='POPPED')return allowDestroy;if(reaction==='PUSH')return d===connection;}return !blockEntity;};
  P.resolvePiston=function(p,d,extending){
    const push=extending?d:OPP[d],start=at(p,d,extending?1:2),list=[],destroy=[];const equals=(a,b)=>key(a)===key(b),index=q=>list.findIndex(p=>equals(p,q));
    const read=q=>!extending&&equals(q,at(p,d))&&this.get(q)?.id==='piston_head'?undefined:this.get(q);
    if(!this.inPlane(start))return null;
    const branch=q=>{const s=read(q);for(const side of V)if(axis(side)!==axis(push)){const next=at(q,side);if(sticks(read(next)?.id,s?.id)&&!line(next,side))return false;}return true;};
    const line=(start,connection)=>{let s=read(start);if(!s||!this.canPush(s,start,push,false,connection)||equals(start,p)||index(start)>=0)return true;
      let count=1;if(count+list.length>12)return false;
      while(sticky(s?.id)){const q=at(start,OPP[push],count),old=s;s=read(q);if(!s||!sticks(old.id,s.id)||!this.canPush(s,q,push,false,OPP[push])||equals(q,p))break;if(++count+list.length>12)return false;}
      let added=0;for(let i=count-1;i>=0;i--){list.push(at(start,OPP[push],i));added++;}
      for(let i=1;;i++){const q=at(start,push,i),collision=index(q);if(collision>=0){const reordered=[...list.slice(0,collision),...list.slice(list.length-added),...list.slice(collision,list.length-added)];list.splice(0,list.length,...reordered);for(let j=0;j<=collision+added;j++)if(sticky(read(list[j])?.id)&&!branch(list[j]))return false;return true;}
        if(!this.inPlane(q)||q.some(v=>Math.abs(v)>192))return false;s=read(q);if(!s)return true;if(!this.canPush(s,q,push,true,push)||equals(q,p))return false;if(popped(s)){destroy.push(q);return true;}if(list.length>=12)return false;list.push(q);added++;
      }
    };
    const first=this.get(start);if(!this.canPush(first,start,push,false,d)){if(extending&&first&&popped(first))destroy.push(start);else return null;}
    else {if(!line(start,push))return null;for(let i=0;i<list.length;i++)if(sticky(this.get(list[i])?.id)&&!branch(list[i]))return null;}
    return {push,list,destroy};
  };
  P.pistonPowered=function(p,s){const d=s.states.facing;if(V.some(side=>side!==d&&this.signal(at(p,side),side)>0))return true;if(this.signal(p,'down')>0)return true;return V.some(side=>side!=='down'&&this.signal(at(at(p,'up'),side),side)>0);};
  P.checkPiston=function(p,s){this.ensurePistons();const d=s.states.facing;if(!this.inPlane(at(p,d))){this.record('活塞朝向垂直画布，未执行',{pos:p,direction:d});return;}
    const powered=this.pistonPowered(p,s);if(powered&&s.states.extended!=='true'){if(this.resolvePiston(p,d,true))this.blockEvent(p,s.id,0,V.indexOf(d));else this.record('活塞推动受阻',{pos:p});}
    else if(!powered&&s.states.extended==='true'){const moving=this.moving.get(key(at(p,d,2)));const instant=moving?.extending&&moving.direction===d&&(moving.progressO<.5||moving.lastTick===this.time||this.phase!=='AT');this.blockEvent(p,s.id,instant?2:1,V.indexOf(d));}
  };
  P.movementTasks=function(p,s,extending){const d=s.states.facing,resolved=this.resolvePiston(p,d,extending);if(!resolved)return null;
    const tasks=[],left=new Map(resolved.list.map(q=>[key(q),this.get(q)]));
    if(!extending&&this.get(at(p,d))?.id==='piston_head')tasks.push({kind:'set',pos:at(p,d),cell:null,flags:276});
    for(const q of [...resolved.destroy].reverse())tasks.push({kind:'活塞推毁掉落',pos:q,oldState:copy(this.get(q))},{kind:'set',pos:q,cell:null,flags:18});
    const moving=(q,state,source)=>{const cell={id:'moving_piston',states:{facing:d,type:s.id==='sticky_piston'?'sticky':'normal'}};tasks.push({kind:'set',pos:q,cell,flags:324},{kind:'登记移动实体',pos:q,movedState:copy(state),direction:d,extending,source});};
    for(const q of [...resolved.list].reverse()){const target=at(q,resolved.push);left.delete(key(target));moving(target,this.get(q),false);}
    if(extending){const front=at(p,d);left.delete(key(front));moving(front,{id:'piston_head',states:{facing:d,type:s.id==='sticky_piston'?'sticky':'normal',short:'false'}},true);}
    for(const k of left.keys())tasks.push({kind:'set',pos:k.split(',').map(Number),cell:null,flags:82});
    for(const k of left.keys())tasks.push(...this.pp(k.split(',').map(Number)));
    for(const q of [...resolved.destroy].reverse())tasks.push(...this.nc(q));for(const q of [...resolved.list].reverse())tasks.push(...this.nc(q));if(extending)tasks.push(...this.nc(at(p,d)));return tasks;
  };
  P.completeMoving=function(p,instant=false){this.ensurePistons();const m=this.moving.get(key(p));if(!m)return;this.moving.delete(key(p));this.tickers=this.tickers.filter(t=>t.token!==m.token);if(this.get(p)?.id!=='moving_piston')return;
    let cell=instant&&m.source?null:copy(m.movedState);if(!instant&&cell?.states.waterlogged==='true')cell.states.waterlogged='false';
    // 原版放置前的邻居形状更新会先调用移动侦测器的 updateShape。
    if(cell?.id==='observer'&&cell.states.powered!=='true')this.schedule(p,'observer',2);
    this.record(instant?'移动方块强制到位':'移动方块到位',{pos:p,cell,direction:m.direction});this.push([{kind:'set',pos:p,cell,flags:instant?3:67},{kind:'NC',pos:p,source:p}]);
  };
  P.pistonEvent=function(t){this.ensurePistons();const s=this.get(t.pos);if(s?.id!==t.type){this.record('方块事件失效',{pos:t.pos,type:t.type});return;}
    const powered=this.pistonPowered(t.pos,s);if(powered&&t.action!==0){this.change(t.pos,s,{extended:'true'},2);this.record('收回事件供电复核失败',{pos:t.pos});return;}if(!powered&&t.action===0){this.record('伸出事件供电复核失败',{pos:t.pos});return;}
    if(t.action===0){const tasks=this.movementTasks(t.pos,s,true);if(tasks)this.push([...tasks,{kind:'set',pos:t.pos,cell:{id:s.id,states:{...s.states,extended:'true'}},flags:67}]);}
    else {const front=at(t.pos,s.states.facing);this.push([...(this.moving.has(key(front))?[{kind:'移动强制到位',pos:front}]:[]),{kind:'活塞收回',pos:t.pos,type:t.type,action:t.action,data:t.data}]);}
  };
  P.retractPiston=function(t){const s=this.get(t.pos);if(!piston(s?.id))return;const d=s.states.facing,cell={id:'moving_piston',states:{facing:d,type:s.id==='sticky_piston'?'sticky':'normal'}},animationDirection=V[t.data&7]||d;
    this.push([{kind:'set',pos:t.pos,cell,flags:276},{kind:'登记移动实体',pos:t.pos,movedState:{id:s.id,states:{...s.states,facing:animationDirection,extended:'false'}},direction:d,extending:false,source:true},...this.nc(t.pos),...this.pp(t.pos),{kind:'黏性拉回判定',pos:t.pos,base:s,action:t.action}]);
  };
  P.pullPiston=function(t){const s=t.base,d=s.states.facing,two=at(t.pos,d,2),front=at(t.pos,d),m=this.moving.get(key(two));
    if(s.id==='sticky_piston'&&m?.extending&&m.direction===d){this.completeMoving(two,true);return;}
    if(s.id==='sticky_piston'&&t.action===1&&this.get(two)&&this.canPush(this.get(two),two,OPP[d],false,d)){
      const tasks=this.movementTasks(t.pos,s,false);if(tasks){this.push(tasks);return;}this.record('黏性活塞拉回受阻',{pos:t.pos});return;
    }this.set(front,null,3);
  };
  P.neighbor=function(t){const s=this.get(t.pos);if(piston(s?.id)){if(t.kind==='NC')this.checkPiston(t.pos,s);return;}
    if(s?.id==='piston_head'){const back=at(t.pos,OPP[s.states.facing]),base=this.get(back),valid=((s.states.type==='sticky'?base?.id==='sticky_piston':base?.id==='piston')&&base.states.extended==='true'||base?.id==='moving_piston')&&base.states.facing===s.states.facing;
      if(t.kind==='PP'&&t.direction===OPP[s.states.facing]&&!valid)this.set(t.pos,null);else if(t.kind==='NC'&&valid)this.push([{kind:'NC',pos:back,source:t.source||t.pos}]);return;}
    return original.neighbor.call(this,t);
  };
  P.write=function(t){this.ensurePistons();const old=this.get(t.pos);original.write.call(this,t);if(old?.id!==this.get(t.pos)?.id){const m=this.moving.get(key(t.pos));if(m){this.moving.delete(key(t.pos));this.tickers=this.tickers.filter(e=>e.token!==m.token);}
      if(old?.id==='piston_head'&&(t.flags&1||t.flags&64)){const p=at(t.pos,OPP[old.states.facing]),base=this.get(p);if(piston(base?.id)&&base.states.facing===old.states.facing&&base.states.extended==='true')this.set(p,null);}
    }
  };
  P.tickEntity=function(t){if(t.entityKind!=='moving')return original.tickEntity.call(this,t);this.ensurePistons();const m=this.moving.get(key(t.pos));if(!m||m.token!==t.token)return;m.lastTick=this.time;m.progressO=m.progress;if(m.progressO>=1)this.completeMoving(t.pos);else{m.progress=Math.min(1,m.progress+.5);this.record('移动方块进度',{pos:t.pos,progress:m.progress,direction:m.direction,extending:m.extending});}};
  P.execute=function(t){
    if(t.kind==='活塞推毁掉落'){this.parent=this.record(t.kind,{pos:t.pos});this.dropBlock?.(t.pos,t.oldState);return;}
    if(['BE动作','活塞收回','黏性拉回判定','移动强制到位','登记移动实体'].includes(t.kind)){this.parent=this.record(t.kind,{...t});
      if(t.kind==='BE动作')this.pistonEvent(t);else if(t.kind==='活塞收回')this.retractPiston(t);else if(t.kind==='黏性拉回判定')this.pullPiston(t);else if(t.kind==='移动强制到位')this.completeMoving(t.pos,true);else {this.ensurePistons();if(this.get(t.pos)?.id==='moving_piston'){const entity={pos:t.pos,movedState:t.movedState,direction:t.direction,extending:t.extending,source:t.source,progress:0,progressO:0,lastTick:-1,token:this.addTicker(t.pos,'moving')};this.moving.set(key(t.pos),entity);}}return;
    }
    const s=this.get(t.pos);original.execute.call(this,t);if((t.kind==='onPlace'||t.kind==='placed')&&piston(s?.id))this.checkPiston(t.pos,s);
  };
  P.stepEvent=function(){if(!this.halted&&!this.tasks.length&&this.phase==='BE'&&this.events.length&&piston(this.events[0].event.type)){
      if(++this.steps>100000){this.halted=true;this.record('执行预算耗尽');return false;}const {event,parent}=this.events.shift();this.execute({kind:'BE动作',...event,parent});return true;
    }return original.stepEvent.call(this);
  };
  P.snapshot=function(){this.ensurePistons();return {...original.snapshot.call(this),pistons:copy({version:1,moving:[...this.moving]})};};
  P.restore=function(data){if(data.pistons){if(data.pistons.version!==1||!Array.isArray(data.pistons.moving)||data.pistons.moving.length>150000)throw new Error('活塞数据无效');for(const [k,m]of data.pistons.moving)if(!/^-?\d+,-?\d+,-?\d+$/.test(k)||!Object.hasOwn(DIR,m.direction)||!m.movedState?.id||!m.movedState.states||![0,.5,1].includes(m.progress)||![0,.5,1].includes(m.progressO)||!Number.isSafeInteger(m.token)||!Number.isSafeInteger(m.lastTick)||typeof m.source!=='boolean'||typeof m.extending!=='boolean')throw new Error('移动方块数据无效');}
    original.restore.call(this,data);this.moving=new Map(copy(data.pistons?.moving||[]));
  };
  B.SUPPORTED.push('piston','sticky_piston');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
