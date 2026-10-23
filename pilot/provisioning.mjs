import { id,token,hash,fail,json,body,audit } from './common.mjs';
import { transaction } from './db.mjs';
const enabled=()=>!!process.env.PROVISIONER_URL&&String(process.env.PROVISIONER_TOKEN||'').length>=32;
function controlURL(){const base=new URL(process.env.PUBLIC_BASE_URL||''),control=new URL(process.env.PROVISIONER_CONTROL_URL||base.href);if(control.protocol!=='https:'||control.origin!==base.origin||control.username||control.password||control.search||control.hash)throw Error('需配置指向当前主控的同源HTTPS PUBLIC_BASE_URL，不能将本地主控Token用于其他主控');return control.origin}
async function call(path,method='GET',data,timeout=20000){
 if(!enabled())fail('服务器接入执行器尚未配置',503);
 const base=new URL(process.env.PROVISIONER_URL);if(!['http:','https:'].includes(base.protocol))fail('执行器地址配置错误',503);
 let response;try{response=await fetch(new URL(path,base),{method,headers:{Authorization:'Bearer '+process.env.PROVISIONER_TOKEN,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(timeout),redirect:'error'})}catch{fail('接入执行器暂不可达，请核查原任务状态后重试',503)}
 const result=await response.json();if(!response.ok)fail(result.error||'接入执行器拒绝请求',response.status===404?404:400);return result;
}
const view=row=>({id:row.id,name:row.name,host:row.host,port:row.port,username:row.username,fingerprint:row.fingerprint,status:row.status,report:row.report,events:row.events,error:row.error,serverId:row.server_id,createdAt:row.created_at,updatedAt:row.updated_at});
async function save(db,row,snapshot){return transaction(db,async c=>{
 row=(await c.query('SELECT * FROM provisioning_jobs WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
 if(['succeeded','blocked','failed','expired','interrupted'].includes(row.status))return view(row);
 if(row.install_started_at&&['checking','ready'].includes(snapshot.status))return view(row);
 if(row.status==='verifying'&&['checking','ready','uploading','installing'].includes(snapshot.status))return view(row);
 const states=['checking','ready','blocked','uploading','installing','verifying','failed','expired','interrupted'];
 if(!states.includes(snapshot.status))fail('执行器任务状态无效',502);
 let status=snapshot.status,error=snapshot.error||null;
 if(status==='verifying'&&row.server_id){const server=(await c.query('SELECT last_seen,revoked FROM servers WHERE id=$1',[row.server_id])).rows[0];if(server&&!server.revoked&&server.last_seen&&new Date(server.last_seen)>=new Date(row.install_started_at))status='succeeded';else if(Date.now()-new Date(row.install_started_at)>720000){status='failed';error='服务已安装但Agent尚未回连，请核查主控HTTPS和出站网络；不要直接重复安装'}}
 const result=(await c.query('UPDATE provisioning_jobs SET status=$1,report=$2,events=$3,error=$4,updated_at=now() WHERE id=$5 RETURNING *',[status,snapshot.report||row.report,JSON.stringify((snapshot.events||[]).slice(-30)),error,row.id])).rows[0];if(status==='succeeded')await audit(c,null,'Provisioner','服务器Agent回连验证完成：'+row.host);return view(result);
})}
async function syncJob(db,row){
 try{const result=await save(db,row,await call('/jobs/'+row.id,'GET',null,3000));if(result.status==='succeeded')await call('/jobs/'+row.id+'/complete','POST',{}).catch(()=>{});return result}
 catch(error){if(error.status===404){const result=(await db.query("UPDATE provisioning_jobs SET status='interrupted',error='执行器重启或凭据过期，请核查远端后重新预检',updated_at=now() WHERE id=$1 AND status IN ('checking','ready','uploading','installing','verifying') RETURNING *",[row.id])).rows[0];return view(result||(await db.query('SELECT * FROM provisioning_jobs WHERE id=$1',[row.id])).rows[0])}return {...view(row),connectionError:'执行器暂不可达，保留原状态，禁止重复安装'}}
}
export async function reconcileProvisioning(db){
 if(!enabled())return;
 const jobs=(await db.query("SELECT * FROM provisioning_jobs WHERE status IN ('checking','ready','uploading','installing','verifying') ORDER BY created_at LIMIT 20")).rows;
 for(const job of jobs)await syncJob(db,job);
}
export async function provisioningRoute(db,user,req,res,path){
 if(!path.startsWith('/api/provisioning'))return false;
 if(user.role!=='admin')fail('仅直营管理员可接入客户服务器',403);
 if(path==='/api/provisioning'&&req.method==='GET'){
  let available=false,installAvailable=false;try{const health=await call('/health','GET',null,2000);available=health.ok;installAvailable=health.installAvailable}catch{}
  let controlReady=false;try{controlURL();controlReady=true}catch{}
  json(res,{configured:enabled(),available,installAvailable,controlReady,jobs:(await db.query('SELECT * FROM provisioning_jobs ORDER BY created_at DESC LIMIT 30')).rows.map(view)});return true;
 }
 if(path==='/api/provisioning/host-key'&&req.method==='POST'){const input=await body(req);json(res,await call('/host-key','POST',{host:input.host,port:input.port}));return true}
 if(path==='/api/provisioning/preflight'&&req.method==='POST'){
  const input=await body(req);if(input.trusted!==true)fail('请先核对SSH主机指纹');
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestKey||''))fail('缺少预检请求编号');
  const host=String(input.host||'').trim(),port=Number(input.port||22),username=String(input.username||'root'),fingerprint=String(input.fingerprint||'');
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)||!Number.isInteger(port)||port<1||port>65535||! /^[a-z_][a-z0-9_-]{0,31}$/.test(username)||!/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint))fail('服务器参数格式无效');
  const existing=(await db.query('SELECT * FROM provisioning_jobs WHERE actor_id=$1 AND request_key=$2',[user.id,input.requestKey])).rows[0];
  if(existing){if(existing.host!==host||existing.port!==port||existing.username!==username||existing.fingerprint!==fingerprint)fail('请求编号已用于其他服务器参数',409);json(res,view(existing));return true}
  if(!enabled())fail('服务器接入执行器尚未配置',503);
  const jobId=id('prov'),name=String(input.name||host).trim().slice(0,100);
  const row=await transaction(db,async c=>{const row=(await c.query("INSERT INTO provisioning_jobs(id,actor_id,request_key,name,host,port,username,fingerprint,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'checking') ON CONFLICT(actor_id,request_key) DO NOTHING RETURNING *",[jobId,user.id,input.requestKey,name,host,port,username,fingerprint])).rows[0];if(row)await audit(c,null,user.name,'发起服务器只读预检：'+host);return row});
  if(!row){json(res,view((await db.query('SELECT * FROM provisioning_jobs WHERE actor_id=$1 AND request_key=$2',[user.id,input.requestKey])).rows[0]));return true}
  try{const snapshot=await call('/jobs','POST',{id:jobId,host,port,username,fingerprint,trusted:true,password:input.password,privateKey:input.privateKey});json(res,await save(db,row,snapshot),202)}catch(error){await db.query("UPDATE provisioning_jobs SET status='failed',error=$1,updated_at=now() WHERE id=$2",[error.message,jobId]);throw error}return true;
 }
 const match=path.match(/^\/api\/provisioning\/(prov[a-z0-9]{8,80})(?:\/(install|cancel|revoke))?$/);
 if(match){const row=(await db.query('SELECT * FROM provisioning_jobs WHERE id=$1',[match[1]])).rows[0];if(!row)fail('接入任务不存在',404);
  if(!match[2]&&req.method==='GET'){
   if(['succeeded','blocked','failed','expired','interrupted'].includes(row.status)){json(res,view(row));return true}
   json(res,await syncJob(db,row));return true;
  }
  if(req.method!=='POST')fail('请使用POST',405);const input=await body(req);
  if(match[2]==='cancel'){if(!['checking','ready','blocked','failed'].includes(row.status))fail('安装已开始或任务不可取消',409);let snapshot;try{snapshot=await call('/jobs/'+row.id+'/cancel','POST',{})}catch(error){if(error.status!==404)throw error;snapshot={status:'expired',events:row.events,report:row.report}}const cancelled=(await db.query("UPDATE provisioning_jobs SET status='expired',events=$1,updated_at=now() WHERE id=$2 AND status IN ('checking','ready','blocked','failed') RETURNING *",[JSON.stringify(snapshot.events||[]),row.id])).rows[0];if(!cancelled)fail('安装已开始，不能取消',409);json(res,view(cancelled));return true}
  if(match[2]==='revoke'){
   if(input.confirmed!==true||!row.server_id)fail('请确认撤销已登记的Agent凭据');
   await transaction(db,async c=>{await c.query('SELECT id FROM servers WHERE id=$1 FOR UPDATE',[row.server_id]);if((await c.query('SELECT 1 FROM sites WHERE server_id=$1',[row.server_id])).rowCount)fail('服务器已有网站绑定，请先由管理员核查并解除绑定');await c.query('UPDATE servers SET revoked=true WHERE id=$1',[row.server_id]);await audit(c,null,user.name,'撤销接入服务器Agent凭据：'+row.host)});json(res,{ok:true});return true;
  }
  if(match[2]==='install'){
   if(input.confirmed!==true||input.fingerprint!==row.fingerprint)fail('请确认预检结果、主机指纹和安装范围');
   const control=controlURL(),health=await call('/health');if(!health.installAvailable)fail('安装需要带Linux运行时的独立Provisioner容器',503);
   const snapshot=await call('/jobs/'+row.id);if(snapshot.status!=='ready'){json(res,await save(db,row,snapshot));return true}
   const registration=await transaction(db,async c=>{const current=(await c.query('SELECT * FROM provisioning_jobs WHERE id=$1 FOR UPDATE',[row.id])).rows[0];if(current.server_id||current.status!=='ready')return null;const credential=token(),serverId=id('srv');await c.query('INSERT INTO servers(id,name,token_hash) VALUES($1,$2,$3)',[serverId,current.name,hash(credential)]);await c.query("UPDATE provisioning_jobs SET status='installing',server_id=$1,install_started_at=now(),updated_at=now() WHERE id=$2",[serverId,row.id]);await audit(c,null,user.name,'确认SSH安装Agent：'+row.host);return {credential,serverId}});
   if(!registration){json(res,view((await db.query('SELECT * FROM provisioning_jobs WHERE id=$1',[row.id])).rows[0]));return true}
   try{const installed=await call('/jobs/'+row.id+'/install','POST',{control,token:registration.credential,confirmed:true,fingerprint:row.fingerprint});const current=(await db.query('SELECT * FROM provisioning_jobs WHERE id=$1',[row.id])).rows[0];json(res,await save(db,current,installed),202)}catch(error){await db.query("UPDATE provisioning_jobs SET status='interrupted',error='安装响应未确认，请检查远端服务和Agent状态；不要重复安装',updated_at=now() WHERE id=$1",[row.id]);throw error}finally{registration.credential=null}return true;
  }
 }
 fail('接入接口不存在',404);
}
