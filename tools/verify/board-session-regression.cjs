'use strict';
const assert=require('node:assert/strict'),{History,persistence}=require('../../webapp/renderer/board-session');
let captures=0,zoom=1,revision=0,next=0;const timers=new Map(),writes=[];
const store=persistence({capture:()=>{captures++;return {view:'side',cells:[revision],zoom};},view:()=> 'side',viewport:()=>({zoom}),write:(key,json)=>writes.push(JSON.parse(json)),schedule:fn=>{timers.set(++next,fn);return next;},cancel:id=>timers.delete(id)});
function drain(){for(const [id,fn]of [...timers]){timers.delete(id);fn();}}
for(let i=0;i<100;i++){zoom++;store.save(false,true);}assert.equal(captures,0);assert.equal(timers.size,1);drain();assert.equal(captures,1);assert.equal(writes.at(-1).zoom,101);
for(let i=0;i<100;i++){zoom++;store.save(false,true);}drain();assert.equal(captures,1);assert.equal(writes.at(-1).zoom,201);
revision++;store.invalidate();store.save(false,true);drain();assert.equal(captures,2);assert.deepEqual(writes.at(-1).cells,[1]);
revision++;store.save();assert.equal(captures,2);store.save(true);assert.equal(timers.size,0);assert.equal(captures,3);assert.deepEqual(store.sessions.get('side').cells,[2]);
const h=new History(1000,4),original={inventory:[1]};h.remember(original);original.inventory[0]=9;assert.deepEqual(h.undo({inventory:[2]}),{inventory:[1]});assert.deepEqual(h.redo({inventory:[1]}),{inventory:[2]});
for(let i=0;i<20;i++)h.remember({i,data:'中'.repeat(50)});assert(h.bytes<=1000);assert(h.past.length+h.future.length<=4);assert(h.canUndo);
h.undo({last:true});h.remember({branch:true});assert.equal(h.canRedo,false);h.clear();assert.equal(h.bytes,0);assert.equal(h.canUndo,false);
const disk=new Map(),failures=[];
function restart(){return persistence({capture:()=>({version:3,view:'side',cells:['stone'],timing:{time:80}}),view:()=> 'side',viewport:()=>({zoom:40}),read:key=>disk.get(key),write:(key,json)=>disk.set(key,json),validate:(value,key)=>{if(value.version!==3||value.view!==key)throw Error('invalid');return value;},onError:(error,operation)=>failures.push(operation)});}
restart().save(true);
const recovered=restart();assert.deepEqual(recovered.load('side'),{version:3,view:'side',cells:['stone'],timing:{time:80}});
disk.set('side','broken');assert.equal(recovered.load('side').timing.time,80,'同次运行复用内存快照');
assert.equal(restart().load('side'),null);assert.equal(failures.at(-1),'read');
disk.set('side',JSON.stringify({version:999,view:'side'}));assert.equal(restart().load('side'),null);
disk.set('side',JSON.stringify({version:3,view:'top'}));assert.equal(restart().load('side'),null);
disk.set('top',JSON.stringify({version:3,view:'top',cells:['chest']}));assert.equal(restart().load('top').cells[0],'chest');
assert.equal(restart().load('missing'),null);
const denied=persistence({capture:()=>({cells:[1]}),view:()=> 'side',viewport:()=>({}),read:()=>{throw Error('denied');},write:()=>{throw Error('quota');},onError:(error,operation)=>failures.push(operation||'write')});
assert.equal(denied.load('side'),null);denied.save(true);assert.deepEqual(denied.load('side').cells,[1]);assert.equal(failures.at(-1),'write');
console.log('PASS: 缩放快照复用、历史预算、重启恢复、视图隔离、损坏与版本校验、读写失败保留内存');
