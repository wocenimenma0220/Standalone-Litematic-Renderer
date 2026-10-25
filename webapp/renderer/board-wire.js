'use strict';
/** 红石粉使用 26.3 普通规则，NC/PP 更新按深度优先执行，并保持 HashSet 通知顺序。 */
(function(root){
  const B=typeof module!=='undefined'?require('./board-components.js'):root.BoardTiming;
  const Support=typeof module!=='undefined'?require('./board-support.js'):root.BoardSupport;
  const {TimingWorld,DIR,OPP}=B,P=TimingWorld.prototype;
  const H=['north','east','south','west'],V=['down','up','north','south','west','east'];
  const at=(p,d)=>p.map((v,i)=>v+DIR[d][i]),wire=s=>s?.id==='redstone_wire';
  const dot=s=>H.every(d=>!s.states[d]||s.states[d]==='none'),cross=s=>H.every(d=>s.states[d]&&s.states[d]!=='none');
  const cell=(power=0,side='none')=>({id:'redstone_wire',states:{north:side,east:side,south:side,west:side,power:String(power)}});
  // 默认 Java HashSet 的七项使用 16 桶 HashMap；按桶序迭代，同哈希保持插入顺序。

  function notificationPositions(p){return [p,...V.map(d=>at(p,d))].map((pos,index)=>{const hash=((pos[1]+Math.imul(pos[2],31))*31+pos[0])|0;return {pos,index,bucket:(hash^(hash>>>16))&15};}).sort((a,b)=>a.bucket-b.bucket||a.index-b.index).map(x=>x.pos);}
  Object.assign(B,{isWire:wire,wireCell:cell,wireNotificationPositions:notificationPositions});
  B.EXTRA_TASKS.push('红石线强度','红石线拐角','红石线周边','红石线高低邻线','红石线间接形状');
  const original={};for(const name of ['own','neighbor','write','execute','interactAt','edit'])original[name]=P[name];
  P.wireCanRestOn=function(p){return this.get(p)?.id==='hopper'||Support.sturdy(this.get(p),'up');};
  P.wireConnectingSide=function(p,d){const q=at(p,d),s=this.get(q);
    if(!this.isConductor(at(p,'up'))&&(s?.id.endsWith('_trapdoor')||this.wireCanRestOn(q))&&Support.wireConnects(this.get(at(q,'up')),null))return Support.sturdy(s,OPP[d])?'up':'side';
    return !Support.wireConnects(s,d)&&(this.isConductor(q)||!Support.wireConnects(this.get(at(q,'down')),null))?'none':'side';
  };
  P.wireConnection=function(p,s){const wasDot=dot(s),result=cell(s.states.power||0);for(const d of H)result.states[d]=this.wireConnectingSide(p,d);if(wasDot&&dot(result))return result;
    const north=result.states.north!=='none',south=result.states.south!=='none',east=result.states.east!=='none',west=result.states.west!=='none';
    if(!west&&!north&&!south)result.states.west='side';if(!east&&!north&&!south)result.states.east='side';if(!north&&!east&&!west)result.states.north='side';if(!south&&!east&&!west)result.states.south='side';return result;
  };
  P.own=function(p,d,direct=false){const s=this.get(p);if(wire(s)){if(this.wireSignalDisabled||d==='down')return 0;const power=Number(s.states.power||0);return power&&(d==='up'||this.wireConnection(p,s).states[OPP[d]]!=='none')?power:0;}return original.own.call(this,p,d,direct);};
  P.wireTarget=function(p){let block=0;this.wireSignalDisabled=true;try{for(const d of V){block=Math.max(block,this.signal(at(p,d),d));if(block===15)return 15;}}finally{this.wireSignalDisabled=false;}
    let incoming=0;const read=q=>wire(this.get(q))?Number(this.get(q).states.power||0):0;
    for(const d of H){const q=at(p,d);incoming=Math.max(incoming,read(q));if(this.isConductor(q)&&!this.isConductor(at(p,'up')))incoming=Math.max(incoming,read(at(q,'up')));else if(!this.isConductor(q))incoming=Math.max(incoming,read(at(q,'down')));}
    return Math.max(block,incoming-1,0);
  };
  P.wireUpdate=function(p,oldState){const s=oldState||this.get(p);if(!wire(s))return;const power=this.wireTarget(p);if(Number(s.states.power||0)===power)return;
    this.record('红石线电量',{pos:p,before:Number(s.states.power||0),after:power});const tasks=[];
    if(this.get(p)===s)tasks.push({kind:'set',pos:p,cell:{id:s.id,states:{...s.states,power:String(power)}},flags:2});
    tasks.push(...notificationPositions(p).flatMap(q=>this.nc(q)));this.push(tasks);
  };
  P.indirectTasks=function(p,s){return wire(s)?H.filter(d=>s.states[d]&&s.states[d]!=='none').map(direction=>({kind:'红石线间接形状',pos:p,direction})):[];};
  P.edit=function(p,s){if(wire(s))s=this.wireConnection(p,cell(0,'side'));return original.edit.call(this,p,s);};
  P.neighbor=function(t){const s=this.get(t.pos);if(!wire(s))return original.neighbor.call(this,t);
    if(!this.canAttach(t.pos,s)){this.set(t.pos,null);return;}
    if(t.kind==='NC'){this.wireUpdate(t.pos);return;}
    if(t.kind!=='PP'||t.direction==='down')return;
    let next;if(t.direction==='up')next=this.wireConnection(t.pos,s);else{
      const side=this.wireConnectingSide(t.pos,t.direction),connected=side!=='none';
      next=connected===(s.states[t.direction]!=='none')&&!cross(s)?{id:s.id,states:{...s.states,[t.direction]:side}}:this.wireConnection(t.pos,{...cell(s.states.power,'side'),states:{...cell(s.states.power,'side').states,[t.direction]:side}});
    }
    if(JSON.stringify(next.states)!==JSON.stringify(s.states))this.set(t.pos,next,2);
  };
  P.write=function(t){const old=this.get(t.pos);original.write.call(this,t);if(wire(old)&&!wire(this.get(t.pos)))this.push([...V.flatMap(d=>this.nc(at(t.pos,d))),{kind:'红石线强度',pos:t.pos,oldState:old},{kind:'红石线周边',pos:t.pos}]);};
  P.execute=function(t){
    if(t.kind==='红石线强度'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.wireUpdate(t.pos,t.oldState);return;}
    if(t.kind==='红石线拐角'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});if(wire(this.get(t.pos)))this.push([...this.nc(t.pos),...V.flatMap(d=>this.nc(at(t.pos,d)))]);return;}
    if(t.kind==='红石线周边'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.push([...H.map(d=>({kind:'红石线拐角',pos:at(t.pos,d)})),...H.map(d=>({kind:'红石线高低邻线',pos:at(t.pos,d)}))]);return;}
    if(t.kind==='红石线高低邻线'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});this.push([{kind:'红石线拐角',pos:at(t.pos,this.isConductor(t.pos)?'up':'down')}]);return;}
    if(t.kind==='红石线间接形状'){this.parent=this.record(t.kind,{pos:t.pos,direction:t.direction,parent:t.parent});const q=at(t.pos,t.direction);if(!wire(this.get(q)))this.push(['down','up'].map(d=>at(q,d)).filter(p=>wire(this.get(p))).map(p=>({kind:'PP',pos:p,direction:OPP[t.direction],source:at(p,OPP[t.direction])})));return;}
    const s=this.get(t.pos);original.execute.call(this,t);
    if(t.kind==='onPlace'&&wire(s)){const connection=this.wireConnection(t.pos,s);this.push([...(JSON.stringify(connection.states)!==JSON.stringify(s.states)?[{kind:'set',pos:t.pos,cell:connection,flags:2}]:[]),{kind:'红石线强度',pos:t.pos},...['up','down'].flatMap(d=>this.nc(at(t.pos,d))),{kind:'红石线周边',pos:t.pos}]);}
  };
  P.interactAt=function(p){const s=this.get(p);if(!wire(s))return original.interactAt.call(this,p);if(this.tasks.length||this.phase!=='AT'||this.halted)throw Error('请先推进到本刻结束');if(!cross(s)&&!dot(s))return false;
    this.steps=0;this.parent=this.record('切换红石粉形状',{pos:p});const next=this.wireConnection(p,cell(s.states.power,dot(s)?'side':'none'));if(JSON.stringify(next.states)===JSON.stringify(s.states))return false;
    this.push([{kind:'set',pos:p,cell:next,flags:3},...H.filter(d=>(s.states[d]!=='none')!==(next.states[d]!=='none')&&this.isConductor(at(p,d))).flatMap(d=>this.nc(at(p,d),OPP[d]))]);return true;
  };
  B.SUPPORTED.push('redstone_wire');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
