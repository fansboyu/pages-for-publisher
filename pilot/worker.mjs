import { Worker,Queue,DelayedError } from 'bullmq';
import Redis from 'ioredis';
import { promises as fs } from 'node:fs';
import { join,dirname } from 'node:path';
import { database,checkDatabase,transaction,project } from './db.mjs';
import { dataRoot,buildWebsite } from './templates.mjs';
import { createStorage,sha256 } from '../storage-adapter.mjs';
import { packWebsite } from './archive.mjs';
import { enqueueDeploy } from './publishing.mjs';
import { gzipSync } from 'node:zlib';
import { checkAndSendAlerts } from './alerts.mjs';
const db=database(),store=createStorage(dataRoot());await checkDatabase(db);
if(!process.env.REDIS_URL)throw Error('REDIS_URL 必填');
const connection=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null,retryStrategy:n=>Math.min(n*500,5000)});connection.on('error',e=>console.error('Redis:',e.message));
const queueName=process.env.BUILD_QUEUE_NAME||'website-builds-v2',queue=new Queue(queueName,{connection});
let closing=false,dispatching=false;
async function dispatch(){if(dispatching||closing)return;dispatching=true;try{
 await db.query("UPDATE build_jobs SET status='queued',error='Worker租约过期，等待重试' WHERE status='building' AND lease_until<now()");
 const jobs=(await db.query("SELECT id FROM build_jobs WHERE status='queued' ORDER BY created_at LIMIT 100")).rows;
 for(const row of jobs){const existing=await queue.getJob(row.id);if(existing){const status=await existing.getState();if(['completed','failed'].includes(status))await existing.remove();else continue}await queue.add('build',{id:row.id},{jobId:row.id,attempts:3,backoff:{type:'exponential',delay:1000},removeOnComplete:{count:300},removeOnFail:{count:300}})}
}catch(e){console.error('任务补投:',e.message)}finally{dispatching=false}}
const worker=new Worker(queueName,async(job,queueToken)=>{
 const row=(await db.query('SELECT * FROM build_jobs WHERE id=$1',[job.data.id])).rows[0];if(!row||row.status==='succeeded'||row.status==='failed')return;
 const c=await db.connect();let acquired=false,pulse;
 try{
  acquired=(await c.query('SELECT pg_try_advisory_lock(hashtext($1)) acquired',['build:'+row.site_id])).rows[0].acquired;
  const older=(await c.query("SELECT 1 FROM build_jobs b JOIN releases r ON r.id=b.release_id WHERE b.site_id=$1 AND b.status IN ('queued','building') AND r.sequence<(SELECT sequence FROM releases WHERE id=$2) LIMIT 1",[row.site_id,row.release_id])).rowCount;
  if(!acquired||older){await job.moveToDelayed(Date.now()+700,queueToken);throw new DelayedError()}
  await c.query("UPDATE build_jobs SET status='building',attempts=attempts+1,lease_until=now()+interval '60 seconds',error=NULL WHERE id=$1",[row.id]);
  await c.query("UPDATE releases SET status='building',error=NULL WHERE id=$1",[row.release_id]);
  pulse=setInterval(()=>db.query("UPDATE build_jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND status='building'",[row.id]).catch(console.error),15000);
  const release=(await c.query('SELECT * FROM releases WHERE id=$1',[row.release_id])).rows[0],template=(await c.query('SELECT * FROM templates WHERE id=$1',[release.template_id])).rows[0];
  const files=await buildWebsite(release.snapshot,template),bytes=await packWebsite(row.site_id,release.id,files),key=`archives/sites/${row.site_id}/${release.id}.tar.gz`;
  await store.putArchive(key,bytes);await store.putArchive(`archives/sites/${row.site_id}/${release.id}.snapshot.json.gz`,gzipSync(Buffer.from(JSON.stringify(release.snapshot))));
  const dir=join(dataRoot(),'releases',row.site_id,release.id);for(const [path,data]of files){await fs.mkdir(dirname(join(dir,path)),{recursive:true});await fs.writeFile(join(dir,path),data)}
  await transaction(db,async tx=>{const site=(await tx.query('SELECT * FROM sites WHERE id=$1 FOR UPDATE',[row.site_id])).rows[0];
   await tx.query('UPDATE releases SET status=$1,archive_key=$2,sha256=$3,bytes=$4,pages=$5,error=NULL WHERE id=$6',[site.server_id?'ready':'live',key,sha256(bytes),bytes.length,[...files.keys()].filter(p=>p.endsWith('.html')).length,release.id]);
   if(site.server_id)await enqueueDeploy(tx,site,release.id,'deploy',release.created_by);else await tx.query('UPDATE sites SET active_release=$1,deployed_at=now() WHERE id=$2',[release.id,row.site_id]);
   await tx.query("UPDATE build_jobs SET status='succeeded',finished_at=now(),lease_until=NULL WHERE id=$1",[row.id]);
  });console.log('build succeeded',release.id);
 }catch(e){if(e instanceof DelayedError)throw e;const attempts=(await db.query('SELECT attempts FROM build_jobs WHERE id=$1',[row.id])).rows[0]?.attempts||0,terminal=attempts>=3||job.attemptsMade+1>=3;await db.query('UPDATE build_jobs SET status=$1,error=$2,lease_until=NULL WHERE id=$3',[terminal?'failed':'queued',e.message,row.id]);await db.query('UPDATE releases SET status=$1,error=$2 WHERE id=$3',[terminal?'failed':'queued',e.message,row.release_id]);throw e}
 finally{clearInterval(pulse);if(acquired)await c.query('SELECT pg_advisory_unlock(hashtext($1))',['build:'+row.site_id]);c.release()}
},{connection,concurrency:Number(process.env.BUILD_CONCURRENCY||2),lockDuration:60000});worker.on('error',e=>console.error('Worker:',e.message));worker.on('failed',(job,e)=>console.error('Build failed:',job?.id,e.message));
const timer=setInterval(dispatch,2000),alertTimer=setInterval(()=>checkAndSendAlerts(db).catch(e=>console.error('告警检查失败:',e.message)),Number(process.env.ALERT_POLL_MS||60000));await dispatch();await checkAndSendAlerts(db).catch(e=>console.error('告警检查失败:',e.message));console.log('Independent build Worker ready');
async function stop(){if(closing)return;closing=true;clearInterval(timer);clearInterval(alertTimer);await worker.close();await queue.close();await connection.quit();await db.end()};process.on('SIGINT',()=>stop().then(()=>process.exit()));process.on('SIGTERM',()=>stop().then(()=>process.exit()));
