'use strict';
/** 对应原版容器拿取、快速转移、收集、交换和均分；物品组件参与堆叠相等性判断。 */
(function(root){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  const copy=value=>JSON.parse(JSON.stringify(value)),same=(a,b)=>!!a&&!!b&&a.id===b.id&&a.max===b.max&&JSON.stringify(canonical(a.components||{}))===JSON.stringify(canonical(b.components||{}))&&(a.damage||0)===(b.damage||0);
  function item(value){if(!value||value.count===0)return null;const id=String(value.id||'').replace(/^minecraft:/,'');if(!/^[a-z0-9_]{1,128}$/.test(id)||![1,16,64,99].includes(value.max)||!Number.isInteger(value.count)||value.count<1||value.count>value.max)throw Error('背包物品无效');return {...copy(value),id,count:value.count,max:value.max};}
  function clean(saved){const state={version:1,items:Array(36).fill(null),cursor:null};if(!saved)return state;if(saved.version!==1||!Array.isArray(saved.items)||saved.items.length!==36)throw Error('背包存档无效');state.items=saved.items.map(item);state.cursor=item(saved.cursor);return state;}
  class ContainerInventory{
    constructor(container,saved,{mayPlace=()=>true,limit=(_,stack)=>stack.max}={}){this.container=container.map(item);this.player=clean(saved);this.mayPlace=mayPlace;this.limit=limit;}
    get length(){return this.container.length+36;}
    get cursor(){return this.player.cursor;}
    set cursor(value){this.player.cursor=item(value);}
    get(index){if(!Number.isInteger(index)||index<0||index>=this.length)throw Error('背包槽位无效');return index<this.container.length?this.container[index]:this.player.items[index-this.container.length];}
    set(index,value){this.get(index);if(index<this.container.length)this.container[index]=item(value);else this.player.items[index-this.container.length]=item(value);}
    accepts(index,stack){return index>=this.container.length||this.mayPlace(index,stack);}
    capacity(index,stack){return Math.min(stack.max,index<this.container.length?this.limit(index,stack):stack.max);}
    place(index,amount){const held=this.cursor,current=this.get(index);if(!held||!this.accepts(index,held)||current&&!same(current,held))return 0;const count=Math.min(amount,held.count,this.capacity(index,held)-(current?.count||0));if(count<=0)return 0;this.set(index,{...held,count:(current?.count||0)+count});this.cursor=held.count===count?null:{...held,count:held.count-count};return count;}
    click(index,{button=0,shift=false,double=false}={}){
      if(shift){this.quickMove(index);return;}if(double){this.gather(index);return;}const current=this.get(index),held=this.cursor;
      if(button===1&&!held){if(current){const count=Math.ceil(current.count/2);this.cursor={...current,count};this.set(index,current.count===count?null:{...current,count:current.count-count});}return;}
      if(!held){this.cursor=current;this.set(index,null);return;}
      if(!current||same(current,held)&&this.accepts(index,held)){this.place(index,button===1?1:held.count);return;}
      if(same(current,held)&&!this.accepts(index,held)){const count=Math.min(current.count,held.max-held.count);this.cursor={...held,count:held.count+count};this.set(index,count===current.count?null:{...current,count:current.count-count});return;}
      if(this.accepts(index,held)&&held.count<=this.capacity(index,held)){this.set(index,held);this.cursor=current;}
    }
    quickMove(index){const source=this.get(index);if(!source)return;const targets=index<this.container.length?Array.from({length:36},(_,i)=>this.container.length+35-i):Array.from({length:this.container.length},(_,i)=>i);let remaining=source.count;
      for(const occupied of [true,false])for(const target of targets){const current=this.get(target);if(!this.accepts(target,source)||!!current!==occupied||current&&!same(current,source))continue;const amount=Math.min(remaining,this.capacity(target,source)-(current?.count||0));if(amount<=0)continue;this.set(target,{...source,count:(current?.count||0)+amount});remaining-=amount;if(!remaining)break;}this.set(index,remaining?{...source,count:remaining}:null);
    }
    distribute(indices,button=0){if(!this.cursor)return;const held={...this.cursor};const eligible=[...new Set(indices)].filter(index=>{const current=this.get(index);return this.accepts(index,held)&&(!current||same(current,held))&&(current?.count||0)<this.capacity(index,held);}).slice(0,held.count);if(!eligible.length)return;const amount=button===1?1:Math.floor(held.count/eligible.length);for(const index of eligible)this.place(index,amount);}
    gather(index){if(!this.cursor){const current=this.get(index);if(!current)return;this.cursor=current;this.set(index,null);}const held=this.cursor;if(held.count===held.max)return;
      for(const full of [false,true])for(let i=0;i<this.length&&this.cursor?.count<held.max;i++){const current=this.get(i);if(!same(current,held)||(current.count===current.max)!==full)continue;const amount=Math.min(current.count,held.max-this.cursor.count);this.cursor={...this.cursor,count:this.cursor.count+amount};this.set(i,amount===current.count?null:{...current,count:current.count-amount});}
    }
    swapHotbar(index,hotbar){if(!Number.isInteger(hotbar)||hotbar<0||hotbar>8)return;const target=this.container.length+27+hotbar;if(target===index)return;const source=this.get(index),other=this.get(target);if(other&&(!this.accepts(index,other)||other.count>this.capacity(index,other)))return;this.set(index,other);this.set(target,source);}
    clone(index){const current=this.get(index);if(current&&!this.cursor)this.cursor={...current,count:current.max};}
    offer(stack){if(this.cursor&&!this.stashCursor(false))return false;this.cursor=stack;return true;}
    stashCursor(includeContainer=true){if(!this.cursor)return true;const held=this.cursor,groups=[Array.from({length:36},(_,i)=>this.container.length+i)];if(includeContainer)groups.push(Array.from({length:this.container.length},(_,i)=>i));for(const targets of groups)for(const occupied of [true,false])for(const index of targets){const current=this.get(index);if(!!current!==occupied||current&&!same(current,held))continue;this.place(index,this.cursor?.count||0);if(!this.cursor)return true;}return false;}
    snapshot(){return copy({container:this.container,player:this.player});}
  }
  const api={ContainerInventory,clean,item,same};if(typeof module!=='undefined')module.exports=api;else root.BoardContainerInventory=api;
})(typeof window!=='undefined'?window:globalThis);
