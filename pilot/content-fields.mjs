import { fail } from './common.mjs';
export const ICP_URL='https://beian.miit.gov.cn/';
export function contentFields(input,{required=false}={}) {
 const result={};
 for(const key of ['title','intro','phone','icp_number','icp_url'])if(Object.hasOwn(input,key)){
  if(typeof input[key]!=='string')fail(key+' 必须是文本');
  result[key]=input[key].trim();
  if(result[key].length>(key==='intro'?2000:200))fail(key+' 过长');
 }
 if(result.phone){result.phone=result.phone.replace(/[\s()-]/g,'');if(!/^\+?\d{5,20}$/.test(result.phone))fail('电话需为5–20位数字，可带国际区号');}
 if(result.icp_url&&result.icp_url!==ICP_URL)fail('备案链接只能是 '+ICP_URL);
 if(required&&(!result.phone||!result.icp_number))fail('此模板发布前必须填写联系电话和备案号');
 if(required||Object.hasOwn(result,'icp_number'))result.icp_url=ICP_URL;
 return result;
}
