'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../webapp/renderer/projection-edit.js'),'utf8');
const code=source.slice(source.indexOf('  async function applyMutation('),source.indexOf('  async function exportProjection('));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness(){
  const gate=deferred(),started=deferred(),writes=[],messages=[];
  const context={session:1,tool:'block',selected:{id:'minecraft:stone',name:'石头'},busy:false,api:{enabled:true},
    state:{viewReady:true,selection:{bounds:()=>null},view:{rayFromScreen:()=>({}),_viewDir:()=>[0,0,1]}},els:{gl:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}},
    info:{textContent:''},drawView(){},selectionWorld(){},update(){},status:m=>messages.push(m),log(){},showInspection:r=>writes.push({inspection:r}),audio:{play(){}},
    window:{engine:{editPick:async()=>({hit:true,id:'minecraft:stone',position:[1,2,3],face:[0,1,0],states:{}}),editBlock:async r=>{writes.push(r);return {changed:true};}}},
    ProjectionEditModel:{container:()=>false,adjacent:()=>[1,3,3],within:()=>true,placement:()=>[{position:[1,3,3]}],removal:()=>[{position:[1,2,3]}]},
    neighbors:async()=>{started.resolve();return gate.promise;},refresh:async()=>{}};
  vm.createContext(context);vm.runInContext(code+';this.run=interact;',context);
  return {context,gate,started,writes,messages,reset(){context.session++;context.api.enabled=false;context.busy=false;}};
}
(async()=>{
  for(const button of [0,2]){
    const h=harness(),pending=h.context.run(button,{});await h.started.promise;
    assert.equal(h.context.busy,true);assert.equal(h.context.run(button,{}),undefined);
    h.reset();h.gate.resolve([]);await pending;assert.equal(h.writes.length,0);assert.equal(h.messages.length,0);
  }
  const h=harness(),pending=h.context.run(2,{});await h.started.promise;h.gate.resolve([]);await pending;
  assert.equal(h.writes.length,1);assert.equal(h.context.busy,false);assert.equal(h.context.api.pending,null);
  const inspection=harness(),gate=deferred();inspection.context.ProjectionEditModel.container=()=>true;inspection.context.window.engine.inspectPosition=()=>gate.promise;
  const viewing=inspection.context.run(2,{});await Promise.resolve();await Promise.resolve();inspection.reset();gate.resolve({hit:true});await viewing;assert.equal(inspection.writes.length,0);
  console.log('PASS: 旧会话不能放置、删除或弹出容器；邻居查询期间禁止重叠编辑，正常操作仍可提交');
})().catch(error=>{console.error(error);process.exitCode=1;});
