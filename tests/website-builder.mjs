import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { promises as fs,createWriteStream } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { localEnv } from '../scripts/pilot-env.mjs';
import { migrate,project } from '../pilot/db.mjs';
import { seed } from '../pilot/seed.mjs';
import { buildWebsite } from '../pilot/templates.mjs';
import { normalizeWebsiteSpec,renderWebsitePages } from '../pilot/website-renderer.mjs';
import { demoWebsite } from '../pilot/ai-website.mjs';
import { processWebsiteJob } from '../pilot/website-builder.mjs';
import { createStorage } from '../storage-adapter.mjs';
import { quote as billingQuote } from '../pilot/billing.mjs';

const env=await localEnv(),name='website_builder_test_'+Date.now(),maintenance=new pg.Pool({connectionString:env.DATABASE_URL});
await maintenance.query(`CREATE DATABASE "${name}"`);const dbURL=new URL(env.DATABASE_URL);dbURL.pathname='/'+name;
const pool=new pg.Pool({connectionString:dbURL.href}),root=join(project,'storage','website-builder-tests',name);await fs.mkdir(root,{recursive:true});
const noKeys=Object.fromEntries(['AI_TEXT_API_KEY','AI_API_KEY','ALIYUN_IMAGE_API_KEY','AI_IMAGE_API_KEY','DASHSCOPE_API_KEY','ALIYUN_IMAGE_MODEL','AI_IMAGE_MODEL','AI_TEXT_MODEL'].map(k=>[k,'']));
Object.assign(process.env,{...noKeys,DEMO_MODE:'true',DATA_ROOT:root,STORAGE_DRIVER:'local',ARCHIVE_STORAGE_DRIVER:'local'});
await migrate(pool);await seed(pool);const store=createStorage(root);
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base='http://127.0.0.1:'+port;process.env.PUBLIC_BASE_URL=base;
let api,cookie,log,fixture,fixtureMode='valid',fixtureCalls=0,lastPrompt,providerSpec;
const runtime={...process.env,DATABASE_URL:dbURL.href,REDIS_URL:env.REDIS_URL,PORT:String(port),PUBLIC_BASE_URL:base};
async function until(fn,timeout=20000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await fn();if(value)return value}catch(error){last=error}await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+(last?.message||''))}
async function stopAPI(){if(!api||api.exitCode!==null)return;const done=once(api,'exit');api.kill();await Promise.race([done,new Promise(r=>setTimeout(r,2500))]);if(api.exitCode===null){api.kill('SIGKILL');await done}log.end()}
async function startAPI(extra={}){log=createWriteStream(join(root,'api.log'),{flags:'a'});api=spawn(process.execPath,['pilot/server.mjs'],{cwd:project,env:{...runtime,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});api.stdout.pipe(log);api.stderr.pipe(log);await until(async()=>(await fetch(base+'/health')).ok);cookie=await login('admin','Admin123!')}
async function login(username,password){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
async function req(path,data,session=cookie){const r=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{Cookie:session,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error),{status:r.status});return value}
const path='sites/s1/website';
async function queue(input){const q=await req(path+'/quote',input);return req(path+'/jobs',{...input,requestKey:input.requestKey||crypto.randomUUID(),quoteVersion:q.price.version,quotedAmountCents:q.amountCents})}
try{
 const plain={name:'测试官网',client_name:'测试企业',type:'企业服务',content:{title:'企业官网标题',intro:'经过确认的企业介绍。'}};
 const unit=demoWebsite(plain,{theme:'business',instruction:'主色改成蓝色，隐藏案例模块，产品与服务放到前面'},null,[]);
 assert.equal(unit.accent,'#2563eb');assert.equal(unit.sections[0].type,'services');assert.equal(unit.sections.find(x=>x.type==='cases').enabled,false);
 assert.throws(()=>normalizeWebsiteSpec({...unit,hero:{...unit.hero,imageUrl:'javascript:alert(1)'}}));assert.throws(()=>normalizeWebsiteSpec({...unit,sections:[null,null]}));
 const injected=structuredClone(unit);injected.hero.title='<script>alert(1)</script>';const html=renderWebsitePages(injected,{client:'测试企业'}).get('index.html').toString();assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));
 console.log('PASS 受控模块、自然语言演示修改、配色与输出转义');
 await startAPI();const agency=await login('agency','Agency123!'),partner=await login('partner','Partner123!');
 assert((await req('state',undefined,agency)).permissions.pages.includes('builder'));
 await assert.rejects(req(path,undefined,partner),e=>e.status===403);await assert.rejects(req(path+'/apply',{revision:1,siteRevision:0},partner),e=>e.status===403);
 assert.equal((await fetch(base+'/website-builder-ui.js')).status,200);assert.equal((await fetch(base+'/website-builder.css')).status,200);
 await req('clients/c1/knowledge',{category:'产品与服务',title:'服务范围',content:'提供上海浦东家庭日常保洁预约服务。',terms:'浦东保洁'});
 const initial=await req(path),input={instruction:'创建绿色企业官网，隐藏案例模块',theme:'warm',imageCount:1,revision:0,requestKey:crypto.randomUUID()};
 const q=await req(path+'/quote',input);assert.equal(q.amountCents,0);assert.equal(q.price.imageCount,1);
 const job=await queue(input);assert.equal((await req(path)).jobs[0].status,'queued');assert.equal((await pool.query("SELECT content->'builder' spec FROM sites WHERE id='s1'")).rows[0].spec,null);
 await processWebsiteJob(pool,store);let state=await req(path);assert.equal(state.jobs[0].status,'succeeded');assert.equal(state.draft.revision,1);assert.equal(state.draft.appliedRevision,0);assert(state.draft.spec.hero.imageUrl);assert.equal((await pool.query("SELECT count(*) n FROM media WHERE site_id='s1'")).rows[0].n,'1');
 assert.equal((await pool.query("SELECT content->'builder' spec FROM sites WHERE id='s1'")).rows[0].spec,null);
 const replay=await queue(input);assert.equal(replay.jobId,job.jobId);assert.equal((await pool.query('SELECT count(*) n FROM website_builder_jobs')).rows[0].n,'1');
 const preview=await fetch(base+'/api/'+path+'/preview/index.html?revision=1',{headers:{Cookie:cookie}});const previewHtml=await preview.text();assert.equal(preview.status,200,previewHtml);assert(preview.headers.get('content-security-policy').includes('sandbox'));assert(previewHtml.includes('上海优佳家政'));assert(previewHtml.includes('?revision=1'));assert.equal((await fetch(base+'/api/'+path+'/preview/index.html',{headers:{Cookie:partner}})).status,403);
 console.log('PASS 代理商隔离、异步任务、演示图片入素材库、独立草稿与重复提交不重复结算');
 await assert.rejects(req(path+'/apply',{revision:1,siteRevision:999}),e=>e.status===409);
 await req(path+'/apply',{revision:1,siteRevision:state.siteRevision});state=await req(path);assert.equal(state.draft.appliedRevision,1);
 const publish=await req('sites/s1/publish',{}),release=(await pool.query('SELECT * FROM releases WHERE id=$1',[publish.id])).rows[0],template=(await pool.query('SELECT * FROM templates WHERE id=$1',[release.template_id])).rows[0];
 const built=await buildWebsite(release.snapshot,template);for(const file of ['index.html','about/index.html','services/index.html','cases/index.html','contact/index.html','news/index.html','news/p1/index.html','publisher-analytics.js'])assert(built.has(file),file);
 assert(built.get('index.html').toString().includes('data-publisher-analytics'));assert(built.get('services/index.html').toString().includes('上海浦东家庭日常保洁预约服务'));
 const changed=structuredClone(state.draft.spec);changed.hero.title='新草稿专用标题';changed.accent='#7c3aed';
 await req(path+'/draft',{revision:1,spec:changed});await assert.rejects(req(path+'/draft',{revision:1,spec:changed}),e=>e.status===409);
 state=await req(path);assert.equal(state.draft.revision,2);assert.equal(state.draft.appliedRevision,1);assert.notEqual((await pool.query("SELECT content->'builder'->'hero'->>'title' title FROM sites WHERE id='s1'")).rows[0].title,'新草稿专用标题');
 const oldPreview=await(await fetch(base+'/api/'+path+'/preview/index.html?revision=1',{headers:{Cookie:cookie}})).text();assert(!oldPreview.includes('新草稿专用标题'));
 const currentPreview=await(await fetch(base+'/api/'+path+'/preview/index.html?revision=2',{headers:{Cookie:cookie}})).text();assert(currentPreview.includes('新草稿专用标题'));
 const invalidImage=structuredClone(changed);invalidImage.hero.imageUrl='https://example.com/foreign.webp';await assert.rejects(req(path+'/draft',{revision:2,spec:invalidImage}),e=>e.status===400);
 assert.notEqual(release.snapshot.site.builder.hero.title,'新草稿专用标题');
 console.log('PASS 草稿版本冲突保护、历史预览、保存与发布快照、五页官网与原文章/统计链路兼容');
 const lost=await queue({instruction:'精简首页介绍',theme:'warm',imageCount:0,revision:2});await pool.query("UPDATE website_builder_jobs SET status='running',lease_until=now()-interval '1 minute' WHERE id=$1",[lost.jobId]);await processWebsiteJob(pool,store);state=await req(path);assert.equal(state.jobs.find(x=>x.id===lost.jobId).status,'review');
 await assert.rejects(queue({instruction:'不应重复生成',theme:'warm',imageCount:0,revision:2}),e=>e.status===409);
 const lostOrder=(await pool.query('SELECT order_id FROM website_builder_jobs WHERE id=$1',[lost.jobId])).rows[0].order_id;await req('billing',{action:'resolve',order:lostOrder,decision:'release',note:'专项测试核查后释放'});assert.equal((await req(path)).jobs.find(x=>x.id===lost.jobId).status,'failed');
 console.log('PASS Worker中断后保留待核查状态，不自动重试或释放冻结金额');
 await stopAPI();providerSpec=structuredClone(state.draft.spec);providerSpec.hero.title='模型生成测试官网';
 fixture=createServer(async(request,response)=>{let text='';for await(const chunk of request)text+=chunk;fixtureCalls++;lastPrompt=JSON.parse(text);response.setHeader('Content-Type','application/json');const answer=()=>response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(fixtureMode==='invalid'?{}:providerSpec)}}]}));if(fixtureMode==='timeout')setTimeout(answer,250);else answer()});fixture.listen(0,'127.0.0.1');await once(fixture,'listening');const provider={AI_TEXT_API_KEY:'mock-key',AI_TEXT_MODEL:'mock-model',AI_TEXT_BASE_URL:'http://127.0.0.1:'+fixture.address().port,AI_TIMEOUT_MS:'80'};
 Object.assign(process.env,provider);await startAPI(provider);await req('billing',{action:'prices',article:'0.10',image:'0.20',video:'0',enabled:true});await req('billing',{action:'recharge',account:'agency:a1',amount:'1.00',note:'建站计费专项测试',requestKey:crypto.randomUUID()});
 const priced=await req(path+'/quote',{instruction:'生成测试官网',theme:'business',imageCount:0,revision:2});assert.equal(priced.amountCents,10);const forgedKind=await billingQuote(pool,{id:'u1',role:'admin'},'s1',{kind:'website',imageCount:1},false);assert.equal(forgedKind.price.imageCount,2);assert.equal(forgedKind.amountCents,50);await assert.rejects(req(path+'/quote',{instruction:'需真实图片模型',theme:'business',imageCount:1,revision:2}),e=>e.status===503);
 const real=await queue({instruction:'生成测试官网',theme:'business',imageCount:0,revision:2});await processWebsiteJob(pool,store);assert.equal((await req(path)).jobs.find(x=>x.id===real.jobId).status,'succeeded');assert.equal(fixtureCalls,1);assert(lastPrompt.messages[1].content.includes('上海浦东家庭日常保洁预约服务'));let wallet=(await pool.query("SELECT balance_cents,held_cents FROM billing_accounts WHERE id='agency:a1'")).rows[0];assert.equal(Number(wallet.balance_cents),90);assert.equal(Number(wallet.held_cents),0);
 fixtureMode='invalid';const invalid=await queue({instruction:'无效返回测试',theme:'business',imageCount:0,revision:3});await processWebsiteJob(pool,store);assert.equal((await req(path)).jobs.find(x=>x.id===invalid.jobId).status,'failed');wallet=(await pool.query("SELECT balance_cents,held_cents FROM billing_accounts WHERE id='agency:a1'")).rows[0];assert.equal(Number(wallet.balance_cents),90);assert.equal(Number(wallet.held_cents),0);
 fixtureMode='timeout';const timed=await queue({instruction:'超时测试',theme:'business',imageCount:0,revision:3});await processWebsiteJob(pool,store);assert.equal((await req(path)).jobs.find(x=>x.id===timed.jobId).status,'review');wallet=(await pool.query("SELECT balance_cents,held_cents FROM billing_accounts WHERE id='agency:a1'")).rows[0];assert.equal(Number(wallet.balance_cents),90);assert.equal(Number(wallet.held_cents),10);const calls=fixtureCalls;await processWebsiteJob(pool,store);assert.equal(fixtureCalls,calls);
 console.log('PASS 模型接口契约与知识库上下文、真实计费模拟、无效结果释放、超时冻结并停止自动重试');
 console.log('All website builder checks passed. '+root);
}finally{await stopAPI();if(fixture){fixture.closeAllConnections();await new Promise(r=>fixture.close(r))}await pool.end();await maintenance.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1',[name]);await maintenance.query(`DROP DATABASE "${name}"`);await maintenance.end()}
