'use strict';
(function(root){
  const scripts=['board-piston-parts.js','board-world.js','board-support-data.js','board-support.js','board-timing.js','board-components.js','board-wire.js','board-analog.js','board-devices.js','board-rails.js','board-household.js','board-physics-data.js','board-physics.js','board-pistons.js','board-entities.js','board-item-data.js','board-fluid-data.js','board-fluids.js','board-explosions.js','board-tnt.js','board-world-features.js','board-container-inventory.js','board-source-panel.js','board-container-panel.js','board-session.js','board-entity-sounds.js','board.js'];
  if(typeof module!=='undefined'){module.exports={scripts};return;}
  const loaded=new Set();let pending=null;
  function load(){
    if(pending)return pending;
    pending=(async()=>{for(const file of scripts){if(loaded.has(file))continue;await new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src=file;script.async=false;
      script.onload=()=>{loaded.add(file);resolve();};script.onerror=()=>{script.remove();reject(Error('加载失败：'+file));};document.head.append(script);
    });}})().catch(error=>{pending=null;throw error;});return pending;
  }
  root.loadBoard=load;
  const button=document.getElementById('menuBoard'),label=button.textContent;
  button.onclick=async()=>{button.disabled=true;button.textContent='正在加载…';try{await load();button.disabled=false;button.click();}catch(error){button.title=error.message;}finally{button.disabled=false;button.textContent=label;}};
})(typeof window!=='undefined'?window:globalThis);
