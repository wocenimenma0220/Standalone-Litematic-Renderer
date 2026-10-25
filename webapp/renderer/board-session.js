'use strict';
(function(root){
  // 历史仅保存独立的 JSON 字符串，按 UTF-16 大小限制撤销和重做的总占用。
  class History {
    constructor(budget=32*1024*1024,limit=60){this.budget=budget;this.limit=limit;this.clear();}
    clear(){this.past=[];this.future=[];this.bytes=0;}
    get canUndo(){return this.past.length>0;}
    get canRedo(){return this.future.length>0;}
    encode(value){return JSON.stringify(value);}
    trim(){while(this.bytes>this.budget||this.past.length+this.future.length>this.limit){const list=this.past.length?this.past:this.future;this.bytes-=list.shift().length*2;}}
    remember(value){for(const entry of this.future)this.bytes-=entry.length*2;this.future=[];const entry=this.encode(value);this.past.push(entry);this.bytes+=entry.length*2;this.trim();}
    transfer(from,to,current){if(!from.length)return null;const saved=from.pop();this.bytes-=saved.length*2;const entry=this.encode(current);to.push(entry);this.bytes+=entry.length*2;this.trim();return JSON.parse(saved);}
    undo(current){return this.transfer(this.past,this.future,current);}
    redo(current){return this.transfer(this.future,this.past,current);}
  }
  function persistence({capture,view,viewport,write,onError=()=>{},schedule=setTimeout,cancel=clearTimeout}){
    const sessions=new Map();let timer=null,worldChanged=false;
    function flush(){
      cancel(timer);timer=null;const key=view(),previous=sessions.get(key);
      const packet=worldChanged||!previous?capture():{...previous,...viewport()};
      worldChanged=false;sessions.set(key,packet);
      try{write(key,JSON.stringify(packet));}catch(error){onError(error);}
      return packet;
    }
    return {sessions,invalidate(){worldChanged=true;},save(immediate=false,viewOnly=false){worldChanged||=!viewOnly;cancel(timer);if(immediate)return flush();timer=schedule(flush,250);},flush};
  }
  const api={History,persistence};if(typeof module!=='undefined')module.exports=api;else root.BoardSession=api;
})(typeof window!=='undefined'?window:globalThis);
