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
console.log('PASS: 连续缩放合并保存、视角保存复用快照、模拟变化失效、即时收尾、历史独立和内存上限');
