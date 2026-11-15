'use strict';
(function(root){
  const scripts=['board-piston-parts.js','board-world.js','board-support-data.js','board-support.js','board-timing.js','board-components.js','board-wire.js','board-analog.js','board-devices.js','board-rails.js','board-household.js','board-physics-data.js','board-physics.js','board-pistons.js','board-entities.js','board-item-data.js','board-fluid-data.js','board-fluids.js','board-explosions.js','board-tnt.js','board-world-features.js','board-container-inventory.js','board-source-panel.js','board-container-panel.js','board-session.js','board-entity-sounds.js','board.js'];
  if(typeof module!=='undefined'){module.exports={scripts};return;}
  const audioScripts=['board-sounds.js','board-audio.js'];
  const loaded=new Set(),inflight=new Map();let pending=null,audioPending=null;
  function loadScript(file){
    if(loaded.has(file))return Promise.resolve();
    if(inflight.has(file))return inflight.get(file);
    const task=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=file;script.async=false;
      script.onload=()=>{loaded.add(file);inflight.delete(file);resolve();};
      script.onerror=()=>{inflight.delete(file);script.remove();reject(Error('加载失败：'+file));};
      document.head.append(script);
    });
    inflight.set(file,task);
    return task;
  }
  function loadAudio(){
    if(root.BoardSounds&&root.BoardAudio)return Promise.resolve();
    if(audioPending)return audioPending;
    audioPending=(async()=>{for(const file of audioScripts)await loadScript(file);})().catch(error=>{audioPending=null;throw error;});
    return audioPending;
  }
  function load(){
    if(pending)return pending;
    pending=(async()=>{await loadAudio();for(const file of scripts)await loadScript(file);})().catch(error=>{pending=null;throw error;});return pending;
  }
  root.loadBoardAudio=loadAudio;
  root.loadBoard=load;
  const button=document.getElementById('menuBoard'),label=button.textContent;
  button.onclick=async()=>{button.disabled=true;button.textContent='正在加载…';try{await load();button.disabled=false;button.click();}catch(error){button.title=error.message;}finally{button.disabled=false;button.textContent=label;}};
})(typeof window!=='undefined'?window:globalThis);
