'use strict';
/** 流体状态、计划刻和实体受力共用同一世界；侧视禁止面外传播，俯视采用不可破坏的虚拟地面。 */
(function(root){
 function install(B){
  const P=B.TimingWorld.prototype,D=B.DIR,F=Math.fround,key=p=>p.join(','),at=(p,d)=>p.map((v,i)=>v+D[d][i]);
  const tags=typeof module!=='undefined'?require('./board-fluid-data.js'):root.BoardFluidData;
  const wash=new Set(tags.washed_away_by_fluids),blocked=new Set(tags.blocks_fluid_flow),replace=new Set(tags.replaceable);
  B.entityMaterial=s=>(tags.entityMaterials?.[s?.id]||[.6,1,0]).map(F);
  const H=['north','south','west','east'],clone=v=>JSON.parse(JSON.stringify(v)),norm=v=>{const n=Math.hypot(...v);return n<1e-8?[0,0,0]:v.map(x=>x/n);};
  B.EXTRA_TASKS.push('流体计划刻');
  P.ensureFluids=function(){if(!this.fluidTicks){this.fluidTicks=[];this.fluidSelected=[];this.fluidOrder=0;this.fluidCollected=-1;this.fluidInitialized=false;}this.rules??={tntExplodes:true,waterSourceConversion:true,tntExplosionDropDecay:false};};
  P.simulationCell=function(p){return this.plane==='top'&&p[1]<0?{id:'bedrock',states:{}}:this.get(p);};
  P.fluidPosition=function(p){return p.every(Number.isSafeInteger)&&p.every(v=>Math.abs(v)<=192)&&this.inPlane(p);};
  P.fluidState=function(p){const s=this.simulationCell(p);if(!s)return null;
   if(s.id==='water'||s.id==='lava'){const level=Math.max(0,Math.min(15,Number(s.states?.level)||0));return {kind:s.id,source:level===0,falling:level>=8,amount:level===0?8:level>=8?8:8-level};}
   if(s.states?.waterlogged==='true'||['bubble_column','kelp','kelp_plant','seagrass','tall_seagrass'].includes(s.id))return {kind:'water',source:true,falling:false,amount:8};return null;
  };
  P.fluidHeight=function(p,f=this.fluidState(p)){return !f?0:this.fluidState(at(p,'up'))?.kind===f.kind?1:F(f.amount/9);};
  P.collisionBoxesAt=function(p){const s=this.simulationCell(p);if(s?.id==='moving_piston'){const m=this.moving?.get(key(p));return m?B.pistonRenderParts(m).flatMap(part=>B.physics(part.cell)[3].map(b=>b.map((v,i)=>v+part.pos[i%3]))):[];}return (B.physics(s)[3]||[]).map(b=>b.map((v,i)=>v+p[i%3]));};
  P.fluidPassesFace=function(p,q,d){
   const axis=D[d].findIndex(v=>v!==0),sign=D[d][axis],other=[0,1,2].filter(a=>a!==axis),rects=[];
   for(const [pos,face]of [[p,sign>0?1:0],[q,sign>0?0:1]])for(const b of this.collisionBoxesAt(pos)){
    const local=b.map((v,i)=>v-pos[i%3]);if(face===1?local[axis+3]<1-1e-7:local[axis]>1e-7)continue;
    rects.push([local[other[0]],local[other[1]],local[other[0]+3],local[other[1]+3]]);
   }
   if(!rects.length)return true;
   const cuts=a=>[...new Set([0,1,...rects.flatMap(r=>[Math.max(0,Math.min(1,r[a])),Math.max(0,Math.min(1,r[a+2]))])])].sort((a,b)=>a-b),xs=cuts(0),ys=cuts(1);
   for(let x=1;x<xs.length;x++)for(let y=1;y<ys.length;y++){const a=(xs[x]+xs[x-1])/2,b=(ys[y]+ys[y-1])/2;if(!rects.some(r=>a>=r[0]&&a<=r[2]&&b>=r[1]&&b<=r[3]))return true;}return false;
  };
  P.canHoldFluid=function(p,kind,source=false){if(!this.fluidPosition(p))return false;const s=this.get(p),f=this.fluidState(p);
   if(!s)return true;if(f?.kind===kind)return !f.source;
   if('waterlogged'in(s.states||{}))return kind==='water'&&source&&s.states.waterlogged!=='true';
   return wash.has(s.id)||replace.has(s.id)||['water','lava'].includes(s.id);
  };
  P.newFluidState=function(p,kind){this.ensureFluids();let amount=0,sources=0;
   for(const d of H){const q=at(p,d),f=this.fluidState(q);if(f?.kind===kind&&this.fluidPassesFace(q,p,B.OPP[d])){amount=Math.max(amount,f.amount);if(f.source)sources++;}}
   const below=at(p,'down'),bf=this.fluidState(below);
   if(kind==='water'&&sources>=2&&this.rules.waterSourceConversion&&(B.physics(this.simulationCell(below))[6]||bf?.kind===kind&&bf.source))return {kind,amount:8,source:true,falling:false};
   const above=at(p,'up'),af=this.fluidState(above);if(af?.kind===kind&&this.fluidPassesFace(above,p,'down'))return {kind,amount:8,source:false,falling:true};
   amount-=kind==='water'?1:2;return amount>0?{kind,amount,source:false,falling:false}:null;
  };
  P.scheduleFluid=function(p,kind,delay=kind==='water'?5:30){this.ensureFluids();if(!this.fluidPosition(p)||this.fluidTicks.some(t=>t.kind===kind&&key(t.pos)===key(p)))return;
   this.fluidTicks.push({pos:[...p],kind,time:this.time+delay,order:this.fluidOrder++});
  };
  P.wakeFluids=function(p){for(const q of [p,...Object.keys(D).map(d=>at(p,d))]){const f=this.fluidState(q);if(f)this.scheduleFluid(q,f.kind);}};
  P.writeFluid=function(p,f){const old=this.get(p);if(old?.states?.waterlogged!==undefined){if(f?.kind==='water'&&f.source)this.change(p,old,{waterlogged:'true'},3);return;}
   if(f&&old?.id&&old.id!==f.kind&&old.id!=='water'&&old.id!=='lava')this.dropBlock?.(p,old);
   const cell=f?{id:f.kind,states:{level:String(f.source?0:f.falling?8:8-f.amount)}}:null;this.set(p,cell);
  };
  P.fluidHole=function(p,kind){const q=at(p,'down');return this.fluidPosition(q)&&this.fluidPassesFace(p,q,'down')&&(this.fluidState(q)?.kind===kind||this.canHoldFluid(q,kind,false));};
  P.fluidSlope=function(p,kind,depth,back,visited=new Set()){
   let best=1000;for(const d of H){if(d===back)continue;const q=at(p,d),k=key(q);if(visited.has(k)||!this.canHoldFluid(q,kind,false)||!this.fluidPassesFace(p,q,d))continue;
    if(this.fluidHole(q,kind))return depth;if(depth<(kind==='water'?4:2)){const seen=new Set(visited);seen.add(k);best=Math.min(best,this.fluidSlope(q,kind,depth+1,B.OPP[d],seen));}}
   return best;
  };
  P.spreadFluid=function(p,f){
   const q=at(p,'down'),below=this.fluidState(q),down=this.fluidPosition(q)&&this.fluidPassesFace(p,q,'down');
   if(down&&below?.kind!==f.kind&&below&&f.kind==='water'&&below.kind==='lava'){this.set(q,{id:below.source?'obsidian':'cobblestone',states:{}});return;}
   if(down&&f.kind==='lava'&&below?.kind==='water'){this.set(q,{id:'stone',states:{}});return;}
   if(down&&this.canHoldFluid(q,f.kind,false)){const next=this.newFluidState(q,f.kind);if(next){this.writeFluid(q,next);const sources=H.filter(d=>{const n=this.fluidState(at(p,d));return n?.kind===f.kind&&n.source;}).length;if(sources<3)return;}}
   if(!f.source&&this.fluidHole(p,f.kind))return;
   if(f.amount-(f.kind==='water'?1:2)<=0&&!f.falling)return;
   let best=1000,choices=[];
   for(const d of H){const to=at(p,d);if(!this.fluidPassesFace(p,to,d))continue;const next=this.newFluidState(to,f.kind);if(!next||!this.canHoldFluid(to,f.kind,next.source))continue;
    const old=this.fluidState(to);if(old?.kind===f.kind&&!old.source&&old.amount>=next.amount&&old.falling===next.falling)continue;
    const distance=this.fluidHole(to,f.kind)?0:this.fluidSlope(to,f.kind,1,B.OPP[d],new Set([key(p),key(to)]));
    if(distance<best){best=distance;choices=[];}if(distance===best)choices.push([to,next]);
   }for(const [to,next]of choices)this.writeFluid(to,next);
  };
  P.tickFluid=function(t){let f=this.fluidState(t.pos);if(f?.kind!==t.kind)return;
   if(f.kind==='lava'&&Object.keys(D).filter(d=>d!=='down').some(d=>this.fluidState(at(t.pos,d))?.kind==='water')){this.set(t.pos,{id:f.source?'obsidian':'cobblestone',states:{}});return;}
   if(!f.source){const next=this.newFluidState(t.pos,f.kind);if(JSON.stringify(f)!==JSON.stringify(next)){this.writeFluid(t.pos,next);if(!next)return;f=next;}}
   this.spreadFluid(t.pos,f);
  };
  P.fluidFlow=function(p,f=this.fluidState(p)){if(!f)return [0,0,0];const h=F(f.amount/9),flow=[0,0,0];
   for(const d of H){const q=at(p,d),n=this.fluidState(q);if(n&&n.kind!==f.kind)continue;let height=n?F(n.amount/9):0,diff=0;
    if(height===0){if(!blocked.has(this.simulationCell(q)?.id)){const low=this.fluidState(at(q,'down'));if(low?.kind===f.kind){height=F(low.amount/9);if(height>0)diff=F(h-F(height-F(.8888889)));}}}else diff=F(h-height);
    flow[0]+=D[d][0]*diff;flow[2]+=D[d][2]*diff;
   }
   if(f.falling&&H.some(d=>[at(p,d),at(at(p,d),'up')].some(q=>this.fluidState(q)?.kind!==f.kind&&!this.simulationCell(q)?.id?.endsWith('ice')&&B.physics(this.simulationCell(q))[6]))){const v=norm(flow);return norm([v[0],-6,v[2]]);}return norm(flow);
  };
  P.entityFluids=function(e){const box=B.aabb(e).map((v,i)=>v+(i<3?.001:-.001)),groups={};
   for(let x=Math.floor(box[0]);x<Math.ceil(box[3]);x++)for(let y=Math.floor(box[1]);y<Math.ceil(box[4]);y++)for(let z=Math.floor(box[2]);z<Math.ceil(box[5]);z++){
    const p=[x,y,z],f=this.fluidState(p);if(!f)continue;const top=y+this.fluidHeight(p,f);if(top<box[1])continue;
    const g=groups[f.kind]??={height:0,flow:[0,0,0],count:0};g.height=Math.max(g.height,top-e.pos[1]);const flow=this.fluidFlow(p,f),scale=g.height<.4?g.height:1;for(let a=0;a<3;a++)g.flow[a]+=flow[a]*scale;g.count++;
   }return groups;
  };
  P.applyFluidCurrent=function(e,groups=this.entityFluids(e)){e.inWater=!!groups.water;e.inLava=!!groups.lava;e.fluidHeight=groups.water?.height||0;
   if(e.inWater)e.fallDistance=0;
   for(const [kind,g]of Object.entries(groups)){if(g.flow.reduce((n,v)=>n+v*v,0)<F(1e-5))continue;let impulse=norm(g.flow).map(v=>v*(kind==='water'?.014:.0023333333333333335));
    if(Math.abs(e.velocity[0])<.003&&Math.abs(e.velocity[2])<.003&&Math.hypot(...impulse)<.0045)impulse=norm(impulse).map(v=>v*.0045);
    if(this.plane==='side')impulse[2]=0;for(let a=0;a<3;a++)e.velocity[a]+=impulse[a];
   }return groups;
  };
  const write=P.write,step=P.stepEvent,execute=P.execute,snapshot=P.snapshot,restore=P.restore;
  P.write=function(t){const old=this.get(t.pos);write.call(this,t);if(old!==this.get(t.pos)){
    for(const p of [t.pos,...Object.keys(D).map(d=>at(t.pos,d))]){const f=this.fluidState(p);if(f?.kind!=='lava')continue;
     if(['up',...H].some(d=>this.fluidState(at(p,d))?.kind==='water'))this.set(p,{id:f.source?'obsidian':'cobblestone',states:{}});
     else if(this.simulationCell(at(p,'down'))?.id==='soul_soil'&&H.some(d=>this.simulationCell(at(p,d))?.id==='blue_ice'))this.set(p,{id:'basalt',states:{axis:'y'}});
    }this.wakeFluids(t.pos);
   }};
  P.stepEvent=function(){if(this.halted)return false;this.ensureFluids();if(!this.fluidInitialized){this.fluidInitialized=true;for(const [k]of this.cells){const p=k.split(',').map(Number),f=this.fluidState(p);if(f)this.scheduleFluid(p,f.kind);}}
   if(this.phase==='TT'&&!this.tasks.length&&!this.selected.length){if(this.fluidCollected!==this.time){this.fluidCollected=this.time;this.fluidSelected=this.fluidTicks.filter(t=>t.time<=this.time).sort((a,b)=>a.time-b.time||a.order-b.order);this.fluidTicks=this.fluidTicks.filter(t=>t.time>this.time);}
    if(this.fluidSelected.length){if(++this.steps>100000){this.halted=true;this.record('执行预算耗尽');return false;}const t=this.fluidSelected.shift();this.execute({kind:'流体计划刻',pos:t.pos,fluidKind:t.kind});return true;}}
   return step.call(this);
  };
  P.execute=function(t){if(t.kind==='流体计划刻'){this.parent=this.record(t.kind,{pos:t.pos,fluid:t.fluidKind});this.tickFluid({pos:t.pos,kind:t.fluidKind});return;}return execute.call(this,t);};
  P.snapshot=function(){this.ensureFluids();return {...snapshot.call(this),fluids:clone({version:1,ticks:this.fluidTicks,selected:this.fluidSelected,order:this.fluidOrder,collected:this.fluidCollected,initialized:this.fluidInitialized,rules:this.rules})};};
  P.restore=function(data){const f=data.fluids;if(f){if(f.version!==1||!Array.isArray(f.ticks)||!Array.isArray(f.selected)||f.ticks.length+f.selected.length>150000||!Number.isSafeInteger(f.order)||f.order<0||!Number.isSafeInteger(f.collected)||typeof f.initialized!=='boolean')throw Error('流体存档无效');
    for(const t of [...f.ticks,...f.selected])if(!Array.isArray(t.pos)||t.pos.length!==3||!t.pos.every(Number.isSafeInteger)||!['water','lava'].includes(t.kind)||!Number.isSafeInteger(t.time)||t.time<0||!Number.isSafeInteger(t.order)||t.order<0)throw Error('流体计划刻无效');
    if(f.rules&&Object.values(f.rules).some(v=>typeof v!=='boolean'))throw Error('模拟规则无效');}
   restore.call(this,data);this.fluidTicks=clone(f?.ticks||[]);this.fluidSelected=clone(f?.selected||[]);this.fluidOrder=f?.order||0;this.fluidCollected=f?.collected??-1;this.fluidInitialized=f?.initialized??false;this.rules={tntExplodes:true,waterSourceConversion:true,tntExplosionDropDecay:false,...f?.rules};
  };
 }
 if(typeof module!=='undefined')module.exports=install;else root.BoardFluids=install;
})(typeof window!=='undefined'?window:globalThis);
