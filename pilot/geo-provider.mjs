import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
import sharp from 'sharp';
const endpoint='https://api.yuanmenggou.com';
export const geoMode=()=>process.env.GEO_QUERY_MODE==='live'?'live':'demo';
export const geoConfigured=()=>geoMode()==='live'&&!!process.env.XIAOQINGWA_API_KEY;
const clean=s=>String(s||'').replaceAll(process.env.XIAOQINGWA_API_KEY||'__NO_SECRET__','[redacted]').slice(0,300);
async function call(path,input){
 if(!geoConfigured())throw Error('GEO正式接口未配置');
 const form=new FormData();form.set('api_key',process.env.XIAOQINGWA_API_KEY);for(const[k,v]of Object.entries(input))form.set(k,String(v));
 const res=await fetch(endpoint+path,{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw Error('GEO供应商HTTP '+res.status);
 const data=await res.json();if(Number(data.code)!==1)throw Object.assign(Error(clean(data.msg)||'GEO供应商拒绝请求'),{definitive:true});return data.data;
}
export const geoProvider={
 async submit(task){const d=await call('/api/geo/add_shoulu',{platform:task.platform,keywords:task.brand,question:task.question,third_id:task.id});if(!d?.request_id)throw Error('GEO提交响应缺少任务编号，须核查');return String(d.request_id)},
 async poll(task){const d=await call('/api/geo/check_task',{request_id:task.provider_id});if(!d||String(d.request_id)!==String(task.provider_id)||Number(d.platform)!==task.platform||![0,1,2,3].includes(Number(d.status)))throw Error('GEO任务返回身份或状态不匹配');return {status:Number(d.status),matchedWord:clean(d.keyword_res),shareUrl:String(d.share_url||''),screenshotUrl:String(d.img_url||''),queryTime:d.script_time||null}}
};
const blocked=new BlockList();for(const[net,prefix,family]of [['0.0.0.0',8,'ipv4'],['10.0.0.0',8,'ipv4'],['100.64.0.0',10,'ipv4'],['127.0.0.0',8,'ipv4'],['169.254.0.0',16,'ipv4'],['172.16.0.0',12,'ipv4'],['192.168.0.0',16,'ipv4'],['192.0.0.0',24,'ipv4'],['192.0.2.0',24,'ipv4'],['198.18.0.0',15,'ipv4'],['198.51.100.0',24,'ipv4'],['203.0.113.0',24,'ipv4'],['224.0.0.0',3,'ipv4'],['::',128,'ipv6'],['::1',128,'ipv6'],['fc00::',7,'ipv6'],['fe80::',10,'ipv6'],['ff00::',8,'ipv6'],['2001:db8::',32,'ipv6']])blocked.addSubnet(net,prefix,family);
export function publicAddress(address){const family=isIP(address);return !!family&&!address.toLowerCase().startsWith('::ffff:')&&!blocked.check(address,family===4?'ipv4':'ipv6')}
export function publicUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:null}catch{return null}}
// Resolve once and pin the validated address to prevent DNS rebinding; redirects are refused.
export async function downloadScreenshot(value){
 const url=publicUrl(value);if(!url)throw Error('截图地址必须是HTTPS');const u=new URL(url),addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('截图地址不允许访问内部网络');
 const a=addresses[0];const bytes=await new Promise((resolve,reject)=>{let size=0;const chunks=[];const req=https.get(u,{lookup:(_h,_o,cb)=>cb(null,a.address,a.family)},res=>{if(res.statusCode!==200){res.resume();return reject(Error('截图下载HTTP '+res.statusCode))}res.on('data',chunk=>{size+=chunk.length;if(size>10*1024*1024){req.destroy(Error('截图超过10MB'));return}chunks.push(chunk)});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)))});const timer=setTimeout(()=>req.destroy(Error('截图下载超时')),20000);req.on('close',()=>clearTimeout(timer));req.on('error',reject)});
 return sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
}
export async function archiveGeoScreenshot(task,store){const bytes=await downloadScreenshot(task.result.screenshotUrl);return store.image(task.site_id,{data:'data:image/webp;base64,'+bytes.toString('base64'),name:'GEO查询截图-'+task.id})}
