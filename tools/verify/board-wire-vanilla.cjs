'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {TimingWorld,wireNotificationPositions}=require('../../webapp/renderer/board-pistons.js');
const cases=JSON.parse(fs.readFileSync(process.argv[2]||path.join(__dirname,'board-wire-output/vanilla-reference.json'),'utf8'));
for(const [index,sample]of cases.entries()){
  const world=new TimingWorld();for(const [p,s]of sample.cells)world.cells.set(p.join(','),s);
  assert.deepEqual(world.wireConnection(sample.pos,world.get(sample.pos)).states,sample.connection,'connection '+index);
  for(const [d,value]of Object.entries(sample.signal))assert.equal(world.own(sample.pos,d),value,'signal '+index+' '+d);
  for(const [d,value]of Object.entries(sample.direct))assert.equal(world.own(sample.pos,d,true),value,'direct '+index+' '+d);
  assert.deepEqual(wireNotificationPositions(sample.pos),sample.notifications,'HashSet '+index);
}
console.log('PASS: '+cases.length+' actual Minecraft Java 26.3 wire connection, six-direction weak/direct signals and HashSet notification reference cases');
