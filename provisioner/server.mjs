import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { target,credentials,sameSecret } from './security.mjs';
import { connect } from './ssh.mjs';
import { preflight } from './preflight.mjs';
import { install,runtimesReady } from './bootstrap.mjs';
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('请求过大');chunks.push(chunk)}let data;try{data=JSON.parse(Buffer.concat(chunks).toString()||'{}')}catch{throw Error('请求格式无效')}if(!data||typeof data!=='object'||Array.isArray(data))throw Error('请求格式无效');return data}
export function createProvisioner({secret,allowlist='',testLoopback=false,now=Date.now,installFn=install,runtimeReady=runtimesReady}={}){
 if(String(secret||'').length<32)throw Error('Provisioner内部凭据至少32位');
 const jobs=new Map(),busy=new Set();let probes=0;
 const snapshot=job=>({id:job.id,status:job.status,host:job.host,port:job.port,fingerprint:job.fingerprint,report:job.report,events:job.events,expiresAt:job.expiresAt,updatedAt:job.updatedAt,error:job.error});
 const step=(job,status,message)=>{job.status=status;job.updatedAt=now();job.events.push({at:job.updatedAt,message});if(job.events.length>30)job.events.shift()};
 const clear=job=>{job.credentials=null;job.installConfig=null;job.connection?.destroy();job.connection=null};
 const sweep=()=>{for(const [id,job]of jobs){if(['ready','checking'].includes(job.status)&&now()>job.expiresAt){step(job,'expired','短期SSH凭据已过期，需重新预检');clear(job)}if(now()-job.updatedAt>3600000&&!['installing','uploading'].includes(job.status)){clear(job);jobs.delete(id)}}};
 const timer=setInterval(sweep,15000);timer.unref();
 async function inspect(job){let client;try{client=await connect(job.credentials);job.connection=client;if(job.status!=='checking')return;const report=await preflight(client);if(job.status!=='checking')return;job.report=report;step(job,report.ready?'ready':'blocked',report.ready?'预检完成，等待人工确认安装':'发现现有服务或环境不兼容，未作修改');if(!report.ready)job.credentials=null}catch{if(job.status==='checking'){step(job,'failed','SSH预检失败：请核对指纹、认证方式和连通性');job.credentials=null}}finally{client?.destroy();job.connection=null;busy.delete(job.host)}}
 async function run(job){let client;const watchdog=setTimeout(()=>{job.connection?.destroy();if(['installing','uploading'].includes(job.status)){step(job,'interrupted','安装连接超时，远端状态需人工核查，禁止直接重复安装');clear(job)}},600000);watchdog.unref();
  try{
   client=await connect(job.credentials);job.connection=client;
   const report=await preflight(client);if(job.status==='interrupted')return;if(!report.ready){job.report=report;step(job,'blocked','安装前复检发现环境变化，已停止');return}
   await installFn(client,job.installConfig,(status,message)=>{if(job.status!=='interrupted')step(job,status,message)});
   if(job.status!=='interrupted')step(job,'verifying','专用服务已启动，等待Agent向主控回连；DNS与HTTPS须另行验收');
  }catch{if(job.status!=='interrupted')step(job,'failed','固定安装步骤失败：已尝试清理本任务新增内容，请核查远端状态后重试')}
  finally{clearTimeout(watchdog);client?.destroy();clear(job);busy.delete(job.host)}
 }
 const server=http.createServer(async(req,res)=>{try{
  if(!sameSecret(req.headers.authorization,'Bearer '+secret))return send(res,401,{error:'Provisioner认证失败'});
  sweep();const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'&&req.method==='GET')return send(res,200,{ok:true,installAvailable:await runtimeReady()});
  if(path==='/host-key'&&req.method==='POST'){
   const input=await body(req),address=target(input,allowlist,{testLoopback});if(probes>=2)throw Error('指纹探测并发已满');probes++;try{return send(res,200,await connect(address,{probe:true}))}finally{probes--}
  }
  if(path==='/jobs'&&req.method==='POST'){
   const input=await body(req);if(!/^prov[a-z0-9]{8,80}$/.test(input.id||''))throw Error('任务编号无效');
   if(jobs.has(input.id))return send(res,200,snapshot(jobs.get(input.id)));
   const address=target(input,allowlist,{testLoopback}),auth=credentials(input);
   if(input.trusted!==true)throw Error('必须先核对主机指纹');
   if(jobs.size>=100||[...jobs.values()].filter(j=>['checking','ready','installing','uploading'].includes(j.status)).length>=20||[...jobs.values()].filter(j=>j.status==='checking').length>=2)throw Error('接入任务或只读预检并发已满');
   if(busy.has(address.host)||[...jobs.values()].some(j=>j.host===address.host&&['ready','installing','uploading','verifying'].includes(j.status)))throw Error('此主机已有接入任务，先核查原任务');
   busy.add(address.host);const job={id:input.id,...address,fingerprint:auth.fingerprint,status:'checking',credentials:{...address,...auth},expiresAt:now()+600000,updatedAt:now(),events:[]};jobs.set(job.id,job);step(job,'checking','正在执行只读SSH预检');void inspect(job);return send(res,202,snapshot(job));
  }
  const match=path.match(/^\/jobs\/(prov[a-z0-9]{8,80})(?:\/(install|cancel|complete))?$/);
  if(match){const job=jobs.get(match[1]);if(!job)return send(res,404,{error:'任务已过期或执行器重启，凭据不会持久化，请重新预检并核查远端状态'});
   if(!match[2]&&req.method==='GET')return send(res,200,snapshot(job));
   if(match[2]==='complete'&&req.method==='POST'){if(job.status!=='verifying')throw Error('任务尚未进入回连验证');step(job,'succeeded','主控确认Agent已回连');clear(job);return send(res,200,snapshot(job))}
   if(match[2]==='cancel'&&req.method==='POST'){if(!['checking','ready','blocked','failed'].includes(job.status))throw Error('安装开始后不能直接取消，请核查远端状态');step(job,'expired','用户取消，SSH凭据已释放');clear(job);return send(res,200,snapshot(job))}
   if(match[2]==='install'&&req.method==='POST'){
    const input=await body(req);if(['installing','uploading','verifying','succeeded'].includes(job.status))return send(res,200,snapshot(job));
    if(job.status!=='ready'||!job.credentials)throw Error('任务未通过预检或凭据已过期');
    if(input.confirmed!==true||input.fingerprint!==job.fingerprint)throw Error('缺少安装与指纹确认');
    const control=new URL(input.control);if(control.protocol!=='https:'||control.username||control.password||control.search||control.hash)throw Error('Agent主控地址必须是有效HTTPS地址');
    if(!/^[a-f0-9]{64}$/.test(input.token||''))throw Error('Agent凭据格式无效');
    if(!await runtimeReady())throw Error('当前执行器不能安装Linux运行时，请部署专用Linux Provisioner容器');
    if(busy.has(job.host)||[...jobs.values()].filter(j=>['installing','uploading'].includes(j.status)).length>=2)throw Error('安装并发已满');
    busy.add(job.host);job.installConfig={control:control.href,token:input.token};step(job,'installing','用户已确认，正在连接并复检');void run(job);return send(res,202,snapshot(job));
   }
  }
  send(res,404,{error:'接入接口不存在'});
 }catch(error){if(!res.headersSent)send(res,400,{error:error.message});else res.destroy()}});
 server.requestTimeout=20000;server.headersTimeout=10000;
 const stop=()=>{clearInterval(timer);for(const job of jobs.values())clear(job);server.close()};
 return {server,stop,sweep};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const service=createProvisioner({secret:process.env.PROVISIONER_TOKEN,allowlist:process.env.PROVISIONER_ALLOWED_CIDRS});
 service.server.listen(Number(process.env.PROVISIONER_PORT||4431),process.env.PROVISIONER_HOST||'127.0.0.1',()=>console.log('Provisioner ready (SSH credentials are memory-only)'));
 process.once('SIGTERM',service.stop);process.once('SIGINT',service.stop);
}
