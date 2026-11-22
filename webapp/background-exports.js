'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {EngineClient}=require('./engine-client');

async function moveFile(source,target){
  try{
    await fs.rename(source,target);
  }catch(error){
    if(error?.code!=='EXDEV')throw error;
    const staging=path.join(path.dirname(target),`.tmp-export-${randomUUID()}`);
    try{await fs.copyFile(source,staging);await fs.rename(staging,target);await fs.unlink(source).catch(()=>{});}
    catch(copyErr){await fs.unlink(staging).catch(()=>{});throw copyErr;}
  }
}

/** 后台导出每次只运行一个独立引擎，预览继续使用自己的引擎和投影。 */
class BackgroundExports {
  constructor({home,runtime,onUpdate=()=>{},Client=EngineClient}){
    this.home=home;this.runtime=runtime;this.onUpdate=onUpdate;this.Client=Client;this.jobs=[];this.running=null;this.closed=false;
    this.reuseWorker=Client===EngineClient;this.warmWorker=null;this.warmTimer=null;this.activeJob=null;this.workerEpoch=0;
  }
  clearWarmTimer(){if(this.warmTimer){clearTimeout(this.warmTimer);this.warmTimer=null;}}
  async resetWorker(){
    this.workerEpoch++;
    this.clearWarmTimer();
    const worker=this.warmWorker;this.warmWorker=null;
    if(worker)await worker.stop().catch(()=>{});
  }
  status(job){return {id:job.id,kind:job.kind,name:path.basename(job.out),path:job.out,state:job.state,stage:job.stage,completed:job.completed||0,total:job.total||0,error:job.error,result:job.result};}
  list(){return this.jobs.map(job=>this.status(job));}
  publish(job){this.onUpdate(this.status(job));}
  recordExternal({kind,out,result}){
    const job={id:randomUUID(),kind,out:path.resolve(out),directory:null,state:'completed',stage:'completed',result:{...result,path:path.resolve(out)}};
    this.jobs.push(job);this.publish(job);
    const finished=this.jobs.filter(j=>['completed','failed','cancelled'].includes(j.state));
    for(const old of finished.slice(0,-8))this.jobs.splice(this.jobs.indexOf(old),1);
    return this.status(job);
  }
  async submitSpoolGif({id,directory,spoolPath,params}){
    if(this.closed)throw Error('应用正在退出');
    if(!spoolPath||!params?.out||!path.isAbsolute(params.out))throw Error('导出参数无效');
    const out=path.resolve(params.out);
    if(this.jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)&&path.resolve(job.out).toLowerCase()===out.toLowerCase()))throw Error('这个文件已有导出任务，请选择其他文件名');
    const job={id:id||randomUUID(),kind:'gif',isSpool:true,spoolPath,out,directory,params:structuredClone(params),state:'queued',stage:'queued'};
    this.jobs.push(job);this.publish(job);
    const finished=this.jobs.filter(j=>['completed','failed','cancelled'].includes(j.state));
    for(const old of finished.slice(0,-8))this.jobs.splice(this.jobs.indexOf(old),1);
    this.pump();return this.status(job);
  }
  async submit({kind,source,params,resources,versionMapping}){
    if(this.closed)throw Error('应用正在退出');
    if(!['png','gif'].includes(kind)||!source||!params?.out||!path.isAbsolute(params.out))throw Error('导出参数无效');
    if(this.jobs.some(job=>!['completed','failed','cancelled'].includes(job.state)&&path.resolve(job.out).toLowerCase()===path.resolve(params.out).toLowerCase()))throw Error('这个文件已有导出任务，请选择其他文件名');
    const out=path.resolve(params.out),stagingRoot=path.join(this.home,'cache','exports');
    await fs.mkdir(stagingRoot,{recursive:true});
    const directory=await fs.mkdtemp(path.join(stagingRoot,'export-'));
    try{
      const input=path.join(directory,'source.litematic');await fs.copyFile(source,input);
      params=structuredClone(params);resources=structuredClone(resources);versionMapping=versionMapping?structuredClone(versionMapping):null;
      if(params.backgroundImage){const image=path.join(directory,'background'+path.extname(params.backgroundImage));await fs.copyFile(params.backgroundImage,image);params.backgroundImage=image;}
      if(this.closed)throw Error('应用正在退出');
      const job={id:randomUUID(),kind,out,directory,input,params,resources,versionMapping,state:'queued',stage:'queued'};
      this.jobs.push(job);this.publish(job);
      // 保留最近完成结果，以及全部尚未结束的导出任务。
      const finished=this.jobs.filter(j=>['completed','failed','cancelled'].includes(j.state));
      for(const old of finished.slice(0,-8))this.jobs.splice(this.jobs.indexOf(old),1);
      this.pump();return this.status(job);
    }catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}
  }
  pump(){
    if(this.running||this.closed)return;
    const job=this.jobs.find(j=>j.state==='queued');if(!job)return;
    this.running=this.run(job).finally(()=>{this.running=null;this.pump();});
  }
  async run(job){
    const alive=()=>{if(job.cancelled||this.closed)throw Error('导出已取消');};
    this.clearWarmTimer();
    job.state='running';job.stage='resources';this.publish(job);
    this.activeJob=job;
    const epoch=this.workerEpoch;
    let worker=this.reuseWorker&&this.warmWorker?.isRunning()?this.warmWorker:null;
    this.warmWorker=null;
    const fresh=!worker;
    if(fresh){
      worker=new this.Client({...this.runtime,home:this.home,onEvent:event=>{
        const current=this.activeJob;
        if(event.event==='exportProgress'&&current&&!current.cancelled){current.stage=event.stage;current.completed=event.completed;current.total=event.total;this.publish(current);}
      }});
    }
    job.worker=worker;
    let healthy=false;
    try{
      if(fresh){
        await worker.start();alive();
        try{os.setPriority(worker.proc.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{ }
      }
      const output=path.join(job.directory,'result.'+job.kind);
      let result;
      if(job.isSpool){
        job.stage='encoding';job.completed=0;job.total=job.params.frames;this.publish(job);
        result=await worker.call('writeAnimatedGif',{spool:job.spoolPath,out:output,width:job.params.width,height:job.params.height,frames:job.params.frames,delay:job.params.delay});alive();
      }else{
        await worker.call('loadResources',job.resources);alive();
        if(job.versionMapping){await worker.call('setVersionMapping',job.versionMapping);alive();}
        job.stage='opening';this.publish(job);await worker.call('open',{path:job.input});alive();
        job.stage='building';this.publish(job);
        result=await worker.call(job.kind==='gif'?'renderAnimation':'render',{...job.params,out:output});alive();
      }
      job.stage='saving';this.publish(job);
      await moveFile(output,job.out);
      job.result={...result,...(job.isSpool?{gpu:true}:{}),path:job.out};job.state='completed';job.stage='completed';
      healthy=true;
    }catch(error){job.state=job.cancelled||this.closed?'cancelled':'failed';job.stage=job.state;if(job.state==='failed')job.error=error.message;}
    finally{
      this.activeJob=null;job.worker=null;
      const keepWarm=this.reuseWorker&&healthy&&!this.closed&&!job.cancelled&&epoch===this.workerEpoch&&!this.warmWorker;
      if(!keepWarm){
        await (this.reuseWorker&&typeof worker.forceStop==='function'?(job.cancelled?worker.forceStop():worker.stop()):worker.stop()).catch(()=>{});
      }else{
        this.warmWorker=worker;
        this.warmTimer=setTimeout(()=>this.resetWorker(),180000);this.warmTimer.unref?.();
      }
      if(job.directory)try{await fs.rm(job.directory,{recursive:true,force:true});}catch{/** 临时目录被占用不能把已成功的导出改为失败。 */}
      this.publish(job);
    }
  }
  async cancel(id){
    const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('找不到导出任务');
    if(['completed','failed','cancelled'].includes(job.state))return this.status(job);
    if(job.stage==='saving')return this.status(job);
    job.cancelled=true;
    if(job.state==='queued'){
      job.state=job.stage='cancelled';await fs.rm(job.directory,{recursive:true,force:true});
    }else {job.state=job.stage='cancelling';if(job.worker){if(this.reuseWorker&&typeof job.worker.forceStop==='function')await job.worker.forceStop();else await job.worker.stop();}}
    this.publish(job);return this.status(job);
  }
  async close(){
    this.closed=true;
    await Promise.all(this.jobs.filter(j=>!['completed','failed','cancelled'].includes(j.state)).map(j=>this.cancel(j.id)));
    if(this.running)await this.running;
    await this.resetWorker();
  }
}
module.exports={BackgroundExports};
