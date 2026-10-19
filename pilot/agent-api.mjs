import { transaction } from './db.mjs';
import { hash,token,fail,json,body,audit } from './common.mjs';
export async function agentRoute(db,store,req,res,path){
 if(!path.startsWith('/agent/v1/'))return false;
 const credential=req.headers.authorization?.replace(/^Bearer /,'');if(!credential)fail('Agent 认证失败',401);
 const server=(await db.query('SELECT * FROM servers WHERE token_hash=$1 AND NOT revoked',[hash(credential)])).rows[0];if(!server)fail('Agent 认证失败',401);
 if(path==='/agent/v1/package'&&req.method==='GET'){
  const task=new URL(req.url,'http://localhost').searchParams.get('task'),row=(await db.query("SELECT r.archive_key FROM deployment_tasks d JOIN releases r ON r.id=d.release_id WHERE d.id=$1 AND d.server_id=$2 AND d.status='running' AND d.lease_until>now()",[task,server.id])).rows[0];if(!row)fail('无权访问此发布包',403);const bytes=await store.readArchive(row.archive_key);res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);return true;
 }
 if(req.method!=='POST')fail('请使用 POST',405);const b=await body(req);
 await db.query('UPDATE servers SET last_seen=now(),version=$1 WHERE id=$2',[String(b.version||server.version||'unknown').slice(0,30),server.id]);
 if(path==='/agent/v1/poll'){
  const result=await transaction(db,async c=>{
   await c.query('SELECT id FROM servers WHERE id=$1 FOR UPDATE',[server.id]);
   await c.query("UPDATE deployment_tasks SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'queued' END,error='Agent租约超时' WHERE server_id=$1 AND status='running' AND lease_until<now()",[server.id]);
   if((await c.query("SELECT 1 FROM deployment_tasks WHERE server_id=$1 AND status='running'",[server.id])).rowCount)return null;
   const task=(await c.query("SELECT d.*,r.sha256,r.bytes,r.format,r.archive_key,s.analytics_domains FROM deployment_tasks d JOIN releases r ON r.id=d.release_id JOIN sites s ON s.id=d.site_id WHERE d.server_id=$1 AND d.status='queued' ORDER BY d.sequence LIMIT 1 FOR UPDATE OF d SKIP LOCKED",[server.id])).rows[0];if(!task)return null;
   if(task.format==='tar-gzip-v2'&&!/^0\.[3-9]\.|^[1-9]\d*\./.test(String(b.version)))fail('Agent需升级到0.3.0或以上才能接收tar发布包',409);
   const site=(await c.query('SELECT server_id FROM sites WHERE id=$1',[task.site_id])).rows[0];if(site.server_id!==server.id){await c.query("UPDATE deployment_tasks SET status='failed',error='站点归属已变化' WHERE id=$1",[task.id]);return null}
   const lease=token();await c.query("UPDATE deployment_tasks SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '60 seconds' WHERE id=$2",[lease,task.id]);
   return {id:task.id,site:task.site_id,release:task.release_id,kind:task.kind,domain:task.domain,domains:[...new Set([task.domain,...(task.analytics_domains||[])])],lease,sha256:task.sha256,bytes:Number(task.bytes),format:task.format,download:store.archiveDownloadUrl(task.archive_key)||'/agent/v1/package?task='+task.id};
  });json(res,{task:result});return true;
 }
 await transaction(db,async c=>{
  await c.query('SELECT id FROM servers WHERE id=$1 FOR UPDATE',[server.id]);const task=(await c.query('SELECT * FROM deployment_tasks WHERE id=$1 AND server_id=$2 FOR UPDATE',[b.task,server.id])).rows[0];
  if(path==='/agent/v1/report'&&task?.status==='succeeded'&&task.lease_token===b.lease&&b.ok)return;
  if(!task||task.status!=='running'||task.lease_token!==b.lease||task.lease_until<Date.now())fail('任务租约已失效',409);
  if(path==='/agent/v1/heartbeat'){await c.query("UPDATE deployment_tasks SET lease_until=now()+interval '60 seconds' WHERE id=$1",[task.id]);return}
  if(path!=='/agent/v1/report')fail('接口不存在',404);
  await c.query('UPDATE deployment_tasks SET status=$1,result=$2,error=$3,finished_at=now() WHERE id=$4',[b.ok?'succeeded':'failed',b.check||null,b.ok?null:String(b.error||'部署失败').slice(0,1000),task.id]);
  if(b.ok){await c.query('UPDATE sites SET active_release=$1,deployed_at=now() WHERE id=$2',[task.release_id,task.site_id]);await c.query("UPDATE releases SET status='live' WHERE id=$1",[task.release_id]);await audit(c,task.site_id,server.name,task.kind==='rollback'?'Agent回滚成功':'Agent部署成功')}
 });json(res,{ok:true});return true;
}
