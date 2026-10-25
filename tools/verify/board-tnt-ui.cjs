'use strict';
const {chromium}=require('./browser-runtime.cjs'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',args:['--allow-file-access-from-files']});
 const out=path.join(__dirname,'tnt-ui-output');fs.mkdirSync(out,{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>{if(/board[^/]*\.js/.test(e.stack||''))errors.push(e.stack);});
  await page.goto('file:///'+path.resolve(__dirname,'../../webapp/renderer/index.html').replaceAll('\\','/'));
  await page.locator('#menuBoard').click();await page.locator('#boardViewSide').click();
  const save=async()=>{const download=page.waitForEvent('download');await page.locator('#boardSave').click();let text='';for await(const part of await(await download).createReadStream())text+=part;return JSON.parse(text);};
  const load=async packet=>{await page.locator('#boardFile').setInputFiles({name:'tnt.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packet))});await page.waitForFunction(()=>document.getElementById('boardFile').value==='');};
  const click=async(x,y,options={})=>{const p=await save(),r=await page.locator('#boardCanvas').boundingBox();await page.mouse.click(r.x+p.pan.x+(x+.5)*p.zoom,r.y+p.pan.y+(y+.5)*p.zoom,options);};
  const tick=async n=>{if(await page.locator('#boardTimingBar').isHidden())await page.locator('#boardTimingToggle').click();for(let i=0;i<n;i++)await page.locator('#boardTickStep').click();};
  await load({version:2,view:'side',cells:[['0,0',{id:'tnt'}],['0,1',{id:'stone'}]],zoom:56,pan:{x:420,y:300}});
  await click(0,0,{button:'right'});let packet=await save();assert.equal(packet.timing.entities.items.length,1);assert.equal(packet.timing.entities.items[0][1].fuse,80);
  await click(0,0,{button:'right'});assert(await page.locator('#boardSourceDialog').evaluate(d=>d.open));
  await page.locator('#boardSourceDialog [data-source-field="fuse"]').fill('3');await page.locator('#boardSourceDialog [data-source-field="velocity0"]').fill('.1');await page.locator('#boardSourceDialog [data-source-apply]').click();await page.locator('#boardSourceDialog button').filter({hasText:'关闭',exact:true}).click();
  packet=await save();assert.equal(packet.timing.entities.items[0][1].fuse,3);
  await page.locator('#boardUndo').click();assert.equal((await save()).timing.entities.items[0][1].fuse,80);await page.locator('#boardRedo').click();assert.equal((await save()).timing.entities.items[0][1].fuse,3);
  await page.screenshot({path:path.join(out,'tnt-fuse.png')});await tick(3);packet=await save();assert(!packet.timing.entities.items.some(([,e])=>e.type==='primed_tnt'));assert(packet.timing.trace.some(e=>e.kind==='爆炸完成'));assert.equal(packet.timing.explosions.jobs.length,0);
  await page.screenshot({path:path.join(out,'explosion.png')});
  await load({version:2,view:'top',cells:[['0,0',{id:'water'}]],zoom:56,pan:{x:420,y:300}});await tick(5);packet=await save();assert(packet.timing.cells.some(([k,s])=>k==='1,0,0'&&s.id==='water'));assert(packet.timing.fluids);await page.screenshot({path:path.join(out,'water.png')});
  const partial=await page.evaluate(()=>{const w=new BoardTiming.TimingWorld('side');w.cells.set('1,0,0',{id:'tnt',states:{unstable:'false'}});w.spawnEntity('primed_tnt',[.5,0,.5],{fuse:0,velocity:[0,0,0]});while(![...w.explosions?.values()||[]].some(j=>j.ray>0))w.stepEvent();return {version:3,view:'side',zoom:56,pan:{x:420,y:300},cells:[['1,0',{id:'tnt'}]],timing:w.snapshot()};});
  await load(partial);packet=await save();assert.equal(packet.timing.explosions.jobs[0][1].ray,partial.timing.explosions.jobs[0][1].ray);await page.locator('#boardFinishTick').click();packet=await save();assert.equal(packet.timing.explosions.jobs.length,0);assert(packet.timing.entities.items.some(([,e])=>e.type==='primed_tnt'&&e.fuse>=10&&e.fuse<=29));
  await page.locator('#boardTabs button').filter({hasText:'实体类',exact:true}).click();assert.equal(await page.locator('#boardPalette [data-block="primed_tnt"]').count(),1);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,checks:['右键点燃','引信与速度设置','撤销重做','3gt引爆','流体计划刻','爆炸中途保存续算','TNT实体目录']},null,2));console.log('PASS UI: TNT 点燃、参数、撤销重做、流体、爆炸和中途保存恢复');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
