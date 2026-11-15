'use strict';

const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { promisify } = require('node:util');
const zlib = require('node:zlib');
const { inflateSync } = zlib;
const inflateAsync = promisify(zlib.inflate);
const RAW_PAGE_LIMIT=16*1024*1024,TRANSFER_SCRATCH_LIMIT=80*1024*1024;
const BATCH_PAGE_LIMIT=128,BATCH_RAW_LIMIT=2*1024*1024;
const BATCH_DECODE_CONCURRENCY=4;
let CRC_TABLE=null;
function jsCrc32(bytes){
  if(!CRC_TABLE)CRC_TABLE=Array.from({length:256},(_,i)=>{for(let b=0;b<8;b++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
  let value=0xffffffff;
  for(let i=0;i<bytes.length;i++)value=CRC_TABLE[(value^bytes[i])&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
}
function crc32(bytes){return typeof zlib.crc32==='function'?(zlib.crc32(bytes)>>>0):jsCrc32(bytes);}
const INLINE_LIMIT = 32 * 1024 * 1024;
const CHUNK_LIMIT = 8 * 1024 * 1024;

/** 当前场景的只读传输能力受大小和归属限制，不接受界面提供的任意文件路径。 */
class SceneTransfer {
  constructor() { this.current = null;this.scenes=new Map();this.decoding=false;this.peakScratchBytes=0;this.generation=0; }
  async readPage(owner,id,page) {
    if(this.decoding)throw new Error('页面读取队列已满');
    this.decoding=true;
    try{return await this.decodePage(owner,id,page);}finally{this.decoding=false;}
  }
  async readPages(owner,id,pages) {
    if(this.decoding)throw new Error('页面读取队列已满');
    if(!Array.isArray(pages)||!pages.length||pages.length>BATCH_PAGE_LIMIT)throw new Error('无效的模型页批次');
    let held=0;
    for(const page of pages){
      this.validatePage(owner,id,page);held+=page.rawBytes;
      if(held>BATCH_RAW_LIMIT)throw new Error('模型页批次超过空间预算');
    }
    this.decoding=true;
    try{
      const packets=new Array(pages.length);
      let cursor=0;
      const worker=async()=>{
        while(true){
          const index=cursor++;
          if(index>=pages.length)return;
          packets[index]=await this.decodePage(owner,id,pages[index],held,true);
        }
      };
      await Promise.all(Array.from({length:Math.min(BATCH_DECODE_CONCURRENCY,pages.length)},worker));
      return packets;
    }
    finally{this.decoding=false;}
  }
  validatePage(owner,id,page) {
    const {offset,bytes,rawBytes,codec,checksum}=page||{};
    if(![offset,bytes,rawBytes,codec,checksum].every(Number.isSafeInteger)||bytes<1||rawBytes<1||rawBytes>RAW_PAGE_LIMIT
      ||codec<0||codec>3||!((codec&1)===0&&bytes===rawBytes||(codec&1)===1&&bytes<rawBytes)||checksum<0||checksum>0xffffffff)throw new Error('无效的压缩页');
    const scene=this.scenes.get(id);
    if(!scene||scene.owner!==owner)throw new Error('模型已更新，请重新加载预览。');
    if(offset<0||offset+bytes>scene.size)throw new Error('无效的模型分块请求。');
  }
  async decodePage(owner,id,page,held=0,parallel=false) {
      this.validatePage(owner,id,page);const {offset,bytes,rawBytes,codec,checksum}=page;
      const scratch=held+bytes+rawBytes*3+1024*1024;if(scratch>TRANSFER_SCRATCH_LIMIT)throw new Error('页面读取超过临时空间预算');
      this.peakScratchBytes=Math.max(this.peakScratchBytes,scratch);
      let wire;
      if(bytes<=CHUNK_LIMIT){
        wire=Buffer.from(await this.read(owner,id,offset,bytes));
      }else{
        wire=Buffer.allocUnsafeSlow(bytes);
        for(let at=0;at<bytes;at+=CHUNK_LIMIT){const n=Math.min(CHUNK_LIMIT,bytes-at);wire.set(new Uint8Array(await this.read(owner,id,offset+at,n)),at);}
      }
      const started=performance.now();
      const raw=(codec&1)===1?((parallel||bytes>=4096)?await inflateAsync(wire,{maxOutputLength:rawBytes}):inflateSync(wire,{maxOutputLength:rawBytes})):wire;
      if(raw.length!==rawBytes||crc32(raw)!==checksum)throw new Error('模型页校验失败，请重新渲染');
      if(this.scenes.get(id)?.owner!==owner)throw new Error('模型已更新，请重新加载预览。');
      const data=(raw.byteOffset===0&&raw.byteLength===raw.buffer.byteLength)?raw.buffer:raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);
      return {data,storedBytes:bytes,decodedBytes:rawBytes,decodeMillis:performance.now()-started,scratchLimitBytes:TRANSFER_SCRATCH_LIMIT,peakScratchBytes:this.peakScratchBytes,cpuCacheBytes:0};
  }
  async close() {
    ++this.generation;
    const previous = [...this.scenes.values()],pending=this.closing;
    this.current = null;this.scenes.clear();
    this.closing=(async()=>{await pending;while(this.decoding)await new Promise(resolve=>setTimeout(resolve,2));for(const scene of previous)await scene.file.close();})();
    await this.closing;
  }
  async open(path, owner, options={}) {
    const closing=!options.retain?this.close():this.closing;
    const generation=this.generation;
    await closing;
    if(generation!==this.generation)throw new Error('模型已更新，请重新加载预览。');
    if(this.scenes.size>=2)throw new Error('预览文件数量超限');
    const file = await fs.open(path, 'r');
    try {
      const actual = (await file.stat()).size,size=options.growing?options.committedBytes:actual;
      if(generation!==this.generation)throw new Error('模型已更新，请重新加载预览。');
      if(!Number.isSafeInteger(size)||size<0||size>actual)throw new Error('无效的已发布模型长度');
      const id = randomUUID();
      this.current = { id, file, size, owner, growing:options.growing===true,key:options.key };
      this.scenes.set(id,this.current);
      return { id, size, chunkBytes: CHUNK_LIMIT };
    } catch (error) { await file.close(); throw error; }
  }
  commit(owner,key,size){
    const scene=[...this.scenes.values()].find(scene=>scene.owner===owner&&scene.key===key&&scene.growing);
    if(scene){if(!Number.isSafeInteger(size)||size<scene.size)throw new Error('无效的区块发布长度');scene.size=size;}
  }
  async read(owner, id, offset, length) {
    const scene = this.scenes.get(id);
    if (!scene || scene.owner !== owner) throw new Error('模型已更新，请重新加载预览。');
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 1
      || length > CHUNK_LIMIT || offset + length > scene.size) throw new Error('无效的模型分块请求。');
    const bytes = Buffer.allocUnsafeSlow(length);
    let done = 0;
    while (done < length) {
      const result = await scene.file.read(bytes, done, length - done, offset + done);
      if (!result.bytesRead) throw new Error('模型文件不完整，请重新渲染。');
      done += result.bytesRead;
    }
    if (this.scenes.get(id) !== scene) throw new Error('模型已更新，请重新加载预览。');
    return bytes.buffer;
  }
}
module.exports = { SceneTransfer, INLINE_LIMIT, CHUNK_LIMIT,crc32,TRANSFER_SCRATCH_LIMIT,BATCH_PAGE_LIMIT,BATCH_RAW_LIMIT };
