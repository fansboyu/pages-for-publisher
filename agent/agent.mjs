import { promises as fs } from 'node:fs';
import { resolve,join,dirname,isAbsolute } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { unpackWebsite,limits } from '../pilot/archive.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
const safeId=id=>{if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))throw Error('非法站点或版本标识');return id};
export function unpack(bytes,task){
 if(bytes.length>32*1024*1024||digest(bytes)!==task.sha256)throw Error('发布包 SHA-256 校验失败');
 const bundle=JSON.parse(gunzipSync(bytes,{maxOutputLength:64*1024*1024}));
 if(bundle.version!==1||bundle.site!==task.site||bundle.release!==task.release||!Array.isArray(bundle.files)||bundle.files.length>3000)throw Error('发布包身份或协议错误');
 const seen=new Set();let total=0;
 for(const f of bundle.files){
  if(typeof f.path!=='string'||isAbsolute(f.path)||f.path.includes('\\')||f.path.includes(':')||f.path.split('/').some(p=>!p||p==='.'||p==='..')||!/\.(html|css|js|json|xml|txt|webp|png|jpg|jpeg|ico|woff2)$/.test(f.path)||seen.has(f.path))throw Error('发布包存在非法路径');
  seen.add(f.path);const data=Buffer.from(f.data,'base64');total+=data.length;if(total>48*1024*1024||data.length!==f.size||digest(data)!==f.sha256)throw Error('发布文件校验失败');
 }
 if(!seen.has('index.html'))throw Error('发布包缺少首页');return bundle;
}
export function makeConfig(sites,config){
 const routes=Object.entries(sites).map(([site,s])=>{
  const handlers=[];if(config.mode==='local')handlers.push({handler:'rewrite',strip_path_prefix:`/sites/${site}`});
  handlers.push({handler:'headers',response:{set:{'X-Site-Release':[s.release],'X-Content-Type-Options':['nosniff']}}},{handler:'vars',root:s.path},{handler:'encode',encodings:{gzip:{}}},{handler:'file_server',index_names:['index.html']});
  return {match:[config.mode==='local'?{path:[`/sites/${site}/*`]}:{host:[s.domain]}],handle:[{handler:'subroute',routes:[{handle:handlers}]}],terminal:true};
 });
 routes.push({handle:[{handler:'static_response',status_code:404,body:'Website not deployed'}]});
 const http={servers:{web:{listen:[config.mode==='local'?`127.0.0.1:${config.port||4320}`:':443'],routes,...(config.mode==='local'?{automatic_https:{disable:true}}:{})}}};
 if(config.mode!=='local'){
  const healthRoutes=Object.entries(sites).map(([site,s])=>({match:[{path:[`/sites/${site}/*`]}],handle:[{handler:'rewrite',strip_path_prefix:`/sites/${site}`},{handler:'headers',response:{set:{'X-Site-Release':[s.release]}}},{handler:'vars',root:s.path},{handler:'file_server',index_names:['index.html']}],terminal:true}));
  http.servers.health={listen:[`127.0.0.1:${config.healthPort||4322}`],automatic_https:{disable:true},routes:healthRoutes};
 }
 return {admin:{listen:new URL(config.caddyAdmin).host},apps:{http},...(config.storage?{storage:config.storage}:{})};
}
export function mergeSharedConfig(existing,sites,config){
 if(config.mode!=='production'||!config.sharedServer)throw Error('共存模式需要production及明确的sharedServer');
 const merged=structuredClone(existing),servers=merged.apps?.http?.servers,target=servers?.[config.sharedServer];
 if(!target)throw Error('共存目标Caddy服务器不存在');
 const namespace='site-agent-'+digest(Buffer.from(resolve(config.root))).slice(0,16)+'-',owned=r=>typeof r?.['@id']==='string'&&(r['@id']===namespace+'managed'||r['@id'].startsWith(namespace+'site-'));
 const domains=Object.values(sites).map(s=>s.domain.toLowerCase());
 function checkRoutes(routes){for(const route of routes||[]){if(owned(route))continue;
  for(const matcher of route.match||[])for(const host of matcher.host||[]){
   const pattern=new RegExp('^'+host.toLowerCase().replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'[^.]+')+'$');
   if(domains.some(domain=>pattern.test(domain)))throw Error('域名已被现有Caddy业务使用：'+host);
  }
  for(const handler of route.handle||[])checkRoutes(handler.routes);
 }}
 for(const server of Object.values(servers))checkRoutes(server.routes);
 const generated=makeConfig(sites,config),routes=generated.apps.http.servers.web.routes.filter(r=>r.match);
 for(const [index,site]of Object.keys(sites).entries())routes[index]['@id']=namespace+'site-'+safeId(site);
 target.routes=[...routes,...(target.routes||[]).filter(r=>!owned(r))];
 const healthName=namespace+'health';
 if(servers[healthName]&&servers[healthName]['@id']!==healthName)throw Error('共存健康检查名称冲突');
 servers[healthName]={...generated.apps.http.servers.health,'@id':healthName};
 return merged;
}
async function loadSharedSubtree(existing,sites,config,admin,headers){
 const merged=mergeSharedConfig(existing,sites,config),namespace='site-agent-'+digest(Buffer.from(resolve(config.root))).slice(0,16)+'-',id=namespace+'managed',healthName=namespace+'health';
 const oldServers=existing.apps.http.servers,oldTarget=oldServers[config.sharedServer];
 if(!Array.isArray(oldTarget.routes))throw Error('旧版共存Caddy需要已有routes数组');
 for(const [name,server]of Object.entries(oldServers))if(name!==config.sharedServer&&(server.routes||[]).some(r=>r['@id']===id))throw Error('Agent托管路由已存在于其他Caddy服务器');
 if(oldTarget.routes.some(r=>r['@id']?.startsWith(namespace+'site-')))throw Error('旧版Caddy不能直接接管其他版本的共存布局');
 const wrapper={'@id':id,handle:[{handler:'subroute',routes:merged.apps.http.servers[config.sharedServer].routes.filter(r=>r['@id']?.startsWith(namespace+'site-'))}]};
 const previous=oldTarget.routes.find(r=>r['@id']===id);
 if(previous&&(previous.handle?.length!==1||previous.handle[0].handler!=='subroute'))throw Error('Agent托管路由结构已被外部修改');
 const apply=async(path,method,value)=>{const r=await fetch(new URL(path,admin),{method,headers,body:JSON.stringify(value),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Caddy独立子配置更新失败: '+await r.text())};
 // Old Caddy lacks ETags. Strict creates and ID-addressed writes never replace
 // foreign routes or global configuration, even when another writer adds routes.
 if(!isDeepStrictEqual(oldServers[healthName],merged.apps.http.servers[healthName]))await apply(oldServers[healthName]?'/id/'+healthName:'/config/apps/http/servers/'+healthName,oldServers[healthName]?'PATCH':'PUT',merged.apps.http.servers[healthName]);
 if(!isDeepStrictEqual(previous,wrapper))await apply(previous?'/id/'+id+'/handle/0/routes':'/config/apps/http/servers/'+encodeURIComponent(config.sharedServer)+'/routes/0',previous?'PATCH':'PUT',previous?wrapper.handle[0].routes:wrapper);
 return merged;
}
export async function loadCaddyConfig(sites,config){
 const admin=new URL(config.caddyAdmin),headers={'Content-Type':'application/json',Origin:admin.origin};
 if(!config.sharedCaddy){const conf=makeConfig(sites,config),r=await fetch(new URL('/load',admin),{method:'POST',headers,body:JSON.stringify(conf),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Caddy 配置加载失败: '+await r.text());return conf}
 for(let attempt=0;attempt<3;attempt++){
  const current=await fetch(new URL('/config/',admin),{headers:{Origin:admin.origin},signal:AbortSignal.timeout(15000)});
  if(!current.ok)throw Error('读取共存Caddy配置失败');
  const etag=current.headers.get('etag'),previous=await current.json();
  if(!etag)return loadSharedSubtree(previous,sites,config,admin,headers);
  const conf=mergeSharedConfig(previous,sites,config);
  if(isDeepStrictEqual(previous,conf))return conf;
  const r=await fetch(new URL('/config/',admin),{method:'POST',headers:{...headers,'If-Match':etag},body:JSON.stringify(conf),signal:AbortSignal.timeout(15000)});
  if(r.status===412)continue;
  if(!r.ok)throw Error('Caddy共存配置加载失败: '+await r.text());
  return conf;
 }
 throw Error('Caddy配置被其他程序同时修改，请重试');
}
export async function startAgent(config){
 if(!['local','production'].includes(config.mode))throw Error('Agent mode 必须为 local 或 production');
 const base=new URL(config.control);if(base.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw Error('远程总控必须使用 HTTPS');
 const admin=new URL(config.caddyAdmin);if(!['127.0.0.1','localhost','[::1]'].includes(admin.hostname))throw Error('Caddy 管理端口必须只监听本机');
 const root=resolve(config.root);await fs.mkdir(root,{recursive:true});
 const stateFile=join(root,'agent-state.json'),lockFile=join(root,'agent.lock');
 try{const old=JSON.parse(await fs.readFile(lockFile,'utf8'));try{process.kill(old.pid,0);throw Error('同一 Agent 目录已有运行进程')}catch(e){if(e.code!=='ESRCH')throw e}await fs.unlink(lockFile)}catch(e){if(e.code!=='ENOENT')throw e}
 await fs.writeFile(lockFile,JSON.stringify({pid:process.pid}),{flag:'wx'});
 let current={sites:{},pending:null},stopped=false;try{current=JSON.parse(await fs.readFile(stateFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 const save=async()=>{await fs.writeFile(stateFile+'.tmp',JSON.stringify(current,null,2));await fs.rename(stateFile+'.tmp',stateFile)};
 const request=async(path,body)=>{const r=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${config.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify({...body,version:'0.3.0'}):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Object.assign(Error(`总控 ${r.status}: ${await r.text()}`),{status:r.status});return r};
 const load=sites=>loadCaddyConfig(sites,config);
 const log=(...args)=>console.log(new Date().toISOString(),...args);
 const report=async()=>{if(!current.pending)return;try{await request('/agent/v1/report',current.pending);log('reported',current.pending.task);current.pending=null;await save()}catch(e){if(e.status===409){current.pending=null;await save()}else throw e}};
 const deploy=async task=>{
  safeId(task.site);safeId(task.release);if(!/^[a-zA-Z0-9.-]+$/.test(task.domain)||task.domain.includes('..'))throw Error('域名格式错误');
  if(Object.entries(current.sites).some(([id,s])=>id!==task.site&&s.domain===task.domain))throw Error('此域名已由另一个站点使用');
  const timer=setInterval(()=>request('/agent/v1/heartbeat',{task:task.id,lease:task.lease}).catch(e=>log('heartbeat:',e.message)),15000);
  const previous=structuredClone(current.sites);let switched=false;
  try{
   const downloadUrl=new URL(task.download,base);if(downloadUrl.origin!==base.origin&&downloadUrl.protocol!=='https:')throw Error('发布包地址必须使用 HTTPS');
   // OSS 签名地址本身携带临时授权，不能向 OSS 发送总控 Agent Token。
   const response=downloadUrl.origin===base.origin?await request(task.download):await fetch(downloadUrl,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`发布包下载失败 ${response.status}`);
   const cap={...limits(),...(config.packageLimits||{})},chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>(task.format==='tar-gzip-v2'?cap.compressed:32*1024*1024))throw Error('发布包过大');chunks.push(chunk)}
   const bundle=task.format==='tar-gzip-v2'?await unpackWebsite(Buffer.concat(chunks),task,cap):unpack(Buffer.concat(chunks),task),dir=join(root,'sites',task.site,'releases',task.release);
   // 每次重试重新验证和写入指定不可变版本，目录名由固定标识生成。
   for(const file of bundle.files){const target=join(dir,...file.path.split('/'));await fs.mkdir(dirname(target),{recursive:true});await fs.writeFile(target,Buffer.from(file.data,'base64'))}
   const next={...previous,[task.site]:{release:task.release,path:dir.replace(/\\/g,'/'),domain:task.domain}};
   // 记录切换意图；重启时按已确认版本恢复 Caddy。
   await fs.writeFile(join(root,'switch-journal.json'),JSON.stringify({previous,next,task:task.id}));
   await load(next);switched=true;
   const checkUrl=`http://127.0.0.1:${config.mode==='local'?(config.port||4320):(config.healthPort||4322)}/sites/${task.site}/`;
   // A hot reload can close an old keep-alive connection. Retry briefly using
   // fresh connections before treating a transient socket close as a bad release.
   let verified=false,lastCheck;
   for(let attempt=0;attempt<5;attempt++){
    try{const r=await fetch(checkUrl,{headers:{...(config.mode==='local'?{}:{Host:task.domain}),Connection:'close'},redirect:'manual',signal:AbortSignal.timeout(10000)});const html=await r.text();if(r.status!==200||r.headers.get('x-site-release')!==task.release||!/^\s*<!doctype\s+html/i.test(html))throw Error('Caddy 首页验证失败');verified=true;break}catch(e){lastCheck=e;if(attempt<4)await new Promise(r=>setTimeout(r,250))}
   }
   // Public DNS and certificate issuance are still a separate acceptance check.
   if(!verified)throw Error('Caddy 首页验证失败: '+lastCheck?.message);
   const check={kind:'local-http',url:checkUrl,ok:true,...(config.mode!=='local'?{publicHttps:'pending',note:'公网 DNS 与证书需另行验收'}:{})};
   current.sites=next;current.pending={task:task.id,lease:task.lease,ok:true,check};await save();await fs.unlink(join(root,'switch-journal.json')).catch(()=>{});log('deployed',task.site,task.release);
  }catch(e){if(switched)await load(previous);current.pending={task:task.id,lease:task.lease,ok:false,error:e.message};await save();log('deployment failed:',e.message)}finally{clearInterval(timer)}
 };
 const shutdown=()=>{stopped=true};process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 try{
  // 上次切换中断时，以本地持久化的确认版本为准恢复路由。
  await load(current.sites);log('agent ready',config.mode,root);let delay=config.pollMs||2000,nextSharedCheck=Date.now()+30000;
  while(!stopped){try{await report();if(config.sharedCaddy&&Date.now()>=nextSharedCheck){await load(current.sites);nextSharedCheck=Date.now()+30000}if(!current.pending){const {task}=await(await request('/agent/v1/poll',{})).json();if(task){await deploy(task);await report()}}delay=config.pollMs||2000}catch(e){log('reconnect:',e.message);delay=Math.min(delay*2,30000)}await new Promise(r=>setTimeout(r,delay))}
 }finally{await fs.unlink(lockFile).catch(()=>{});process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];if(!file)throw Error('Usage: node agent/agent.mjs path/to/agent.json');const config=JSON.parse(await fs.readFile(resolve(file),'utf8'));await startAgent(config);
}
