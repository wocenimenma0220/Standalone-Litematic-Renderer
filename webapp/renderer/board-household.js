'use strict';
/* 26.3 Door/TrapDoor/FenceGate, ContainerOpenersCounter, Leaves/Scaffolding.
 * Distance changes use scheduled ticks. Random decay is intentionally disabled. */
(function(root){
 const B=typeof module!=='undefined'?require('./board-rails.js'):root.BoardTiming,S=typeof module!=='undefined'?require('./board-support.js'):root.BoardSupport;
 const {TimingWorld,DIR,OPP}=B,P=TimingWorld.prototype,at=(p,d)=>p.map((v,i)=>v+DIR[d][i]),key=p=>p.join(',');
 const door=id=>id?.endsWith('_door'),trap=id=>id?.endsWith('_trapdoor'),gate=id=>id?.endsWith('_fence_gate'),leaf=id=>id?.endsWith('_leaves');
 Object.assign(B,{isDoor:door,isOpenable:id=>door(id)||trap(id)||gate(id)});B.EXTRA_TASKS.push('门上半放置','陷阱箱查看人数');
 const old={};for(const n of ['edit','neighbor','tickBlock','execute','own','interactAt','write'])old[n]=P[n];
 P.leafDistanceAt=function(p){const s=this.get(p);return !s?7:this.leafAnchors?.has(s.id)||B.LEAF_LOGS?.has(s.id)?0:leaf(s.id)?Number(s.states.distance??7):7;};
 P.leafDistance=function(p){return Math.min(7,...Object.keys(DIR).map(d=>this.leafDistanceAt(at(p,d))+1));};
 P.scaffoldDistance=function(p){if(this.plane==='top')return 0;const s=this.get(at(p,'down'));if(S.sturdy(s,'up','FULL'))return 0;return Math.min(s?.id==='scaffolding'?Number(s.states.distance):7,...['north','east','south','west'].map(d=>this.get(at(p,d))).filter(s=>s?.id==='scaffolding').map(s=>Number(s.states.distance)+1));};
 P.edit=function(p,c){if(c&&door(c.id)){const lower=c.states.half!=='upper';if(!lower&&this.plane!=='top'){const base=this.get(at(p,'down'));if(base?.id!==c.id||base.states.half!=='lower')throw Error('门的上半部必须连接同种门的下半部；请选择下半部放置');}if(lower){if(this.plane!=='top'&&!S.sturdy(this.get(at(p,'down')),'up'))throw Error('门下方需要完整支撑面');if(this.plane!=='top'&&this.get(at(p,'up'))&&!B.isReplaceable?.(this.get(at(p,'up'))))throw Error('门上半部位置被占用');const powered=this.powered(p)||this.plane!=='top'&&this.powered(at(p,'up'));c={id:c.id,states:{...c.states,half:'lower',open:String(powered),powered:String(powered)}};old.edit.call(this,p,c);if(this.plane!=='top')this.tasks.splice(0,0,{kind:'门上半放置',pos:p,cell:c,parent:this.parent});return;}}
   if(c&&leaf(c.id))c={id:c.id,states:{...c.states,distance:String(this.leafDistance(p)),persistent:'true'}};
   if(c?.id==='scaffolding'){const distance=this.scaffoldDistance(p);c={id:c.id,states:{...c.states,distance:String(distance),bottom:String(distance>0&&this.get(at(p,'down'))?.id!=='scaffolding')}};}
   if(c&&(trap(c.id)||gate(c.id))){const powered=this.powered(p);c={id:c.id,states:{...c.states,open:String(powered),powered:String(powered)}};}
   return old.edit.call(this,p,c);
 };
 P.neighbor=function(t){const s=this.get(t.pos);if(!s)return;
   if(door(s.id)){
    const lower=s.states.half!=='upper',other=at(t.pos,lower?'up':'down');
    if(t.kind==='PP'&&this.plane!=='top'){if(t.direction===(lower?'up':'down')){const part=this.get(other);this.set(t.pos,part?.id===s.id&&part.states.half!==s.states.half?{id:part.id,states:{...part.states,half:s.states.half}}:null);return;}if(lower&&t.direction==='down'&&!S.sturdy(this.get(at(t.pos,'down')),'up')){this.set(t.pos,null);return;}}
    if(t.kind==='NC'&&t.block!==s.id){const power=this.powered(t.pos)||this.plane!=='top'&&this.powered(other);if(power!==(s.states.powered==='true'))this.change(t.pos,s,{powered:String(power),open:String(power)},2);}return;
   }
   if(trap(s.id)||gate(s.id)){if(t.kind==='NC'){const power=this.powered(t.pos);if(power!==(s.states.powered==='true'))this.change(t.pos,s,{powered:String(power),open:String(power)},2);}else if(gate(s.id)&&['north','south','west','east'].includes(t.direction)){const ns=['north','south'].includes(s.states.facing),sides=ns?['west','east']:['north','south'];if(sides.includes(t.direction)){const inWall=String(sides.some(d=>this.get(at(t.pos,d))?.id.endsWith('_wall')));if(inWall!==s.states.in_wall)this.change(t.pos,s,{in_wall:inWall},2);}}return;}
   if(t.kind==='PP'&&leaf(s.id)){const n=this.leafDistanceAt(at(t.pos,t.direction))+1;if(n!==1||Number(s.states.distance)!==n)this.schedule(t.pos,s.id,1);return;}
   if(t.kind==='PP'&&s.id==='scaffolding'){this.schedule(t.pos,s.id,1);return;}return old.neighbor.call(this,t);
 };
 P.tickBlock=function(t){const s=this.get(t.pos);if(s?.id!==t.type)return old.tickBlock.call(this,t);if(leaf(s.id)){this.change(t.pos,s,{distance:String(this.leafDistance(t.pos))},3);return;}if(s.id==='scaffolding'){const distance=this.scaffoldDistance(t.pos);if(distance===7){if(Number(s.states.distance)===7)this.spawnFallingBlock?.(t.pos,s);else this.dropBlock?.(t.pos,s);this.set(t.pos,null);}else this.change(t.pos,s,{distance:String(distance),bottom:String(distance>0&&this.get(at(t.pos,'down'))?.id!=='scaffolding')},3);return;}if(s.id==='trapped_chest'){const c=this.containerAt(t.pos);if(c.openCount>0)this.schedule(t.pos,s.id,5);return;}return old.tickBlock.call(this,t);};
 P.own=function(p,d,direct=false){if(this.get(p)?.id==='trapped_chest')return !direct||d==='up'?Math.max(0,Math.min(15,this.containerAt(p).openCount||0)):0;return old.own.call(this,p,d,direct);};
 P.setContainerOpen=function(p,open){if(this.get(p)?.id!=='trapped_chest')return;const positions=new Map(this.inventoryRefs(p).map(r=>[key(r.pos),r.pos]));for(const q of positions.values()){const c=this.containerAt(q),before=c.openCount||0,after=open?1:0;if(before===after)continue;c.openCount=after;this.parent=this.record('陷阱箱查看人数',{pos:q,before,after});this.push([...this.nc(q,undefined,'trapped_chest'),...this.nc(at(q,'down'),undefined,'trapped_chest')]);if(after)this.schedule(q,'trapped_chest',5);}};
 P.interactAt=function(p){const s=this.get(p);if(!B.isOpenable(s?.id))return old.interactAt.call(this,p);if(this.tasks.length||this.phase!=='AT'||this.halted)throw Error('请先推进到本刻结束');if(s.id==='iron_door'||s.id==='iron_trapdoor')return false;this.steps=0;this.parent=this.record('门类交互',{pos:p});this.change(p,s,{open:String(s.states.open!=='true')},trap(s.id)?2:10);return true;};
 P.execute=function(t){if(t.kind==='门上半放置'){if(this.get(t.pos)?.id===t.cell.id)this.set(at(t.pos,'up'),{id:t.cell.id,states:{...this.get(t.pos).states,half:'upper'}});return;}old.execute.call(this,t);if(t.kind==='onPlace'){const s=this.get(t.pos);if(s?.id==='scaffolding')this.schedule(t.pos,s.id,1);}};
 B.SUPPORTED.push('doors','trapdoors','fence_gates','trapped_chest','leaves','scaffolding');if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
