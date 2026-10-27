'use strict';
(function(root){
  const extensions=['litematic','nbt','schem'];
  const accepts=file=>typeof file==='string'&&extensions.includes(file.split('.').pop().toLowerCase());
  const stem=file=>String(file).replace(/\.(litematic|nbt|schem)$/i,'');
  const api={extensions,accepts,stem,label:'.litematic / .nbt / .schem'};
  if(typeof module!=='undefined')module.exports=api;else root.SchematicFormats=api;
})(typeof window!=='undefined'?window:globalThis);
