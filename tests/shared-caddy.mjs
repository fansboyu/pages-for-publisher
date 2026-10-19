import assert from 'node:assert/strict';
import { promises as fs,createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as tcpServer } from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadCaddyConfig } from '../agent/agent.mjs';
const project=fileURLToPath(new URL('../',import.meta.url)),root=join(project,'storage','shared-caddy-tests',String(Date.now()));
await fs.mkdir(root,{recursive:true});
async function port(){const s=tcpServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p}
const [adminPort,webPort,healthPort]=await Promise.all([port(),port(),port()]),admin=`http://127.0.0.1:${adminPort}`;
const upstream=http.createServer((req,res)=>{res.setHeader('X-Legacy','preserved');res.end('existing business')});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
const foreign={match:[{host:['legacy.example.test']}],handle:[{handler:'reverse_proxy',upstreams:[{dial:`127.0.0.1:${upstream.address().port}`}]}],terminal:true};
const initial={admin:{listen:`127.0.0.1:${adminPort}`},logging:{logs:{default:{level:'ERROR'}}},storage:{module:'file_system',root:join(root,'certificates')},apps:{http:{servers:{legacy:{listen:[`127.0.0.1:${webPort}`],automatic_https:{disable:true},routes:[foreign,{handle:[{handler:'static_response',status_code:404,body:'original fallback'}]}]}}}}};
const bootstrap=join(root,'bootstrap.json');await fs.writeFile(bootstrap,JSON.stringify(initial));
const log=createWriteStream(join(root,'caddy.log')),caddy=spawn(process.env.CADDY_BIN||join(project,'tools',process.platform==='win32'?'caddy.exe':'caddy'),['run','--config',bootstrap],{cwd:project,env:{...process.env,APPDATA:join(root,'config'),XDG_CONFIG_HOME:join(root,'config')},windowsHide:true,stdio:['ignore','pipe','pipe']});caddy.stdout.pipe(log);caddy.stderr.pipe(log);let spawnError;caddy.on('error',e=>spawnError=e);
const cfg={root:join(root,'agent'),mode:'production',caddyAdmin:admin,sharedCaddy:true,sharedServer:'legacy',healthPort};
async function request(host){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:webPort,headers:{Host:host,Connection:'close'}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,release:res.headers['x-site-release'],legacy:res.headers['x-legacy'],body:Buffer.concat(chunks).toString()}));res.on('error',reject)});req.on('error',reject);req.end()})}
async function read(){return (await fetch(admin+'/config/',{headers:{Origin:admin}})).json()}
async function write(value){const r=await fetch(admin+'/config/',{method:'POST',headers:{Origin:admin,'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(r.status,200,await r.text())}
const nodes={a:{domain:'alpha.example.test',domains:['sh.alpha.example.test','hz.alpha.example.test'],release:'r1',path:join(root,'r1').replace(/\\/g,'/')}};
async function version(release){const path=join(root,release);await fs.mkdir(path,{recursive:true});await fs.writeFile(join(path,'index.html'),`<!doctype html><h1>${release}</h1>`);return path.replace(/\\/g,'/')}
nodes.a.path=await version('r1');let bridge;
try{
 let ready=false;for(let i=0;i<100;i++){if(spawnError)throw spawnError;try{if((await fetch(admin+'/config/',{headers:{Origin:admin}})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready);
 assert.equal((await request('legacy.example.test')).body,'existing business');
 await loadCaddyConfig({},cfg);assert.equal((await request('legacy.example.test')).body,'existing business');assert.equal((await request('unknown.example.test')).body,'original fallback');
 await loadCaddyConfig(nodes,cfg);let current=await read();assert.deepEqual(current.storage,initial.storage);assert.deepEqual(current.logging,initial.logging);assert.deepEqual(current.admin,initial.admin);assert.deepEqual(current.apps.http.servers.legacy.routes.filter(r=>!r['@id']),initial.apps.http.servers.legacy.routes);assert.equal((await request('legacy.example.test')).legacy,'preserved');assert.equal((await request(nodes.a.domain)).release,'r1');assert.equal((await request('sh.alpha.example.test')).release,'r1');assert.equal((await request('hz.alpha.example.test')).release,'r1');assert.equal((await request('unknown.example.test')).body,'original fallback');
 console.log('PASS 共存接入保留旧反向代理、默认路由及全局配置，新站独立托管');
 const supportsEtag=!!(await fetch(admin+'/config/',{headers:{Origin:admin}})).headers.get('etag');
 const previous=structuredClone(nodes);nodes.a={...nodes.a,release:'r2',path:await version('r2')};nodes.b={domain:'beta.example.test',release:'r3',path:await version('r3')};await loadCaddyConfig(nodes,cfg);assert.equal((await request(nodes.a.domain)).release,'r2');assert.equal((await request(nodes.b.domain)).release,'r3');assert.equal((await request('legacy.example.test')).body,'existing business');
 await loadCaddyConfig({...nodes,a:previous.a},cfg);assert.equal((await request(nodes.a.domain)).release,'r1');assert.equal((await request(nodes.b.domain)).release,'r3');console.log('PASS 新站更新和回滚均保留原业务及同机其他新站');
 const before=await read();await assert.rejects(loadCaddyConfig({clash:{...nodes.a,domain:'legacy.example.test'}},cfg),/现有Caddy业务/);assert.deepEqual(await read(),before);console.log('PASS 拒绝占用已有业务域名，Caddy配置保持不变');
 let injected=false,preconditionFailures=0;
 bridge=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const b of req)chunks.push(b);
  if(req.method!=='GET'&&!injected){injected=true;const latest=await read();latest.apps.http.servers.legacy.routes.unshift({match:[{host:['concurrent.example.test']}],handle:[{handler:'static_response',body:'concurrent business'}],terminal:true});await write(latest)}
  const r=await fetch(admin+req.url,{method:req.method,headers:{Origin:admin,...(req.method!=='GET'?{'Content-Type':'application/json',...(req.headers['if-match']?{'If-Match':req.headers['if-match']}:{})}:{})},...(req.method!=='GET'?{body:Buffer.concat(chunks)}:{})});if(r.status===412)preconditionFailures++;if(r.headers.get('etag'))res.setHeader('ETag',r.headers.get('etag'));res.writeHead(r.status);res.end(Buffer.from(await r.arrayBuffer()));
 }catch(e){res.statusCode=500;res.end(e.message)}});bridge.listen(0,'127.0.0.1');await once(bridge,'listening');
 await loadCaddyConfig(nodes,{...cfg,caddyAdmin:`http://127.0.0.1:${bridge.address().port}`});assert.equal(preconditionFailures,supportsEtag?1:0);assert.equal((await request('concurrent.example.test')).body,'concurrent business');assert.equal((await request(nodes.a.domain)).release,'r2');assert.equal((await request('legacy.example.test')).body,'existing business');console.log(supportsEtag?'PASS 并发配置变更触发ETag重试，保留其他程序刚写入的路由':'PASS 旧版按独立子树更新，保留并发新增的其他业务路由');
 await loadCaddyConfig(nodes,cfg);await loadCaddyConfig(nodes,cfg);current=await read();assert.equal(current.apps.http.servers.legacy.routes.filter(r=>r['@id']).length,supportsEtag?2:1);if(!supportsEtag)assert.equal(current.apps.http.servers.legacy.routes.find(r=>r['@id']).handle[0].routes.length,2);assert.equal(Object.keys(current.apps.http.servers).filter(n=>n.startsWith('site-agent-')).length,1);console.log('PASS Agent重复恢复不会重复添加站点路由或健康检查服务');
 console.log('5 shared Caddy checks passed. Report directory: '+root);
}finally{
 if(bridge){bridge.closeAllConnections();await new Promise(r=>bridge.close(r))}upstream.closeAllConnections();await new Promise(r=>upstream.close(r));if(caddy.exitCode===null&&!spawnError){const done=once(caddy,'exit');caddy.kill();await Promise.race([done,new Promise(r=>setTimeout(r,2000))]);if(caddy.exitCode===null)caddy.kill('SIGKILL')}log.end();
}
