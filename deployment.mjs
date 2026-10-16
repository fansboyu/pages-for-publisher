import { randomBytes,timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sha256 } from './storage-adapter.mjs';

const id=prefix=>prefix+Date.now().toString(36)+randomBytes(5).toString('hex');
const err=(message,status=400)=>{throw Object.assign(Error(message),{status})};
export function createDeployment({state,persist,store,audit,readBody,send}){
 state.servers??=[];state.deployments??=[];
 const save=persist;
 function requireAdmin(user){if(user.role!=='admin')err('仅平台管理员可管理服务器',403)}
 function serverAuth(req){const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)err('Agent 认证失败',401);const hashed=sha256(token),server=state.servers.find(s=>!s.revoked&&timingSafeEqual(Buffer.from(s.tokenHash,'hex'),Buffer.from(hashed,'hex')));if(!server)err('Agent 认证失败',401);return server}
 function createTask(site,release,kind='deploy',by='系统'){
  if(!site.serverId)err('请先绑定客户服务器');
  const server=state.servers.find(s=>s.id===site.serverId&&!s.revoked);if(!server)err('绑定的服务器不可用');
  // 更换服务器时需先取消旧任务；发布任务严格按创建顺序执行。
  const task={id:id('d'),site:site.id,server:server.id,release:release.id,kind,by,status:'queued',attempts:0,time:new Date().toISOString(),domain:site.domain};
  state.deployments.push(task);release.status='ready';save();return task;
 }
 return {
  async package(site,release,pages,snapshot){
   const files=Object.entries(pages).map(([path,content])=>{const bytes=Buffer.from(content);return {path,size:bytes.length,sha256:sha256(bytes),data:bytes.toString('base64')}});
   const bundle=gzipSync(Buffer.from(JSON.stringify({version:1,site:site.id,release:release.id,files})));if(bundle.length>32*1024*1024)err('发布包超过首版 32MB 上限');
   release.archiveKey=`archives/sites/${site.id}/${release.id}.json.gz`;release.sha256=sha256(bundle);release.bytes=bundle.length;release.templateVersion='basic-v1';
   await store.putArchive(release.archiveKey,bundle);
   // 独立归档快照，不进入客户端网站目录；排除站点 API Key。
   const {key,...siteContent}=snapshot.site;await store.putArchive(`archives/sites/${site.id}/${release.id}.snapshot.json.gz`,gzipSync(Buffer.from(JSON.stringify({site:siteContent,articles:snapshot.articles}))));
   if(site.serverId){const task=createTask(site,release,'deploy',release.by);release.deploymentId=task.id;return true}return false;
  },
  rollback(site,release,user){return createTask(site,release,'rollback',user.name)},
  view(user,sites){const ids=new Set(sites.map(s=>s.id));return {servers:user.role==='admin'?state.servers.map(({tokenHash,...s})=>({...s,online:!!s.lastSeen&&Date.now()-Date.parse(s.lastSeen)<30000})):[],deployments:state.deployments.filter(d=>ids.has(d.site)).slice(-100).reverse(),storage:store.info()}},
  async adminRoute(p,req,res,user){
   if(!p.startsWith('/api/infrastructure/'))return false;requireAdmin(user);
   if(req.method!=='POST')err('请使用 POST',405);const b=await readBody(req);
   if(p==='/api/infrastructure/servers'){
    if(!String(b.name||'').trim())err('请填写服务器名称');
    const token=randomBytes(32).toString('hex'),server={id:id('srv'),name:String(b.name).slice(0,100),tokenHash:sha256(token),created:new Date().toISOString(),lastSeen:null,version:null};state.servers.push(server);save();return send(res,{id:server.id,name:server.name,token},201),true;
   }
   if(p==='/api/infrastructure/bind'){
    const site=state.sites.find(s=>s.id===b.site),server=state.servers.find(s=>s.id===b.server&&!s.revoked);if(!site||!server)err('网站或服务器不存在');
    if(site.serverId===server.id){send(res,{ok:true});return true}
    if(state.deployments.some(d=>d.site===site.id&&['queued','running'].includes(d.status)))err('请等待当前部署完成后再更换服务器',409);
    site.serverId=server.id;audit(user,'绑定部署服务器',site.id);save();return send(res,{ok:true}),true;
   }
   if(p==='/api/infrastructure/retry'){
    const task=state.deployments.find(d=>d.id===b.task&&d.status==='failed');if(!task)err('只能重试失败任务');
    const site=state.sites.find(s=>s.id===task.site),release=state.releases.find(r=>r.id===task.release);if(site.serverId!==task.server)err('服务器归属已变化');
    const next=createTask(site,release,task.kind,user.name);return send(res,next),true;
   }
   err('接口不存在',404);
  },
  async agentRoute(p,req,res){
   if(!p.startsWith('/agent/v1/'))return false;const server=serverAuth(req);
   if(p==='/agent/v1/package'&&req.method==='GET'){
    const taskId=new URL(req.url,'http://localhost').searchParams.get('task'),task=state.deployments.find(d=>d.id===taskId&&d.server===server.id&&d.status==='running');if(!task)err('无权读取发布包',403);
    const release=state.releases.find(r=>r.id===task.release);const bytes=await store.readArchive(release.archiveKey);res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;
   }
   if(req.method!=='POST')err('请使用 POST',405);const b=await readBody(req);server.lastSeen=new Date().toISOString();server.version=String(b.version||server.version||'unknown').slice(0,30);
   if(p==='/agent/v1/poll'){
    for(const t of state.deployments.filter(d=>d.server===server.id&&d.status==='running'&&Date.now()>d.leaseUntil)){t.status=t.attempts>=5?'failed':'queued';t.error='Agent 租约超时，等待重新领取'}
    if(state.deployments.some(d=>d.server===server.id&&d.status==='running')){save();send(res,{task:null});return true}
    const task=state.deployments.find(d=>d.server===server.id&&d.status==='queued');
    if(!task){save();send(res,{task:null});return true}
    const site=state.sites.find(s=>s.id===task.site),release=state.releases.find(r=>r.id===task.release);
    if(site.serverId!==server.id){task.status='failed';task.error='站点绑定已变更';save();send(res,{task:null});return true}
    task.status='running';task.attempts++;task.lease=randomBytes(16).toString('hex');task.leaseUntil=Date.now()+60000;save();
    send(res,{task:{id:task.id,site:task.site,release:task.release,lease:task.lease,domain:task.domain,kind:task.kind,sha256:release.sha256,bytes:release.bytes,download:store.archiveDownloadUrl(release.archiveKey)||`/agent/v1/package?task=${task.id}`}});return true;
   }
   const task=state.deployments.find(d=>d.id===b.task&&d.server===server.id);if(!task||task.status!=='running'||task.lease!==b.lease||Date.now()>task.leaseUntil)err('任务租约失效',409);
   if(p==='/agent/v1/heartbeat'){task.leaseUntil=Date.now()+60000;save();send(res,{ok:true});return true}
   if(p==='/agent/v1/report'){
    task.status=b.ok?'succeeded':'failed';task.finished=new Date().toISOString();task.error=b.ok?null:String(b.error||'部署失败').slice(0,1000);task.check=b.check||null;
    const site=state.sites.find(s=>s.id===task.site),release=state.releases.find(r=>r.id===task.release);
    if(b.ok){site.active=release.id;site.deployedAt=task.finished;release.status='live';audit({name:server.name},task.kind==='rollback'?'Agent 回滚成功':'Agent 部署成功',site.id)}
    else if(site.active!==release.id)release.status='deploy_failed';save();send(res,{ok:true});return true;
   }
   err('Agent 接口不存在',404);
  }
 };
}
