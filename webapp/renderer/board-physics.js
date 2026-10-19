'use strict';
(function(root){
 const B=typeof module!=='undefined'?require('./board-household.js'):root.BoardTiming,D=typeof module!=='undefined'?require('./board-physics-data.js'):root.BoardPhysicsData;
 B.BLOCK_DEFAULTS=D.__defaults||{};
 B.LEAF_LOGS=new Set(D.__leafLogs||[]);
 B.physics=function(cell){if(!cell)return ['NORMAL',false,false,[]];let v=D[cell.id];if(v&&!Array.isArray(v))v=v.values[v.keys.map((k,i)=>cell.states?.[k]??v.defaults[i]).join(',')];return v||['NORMAL',false,false,[]];};
 B.isReplaceable=s=>!s||['water','lava','fire','short_grass','tall_grass','snow'].includes(s.id);
 B.aabb=(e)=>{const w=e.width??.6,h=e.height??1.8;return [e.pos[0]-w/2,e.pos[1],e.pos[2]-w/2,e.pos[0]+w/2,e.pos[1]+h,e.pos[2]+w/2];};
 B.intersects=(a,b)=>a[0]<b[3]&&a[3]>b[0]&&a[1]<b[4]&&a[4]>b[1]&&a[2]<b[5]&&a[5]>b[2];
 B.inventorySignal=slots=>{let total=0;for(const s of slots||[])if(s)total=Math.fround(total+Math.fround(s.count/s.max));const f=Math.fround(total/(slots?.length||1));return Math.floor(Math.fround(f*14))+(f>0?1:0);};
 const P=B.TimingWorld.prototype;
 P.entityColliders=function(box){const result=[];for(let x=Math.floor(box[0])-1;x<=Math.floor(box[3]);x++)for(let y=Math.floor(box[1])-1;y<=Math.floor(box[4]);y++)for(let z=Math.floor(box[2])-1;z<=Math.floor(box[5]);z++){const s=this.get([x,y,z]);if(!s||B.isRail(s.id))continue;if(s.id==='moving_piston'){const m=this.moving?.get([x,y,z].join(','));if(m)for(const part of B.pistonRenderParts(m)){if(this.pistonNoClip&&!part.baseOnly)continue;for(const b of B.physics(part.cell)[3])result.push(b.map((v,i)=>v+part.pos[i%3]));}}else for(const b of B.physics(s)[3])result.push(b.map((v,i)=>v+[x,y,z][i%3]));}if(this.plane==='top')result.push([-193,-1,-193,194,0,194]);return result;};
 P.moveEntityBy=function(e,requested){const delta=[...requested];if(this.plane==='side')delta[2]=0;const box=B.aabb(e),swept=box.map((v,i)=>v+(i<3?Math.min(0,delta[i]):Math.max(0,delta[i-3]))),shapes=this.entityColliders(swept),axes=Math.abs(delta[0])<Math.abs(delta[2])?[1,2,0]:[1,0,2];
   for(const a of axes){let d=delta[a];for(const b of shapes){if([0,1,2].filter(i=>i!==a).some(i=>box[i+3]<=b[i]+1e-7||box[i]>=b[i+3]-1e-7))continue;if(d>0&&box[a+3]<=b[a]+1e-7)d=Math.min(d,Math.max(0,b[a]-box[a+3]));else if(d<0&&box[a]>=b[a+3]-1e-7)d=Math.max(d,Math.min(0,b[a+3]-box[a]));}delta[a]=d;box[a]+=d;box[a+3]+=d;e.pos[a]+=d;}
   e.onGround=requested[1]<0&&delta[1]!==requested[1];e.horizontalCollision=delta[0]!==requested[0]||delta[2]!==requested[2];for(let a=0;a<3;a++)if(Math.abs(delta[a]-requested[a])>1e-8)e.velocity[a]=0;return delta;
 };
 if(typeof module!=='undefined')module.exports=B;
})(typeof window!=='undefined'?window:globalThis);
