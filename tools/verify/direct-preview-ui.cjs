'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../..'));
const out=path.join(__dirname,'direct-preview-output');fs.mkdirSync(out,{recursive:true});
process.argv=process.argv.slice(0,2);app.setPath('userData',path.join(out,'electron'));
BrowserWindow.prototype.show=function(){};
const settings=require(path.join(root,'webapp/ui-settings')),OriginalSettings=settings.UiSettings;
fs.mkdirSync(path.join(out,'settings'),{recursive:true});
fs.writeFileSync(path.join(out,'settings/ui.json'),JSON.stringify({projectionMode:'auto',previewBackend:'gpu',lodPreview:true,hideWelcome:true}));
settings.UiSettings=class extends OriginalSettings{constructor(){super(out);}};
const engine=require(path.join(root,'webapp/engine-client')),OriginalEngine=engine.EngineClient,calls=[],progress=[];
engine.EngineClient=class extends OriginalEngine{
  constructor(options){super({...options,home:process.env.LITEMATIC_TEST_HOME||options.home,classpath:process.env.LITEMATIC_TEST_CLASSPATH||options.classpath,onEvent:event=>{if(event.event==='previewProgress')progress.push({...event,at:Date.now()});options.onEvent?.(event);}});}
  call(method,params={}){if(method==='loadResources'&&process.env.LITEMATIC_TEST_HOME)params={...params,root:path.join(process.env.LITEMATIC_TEST_HOME,'assets/vanilla'),imports:[]};const record={method,streaming:params.streaming,progressId:params.progressId};calls.push(record);return super.call(method,params).then(result=>{if(method==='exportScene')Object.assign(record,{quads:result.quads,exportMillis:result.exportMillis,sceneBuildMillis:result.sceneBuildMillis});return result;});}
};
const fixture=process.env.LITEMATIC_DIRECT_SCHEMATIC||path.join(__dirname,'projection-edit-output/original.litematic');
let failed=false;
app.once('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load',async()=>{
    const evaluate=code=>win.webContents.executeJavaScript(code);
    try{
      const initial=await evaluate(`(async()=>{
        await window.__uiReady;await window.__resourcesReady;
        for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
        window.directBusyMessages=[];const originalBusy=setBusy;
        setBusy=function(on,text){if(on&&text)directBusyMessages.push(text);return originalBusy(on,text);};
        window.directStages=[];const originalStage=showPreviewStage;
        showPreviewStage=function(stage){originalStage(stage);directStages.push({stage,text:els.busyText.textContent,at:performance.now()});};
        state.projectionMode='auto';$('projectionMode').value='auto';
        await loadFile(${JSON.stringify(fixture)});
        window.directCheck=()=>{if(!state.viewReady||state.view.stream)throw Error('完整模型误入分块路径');if(els.status.textContent!=='3D 视图已就绪。')throw Error('就绪提示未结束');if(els.preloadInfo.textContent!=='完整加载无需分块预渲染。')throw Error('完整加载仍提示分块预渲染');};
        directCheck();return{quads:state.view.quadCount,messages:directBusyMessages.slice(),info:state.info,stages:directStages.slice()};
      })()`);
      assert(initial.quads>0);assert(!initial.messages.some(text=>text.includes('分块')));
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>{drawView();requestAnimationFrame(resolve);}))');
      win.webContents.invalidate();
      // 隐藏窗口需要先触发一次捕获，等待合成器发布新画面。
      await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const area=await evaluate('(()=>{const r=els.gl.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)};})()');
      const screenshot=await win.webContents.capturePage(area,{stayHidden:true,stayAwake:true});
      assert(!screenshot.isEmpty(),'GPU screenshot is empty');
      const pixels=screenshot.toBitmap(),colors=new Set();for(let i=0;i<pixels.length;i+=4)colors.add(pixels.readUInt32LE(i));
      assert(colors.size>32,'GPU screenshot lacks rendered detail');fs.writeFileSync(path.join(out,'gpu-preview.png'),screenshot.toPNG());
      if(path.basename(fixture)==='pipeline.litematic'){
        let missing=0,fixtureColor=0;for(let i=0;i<pixels.length;i+=4){const b=pixels[i],g=pixels[i+1],r=pixels[i+2];if(r>150&&b>150&&g<80)missing++;if(r>100&&g>60&&b<150)fixtureColor++;}
        assert(missing<10,'GPU fixture contains missing-texture magenta');assert(fixtureColor>100,'GPU fixture colors are missing');
        assert((await evaluate('els.stats.textContent')).includes('1 个实体暂未显示'),'unsupported entity is not visible in statistics');
      }
      const required=['lighting','geometry','optimizing','encoding','transfer','decoding','upload'];
      let last=-1;for(const stage of required){const index=initial.stages.findIndex(s=>s.stage===stage);assert(index>last,'阶段缺失或顺序不正确：'+stage);last=index;}
      await evaluate(`(()=>{
        const text=els.busyText.textContent,rendering=state.rendering;
        try{
          state.rendering=true;handlePreviewProgress({progressId:String(gpuBuildGeneration-1),stage:'lighting'});
          if(els.busyText.textContent!==text)throw Error('旧任务覆盖当前提示');
          state.stopping=true;handlePreviewProgress({progressId:String(gpuBuildGeneration),stage:'lighting'});
          if(els.busyText.textContent!==text)throw Error('停止后仍更新提示');
          state.stopping=false;state.rendering=false;handlePreviewProgress({progressId:String(gpuBuildGeneration),stage:'lighting'});
          if(els.busyText.textContent!==text)throw Error('完成后仍更新提示');
        }finally{state.rendering=rendering;state.stopping=false;}
      })()`);
      const exportsBefore=calls.filter(c=>c.method==='exportScene').length;
      await evaluate(`(async()=>{
        $('projectionMode').value='full';$('projectionMode').dispatchEvent(new Event('change'));
        const deadline=Date.now()+10000;while(!$('projectionModeInfo').textContent.startsWith('一次载入')){if(Date.now()>deadline)throw Error('加载方式切换超时');await new Promise(r=>setTimeout(r,20));}
        await new Promise(r=>setTimeout(r,150));directCheck();
      })()`);
      assert.equal(calls.filter(c=>c.method==='exportScene').length,exportsBefore,'相同加载方式重复生成模型');
      const forced=await evaluate(`(async()=>{
        const info=state.info;state.info={...info,totalBlocks:2000000,size:{x:1024,y:1024,z:1024}};
        try{await buildView({force:true,preserveCamera:true});directCheck();}finally{state.info=info;}
        state.lodPreview=false;await buildView({preserveCamera:true});directCheck();
        return{messages:directBusyMessages.slice(),status:els.status.textContent,preload:els.preloadInfo.textContent};
      })()`);
      assert(!forced.messages.some(text=>text.includes('分块')));
      assert(!calls.some(c=>['beginPreview','previewStatus','exportCachedScene'].includes(c.method)),'完整加载调用了分块生成接口');
      assert(calls.filter(c=>c.method==='exportScene').every(c=>c.streaming===false));
      const cachedId=calls.filter(c=>c.method==='exportScene').at(-1).progressId,cachedStages=progress.filter(p=>p.progressId===cachedId).map(p=>p.stage);
      assert(cachedStages.includes('cached')&&!cachedStages.includes('lighting')&&!cachedStages.includes('geometry'),'缓存命中仍显示重新计算阶段');
      if(initial.quads<10000){
        await evaluate(`(async()=>{els.lightingEnabled.checked=false;try{await buildView({force:true,preserveCamera:true});directCheck();}finally{els.lightingEnabled.checked=true;}})()`);
        const unlitId=calls.filter(c=>c.method==='exportScene').at(-1).progressId;
        assert(!progress.some(p=>p.progressId===unlitId&&p.stage==='lighting'),'关闭光照仍提示计算光照');
      }
      if(initial.quads<10000)await evaluate(`(async()=>{
        const until=async(test)=>{const deadline=Date.now()+60000;while(!test()){if(Date.now()>deadline)throw Error('切换加载方式超时');await new Promise(r=>setTimeout(r,25));}};
        $('projectionMode').value='streaming';$('projectionMode').dispatchEvent(new Event('change'));
        await until(()=>state.view?.stream&&state.viewReady&&!state.rendering&&!state.scenePreparing);
        $('projectionMode').value='full';$('projectionMode').dispatchEvent(new Event('change'));
        await until(()=>!state.view?.stream&&state.viewReady&&!state.rendering&&!state.scenePreparing);
        directCheck();
      })()`);
      assert.equal((await new OriginalSettings(out).settings()).projectionMode,'full','手动加载方式未保存');
      if(path.basename(fixture)==='pipeline.litematic'){
        const formatRoot=process.env.LITEMATIC_FORMAT_FIXTURES||path.join(root,'tools/verify/verification-output/formats');
        for(const [name,position]of [['valid-structure.nbt',[1,0,1]],['valid-sponge-2.schem',[-2,2,5]],['valid-sponge-3.schem',[-2,2,5]]]){
          const file=path.join(formatRoot,name);assert(fs.existsSync(file),'format fixture missing: '+name);
          await evaluate(`loadFile(${JSON.stringify(file)})`);
          const imported=await evaluate(`(async()=>({ready:state.viewReady,quads:state.view.quadCount,blocks:state.info.totalBlocks,container:await window.engine.inspectPosition(${JSON.stringify(position)})}))()`);
          assert(imported.ready&&imported.quads>0&&imported.blocks===2,'format did not render imported blocks: '+name);assert.equal(imported.container.id,'minecraft:chest');
        }
      }
      const result={pass:true,fixture,quads:initial.quads,reusedOnEquivalentMode:true,streamingRoundTrip:initial.quads<10000,exports:calls.filter(c=>c.method==='exportScene'),stages:initial.stages,cachedStages,...forced};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
    }catch(error){failed=true;fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:false,error:error.stack,calls,progress},null,2));console.error(error.stack);}
    finally{app.quit();}
  });
});
app.on('will-quit',()=>{if(failed)app.exit(1);});
require(path.join(root,'webapp/main.js'));
setTimeout(()=>app.exit(1),180000).unref();
