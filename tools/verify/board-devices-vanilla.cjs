'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const B=require('../../webapp/renderer/board-pistons.js'),{TimingWorld}=B;
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'board-devices-output/vanilla-reference.json'),'utf8'));
const w=new TimingWorld();for(const fixture of data.analog){w.cells.set('0,0,0',fixture.cell);assert.equal(w.analog([0,0,0]),fixture.signal,JSON.stringify(fixture));}
for(const f of data.torches){w.cells.set('0,0,0',f.cell);for(const d of Object.keys(B.DIR)){assert.equal(w.own([0,0,0],d),f.weak[d],JSON.stringify(f));assert.equal(w.own([0,0,0],d,true),f.strong[d],JSON.stringify(f));}}
for(const f of data.rails)assert.deepEqual(B.railConnections([0,0,0],f.cell),f.connections);
for(const f of data.inventories){const id={1:'decorated_pot',3:'furnace',5:'hopper',9:'dispenser',27:'chest',54:'chest'}[f.size],v=new TimingWorld();v.cells.set('0,0,0',{id,states:f.size===54?{type:'right',facing:'north'}:{}});if(f.size===54)v.cells.set('-1,0,0',{id:'chest',states:{type:'left',facing:'north'}});const refs=v.inventoryRefs([0,0,0]);assert.equal(refs.length,f.size);f.items.forEach((item,i)=>refs[i].container.slots[refs[i].index]=item);assert.equal(v.analog([0,0,0]),f.signal,JSON.stringify(f));}
const rng=new TimingWorld();for(const f of data.slots){const container={slots:Array.from({length:9},(_,i)=>f.mask&(1<<i)?{id:'stone',count:1,max:64}:null)};assert.equal(rng.randomDispenseSlot(container),f.slot,JSON.stringify(f));}
console.log(`PASS real MC 26.3: ${data.analog.length} analog states, ${data.torches.length*12} torch weak/direct signals, ${data.rails.length} rail endpoint shapes, ${data.inventories.length} inventory outputs, ${data.slots.length} Java random reservoir selections`);
