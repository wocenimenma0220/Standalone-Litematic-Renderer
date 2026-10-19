'use strict';
(() => {
  const $=id=>document.getElementById(id),dialog=$('boardDialog'),viewDialog=$('boardViewDialog');
  const canvas=$('boardCanvas'),ctx=canvas.getContext('2d'),catalog=[...window.BoardCatalog,...BoardTiming.ENTITY_CATALOG],defs=new Map(catalog.map(b=>[b.id,b]));
  const world=new BoardModel.BoardWorld(catalog),atlas=new Image(),partsAtlas=new Image(),tileCache=new Map(),sessions=new Map();
  defs.set('piston_head',{...BoardModel.headDefinition,...window.BoardPistonParts});
  const itemImages=new Map(BoardTiming.extraItems.map(item=>{const img=new Image();img.src='board-items/'+item.id+'.png';img.onload=()=>{dirty=true;};return [item.id,img];}));
  const categories=[['building_blocks','建筑方块'],['colored_blocks','染色方块'],['natural_blocks','自然方块'],['functional_blocks','功能方块'],['redstone_blocks','红石方块'],['op_blocks','管理员方块'],['special','水 / 岩浆 / 地狱门'],['entities','实体类'],['all','全部']];
  const names={facing:'方向',axis:'轴向',rotation:'旋转',shape:'形状',half:'半部',type:'类型',face:'附着',attachment:'附着',part:'部位',hinge:'铰链',mode:'模式',delay:'延迟',waterlogged:'含水',powered:'激活',triggered:'激活',extended:'伸出',enabled:'启用',lit:'点亮',open:'打开',power:'信号',locked:'锁定',in_wall:'嵌墙',north:'↑',south:'↓',east:'→',west:'←',up:'上连接',down:'下连接',age:'生长',stage:'阶段',layers:'层数',level:'液位',moisture:'湿度',distance:'距离',persistent:'持久',occupied:'占用',snowy:'积雪',berries:'浆果',bloom:'开花',candles:'数量',eggs:'数量',pickles:'数量',hatch:'孵化',bites:'食用',charges:'充能',honey_level:'蜂蜜',instrument:'乐器',note:'音高',sculk_sensor_phase:'阶段',short:'短臂',has_book:'书本',has_record:'唱片',orientation:'朝向',attached:'连接',disarmed:'解除',bottom:'底部',hanging:'悬挂',inverted:'反转',conditional:'条件',unstable:'不稳定',cracked:'开裂',crafting:'合成',ominous:'不祥',can_summon:'召唤',dusted:'刷扫',thickness:'粗细',vertical_direction:'方向',tilt:'倾斜',leaves:'叶片',drag:'下沉'};
  const values={true:'开',false:'关',bottom:'下',top:'上',lower:'下',upper:'上',double:'双层',single:'单体',left:'左',right:'右',head:'头部',foot:'尾部',floor:'地面',wall:'墙面',ceiling:'顶部',straight:'直线',inner_left:'内弯 ↰',inner_right:'内弯 ↱',outer_left:'外弯 ↰',outer_right:'外弯 ↱',compare:'比较',subtract:'减法',inactive:'静止',active:'激活',cooldown:'冷却',none:'无',side:'平接',up:'↑',low:'低',tall:'高'};
  Object.assign(values,{west:'西',east:'东',north:'北',south:'南',up:'上',down:'下'});
  let selected=defs.get('stone')||catalog[0],placement,category='building_blocks',zoom=40,pan={x:0,y:0};
  let erase=false,paused=true,timingVisible=false,pointer=null,hover=null,history=[],future=[],dirty=true,lastTick=0,savedTimer,animation;
  let screenWidth=1,screenHeight=1;
  let timing=null,dormantTiming=null,lastTimingRevision=-1;
  let inventoryState=BoardContainerInventory.clean(),entityTarget=null;const entityImages=new Map();function entityImage(id,facing='east',view=world.view){const d={south:0,west:1,north:2,east:3}[facing]??3,k=id+'-'+d+'-'+view;if(!entityImages.has(k)){const img=new Image();img.onload=()=>{dirty=true;};img.src='board-entities/'+k+'.png';entityImages.set(k,img);}return entityImages.get(k);}
  const compact=cell=>cell?{id:cell.id,states:{...cell.states}}:null;
  const timingBusy=()=>timing&&(timing.tasks.length||timing.phase!=='AT');
  function syncTiming(){if(!timing)return;timing.ensurePistons();timing.ensureEntities();if(timing.pendingOpenView!==undefined&&timing.phase==='AT'&&!timing.tasks.length){const active=timing.pendingOpenView;delete timing.pendingOpenView;if(timing.syncOpenContainers(active))timing.finish();}world.cells.clear();for(const [k,s]of timing.cells){const p=BoardTiming.to2(k.split(',').map(Number),world.view);if(p&&Math.abs(p[0])<=BoardModel.LIMIT&&Math.abs(p[1])<=BoardModel.LIMIT){const cell=world.normalize(s.id==='moving_piston'?timing.moving.get(k)?.movedState:s);if(cell)world.cells.set(BoardModel.key(...p),cell);}}dirty=true;}
  function commitTiming(){if(!timing)return;const changes=[];const positions=new Set([...world.cells.keys(),...[...timing.cells.keys()].map(k=>BoardTiming.to2(k.split(',').map(Number),world.view)).filter(Boolean).map(p=>BoardModel.key(...p))]);for(const k of positions){const p=BoardTiming.to3(...k.split(',').map(Number),world.view),cell=compact(world.cells.get(k));if(timing.get(p)?.id!=='moving_piston'&&JSON.stringify(cell)!==JSON.stringify(timing.get(p)||null))changes.push({kind:'set',pos:p,cell,flags:3,placed:true});}timing.parent=timing.record('玩家编辑批次');timing.steps=0;timing.push(changes);timing.finish();syncTiming();renderTiming();}
  function setPaused(value){paused=value;$('boardPause').textContent=paused?(timing?.time?'继续运行':'开始运行'):'暂停运行';$('boardPause').setAttribute('aria-pressed',String(paused));lastTick=performance.now();}
  function renderTiming(){
    $('boardTimingPanel').hidden=!timing||!timingVisible;$('boardTimingBar').hidden=!timing||!timingVisible;$('boardTimingToggle').textContent=timingVisible?'隐藏时序':'显示时序';$('boardTimingToggle').setAttribute('aria-expanded',String(timingVisible));
    for(const id of ['boardTickStep','boardPhaseStep','boardEventStep','boardTraceExport'])$(id).disabled=!timing;
    $('boardClock').textContent=timing?`${timing.time}gt · ${timing.phase}${timing.halted?' · 已停止（见事件记录）':''}`:'时序未启用';
    if(!timing||!timingVisible||lastTimingRevision===timing.revision)return;lastTimingRevision=timing.revision;
    const queue=timing.scheduled.slice().sort((a,b)=>a.triggerTick-b.triggerTick||a.priority-b.priority||a.subTickOrder-b.subTickOrder);
    $('boardTimingQueue').textContent=`待执行更新 ${timing.tasks.length} · 本刻计划刻 ${timing.selected.length} · 方块事件 ${timing.events.length} · 方块实体 ${timing.tickers.length}\n`+queue.slice(0,10).map(t=>`${t.triggerTick}gt  P${t.priority} #${t.subTickOrder} ${t.type} (${t.pos})`).concat(timing.events.slice(0,6).map(t=>`BE ${t.event.type} 动作${t.event.action} (${t.event.pos})`)).join('\n');
    const filter=$('boardTraceFilter').value.trim().toLowerCase(),host=$('boardTrace');host.replaceChildren();
    for(const row of timing.trace.filter(r=>!filter||JSON.stringify(r).toLowerCase().includes(filter)).slice(-100).reverse()){
      const label={set:'写入方块',afterSet:'写入后检查',onPlace:'放置自检',placed:'放置完成',NC:'NC 邻居更新',PP:'PP 形状更新',TT:'执行计划刻',schedule:'添加计划刻'}[row.kind]||row.kind;
      const button=document.createElement('button');button.type='button';
      if(['TT','schedule','登记计划刻'].includes(row.kind))button.className='trace-schedule';
      else if(['NC','PP'].includes(row.kind))button.className='trace-update';
      else if(row.kind==='状态变化')button.className='trace-state';
      else if(row.kind?.includes('漏斗'))button.className='trace-hopper';
      else if(row.kind?.includes('活塞')||row.kind?.includes('移动'))button.className='trace-piston';
      button.textContent=`#${row.id} ${row.gt}gt ${row.phase} ${label}${row.pos?' ('+row.pos+')':''}${row.parent?' ← #'+row.parent:''}`;
      button.title=JSON.stringify(row,null,2);if(row.kind==='状态变化')button.textContent+=`\n${row.before?.id||'air'} ${JSON.stringify(row.before?.states||{})} → ${row.after?.id||'air'} ${JSON.stringify(row.after?.states||{})}`;
      button.onclick=()=>{if(row.pos){const p=BoardTiming.to2(row.pos,world.view);if(p){pan={x:screenWidth/2-p[0]*zoom-zoom/2,y:screenHeight/2-p[1]*zoom-zoom/2};hover={x:p[0],y:p[1]};dirty=true;}}status(JSON.stringify(row));};host.append(button);
    }
  }
  const status=text=>$('boardStatus').textContent=text;
  const audio=new BoardAudio(window.BoardSounds,{onError:()=>status('音效播放失败。')});
  const tools=$('boardTools'),toolsHandle=$('boardToolsHandle');
  let toolsExpanded=false,toolsDrag=null,suppressToolsClick=false;
  function expandTools(expanded){toolsExpanded=expanded;tools.classList.toggle('is-expanded',expanded);toolsHandle.setAttribute('aria-expanded',String(expanded));toolsHandle.setAttribute('aria-label',expanded?'收起方块工具栏':'展开方块工具栏');dirty=true;}
  toolsHandle.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();suppressToolsClick=false;toolsDrag={id:event.pointerId,y:event.clientY,expanded:toolsExpanded,moved:false};toolsHandle.setPointerCapture(event.pointerId);});
  toolsHandle.addEventListener('pointermove',event=>{if(toolsDrag?.id!==event.pointerId)return;const delta=event.clientY-toolsDrag.y;if(Math.abs(delta)>10){toolsDrag.moved=true;expandTools(delta<0);}});
  toolsHandle.addEventListener('pointerup',event=>{if(toolsDrag?.id!==event.pointerId)return;suppressToolsClick=toolsDrag.moved;toolsDrag=null;});
  for(const name of ['pointercancel','lostpointercapture'])toolsHandle.addEventListener(name,event=>{if(toolsDrag?.id!==event.pointerId)return;expandTools(toolsDrag.expanded);toolsDrag=null;suppressToolsClick=true;});
  toolsHandle.addEventListener('click',event=>{if(suppressToolsClick&&event.detail>0){suppressToolsClick=false;return;}expandTools(!toolsExpanded);});
  const capture=()=>({version:3,view:world.view,cells:world.snapshot(),timing:timing?.snapshot()||null,inventory:inventoryState,zoom,pan:{...pan}});
  function updateHistory(){$('boardUndo').disabled=!history.length;$('boardRedo').disabled=!future.length;}
  function remember(){history.push(capture());if(history.length>60)history.shift();future=[];updateHistory();}
  function persist(flush=false){const packet=capture();sessions.set(packet.view,packet);clearTimeout(savedTimer);const write=()=>{try{localStorage.setItem('litematic-board-v2-'+packet.view,JSON.stringify(packet));}catch{status('暂存失败，请保存画布。');}};if(flush)write();else savedTimer=setTimeout(write,250);}
  function updateTitle(){$('boardTitle').textContent='二维搭建 · '+(world.view==='top'?'俯视':'侧视');$('boardDirections').textContent=world.view==='top'?'俯视：↑ 北  ↓ 南  ← 西  → 东\n上：朝向屏幕外 · 下：朝向屏幕内':'侧视：↑ 上  ↓ 下  ← 西  → 东\n北：朝向屏幕内 · 南：朝向屏幕外';}
  function restore(packet){const restored=packet.timing?new BoardTiming.TimingWorld():null,stored=packet.dormantTiming?new BoardTiming.TimingWorld():null,items=BoardContainerInventory.clean(packet.inventory);if(restored)restored.restore(packet.timing);if(stored)stored.restore(packet.dormantTiming);world.view=packet.view==='top'?'top':'side';world.restore(packet.cells);timing=restored;dormantTiming=stored;inventoryState=items;if(!timing)enableTiming();timing.plane=world.view;for(const k of [...timing.cells.keys()])if(!timing.inPlane(k.split(',').map(Number)))timing.cells.delete(k);syncTiming();setPaused(true);lastTimingRevision=-1;renderTiming();if(Number.isFinite(packet.zoom))zoom=Math.max(10,Math.min(160,packet.zoom));if(Number.isFinite(packet.pan?.x)&&Number.isFinite(packet.pan?.y))pan={...packet.pan};updateTitle();drawOptions();drawPalette();timing.pendingOpenView=$('boardContainerDialog').open&&!entityTarget?containerPanel.pos:null;syncTiming();if($('boardContainerDialog').open)bindContainer();dirty=true;}
  function choose(block){selected=block;placement=world.normalize({id:block.id,states:{...block.defaults,...(block.id==='observer'&&world.view==='side'?{facing:'east',powered:'false'}:{})}});if(block.id==='redstone_wire')placement=world.normalize(BoardTiming.wireCell(0,'side'));erase=false;updateBrush();drawOptions();drawPalette();dirty=true;}
  function matches(condition,states){return Object.entries(condition).every(([k,v])=>k==='OR'?v.some(c=>matches(c,states)):k==='AND'?v.every(c=>matches(c,states)):String(v).split('|').includes(states[k]));}
  function sprites(block,cell,view){
    const index=p=>view==='icon'?(p.icon??p.sprite):view==='top'?p.top:p.sprite;
    if(block.multipart?.length)return block.multipart.filter(p=>matches(p.when,cell.states)).map(index);
    const visual=block.visuals.find(v=>matches(v.when,cell.states))||block.visuals[0];return visual?[index(visual)]:[];
  }
  function tileImage(raw,view=world.view,baseOnly=false){if(defs.get(raw.id)?.entity){const c=document.createElement('canvas');c.width=c.height=32;const img=entityImage(raw.id,raw.states?.facing,view==='icon'?'side':view);if(img.complete&&img.naturalWidth)c.getContext('2d').drawImage(img,16,0,96,112,0,0,32,32);return c;}
    const cell=raw.states?raw:world.normalize(raw),key=view+':'+cell.id+':'+JSON.stringify(cell.states)+':'+baseOnly;
    if(tileCache.has(key))return tileCache.get(key);
    const block=defs.get(cell.id),c=document.createElement('canvas');c.width=c.height=32;const context=c.getContext('2d');context.imageSmoothingEnabled=false;
    const texture=cell.id==='piston_head'?partsAtlas:atlas;
    for(const index of sprites(block,cell,view))if(Number.isInteger(index)&&texture.naturalWidth)context.drawImage(texture,index%64*32,Math.floor(index/64)*32,32,32,0,0,32,32);
    const head=world.pistonHead(cell),[dx,dy]=BoardModel.pistonOffset(cell,view);
    if(!baseOnly&&head&&partsAtlas.naturalWidth&&(dx||dy||cell.states.facing===(view==='top'?'up':'north'))){
      const visual=window.BoardPistonParts.visuals.find(v=>matches(v.when,head.states)),index=visual?.overlap[view==='top'?'top':'sprite'];
      if(Number.isInteger(index))context.drawImage(partsAtlas,index%64*32,Math.floor(index/64)*32,32,32,0,0,32,32);
    }
    if(cell.id==='redstone_wire'){context.globalCompositeOperation='source-atop';context.fillStyle=`rgba(${Math.round(100+155*Number(cell.states.power||0)/15)},15,5,.6)`;context.fillRect(0,0,32,32);context.globalCompositeOperation='source-over';}
    if(cell.waterlogged){context.fillStyle='rgba(49,130,235,.38)';context.fillRect(0,0,32,32);}
    if(tileCache.size>6000)tileCache.clear();tileCache.set(key,c);return c;
  }
  function drawTile(context,cell,x,y,size,alpha=1,baseOnly=false){if(!defs.has(cell?.id)||!atlas.naturalWidth)return;context.save();context.globalAlpha=alpha;context.imageSmoothingEnabled=false;context.drawImage(tileImage(cell,world.view,baseOnly),x,y,size,size);context.restore();}
  function tile(cell,view='icon'){
    const c=document.createElement('canvas');c.width=c.height=32;if(!atlas.naturalWidth)return c;
    const context=c.getContext('2d');context.imageSmoothingEnabled=false;
    if(defs.get(cell.id)?.entity){const img=entityImage(cell.id,cell.states?.facing,view==='icon'?'side':view),paint=()=>{if(img.naturalWidth){context.clearRect(0,0,32,32);context.drawImage(img,16,0,96,112,0,0,32,32);}};if(img.complete)paint();else img.addEventListener('load',paint,{once:true});return c;}
    if(!world.pistonHead(cell)){context.drawImage(tileImage(cell,view),0,0);return c;}
    const projectedView=view==='icon'?world.view:view,[dx,dy]=BoardModel.pistonOffset(cell,projectedView),size=32/(dx||dy?2:1);
    const x=(32-size*(1+Math.abs(dx)))/2-Math.min(0,dx)*size,y=(32-size*(1+Math.abs(dy)))/2-Math.min(0,dy)*size;
    context.drawImage(tileImage(cell,projectedView),x,y,size,size);
    if(dx||dy)context.drawImage(tileImage(world.pistonHead(cell),projectedView),x+dx*size,y+dy*size,size,size);
    return c;
  }
  function drawParts(parts,alpha){for(const p of parts)drawTile(ctx,p.cell,pan.x+p.x*zoom,pan.y+p.y*zoom,zoom,alpha);}
  function setState(property,value){const states={...placement.states,[property]:value};
    if(property==='powered'&&('open' in states))states.open=value;
    placement=world.normalize({id:selected.id,states});drawOptions();dirty=true;
  }
  function drawOptions(){
    $('boardSelected').textContent=selected.name;const host=$('boardState');host.replaceChildren();
    const priority=['facing','axis','rotation','shape','half','face','type','waterlogged','powered','triggered','open','lit','extended','mode','delay'];
    const properties=Object.entries(selected.properties||{}).sort(([a],[b])=>(priority.includes(a)?priority.indexOf(a):99)-(priority.includes(b)?priority.indexOf(b):99));
    for(const [property,options] of properties){
      if(selected.id==='redstone_wire')continue;
      if(selected.id==='observer'&&property==='powered')continue;
      const field=document.createElement('fieldset'),legend=document.createElement('legend');field.dataset.property=property;legend.textContent=selected.id==='observer'&&property==='facing'?'检测方向':names[property]||property;field.append(legend);
      const iconOnly=['facing','axis','shape','rotation','orientation','vertical_direction'].includes(property);
      if(!iconOnly&&(options.length>12||options.length>6&&options.every(v=>/^\d+$/.test(v)))){
        const select=document.createElement('select');select.setAttribute('aria-label',names[property]||property);for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=values[value]||value;select.append(option);}select.value=placement.states[property];select.onchange=()=>setState(property,select.value);field.append(select);
      }else for(const value of options){
        const button=document.createElement('button');button.type='button';button.className='board-option';button.title=property+'='+value;button.setAttribute('aria-label',button.title);button.setAttribute('aria-pressed',String(placement.states[property]===value));
        button.disabled=property==='waterlogged'&&value==='true'&&placement.states.type==='double'&&selected.id.endsWith('_slab');
        button.append(tile(world.normalize({id:selected.id,states:{...placement.states,[property]:value}}),world.view));if(!iconOnly||property==='facing')button.append(document.createTextNode(values[value]||value));button.onclick=()=>setState(property,value);field.append(button);
      }
      host.append(field);
    }
    if(selected.id==='observer'){const d=placement.states.facing,p=document.createElement('p');p.id='boardObserverHint';p.textContent=`检测面朝${values[d]}，输出面朝${values[BoardTiming.OPP[d]]}；纹理箭头指向输出面。`;host.append(p);}
  }
  function drawPalette(){const query=$('boardSearch').value.trim().toLowerCase(),host=$('boardPalette');host.replaceChildren();
    const shown=catalog.filter(b=>(category==='all'||b.categories.includes(category))&&(!query||b.name.toLowerCase().includes(query)||b.id.includes(query)));
    for(const block of shown){const button=document.createElement('button');button.type='button';button.title=block.name;button.dataset.block=block.id;button.draggable=true;button.ondragstart=event=>event.dataTransfer.setData('application/x-board-block',block.id);button.setAttribute('aria-label',block.name+' · '+block.id);button.setAttribute('aria-pressed',String(block===selected));button.append(tile({id:block.id}));button.onclick=()=>choose(block);host.append(button);}
  }
  function updateBrush(){$('boardBrush').setAttribute('aria-pressed',String(!erase));$('boardEraser').setAttribute('aria-pressed',String(erase));}
  function resize(){const rect=canvas.getBoundingClientRect();screenWidth=rect.width;screenHeight=rect.height;const dpr=window.devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);dirty=true;}
  function location(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function cellAt(p){return{x:Math.floor((p.x-pan.x)/zoom),y:Math.floor((p.y-pan.y)/zoom)};}
  function canMove(from,to){const plan=world.planMove(from,to);if(!plan)return false;if(!timing)return true;const added=new Map(plan.add.map(p=>[BoardModel.key(p.x,p.y),p.cell]));return plan.add.every(p=>timing.canAttach(BoardTiming.to3(p.x,p.y,world.view),p.cell,q=>{const xy=BoardTiming.to2(q,world.view);if(!xy)return undefined;const k=BoardModel.key(...xy);return added.get(k)||(plan.remove.has(k)?undefined:timing.get(q));}));}
  function paint(cell){if(timingBusy()||timing?.halted){status('请先推进到本刻结束；执行停止时可撤销或关闭时序。');return;}const k=BoardModel.key(cell.x,cell.y);if(pointer?.last===k)return;if(pointer)pointer.last=k;
    if(timing&&selected.entity){const pos=BoardTiming.to3(cell.x,cell.y,world.view);try{timing.placeEntity(selected.id,pos,placement.states);syncTiming();renderTiming();status('');}catch(error){status(error.message);}return;}if(timing){if(Math.abs(cell.x)>BoardModel.LIMIT||Math.abs(cell.y)>BoardModel.LIMIT)return;const pos=BoardTiming.to3(cell.x,cell.y,world.view);if(timing.get(pos)?.id==='moving_piston'){status('移动中的方块请等到位后再编辑。');return;}const before=JSON.stringify(timing.get(pos)||null);let placed=erase?null:compact(placement);if(placed&&BoardTiming.isPiston(placed.id))placed.states.extended='false';if(placed?.id==='observer')placed.states.powered='false';try{timing.edit(pos,placed);timing.finish();syncTiming();renderTiming();if(!erase&&before!==JSON.stringify(timing.get(pos)||null))audio.play(placement.id);status('');}catch(error){status(error.message);}return;}
    const before=JSON.stringify(world.get(cell.x,cell.y)),changed=world.set(cell.x,cell.y,erase?null:placement);if(!changed)status(world.pistonHead(placement)&&!erase?'无法放置：活塞头位置被占用或超出画布。':'');else{status('');if(!erase&&before!==JSON.stringify(world.get(cell.x,cell.y)))audio.play(placement.id);}dirty=true;}
  function draw(){ctx.clearRect(0,0,screenWidth,screenHeight);ctx.imageSmoothingEnabled=false;
    const minX=Math.max(-BoardModel.LIMIT,Math.floor(-pan.x/zoom)),maxX=Math.min(BoardModel.LIMIT,Math.ceil((screenWidth-pan.x)/zoom)),minY=Math.max(-BoardModel.LIMIT,Math.floor(-pan.y/zoom)),maxY=Math.min(BoardModel.LIMIT,Math.ceil((screenHeight-pan.y)/zoom));
    ctx.strokeStyle='rgba(148,163,184,.12)';ctx.lineWidth=1;ctx.beginPath();for(let x=minX;x<=maxX+1;x++){const xx=Math.round(pan.x+x*zoom)+.5;ctx.moveTo(xx,Math.max(0,pan.y+minY*zoom));ctx.lineTo(xx,Math.min(screenHeight,pan.y+(maxY+1)*zoom));}for(let y=minY;y<=maxY+1;y++){const yy=Math.round(pan.y+y*zoom)+.5;ctx.moveTo(Math.max(0,pan.x+minX*zoom),yy);ctx.lineTo(Math.min(screenWidth,pan.x+(maxX+1)*zoom),yy);}ctx.stroke();
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const cell=world.get(x,y),moving=pointer?.mode==='move'&&pointer.parts.some(p=>p.x===x&&p.y===y);
      const entity=timing?.moving?.get(BoardTiming.to3(x,y,world.view).join(','));
      if(cell&&cell.id!=='water'&&!entity){const dir=BoardTiming.DIR[cell.states.facing],p=BoardTiming.to3(x,y,world.view),front=dir&&timing?.moving?.get(p.map((v,i)=>v+dir[i]).join(','));drawTile(ctx,cell,pan.x+x*zoom,pan.y+y*zoom,zoom,moving?.3:1,!!front?.source);}
      const water=world.water.get(BoardModel.key(x,y))||(world.source(x,y)?{level:0,falling:false}:null);if(water){const height=world.view==='top'||water.falling||water.level===0?1:Math.max(.125,(8-water.level)/8),left=pan.x+x*zoom,top=pan.y+(y+1-height)*zoom;ctx.save();ctx.beginPath();ctx.rect(left,top,zoom,zoom*height);ctx.clip();drawTile(ctx,{id:'water'},left,pan.y+y*zoom,zoom,moving?.3:world.view==='top'?.55+(8-water.level)*.025:.72);ctx.restore();}
    }
    if(timing)for(const m of timing.moving.values())for(const part of BoardTiming.pistonRenderParts(m)){const p=BoardTiming.to2(part.pos,world.view),s=world.normalize(part.cell);if(!p||!s)continue;drawTile(ctx,s,pan.x+p[0]*zoom,pan.y+p[1]*zoom,zoom,1,part.baseOnly);}
    if(timing)for(const e of timing.entities.values()){if(['item','projectile','primed_tnt','falling_block'].includes(e.type)){const xy=world.view==='top'?[e.pos[0],e.pos[2]]:[e.pos[0],1-e.pos[1]],size=zoom*.4,img=itemImages.get(e.item?.id);if(e.block||e.type==='primed_tnt')drawTile(ctx,e.block||{id:'tnt'},pan.x+(xy[0]-.5)*zoom,pan.y+(xy[1]-1)*zoom,zoom);else if(defs.has(e.item?.id))drawTile(ctx,{id:e.item.id},pan.x+xy[0]*zoom-size/2,pan.y+xy[1]*zoom-size/2,size);else if(img?.complete)ctx.drawImage(img,pan.x+xy[0]*zoom-size/2,pan.y+xy[1]*zoom-size/2,size,size);continue;}const img=entityImage(e.type,e.facing);if(img.complete&&img.naturalWidth)ctx.drawImage(img,pan.x+(e.pos[0]-2)*zoom,pan.y+(world.view==='top'?e.pos[2]-2:-2-e.pos[1])*zoom,4*zoom,4*zoom);}

    if(hover&&Math.abs(hover.x)<=BoardModel.LIMIT&&Math.abs(hover.y)<=BoardModel.LIMIT&&pointer?.mode!=='pan'){
      const moving=pointer?.mode==='move',blocked=moving?!canMove(pointer.from,hover):!world.canSet(hover.x,hover.y,erase?null:placement)||!erase&&timing&&!timing.canAttach(BoardTiming.to3(hover.x,hover.y,world.view),placement);
      const parts=moving?pointer.parts.map(p=>({...p,x:p.x+hover.x-pointer.from.x,y:p.y+hover.y-pointer.from.y})):erase?world.assemblyAt(hover.x,hover.y):world.assembly(hover.x,hover.y,placement);
      if(moving||!erase)drawParts(parts,moving?.7:.45);
      ctx.strokeStyle=erase||blocked?'#fb7185':'#60a5fa';ctx.lineWidth=2;
      for(const p of parts.length?parts:[hover])ctx.strokeRect(pan.x+p.x*zoom+1,pan.y+p.y*zoom+1,zoom-2,zoom-2);
    }dirty=false;
  }
  function frame(now){if(!dialog.open)return;if(!paused&&!pointer&&now-lastTick>=(timing?50:150)){if(timing){timing.tick();syncTiming();renderTiming();if(timing.halted)setPaused(true);}else world.tick();lastTick=now;dirty=true;}if(dirty&&atlas.naturalWidth)draw();animation=requestAnimationFrame(frame);}
  function home(){pan={x:Math.round(timing&&timingVisible?(screenWidth-Math.min(420,screenWidth*.45))/2-3*zoom:screenWidth/2),y:Math.round(screenHeight/3)};dirty=true;}
  function enter(view){viewDialog.close();pointer=null;hover=null;timingVisible=false;timing=null;dormantTiming=null;inventoryState=BoardContainerInventory.clean();world.view=view;world.restore([]);enableTiming();lastTimingRevision=-1;renderTiming();dialog.showModal();resize();zoom=40;home();setPaused(true);history=[];future=[];updateHistory();status('默认暂停；点击开始运行。右键操作元件 / 打开容器；Shift＋右键拖动；显示时序可查看更新。');
    const packet=sessions.get(view);if(packet)restore({...packet,view});
    updateTitle();drawOptions();drawPalette();canvas.focus();lastTick=performance.now();cancelAnimationFrame(animation);animation=requestAnimationFrame(frame);
  }
  $('menuBoard').onclick=()=>{if(document.pointerLockElement)document.exitPointerLock();viewDialog.showModal();};
  $('boardViewSide').onclick=()=>enter('side');$('boardViewTop').onclick=()=>enter('top');$('boardViewCancel').onclick=()=>viewDialog.close();
  function close(){pointer=null;persist(true);cancelAnimationFrame(animation);dialog.close();}
  $('boardClose').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('boardBrush').onclick=()=>{erase=false;updateBrush();dirty=true;};$('boardEraser').onclick=()=>{erase=true;updateBrush();dirty=true;};$('boardSearch').oninput=drawPalette;
  for(const [id,label]of categories){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(category===id));button.onclick=()=>{category=id;for(const b of $('boardTabs').children)b.setAttribute('aria-pressed',String(b===button));drawPalette();};$('boardTabs').append(button);}
  $('boardPause').onclick=()=>setPaused(!paused);$('boardHome').onclick=()=>{zoom=40;home();persist();};
  $('boardTimingToggle').onclick=()=>{if(timingVisible&&timingBusy()&&!timing.halted){remember();timing.finish();syncTiming();persist();}timingVisible=!timingVisible;lastTimingRevision=-1;renderTiming();dirty=true;};
  $('boardFinishTick').onclick=()=>{if(!timing)return;remember();setPaused(true);timing.finish();syncTiming();renderTiming();persist();};
  function enableTiming(){if(timing)return;const resumed=!!dormantTiming;timing=dormantTiming||new BoardTiming.TimingWorld(world.view);dormantTiming=null;timing.plane=world.view;timing.cells.clear();for(const [k,s]of world.cells)timing.cells.set(BoardTiming.to3(...k.split(',').map(Number),world.view).join(','),compact(s));timing.ensurePistons();timing.ensureEntities();for(const [k,c]of timing.containers)if(timing.get(k.split(',').map(Number))?.id!==c.type)timing.containers.delete(k);timing.tickers=timing.tickers.filter(t=>t.kind!=='hopper'||timing.containers.get(t.pos.join(','))?.token===t.token);for(const [k,s]of timing.cells)if(BoardTiming.containerSize(s.id))timing.containerAt(k.split(',').map(Number));timing.record('载入二维画布',{note:'只运算当前平面；俯视元件采用隐式地面支撑'});if(!resumed){const updates=[];for(const [k,s]of timing.cells){const pos=k.split(',').map(Number);if(s.id==='redstone_wire'||BoardTiming.isTorch(s.id)||BoardTiming.isRail(s.id)||s.id==='scaffolding')updates.push({kind:'onPlace',pos});if(timing.analog(pos)!==null)updates.push({kind:'比较器更新',pos});if(s.id==='redstone_block'||BoardTiming.isTorch(s.id)||s.id==='lever'&&s.states.powered==='true'||BoardTiming.isButton(s.id)&&s.states.powered==='true'||BoardTiming.isPlate(s.id)&&(s.states.powered==='true'||Number(s.states.power)>0))updates.push(...timing.nc(pos));else if(['repeater','observer'].includes(s.id)&&s.states.powered==='true')updates.push(...timing.outputTasks(pos,s));}timing.push(updates);timing.finish();}}
  for(const [id,method]of [['boardTickStep','tick'],['boardPhaseStep','stepPhase'],['boardEventStep','stepEvent']])$(id).onclick=()=>{if(!timing)return;remember();setPaused(true);timing[method]();syncTiming();renderTiming();persist();};
  $('boardTraceFilter').oninput=()=>{lastTimingRevision=-1;renderTiming();};
  $('boardTraceExport').onclick=()=>{if(!timing)return;const url=URL.createObjectURL(new Blob([JSON.stringify({version:'26.3-planar-round2',trace:timing.trace,snapshot:timing.snapshot()},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='MC微时序.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  $('boardUndo').onclick=()=>{if(!history.length)return;future.push(capture());restore(history.pop());updateHistory();persist();};$('boardRedo').onclick=()=>{if(!future.length)return;history.push(capture());restore(future.pop());updateHistory();persist();};
  let pressurePos=null,dialogWasRunning=false;
  const containerPanel=new BoardContainerPanel({defs,catalog,icon:tile,world:()=>entityTarget?timing.entityView(entityTarget):timing,inventory:()=>inventoryState,saveInventory:value=>{inventoryState=BoardContainerInventory.clean(value);},remember,save:()=>$('boardSave').click(),undo:redo=>(redo?$('boardRedo'):$('boardUndo')).click(),changed:()=>{syncTiming();renderTiming();persist();},closed:()=>{if(dialogWasRunning)setPaused(false);persist();}});
  function bindContainer(){containerPanel.bind();}
  const sourcePanel=new BoardSourcePanel({defs,world:()=>entityTarget?timing.entityView(entityTarget):timing,remember,changed:()=>{syncTiming();renderTiming();persist();},closed:()=>{if(dialogWasRunning)setPaused(false);persist();}});
  function openContainer(pos){entityTarget=null;if(timingBusy()||timing?.halted){status('请先推进到本刻结束再打开容器。');return;}dialogWasRunning=!paused;setPaused(true);containerPanel.open(pos);}
  function openPressure(pos){if(timingBusy()||timing?.halted){status('请先推进到本刻结束再操作压力板。');return;}if(!timing){remember();enableTiming();renderTiming();}pressurePos=pos;dialogWasRunning=!paused;setPaused(true);timing.ensureComponents();const contact=timing.contacts.get(pos.join(','));$('boardPressureCount').value=contact?.count||0;$('boardPressureKind').value=contact?.kind||'living';$('boardPressureInfo').textContent='';$('boardPressureDialog').showModal();}
  function closePressure(){$('boardPressureDialog').close();pressurePos=null;if(dialogWasRunning)setPaused(false);persist();}
  $('boardPressureClose').onclick=closePressure;$('boardPressureDialog').addEventListener('cancel',event=>{event.preventDefault();closePressure();});$('boardPressureApply').onclick=()=>{try{remember();timing.setContact(pressurePos,Number($('boardPressureCount').value),$('boardPressureKind').value);timing.finish();syncTiming();renderTiming();persist();$('boardPressureInfo').textContent='已应用；释放或减少接触数量会等待计划刻复查。';}catch(error){$('boardPressureInfo').textContent=error.message;}};
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(e.button>2)return;e.preventDefault();canvas.focus();const point=location(e),from=cellAt(point),cell=world.get(from.x,from.y);
    const pos=BoardTiming.to3(from.x,from.y,world.view);
    const hit=timing?.entityAt(world.view==='top'?[from.x+.5,.5,from.y+.5]:[from.x+.5,.5-from.y,.5]);if(hit&&(e.button===2||erase)&&!e.shiftKey){if(timingBusy()){status('请先完成本刻');return;}remember();if(erase){timing.removeEntity(hit.id);persist();dirty=true;return;}entityTarget=hit.id;dialogWasRunning=!paused;setPaused(true);if(hit.container)containerPanel.open(pos);else sourcePanel.open(pos);return;}entityTarget=null;
    if(e.button===2&&!e.shiftKey&&BoardTiming.containerSize(cell?.id)){openContainer(pos);return;}
    if(e.button===2&&!e.shiftKey&&timing?.sourceFields(pos).length){if(timingBusy()||timing.halted){status('请先推进到本刻结束再操作。');return;}dialogWasRunning=!paused;setPaused(true);sourcePanel.open(pos);return;}
    if(e.button===2&&!e.shiftKey&&BoardTiming.isPlate(cell?.id)){openPressure(pos);return;}
    if(timing&&e.button===2&&!e.shiftKey&&(cell?.id==='lever'||BoardTiming.isButton(cell?.id)||['comparator','repeater','note_block','redstone_wire','composter','cake','respawn_anchor'].includes(cell?.id)||BoardTiming.isOpenable(cell?.id))){if(timingBusy()||timing.halted){status('请先在时序面板中完成本刻再操作。');return;}remember();if(timing.interactAt(pos,{id:selected.id,count:1,max:BoardTiming.maxStack(selected.id)})){timing.finish();syncTiming();renderTiming();if(!['note_block','redstone_wire'].includes(cell.id))audio.play(cell.id);status(cell.id==='note_block'?'音符盒音高：'+timing.get(pos).states.note+' / 24':'');persist();}else status(cell.id==='redstone_wire'?'按原版规则，连接中的线粉保持接线；十字粉与点粉可以右键切换。':'附着方向或支撑不匹配，无法操作。');return;}
    if(timing?.moving?.has(pos.join(','))){status('移动中的方块不能拖动，请等到位后操作。');return;}
    if(timingBusy()&&e.button!==1){status('请先推进到本刻结束再编辑。');return;}canvas.setPointerCapture(e.pointerId);pointer={id:e.pointerId,mode:e.button===1?'pan':e.button===2?(cell?'move':'pan'):'paint',point,from,cell,parts:world.assemblyAt(from.x,from.y),last:null};hover=from;if(pointer.mode==='paint'){remember();paint(from);}canvas.style.cursor=pointer.mode==='pan'?'grabbing':pointer.mode==='move'?'move':'crosshair';});
  canvas.addEventListener('pointermove',e=>{const p=location(e);hover=cellAt(p);if(pointer?.id===e.pointerId){if(pointer.mode==='pan'){pan.x+=p.x-pointer.point.x;pan.y+=p.y-pointer.point.y;}else if(pointer.mode==='paint'){const from=cellAt(pointer.point),to=cellAt(p),steps=Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y));for(let i=0;i<=steps;i++)paint({x:Math.round(from.x+(to.x-from.x)*i/(steps||1)),y:Math.round(from.y+(to.y-from.y)*i/(steps||1))});}pointer.point=p;}dirty=true;});
  function endPointer(e,commit){if(!pointer||pointer.id!==e.pointerId)return;if(commit&&pointer.mode==='move'){const to=cellAt(location(e));if(canMove(pointer.from,to)){remember();const carried=timing?pointer.parts.map(part=>{const p=BoardTiming.to3(part.x,part.y,world.view),k=p.join(',');return {part,container:timing.containers.get(k)?JSON.parse(JSON.stringify(timing.containers.get(k))):null,output:timing.outputs.get(k),contact:timing.contacts.get(k),sourceData:timing.sourceData.get(k)?JSON.parse(JSON.stringify(timing.sourceData.get(k))):null};}):[];
      if(world.move(pointer.from,to)){commitTiming();if(timing){for(const entry of carried){const pos=BoardTiming.to3(entry.part.x+to.x-pointer.from.x,entry.part.y+to.y-pointer.from.y,world.view),k=pos.join(','),container=timing.containerAt(pos);if(entry.container&&container){Object.assign(container,{...entry.container,token:container.token});if(container.type==='ender_chest'){timing.enderSlots.splice(0,27,...entry.container.slots);container.slots=timing.enderSlots;}if(entry.sourceData)timing.sourceData.set(k,entry.sourceData);timing.inventoryChanged(pos,[]);timing.record('容器移动',{pos});}if(entry.output!==undefined)timing.outputs.set(k,entry.output);if(entry.contact)timing.contacts.set(k,entry.contact);if(entry.sourceData)timing.sourceData.set(k,entry.sourceData);}timing.finish();syncTiming();renderTiming();}audio.play(pointer.parts[0].cell.id);}}}pointer=null;canvas.style.cursor='crosshair';dirty=true;persist();}
  canvas.addEventListener('pointerup',e=>endPointer(e,true));canvas.addEventListener('pointercancel',e=>endPointer(e,false));canvas.addEventListener('lostpointercapture',e=>endPointer(e,false));canvas.addEventListener('pointerleave',()=>{if(!pointer)hover=null;dirty=true;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();if(pointer)return;const p=location(e),wx=(p.x-pan.x)/zoom,wy=(p.y-pan.y)/zoom;zoom=Math.max(10,Math.min(160,zoom*Math.exp(-e.deltaY*.0015)));pan={x:p.x-wx*zoom,y:p.y-wy*zoom};dirty=true;persist();},{passive:false});
  dialog.addEventListener('keydown',e=>{if(e.target.closest('input,select'))return;if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){e.preventDefault();(e.shiftKey?$('boardRedo'):$('boardUndo')).click();}if((e.ctrlKey||e.metaKey)&&e.code==='KeyS'){e.preventDefault();$('boardSave').click();}});
  $('boardSave').onclick=()=>{const blob=new Blob([JSON.stringify(capture(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='二维搭建.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  $('boardLoad').onclick=()=>$('boardFile').click();$('boardFile').onchange=async()=>{const file=$('boardFile').files[0];if(!file)return;try{if(file.size>20*1024*1024)throw new Error('文件超过 20 MB');const data=JSON.parse(await file.text());if(![1,2,3].includes(data.version))throw new Error('不支持的格式');const test=new BoardModel.BoardWorld(catalog,data.view==='top'?'top':data.view==='side'?'side':world.view);test.restore(data.cells);if(data.timing)new BoardTiming.TimingWorld().restore(data.timing);remember();persist();restore({...data,view:data.view||world.view,cells:test.snapshot()});persist();status('');}catch(error){status('打开失败：'+error.message);}finally{$('boardFile').value='';}};
  new ResizeObserver(()=>{if(dialog.open)resize();}).observe($('boardStage'));
  atlas.onload=()=>{tileCache.clear();drawOptions();drawPalette();dirty=true;};atlas.onerror=()=>status('贴图加载失败。');
  partsAtlas.onload=()=>{tileCache.clear();drawOptions();drawPalette();dirty=true;};partsAtlas.onerror=()=>status('活塞头贴图加载失败。');partsAtlas.src='board-piston-parts.png';
  atlas.src='board-atlas.png';updateHistory();choose(selected);renderTiming();
})();
