'use strict';
/** 材料面板仅依赖显式传入的界面上下文，独立管理统计、换算和导出。 */
window.installMaterialsPanel=function({$,els,state,log,toggleFileMenu}) {
// 材料清单只使用解析后的投影，不请求场景几何。
let materialReport=null,materialWaterAsIce=false,materialSourceFile=null;
function drawMaterials() {
  const query=$('materialSearch').value.trim().toLowerCase();
  for(const [key,id] of [['building','buildingMaterials'],['contents','containerMaterials']]) {
    const panel=$(id);panel.replaceChildren();const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr');
    for(const label of ['','物品名','数量','需盒']){const th=document.createElement('th');th.textContent=label;header.append(th);}head.append(header);table.append(head);
    const body=document.createElement('tbody');const rows=materialReport?.[key]||[];
    for(const row of rows.filter(r=>!query||(r.name+' '+r.id).toLowerCase().includes(query))) {
      const tr=document.createElement('tr'),icon=document.createElement('td'),name=document.createElement('td'),count=document.createElement('td'),boxes=document.createElement('td');tr.dataset.itemId=row.id;icon.className='material-icon';
      if(row.icon){const img=document.createElement('img');img.src=row.icon;img.alt='';img.width=img.height=40;img.loading='lazy';icon.append(img);}else{const missing=document.createElement('span');missing.className='material-icon-empty';missing.textContent='?';missing.title='暂无对应贴图';icon.append(missing);}
      name.textContent=row.name;const detail=document.createElement('small');detail.textContent=row.id;name.append(detail);count.textContent=Number(row.count).toLocaleString('zh-CN');
      const stacks=document.createElement('small');stacks.textContent=row.maxStack?(row.stacks+' 组 '+row.remainder+' 个'):'堆叠上限未知';count.append(stacks);boxes.textContent=row.boxes===undefined?'':row.boxes+' 盒';tr.append(icon,name,count,boxes);body.append(tr);
    }
    table.append(body);panel.append(table);if(!body.children.length){const empty=document.createElement('p');empty.className='muted small';empty.textContent=query?'没有匹配的物品':'没有已知材料';panel.append(empty);}
  }
  if(materialReport){$('materialSummary').textContent='建材 '+materialReport.building.length+' 种 · 容器内容物 '+materialReport.contents.length+' 种；潜影盒 27 格，达到半盒才显示需盒数。';$('materialWarnings').textContent=materialReport.warnings.join(' ');$('materialConvertWater').textContent=materialWaterAsIce?'恢复水桶统计':'水桶换算为冰';$('materialConvertWater').disabled=!materialReport.waterBucketCount;$('materialConversion').hidden=!materialWaterAsIce;$('materialConversion').textContent='已将建材中的 '+Number(materialReport.waterBucketCount).toLocaleString('zh-CN')+' 桶水按 1:1 换算为普通冰，并合并已有冰；导出采用当前结果。容器内物品保持原样。';}
}
async function showMaterials() {
  if(!state.file||state.rendering||state.scenePreparing)return;
  if(materialSourceFile!==state.file){materialSourceFile=state.file;materialWaterAsIce=false;}
  $('materialStatus').textContent='正在统计材料…';$('materialExport').disabled=true;$('materialConvertWater').disabled=true;$('materialDialog').showModal();
  try{materialReport=await window.engine.materials({waterAsIce:materialWaterAsIce});drawMaterials();$('materialStatus').textContent='';$('materialExport').disabled=false;}
  catch(error){$('materialStatus').textContent='统计失败：'+error.message;}
}
els.materials.addEventListener('click',showMaterials);els.menuMaterials.addEventListener('click',()=>{toggleFileMenu(false);showMaterials();});
$('materialClose').addEventListener('click',()=>$('materialDialog').close());$('materialSearch').addEventListener('input',drawMaterials);
$('materialConvertWater').addEventListener('click',async()=>{
  $('materialConvertWater').disabled=true;$('materialExport').disabled=true;$('materialStatus').textContent='正在换算…';
  try{materialReport=await window.engine.materials({waterAsIce:!materialWaterAsIce});materialWaterAsIce=materialReport.waterAsIce;drawMaterials();$('materialStatus').textContent='';}
  catch(error){$('materialStatus').textContent='换算失败：'+error.message;}
  finally{$('materialConvertWater').disabled=!materialReport?.waterBucketCount;$('materialExport').disabled=!materialReport;}
});
$('materialExport').addEventListener('click',async()=>{
  const format=$('materialFormat').value,scope=$('materialScope').value;
  $('materialExport').disabled=true;$('materialStatus').textContent='请选择保存位置…';
  try {
    const file=await window.shellApi.saveMaterials({suggested:((state.info?.name&&state.info.name!=='?'?state.info.name:SchematicFormats.stem(state.file.split(/[\\/]/).pop())).replace(/[<>:"\\/|?*\x00-\x1f]/g,'_').slice(0,120))+'-材料清单.'+format,format,scope});
    if(!file){$('materialStatus').textContent='已取消导出';return;}
    $('materialStatus').textContent='正在导出…';
    const result=await window.engine.exportMaterials({out:file,scope,waterAsIce:materialWaterAsIce});$('materialStatus').textContent='已导出：'+result.files.join('；');log('材料表已导出：'+result.files.join('；'));
  }catch(error){$('materialStatus').textContent='导出失败：'+error.message;}finally{$('materialExport').disabled=false;}
});

};
