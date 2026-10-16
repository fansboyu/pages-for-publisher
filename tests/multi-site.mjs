import assert from 'node:assert/strict';
import { promises as fs,createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { makeConfig } from '../agent/agent.mjs';
const project=fileURLToPath(new URL('../',import.meta.url));
const root=join(project,'storage','multi-site-tests',String(Date.now()));
await fs.mkdir(root,{recursive:true});
async function port(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const value=s.address().port;await new Promise(r=>s.close(r));return value}
const adminPort=await port(),webPort=await port(),healthPort=await port(),admin=`http://127.0.0.1:${adminPort}`;
const results=[];const pass=s=>{results.push(s);console.log('PASS',s)};
const nodes={a:{domain:'alpha.example.test',release:'r1',path:join(root,'sites','a','r1').replace(/\\/g,'/')},b:{domain:'beta.example.test',release:'r2',path:join(root,'sites','b','r2').replace(/\\/g,'/')}};
for(const [id,site] of Object.entries(nodes)){await fs.mkdir(site.path,{recursive:true});await fs.writeFile(join(site.path,'index.html'),`<!doctype html><h1>website ${id} ${site.release}</h1>`);await fs.writeFile(join(site.path,'only-'+id+'.txt'),id)}
const cfg={mode:'production',caddyAdmin:admin,healthPort,storage:{module:'file_system',root:join(root,'certificates')}};
function config(sites){const value=makeConfig(sites,cfg);assert.deepEqual(value.apps.http.servers.web.listen,[':443']);assert(value.apps.http.servers.web.routes.every(r=>!r.match||r.match[0].host));
 // Exercise production host routes with real Caddy, but loopback HTTP only:
 // no public DNS, certificate issuance, root privileges or public port binding.
 value.apps.http.servers.web.listen=[`127.0.0.1:${webPort}`];value.apps.http.servers.web.automatic_https={disable:true};return value}
const bootstrap=join(root,'bootstrap.json');await fs.writeFile(bootstrap,JSON.stringify({admin:{listen:`127.0.0.1:${adminPort}`},storage:cfg.storage}));
const log=createWriteStream(join(root,'caddy.log'));const caddy=spawn(process.env.CADDY_BIN||join(project,'tools',process.platform==='win32'?'caddy.exe':'caddy'),['run','--config',bootstrap],{cwd:project,env:{...process.env,APPDATA:join(root,'config'),XDG_CONFIG_HOME:join(root,'config')},windowsHide:true,stdio:['ignore','pipe','pipe']});
caddy.stdout.pipe(log);caddy.stderr.pipe(log);let spawnError;caddy.on('error',e=>{spawnError=e});
async function request(host,path='/'){return new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:webPort,path,headers:{Host:host,Connection:'close'}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key.toLowerCase()]},text:async()=>Buffer.concat(chunks).toString()}));res.on('error',reject)});req.on('error',reject);req.end()})}
async function load(sites){const r=await fetch(admin+'/load',{method:'POST',headers:{'Content-Type':'application/json',Origin:admin},body:JSON.stringify(config(sites))});assert.equal(r.status,200,await r.text())}
try{
 let ready=false;for(let i=0;i<100;i++){if(spawnError)throw spawnError;try{if((await fetch(admin+'/config/',{headers:{Origin:admin}})).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert(ready,'Caddy ready');
 await load(nodes);
 for(const [id,site]of Object.entries(nodes)){const r=await request(site.domain);assert.equal(r.status,200);assert.equal(r.headers.get('x-site-release'),site.release);assert((await r.text()).includes(`website ${id}`))}
 assert.equal((await request('unknown.example.test')).status,404);assert.equal((await request(nodes.a.domain,'/only-b.txt')).status,404);assert.equal((await request(nodes.b.domain,'/only-a.txt')).status,404);pass('同IP同端口按域名分流，未知域名404，站点文件不串站');
 const previous=structuredClone(nodes);nodes.a={...nodes.a,release:'r3',path:join(root,'sites','a','r3').replace(/\\/g,'/')};await fs.mkdir(nodes.a.path,{recursive:true});await fs.writeFile(join(nodes.a.path,'index.html'),'<!doctype html><h1>website a r3</h1>');await load(nodes);assert.equal((await request(nodes.a.domain)).headers.get('x-site-release'),'r3');assert.equal((await request(nodes.b.domain)).headers.get('x-site-release'),'r2');pass('只更新网站甲目录，网站乙的版本保持不变');
 await load(previous);assert.equal((await request(nodes.a.domain)).headers.get('x-site-release'),'r1');assert.equal((await request(nodes.b.domain)).headers.get('x-site-release'),'r2');pass('只回滚网站甲，不改变网站乙');
 const invalid=config(previous);invalid.apps.http.servers.web.routes[0].handle[0].handler='invalid-test-handler';const bad=await fetch(admin+'/load',{method:'POST',headers:{'Content-Type':'application/json',Origin:admin},body:JSON.stringify(invalid)});assert(bad.status>=400);assert.equal((await request(nodes.a.domain)).headers.get('x-site-release'),'r1');assert.equal((await request(nodes.b.domain)).headers.get('x-site-release'),'r2');pass('Caddy拒绝无效配置，两个网站继续使用原有效配置');
 const saved=JSON.parse(await fs.readFile(join(root,'config','caddy','autosave.json'),'utf8'));assert.equal(saved.apps.http.servers.web.routes.filter(r=>r.match).length,2);pass('自动保存的完整配置保留两个站点');
 await fs.writeFile(join(root,'report.json'),JSON.stringify({version:'1.2.0',results,notTested:['公网DNS','自动证书签发与续期','真实OSS']},null,2));console.log('Report: '+root);
}finally{if(caddy.exitCode===null&&!spawnError){const ended=once(caddy,'exit');caddy.kill();await Promise.race([ended,new Promise(r=>setTimeout(r,2000))]);if(caddy.exitCode===null)caddy.kill('SIGKILL')}log.end()}
