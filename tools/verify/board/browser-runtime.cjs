'use strict';
// 使用项目依赖或调用方明确配置的模块路径，避免绑定开发者的用户目录。
try{module.exports=require('playwright');}catch(error){
  if(process.env.PLAYWRIGHT_MODULE_PATH)module.exports=require(process.env.PLAYWRIGHT_MODULE_PATH);
  else throw Error('界面验证需要 Playwright：在 tools/verify 运行 npm install，或设置 PLAYWRIGHT_MODULE_PATH。',{cause:error});
}
