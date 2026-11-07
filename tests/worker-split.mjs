import assert from 'node:assert/strict';
import pg from 'pg';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {localEnv} from '../scripts/pilot-env.mjs';
import {migrate,project} from '../pilot/db.mjs';
import {seed} from '../pilot/seed.mjs';
import {queueArticle,processArticleJob} from '../pilot/ai-article-jobs.mjs';
import {accountScope,siteFor} from '../pilot/common.mjs';
import {createStorage} from '../storage-adapter.mjs';
const env=await localEnv(),maintenance=new pg.Pool({connectionString:env.DATABASE_URL}),name='worker_split_'+Date.now();
await maintenance.query(`CREATE DATABASE "${name}"`);const url=new URL(env.DATABASE_URL);url.pathname='/'+name;
const db=new pg.Pool({connectionString:url.href}),children=[];
Object.assign(process.env,{DEMO_MODE:'true',STORAGE_DRIVER:'local',ARCHIVE_STORAGE_DRIVER:'local',AI_TEXT_API_KEY:'',AI_API_KEY:'',ALIYUN_IMAGE_API_KEY:'',AI_IMAGE_API_KEY:'',DASHSCOPE_API_KEY:'',DATA_ROOT:project+'/storage/worker-tests/'+name});
try{
 await migrate(db);await seed(db);
 const user=accountScope((await db.query("SELECT * FROM users WHERE id='u1'")).rows[0]),site=await siteFor(db,user,'s1'),store=createStorage(process.env.DATA_ROOT),input={topic:'后台隔离验证',imageCount:2,requestKey:crypto.randomUUID()};
 const count=Number((await db.query("SELECT count(*) FROM articles WHERE site_id='s1'")).rows[0].count);
 const tasks=await Promise.all([queueArticle(db,user,site,input,true),queueArticle(db,user,site,input,true)]);
 assert.equal(tasks[0].jobId,tasks[1].jobId);assert.equal(Number((await db.query('SELECT count(*) FROM billing_orders')).rows[0].count),1);
 assert.equal(Number((await db.query("SELECT count(*) FROM articles WHERE site_id='s1'")).rows[0].count),count);
 assert.equal((await db.query('SELECT status FROM ai_article_jobs')).rows[0].status,'queued');
 console.log('PASS API enqueue is durable, duplicate submission creates one reservation/task, no inline generation');
 await Promise.all([processArticleJob(db,store),processArticleJob(db,store)]);
 const done=(await db.query('SELECT * FROM ai_article_jobs')).rows[0];assert.equal(done.status,'succeeded',done.error);
 assert.equal(Number((await db.query("SELECT count(*) FROM articles WHERE site_id='s1'")).rows[0].count),count+1);
 assert.equal((await db.query('SELECT status FROM billing_orders')).rows[0].status,'charged');assert.equal(done.result.imageCount,3);assert(done.result.release.id);
 console.log('PASS concurrent AI consumers claim once; article + three images + settlement + publish outbox');
 const lost=await queueArticle(db,user,site,{...input,requestKey:crypto.randomUUID()},true);
 await db.query("UPDATE ai_article_jobs SET status='running',lease_until=now()-interval '1 second' WHERE id=$1",[lost.jobId]);
 await processArticleJob(db,store);
 const review=(await db.query('SELECT j.status,o.status bill FROM ai_article_jobs j JOIN billing_orders o ON o.id=j.order_id WHERE j.id=$1',[lost.jobId])).rows[0];assert.deepEqual(review,{status:'review',bill:'review'});
 assert.equal(await processArticleJob(db,store),false);
 console.log('PASS expired AI lease enters review, retains reservation, never resubmits paid generation');
 const denied=accountScope((await db.query("SELECT * FROM users WHERE id='u3'")).rows[0]);
 await assert.rejects(queueArticle(db,denied,site,{...input,requestKey:crypto.randomUUID()},true),e=>e.status===403);
 console.log('PASS tenant permission enforced inside enqueue transaction');
 const mismatch=await queueArticle(db,user,site,{...input,requestKey:crypto.randomUUID()},true);
 process.env.AI_TEXT_MODEL='test-only-model';process.env.AI_TEXT_API_KEY='test-only-never-called';await processArticleJob(db,store);process.env.AI_TEXT_API_KEY='';process.env.AI_TEXT_MODEL='';
 const rejected=(await db.query('SELECT j.status,o.status bill FROM ai_article_jobs j JOIN billing_orders o ON o.id=j.order_id WHERE j.id=$1',[mismatch.jobId])).rows[0];assert.deepEqual(rejected,{status:'failed',bill:'released'});
 console.log('PASS changed provider mode is rejected before generation and releases reservation');
 const smoke=await queueArticle(db,user,site,{...input,requestKey:crypto.randomUUID()},true);
 async function boot(file,ready){
  const child=spawn(process.execPath,['pilot/'+file],{cwd:project,env:{...process.env,DATABASE_URL:url.href,REDIS_URL:env.REDIS_URL,BUILD_QUEUE_NAME:name,EXTERNAL_PUBLISH_MODE:'mock',GEO_QUERY_MODE:'demo'},windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);
  for(let i=0;i<100;i++){if(log.includes(ready))return;if(child.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100))}throw Error('Worker startup failed: '+file+' '+log);
 }
 await boot('worker.mjs','Independent build Worker ready');await boot('media-worker.mjs','MEDIA Worker ready');await boot('geo-worker.mjs','GEO Worker ready');
 await new Promise(r=>setTimeout(r,1000));assert.equal((await db.query('SELECT status FROM ai_article_jobs WHERE id=$1',[smoke.jobId])).rows[0].status,'queued');
 await boot('ai-worker.mjs','AI Worker ready');
 let complete;
 for(let i=0;i<150;i++){complete=(await db.query('SELECT status,error FROM ai_article_jobs WHERE id=$1',[smoke.jobId])).rows[0];if(complete.status==='succeeded')break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(complete.status,'succeeded',complete.error);
 console.log('PASS four independent processes start; publish/media/GEO never consume AI jobs, AI worker consumes queued job');

}finally{await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const ended=once(child,'exit');child.kill();await Promise.race([ended,new Promise(r=>setTimeout(r,2500))]);if(child.exitCode===null){child.kill('SIGKILL');await ended}}));await db.end();await maintenance.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.end()}
