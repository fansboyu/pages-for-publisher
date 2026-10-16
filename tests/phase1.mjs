import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs,createWriteStream } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { unpack } from '../agent/agent.mjs';
import { sha256 } from '../storage-adapter.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const testRoot=join(root,'storage','tests',Date.now().toString());await fs.mkdir(testRoot,{recursive:true});
const results=[];const pass=s=>{results.push(s);console.log('PASS',s)};
async function port(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}
const [controlPort,webPort,adminPort]=await Promise.all([port(),port(),port()]);const base=`http://127.0.0.1:${controlPort}`,web=`http://127.0.0.1:${webPort}/sites/s1/`,admin=`http://127.0.0.1:${adminPort}`;
const children=[],streams=[];
function start(cmd,args,env={},name='process'){const stream=createWriteStream(join(testRoot,name+'.log'),{flags:'a'});streams.push(stream);const p=spawn(cmd,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.pipe(stream);p.stderr.pipe(stream);p.on('error',e=>stream.write(e.stack));children.push(p);return p}
async function stop(p){if(p.exitCode!==null)return;const done=once(p,'exit');p.kill();await Promise.race([done,new Promise(r=>setTimeout(r,2500))]);if(p.exitCode===null)p.kill('SIGKILL')}
async function until(fn,label,ms=25000){const start=Date.now();let last;while(Date.now()-start<ms){try{const result=await fn();if(result)return result}catch(e){last=e}await new Promise(r=>setTimeout(r,200))}throw Error(`Timeout: ${label} ${last?.message||''}`)}
let cookie;
async function req(path,body,headers={}){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error),{status:r.status});return d}
const serverEnv={PORT:String(controlPort),DATA_ROOT:join(testRoot,'control'),STORAGE_DRIVER:'local',PUBLIC_BASE_URL:base};
let server,agent,caddy;
try{
 server=start(process.execPath,['server.mjs'],serverEnv,'control');await until(async()=> (await fetch(base)).ok,'control startup');
 const login=async()=>{const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin123!'})});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0]};await login();
 const node=await req('/api/infrastructure/servers',{name:'隔离测试节点'});await req('/api/infrastructure/bind',{site:'s1',server:node.id});
 await assert.rejects(req('/agent/v1/poll',{}, {Authorization:'Bearer invalid'}),e=>e.status===401);
 await assert.rejects(req('/agent/v1/package?task=invalid',null,{Authorization:'Bearer '+node.token}),e=>e.status===403);pass('Agent 身份认证与发布包访问隔离');
 const original=await sharp({create:{width:600,height:400,channels:3,background:'#457a60'}}).png().toBuffer();
 const image=await req('/api/sites/s1/media',{name:'editor-test.png',data:'data:image/png;base64,'+original.toString('base64')});assert(image.url.endsWith('.webp'));assert.equal((await fetch(base+image.url)).status,200);pass('素材 / 编辑器共用图片接口：实际 WebP 压缩和存储');
 await req('/api/sites/s1/articles',{title:'图文发布测试',body:`<h2>富文本标题</h2><p><strong>加粗内容</strong></p><img src="${image.url}">`,format:'html',status:'published'});
 await req('/api/sites/s1/content',{title:'阶段一版本 A'});const a=await req('/api/sites/s1/publish',{});assert.equal(a.status,'ready');assert((await req('/api/state')).deployments.some(d=>d.status==='queued'));pass('Agent 离线时任务持久排队');
 const agentConfig={control:base,token:node.token,root:join(testRoot,'agent'),mode:'local',caddyAdmin:admin,port:webPort,pollMs:200,storage:{module:'file_system',root:join(testRoot,'caddy-data')}};const conf=join(testRoot,'agent.json');await fs.writeFile(conf,JSON.stringify(agentConfig));
 const bootstrap=join(testRoot,'caddy.json');await fs.writeFile(bootstrap,JSON.stringify({admin:{listen:`127.0.0.1:${adminPort}`}}));
 const bin=process.env.CADDY_BIN||join(root,'tools',process.platform==='win32'?'caddy.exe':'caddy');caddy=start(bin,['run','--config',bootstrap],{APPDATA:join(testRoot,'config'),XDG_CONFIG_HOME:join(testRoot,'config')},'caddy');await until(async()=>(await fetch(admin+'/config/',{headers:{Origin:admin}})).ok,'Caddy startup');agent=start(process.execPath,['agent/agent.mjs',conf],{},'agent');
 const waitRelease=async id=>until(async()=>{const s=await req('/api/state');return s.sites.find(s=>s.id==='s1').active===id&&s.deployments.some(d=>d.release===id&&d.status==='succeeded')},'release '+id);
 await waitRelease(a.id);assert((await(await fetch(web)).text()).includes('阶段一版本 A'));const list=await req('/api/state'),article=list.articles.find(p=>p.title==='图文发布测试');const articlePage=await(await fetch(web+`news/${article.id}/`)).text();assert(articlePage.includes('<strong>加粗内容</strong>'));assert(articlePage.includes(base+image.url));pass('真实 Caddy 托管首页、文章、图片绝对路径与部署回执');
 await req('/api/sites/s1/content',{title:'阶段一版本 B'});const b=await req('/api/sites/s1/publish',{});await waitRelease(b.id);assert((await(await fetch(web)).text()).includes('阶段一版本 B'));
 await req('/api/sites/s1/rollback',{id:a.id});await until(async()=>(await(await fetch(web)).text()).includes('阶段一版本 A'),'rollback');await until(async()=>(await req('/api/state')).sites.find(s=>s.id==='s1').active===a.id,'rollback report');assert.equal((await req('/api/state')).sites.find(s=>s.id==='s1').title,'阶段一版本 B');pass('真实版本回滚，编辑草稿不被覆盖');
 await stop(agent);await req('/api/sites/s1/content',{title:'断线恢复后版本 C'});const c=await req('/api/sites/s1/publish',{});assert((await(await fetch(web)).text()).includes('阶段一版本 A'));agent=start(process.execPath,['agent/agent.mjs',conf],{},'agent');await waitRelease(c.id);pass('Agent 停机后恢复领取排队任务，旧网站持续可用');
 await stop(agent);const broken=await req('/api/sites/s1/publish',{}),archive=join(testRoot,'control','objects',...broken.archiveKey.split('/')),good=await fs.readFile(archive);await fs.writeFile(archive,Buffer.from('tampered'));agent=start(process.execPath,['agent/agent.mjs',conf],{},'agent');await until(async()=>(await req('/api/state')).deployments.find(d=>d.release===broken.id)?.status==='failed','tampered archive denial');assert.equal((await req('/api/state')).sites.find(s=>s.id==='s1').active,c.id);pass('损坏发布包被拒绝，不切换客户网站');await fs.writeFile(archive,good);const badTask=(await req('/api/state')).deployments.find(d=>d.release===broken.id);await req('/api/infrastructure/retry',{task:badTask.id});await waitRelease(broken.id);pass('失败任务修复后可手动重试');
 await stop(server);assert.equal((await fetch(web)).status,200);await new Promise(r=>setTimeout(r,800));server=start(process.execPath,['server.mjs'],serverEnv,'control');await until(async()=>(await fetch(base)).ok,'control recovery');await login();await req('/api/sites/s1/content',{title:'总控重启后版本 D'});const d=await req('/api/sites/s1/publish',{});await waitRelease(d.id);pass('总控停机时 Caddy 持续服务，重启后 Agent 自动重连');
 const malicious=Buffer.from('x'),badBundle=gzipSync(Buffer.from(JSON.stringify({version:1,site:'s1',release:'rtest',files:[{path:'../outside.html',data:malicious.toString('base64'),size:1,sha256:sha256(malicious)}]})));assert.throws(()=>unpack(badBundle,{site:'s1',release:'rtest',sha256:sha256(badBundle)}),/非法路径/);pass('发布包目录穿越被拒绝');
 const agentLogin=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'agency',password:'Agency123!'})});const ac=agentLogin.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/api/infrastructure/servers',{method:'POST',headers:{Cookie:ac,'Content-Type':'application/json'},body:'{"name":"forbidden"}'})).status,403);pass('代理商不能注册服务器或读取其他代理商的网站');
 const key=(await req('/api/state')).sites.find(s=>s.id==='s1').key;const geo=body=>req('/webhooks/v1/sites/s1/articles',body,{Authorization:'Bearer '+key});const g1=await geo({external_id:'phase1-geo',title:'GEO更新',content_html:'<p>接口正文</p>',status:'draft'}),g2=await geo({external_id:'phase1-geo',title:'GEO更新',content_html:'<p>接口正文</p>',status:'draft'});assert.equal(g1.article_id,g2.article_id);pass('GEO Webhook 鉴权、富文本与外部ID幂等');
 await fs.writeFile(join(testRoot,'report.json'),JSON.stringify({time:new Date().toISOString(),mode:'local-files + real Caddy',results,notTested:['真实阿里云 OSS 连接','真实 ECS 部署','公网 HTTPS 证书签发与续期']},null,2));console.log(`\n${results.length} checks passed. Report: ${testRoot}`);
}finally{for(const p of children.reverse())await stop(p);for(const s of streams)s.end()}
