'use strict';
/* Direct planar port of Java 26.3 RailState, BaseRailBlock, RailBlock,
 * PoweredRailBlock (also activator rails) and DetectorRailBlock. */
(function(root){
  const B=typeof module!=='undefined'?require('./board-devices.js'):root.BoardTiming;
  const Support=typeof module!=='undefined'?require('./board-support.js'):root.BoardSupport;
  const {TimingWorld,DIR,OPP}=B,P=TimingWorld.prototype,key=p=>p.join(','),at=(p,d,n=1)=>p.map((v,i)=>v+DIR[d][i]*n);
  const H=['north','east','south','west'],rail=id=>['rail','powered_rail','activator_rail','detector_rail'].includes(id),powered=id=>['powered_rail','activator_rail'].includes(id);
  const connections={north_south:[['north',0],['south',0]],east_west:[['west',0],['east',0]],ascending_east:[['west',0],['east',1]],ascending_west:[['west',1],['east',0]],ascending_north:[['north',1],['south',0]],ascending_south:[['north',0],['south',1]],south_east:[['east',0],['south',0]],south_west:[['west',0],['south',0]],north_west:[['west',0],['north',0]],north_east:[['east',0],['north',0]]};
  B.isRail=rail;B.railConnections=(p,s)=>(connections[s.states.shape]||connections.north_south).map(([d,y])=>at(at(p,d),'up',y));
  B.EXTRA_TASKS.push('铁轨放置','铁轨连接','铁轨放置结束','铁轨供电通知');
  class RailState{
    constructor(w,p,s=w.get(p)){this.w=w;this.pos=p;this.state=s;this.straight=s.id!=='rail';this.connections=B.railConnections(p,s);}
    has(p){return this.connections.some(q=>q[0]===p[0]&&q[2]===p[2]);}
    get(p){for(const q of [p,at(p,'up'),at(p,'down')])if(rail(this.w.get(q)?.id))return new RailState(this.w,q);return null;}
    hasRail(p){return !!this.get(p);}
    removeSoft(){this.connections=this.connections.map(p=>this.get(p)).filter(r=>r?.has(this.pos)).map(r=>r.pos);}
    canConnect(other){return this.has(other.pos)||this.connections.length!==2;}
    neighbor(p){const r=this.get(p);if(!r)return false;r.removeSoft();return r.canConnect(this);}
    slopes(shape){const p=this.pos;if(shape==='north_south'){if(rail(this.w.get(at(at(p,'north'),'up'))?.id))shape='ascending_north';if(rail(this.w.get(at(at(p,'south'),'up'))?.id))shape='ascending_south';}if(shape==='east_west'){if(rail(this.w.get(at(at(p,'east'),'up'))?.id))shape='ascending_east';if(rail(this.w.get(at(at(p,'west'),'up'))?.id))shape='ascending_west';}return shape;}
    connect(other){this.connections.push(other.pos);const [n,s,w,e]=['north','south','west','east'].map(d=>this.has(at(this.pos,d)));let shape=null;if(n||s)shape='north_south';if(w||e)shape='east_west';if(!this.straight){if(s&&e&&!n&&!w)shape='south_east';if(s&&w&&!n&&!e)shape='south_west';if(n&&w&&!s&&!e)shape='north_west';if(n&&e&&!s&&!w)shape='north_east';}shape=this.slopes(shape)||'north_south';return {kind:'set',pos:this.pos,cell:{id:this.state.id,states:{...this.state.states,shape}},flags:3};}
    place(hasSignal,first,defaultShape){const [n,s,w,e]=['north','south','west','east'].map(d=>this.neighbor(at(this.pos,d))),ns=n||s,we=w||e;let shape=null;
      if(ns&&!we)shape='north_south';if(we&&!ns)shape='east_west';if(!this.straight){if(s&&e&&!n&&!w)shape='south_east';if(s&&w&&!n&&!e)shape='south_west';if(n&&w&&!s&&!e)shape='north_west';if(n&&e&&!s&&!w)shape='north_east';}
      if(shape===null){if(ns&&we)shape=defaultShape;else if(ns)shape='north_south';else if(we)shape='east_west';if(!this.straight){const choices=hasSignal?[[s&&e,'south_east'],[s&&w,'south_west'],[n&&e,'north_east'],[n&&w,'north_west']]:[[n&&w,'north_west'],[n&&e,'north_east'],[s&&w,'south_west'],[s&&e,'south_east']];for(const [yes,value]of choices)if(yes)shape=value;}}
      shape=this.slopes(shape)||defaultShape;const state={id:this.state.id,states:{...this.state.states,shape}};return first||shape!==this.state.states.shape?[{kind:'set',pos:this.pos,cell:state,flags:3},...B.railConnections(this.pos,state).map(pos=>({kind:'铁轨连接',pos,source:this.pos}))]:[];
    }
  }
  const old={};for(const n of ['neighbor','own','tickBlock','write','execute'])old[n]=P[n];
  P.railSupported=function(p,s){if(!this.canAttach(p,s))return false;const d=s.states.shape?.startsWith('ascending_')?s.states.shape.slice(10):null;return !d||Support.sturdy(this.get(at(p,d)),'up','RIGID');};
  P.findPoweredRail=function(p,s,forward,depth=0){if(depth>=8)return false;const shape=s.states.shape;let q=[...p],below=true,axis=['east_west','ascending_east','ascending_west'].includes(shape)?'east_west':'north_south';
    if(axis==='east_west')q=at(q,forward?'west':'east');else q=at(q,forward?'south':'north');
    if(shape==='ascending_east'&&!forward||shape==='ascending_west'&&forward||shape==='ascending_north'&&!forward||shape==='ascending_south'&&forward){q=at(q,'up');below=false;}
    const match=q=>{const other=this.get(q);if(other?.id!==s.id||other.states.powered!=='true')return false;const oa=['east_west','ascending_east','ascending_west'].includes(other.states.shape)?'east_west':'north_south';return axis===oa&&(this.powered(q)||this.findPoweredRail(q,other,forward,depth+1));};return match(q)||below&&match(at(q,'down'));
  };
  P.updatePoweredRail=function(p,s){const on=this.powered(p)||this.findPoweredRail(p,s,true)||this.findPoweredRail(p,s,false);if(on!==(s.states.powered==='true'))this.push([{kind:'set',pos:p,cell:{id:s.id,states:{...s.states,powered:String(on)}},flags:3},...this.nc(at(p,'down'),undefined,s.id),...(s.states.shape.startsWith('ascending_')?this.nc(at(p,'up'),undefined,s.id):[])]);};
  P.checkDetector=function(p){const s=this.get(p);if(s?.id!=='detector_rail'||!this.railSupported(p,s))return;const on=!!this.sourceAt(p).cart,tasks=[];if(on!==(s.states.powered==='true'))tasks.push({kind:'set',pos:p,cell:{id:s.id,states:{...s.states,powered:String(on)}},flags:3},...B.railConnections(p,s).map(pos=>({kind:'NC',pos,source:p,block:this.get(pos)?.id||'air'})),...this.nc(p),...this.nc(at(p,'down'),undefined,s.id));if(on)tasks.push({kind:'schedule',pos:p,type:s.id,delay:20});tasks.push({kind:'比较器更新',pos:p});this.push(tasks);};
  P.own=function(p,d,direct=false){const s=this.get(p);if(s?.id==='detector_rail')return s.states.powered==='true'&&(!direct||d==='up')?15:0;return old.own.call(this,p,d,direct);};
  const source=id=>id==='redstone_wire'||id==='redstone_block'||id==='lever'||B.isButton(id)||B.isPlate(id)||B.isTorch(id)||['repeater','comparator','observer','detector_rail','daylight_detector','target','lectern','jukebox','lightning_rod','tripwire_hook','sculk_sensor','calibrated_sculk_sensor','trapped_chest'].includes(id);
  P.neighbor=function(t){const s=this.get(t.pos);if(!rail(s?.id))return old.neighbor.call(this,t);if(t.kind!=='NC')return;if(!this.railSupported(t.pos,s)){this.set(t.pos,null);return;}if(powered(s.id)){this.updatePoweredRail(t.pos,s);return;}if(s.id==='rail'&&source(t.block||this.get(t.source||t.pos)?.id)){const r=new RailState(this,t.pos,s);if(H.filter(d=>r.hasRail(at(t.pos,d))).length===3)this.push(r.place(this.powered(t.pos),false,s.states.shape));}};
  P.tickBlock=function(t){if(t.type==='detector_rail'&&this.get(t.pos)?.id===t.type){if(this.get(t.pos).states.powered==='true')this.checkDetector(t.pos);return;}return old.tickBlock.call(this,t);};
  P.write=function(t){const before=this.get(t.pos),serial=this.serial;old.write.call(this,t);const s=this.get(t.pos);if(serial!==this.serial&&rail(before?.id)&&(!(t.flags&64))&&(t.flags&1))this.push([...(before.states.shape?.startsWith('ascending_')?this.nc(at(t.pos,'up'),undefined,before.id):[]),...(before.id!=='rail'?[...this.nc(t.pos,undefined,before.id),...this.nc(at(t.pos,'down'),undefined,before.id)]:[])]);};
  P.execute=function(t){const s=this.get(t.pos);if(t.kind==='铁轨放置'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});if(rail(s?.id))this.push([...new RailState(this,t.pos,s).place(this.powered(t.pos),true,s.states.shape||'north_south'),{kind:'铁轨放置结束',pos:t.pos}]);return;}
    if(t.kind==='铁轨连接'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});if(!rail(this.get(t.source)?.id))return;const r=new RailState(this,t.source).get(t.pos),other=new RailState(this,t.source);if(r){r.removeSoft();if(r.canConnect(other))this.push([r.connect(other)]);}return;}
    if(t.kind==='铁轨放置结束'){this.parent=this.record(t.kind,{pos:t.pos,parent:t.parent});if(rail(s?.id)&&s.id!=='rail'){this.neighbor({kind:'NC',pos:t.pos,block:s.id});if(s.id==='detector_rail')this.checkDetector(t.pos);}return;}
    old.execute.call(this,t);if(t.kind==='onPlace'&&rail(s?.id))this.push([{kind:'铁轨放置',pos:t.pos}]);
  };
  B.SUPPORTED.push('rail','powered_rail','activator_rail','detector_rail');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
