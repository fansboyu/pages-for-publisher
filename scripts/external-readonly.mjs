// Explicit, read-only supplier smoke check. Never submits an article.
import { localEnv } from './pilot-env.mjs';
await localEnv();
if(!process.env.XIAOQINGWA_API_KEY)throw Error('请先在.env.local配置XIAOQINGWA_API_KEY');
const form=new FormData();
form.set('api_key',process.env.XIAOQINGWA_API_KEY);
form.set('page','1');form.set('page_size','2');
try{
 const res=await fetch('https://api.yuanmenggou.com/api/media/media_list',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('供应商HTTP状态 '+res.status);
 const data=await res.json();
 if(Number(data.code)!==1||!Array.isArray(data.data))throw Error('供应商未返回成功的媒体数组；请检查密钥或权限');
 console.log(JSON.stringify({http:res.status,code:data.code,count:data.data.length,readonly:true,submitted:false}));
}catch(err){console.error(err.name==='TimeoutError'?'供应商只读查询超时':err.message.replaceAll(process.env.XIAOQINGWA_API_KEY,'[redacted]'));process.exitCode=1}
