import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { localEnv } from '../scripts/pilot-env.mjs';
import { migrate,project } from '../pilot/db.mjs';
import { seed } from '../pilot/seed.mjs';
import { processExternalJob } from '../pilot/external-publishing.mjs';
import pg from 'pg';
Object.assign(process.env,{DEMO_MODE:'true',DATA_ROOT:project+'/storage/external-tests/'+Date.now()});
const env=await localEnv(),name='external_test_'+Date.now(),admin=new pg.Pool({connectionString:env.DATABASE_URL});await admin.query(`CREATE DATABASE "${name}"`);const url=new URL(env.DATABASE_URL);url.pathname='/'+name;const db=new pg.Pool({connectionString:url.href});await migrate(db);await seed(db);
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));const base='http://127.0.0.1:'+port;
Object.assign(process.env,{EXTERNAL_PUBLISH_MODE:'mock'});
const child=spawn(process.execPath,['pilot/server.mjs'],{cwd:project,env:{...process.env,...env,DATABASE_URL:url.href,PORT:String(port),EXTERNAL_PUBLISH_MODE:'mock',XIAOQINGWA_API_KEY:'mock-key'},windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',b=>errors+=b.toString());
async function ready(){for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error(errors||'API startup timeout')}
async function login(user,password){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
let cookie;
async function req(path,data,session=cookie){const r=await fetch(base+'/api/external/'+path,{method:data?'POST':'GET',headers:{Cookie:session,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await r.json();if(!r.ok)throw Object.assign(Error(result.error),{status:r.status});return result}
async function quote(channels,session=cookie,article='p1'){return req('quote',{site:'s1',article,channels},session)}
async function drain(){for(let i=0;i<15;i++){await db.query("UPDATE external_publish_orders SET next_poll_at=now() WHERE status='processing'");if(!await processExternalJob(db))break}}
try{
 await ready();cookie=await login('admin','Admin123!');const partner=await login('partner','Partner123!');
 assert.equal((await fetch(base+'/api/external/channels')).status,401);
 const page=await req('channels?page=1&pageSize=12');assert.equal(page.items.length,12);assert.equal(page.total,160);assert(!JSON.stringify(page).includes('mock-key'));assert.equal((await req('channels?page=1&pageSize=12')).cached,true);
 const page2=await req('channels?page=2&pageSize=12');assert.notEqual(page.items[0].id,page2.items[0].id);assert((await req('channels?industry='+encodeURIComponent('工业贸易'))).items.every(x=>x.industry==='工业贸易'));
 await assert.rejects(req('channels?pageSize=100000'),e=>e.status===400);await assert.rejects(quote(['demo-1'],partner),e=>e.status===403);await assert.rejects(req('batches?site=s1',undefined,partner),e=>e.status===403);
 const q=await quote(['demo-1','demo-7']);assert.equal(q.amountCents,0);assert.equal(q.channels.length,2);const key=crypto.randomUUID(),batch=await req('batches',{quoteId:q.quoteId,requestKey:key});const replay=await req('batches',{quoteId:q.quoteId,requestKey:key});assert.equal(replay.id,batch.id);assert.equal(replay.replay,true);await assert.rejects(req('batches',{quoteId:q.quoteId,requestKey:crypto.randomUUID()}),e=>e.status===409);
 await db.query("UPDATE articles SET title='后来修改的原文' WHERE id='p1'");await drain();let list=await req('batches?site=s1'),result=list.batches.find(b=>b.id===batch.id);assert.equal(result.status,'partial');assert.equal(result.orders.filter(o=>o.status==='published').length,1);assert.equal(result.orders.filter(o=>o.status==='failed').length,1);assert.equal(result.title,q.article.title);assert.equal(result.billingStatus,'charged');assert.equal((await db.query('SELECT count(*) n FROM billing_ledger WHERE order_id=$1 AND kind=$2',[result.billingId,'charge'])).rows[0].n,'1');
 const timeout=await quote(['demo-9']);const uncertain=await req('batches',{quoteId:timeout.quoteId,requestKey:crypto.randomUUID()});await drain();list=await req('batches?site=s1');result=list.batches.find(b=>b.id===uncertain.id);assert.equal(result.status,'review');assert.equal(result.billingStatus,'review');assert.equal(result.orders[0].status,'review');const attempts=(await db.query('SELECT attempts FROM external_publish_orders WHERE batch_id=$1',[uncertain.id])).rows[0].attempts;await drain();assert.equal((await db.query('SELECT attempts FROM external_publish_orders WHERE batch_id=$1',[uncertain.id])).rows[0].attempts,attempts);
 const release=await fetch(base+'/api/billing',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'resolve',order:result.billingId,decision:'release',note:'模拟测试核查后释放'})});assert.equal(release.status,200);await drain();assert.equal((await req('batches?site=s1')).batches.find(b=>b.id===uncertain.id).status,'failed');
 const expired=await quote(['demo-2']);await db.query("UPDATE external_publish_quotes SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.quoteId]);await assert.rejects(req('batches',{quoteId:expired.quoteId,requestKey:crypto.randomUUID()}),e=>e.status===409);
 const staleQuote=await quote(['demo-3']),stale=await req('batches',{quoteId:staleQuote.quoteId,requestKey:crypto.randomUUID()});await db.query("UPDATE external_publish_orders SET status='submitting',lease_until=now()-interval '1 minute' WHERE batch_id=$1",[stale.id]);await drain();assert.equal((await req('batches?site=s1')).batches.find(b=>b.id===stale.id).status,'review');
 process.env.EXTERNAL_PUBLISH_MODE='live';process.env.XIAOQINGWA_API_KEY='';await assert.rejects((await import('../pilot/external-provider.mjs')).channelById('demo-1'),e=>e.status===503);
 const originalFetch=globalThis.fetch;process.env.XIAOQINGWA_API_KEY='test-only';let sent;
 try{globalThis.fetch=async(url,options)=>{sent=Object.fromEntries(options.body);return {ok:true,json:async()=>({code:1,data:{order_nid:'test-order'}})}};const adapter=await import('../pilot/external-provider.mjs');const r=await adapter.submitExternal({id:'test-task',channel:{id:'123'},snapshot:{article:{title:'冻结标题',body:'正文<文本>',format:'text'}}});assert.equal(r.providerId,'test-order');assert.equal(sent.title,'冻结标题');assert(sent.content.includes('&lt;文本&gt;'));globalThis.fetch=async()=>({ok:true,json:async()=>({code:1,data:{status:4,is_refund:0}})});assert.equal((await adapter.queryExternal({provider_order_id:'test-order'})).status,'review');}finally{globalThis.fetch=originalFetch}
 assert.equal((await fetch(base+'/external-ui.js')).status,200);assert.equal((await fetch(base+'/external.css')).status,200);
 console.log('PASS 外部发布模拟闭环：分页缓存、筛选、权限、不可泄露密钥、冻结稿件、幂等、部分成功、模拟链接、零金额流水、超时不重发、核查释放、报价过期、Worker中断及正式模式阻断');
}finally{child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,2000))]);if(child.exitCode===null)child.kill('SIGKILL');await db.end();await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await admin.query(`DROP DATABASE "${name}"`);await admin.end()}
