'use strict';
const fs=require('node:fs'),path=require('node:path');
function versionInfo(root=path.resolve(__dirname,'..')){
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'webapp/package.json'),'utf8'));
  if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(pkg.version)||pkg.version.includes('tetst'))throw Error('版本格式无效，请使用如 1.2.0-test-v2');
  const display=pkg.version.replace(/-test-v(\d+)$/,'test-v$1');
  return {version:pkg.version,display,assembly:pkg.version.split('-')[0]+'.0',title:pkg.productName+' '+display,zipName:'Litematic-Viewer-'+display+'-win-x64'};
}
function sync(root,{write=false,version}={}){
  const pkgFile=path.join(root,'webapp/package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));
  if(version){if(!write)throw Error('修改版本需要 --write');pkg.version=version;}
  const before=fs.readFileSync(pkgFile,'utf8');
  if(write){delete pkg.displayVersion;fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');}
  let info;
  try{info=versionInfo(root);}catch(error){if(write)fs.writeFileSync(pkgFile,before);throw error;}
  const lockFile=path.join(root,'webapp/package-lock.json'),lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));
  const target=path.join(root,'webapp/renderer/app-version.js');
  const source="'use strict';\n// 由 tools/version.cjs 生成；修改 webapp/package.json 后运行 node tools/version.cjs --write。\nwindow.AppVersion="+JSON.stringify(info)+";\n";
  if(write){lock.version=info.version;lock.packages[''].version=info.version;fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');fs.writeFileSync(target,source);}
  else if(pkg.displayVersion!==undefined||lock.version!==info.version||lock.packages[''].version!==info.version||!fs.existsSync(target)||fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==source)throw Error('版本信息不同步，请运行 node tools/version.cjs --write');
  return info;
}
module.exports={versionInfo,sync};
if(require.main===module){try{const args=process.argv.slice(2),write=args.includes('--write'),version=args.find(arg=>!arg.startsWith('--'));const info=sync(path.resolve(__dirname,'..'),{write,version});console.log(args.includes('--json')?JSON.stringify(info):'PASS: '+info.title+'，锁文件和界面版本一致');}catch(error){console.error(error.message);process.exitCode=1;}}
