import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { crc32 } from 'node:zlib';
import pg from 'pg';
import { localEnv } from '../scripts/pilot-env.mjs';
import { migrate,project } from '../pilot/db.mjs';
import { templateFiles } from '../pilot/templates.mjs';
import { extractZip } from '../pilot/template-upload.mjs';

// Stored ZIP fixture, including hostile names not accepted by convenience ZIP writers.
function zip(entries){const locals=[],centrals=[];let offset=0;for(const [name,value,mode=0x81a40000]of entries){const n=Buffer.from(name),b=Buffer.from(value),crc=crc32(b),l=Buffer.alloc(30),c=Buffer.alloc(46);l.writeUInt32LE(0x04034b50);l.writeUInt16LE(20,4);l.writeUInt16LE(0x800,6);l.writeUInt32LE(crc,14);l.writeUInt32LE(b.length,18);l.writeUInt32LE(b.length,22);l.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(0x314,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(mode>>>0,38);c.writeUInt32LE(offset,42);locals.push(l,n,b);centrals.push(c,n);offset+=l.length+n.length+b.length}const central=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,central,end])}
const env=await localEnv(),maintenance=new pg.Pool({connectionString:env.DATABASE_URL}),name='template_test_'+Date.now(),url=new URL(env.DATABASE_URL);url.pathname='/'+name;await maintenance.query(`CREATE DATABASE "${name}"`);const pool=new pg.Pool({connectionString:url.href});await migrate(pool);
const root=join(project,'storage','template-tests',name);await fs.mkdir(root,{recursive:true});
const source=process.env.TEST_TEMPLATE||join(project,'..','shugaoxing-template');const entries=[...await templateFiles(source)].filter(([p])=>p!=='网站信息.txt');const good=zip(entries),wrapped=zip(entries.map(([p,b])=>['官网/'+p,b]));
const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
const child=spawn(process.execPath,['pilot/server.mjs'],{cwd:project,windowsHide:true,env:{...process.env,DATABASE_URL:url.href,REDIS_URL:env.REDIS_URL,DATA_ROOT:root,DEMO_MODE:'true',COOKIE_SECURE:'false',STORAGE_DRIVER:'local',PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);const base=`http://127.0.0.1:${port}`;let cookie;const results=[];const pass=x=>{results.push(x);console.log('PASS',x)};
async function req(path,b,override){const r=await fetch(base+path,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:override||cookie||''},body:b===undefined?undefined:JSON.stringify(b)});return {r,d:await r.json()}}
async function upload(bytes,override){const r=await fetch(base+'/api/infrastructure/templates/upload?name=数告星验收',{method:'POST',headers:{'Content-Type':'application/zip',Cookie:override||cookie||''},body:bytes});return {r,d:await r.json()}}
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(logs)}
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin123!'})});cookie=login.headers.get('set-cookie').split(';')[0];
 const partner=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'partner',password:'Partner123!'})}),pc=partner.headers.get('set-cookie').split(';')[0];
 assert.equal((await upload(good,pc)).r.status,403);assert.equal((await upload(good,'session=invalid')).r.status,401);pass('上传仅管理员可用，未登录/代理商均被拒绝');
 for(const [label,bytes]of [['路径穿越',zip([['../escape.html','x']])],['软链接',zip([['evil.html','index.html',0xa1ff0000]])],['重复路径',zip([['index.html','x'],['index.html','y']])],['非法程序',zip([['shell.php','x']])],['无配置',zip([['index.html','x']])]]){assert.ok((await upload(bytes)).r.status>=400,label)}pass('恶意ZIP穿越/链接/重复/程序/缺配置均拒绝');
 const original=await upload(good);assert.equal(original.r.status,201,JSON.stringify(original.d));assert.ok(original.d.report.ok);const again=await upload(wrapped);assert.equal(again.r.status,201,JSON.stringify(again.d));assert.equal(again.d.id,original.d.id);pass('完整ZIP和单层外包目录导入，内容哈希去重');
 const archived=(await pool.query('SELECT * FROM templates WHERE id=$1',[original.d.id])).rows[0];assert.ok(archived.archive_key.startsWith('templates/'));assert.deepEqual(await fs.readFile(join(root,'objects',archived.archive_key)),wrapped);pass('原始ZIP独立私有归档，固定模板文件已持久化');
 assert.equal((await req('/api/infrastructure/templates/bind',{site:'s1',template:original.d.id})).r.status,200);
 const before=(await pool.query("SELECT content FROM sites WHERE id='s1'")).rows[0].content;
 assert.equal((await req('/api/sites/s1/content',{icp_url:'https://evil.invalid'})).r.status,400);
 assert.equal((await req('/api/sites/s1/content',{phone:'bad<phone>'})).r.status,400);
 assert.equal((await req('/api/sites/s1/content',{phone:'186 2126 5069',icp_number:'沪ICP备2026044197号-1'})).r.status,200);
 const content=(await pool.query("SELECT content FROM sites WHERE id='s1'")).rows[0].content;assert.equal(content.title,before.title);assert.equal(content.phone,'18621265069');assert.equal(content.icp_url,'https://beian.miit.gov.cn/');pass('备案/电话校验持久化，模板绑定不覆盖客户草稿');
 const preview=await req('/api/infrastructure/templates/preview',{site:'s1'});assert.equal(preview.r.status,201,JSON.stringify(preview.d));
 const html=await fetch(base+preview.d.url,{headers:{Cookie:cookie}});assert.equal(html.status,200);assert.ok(html.headers.get('content-security-policy').includes('sandbox allow-same-origin'));assert.ok(!html.headers.get('content-security-policy').includes('allow-scripts'));const text=await html.text();assert.ok(text.includes('沪ICP备2026044197号-1'));assert.ok(text.includes('tel:18621265069'));assert.doesNotMatch(text,/\{\{[a-z_]+\}\}/);assert.equal((await fetch(base+preview.d.url,{headers:{Cookie:pc}})).status,404);assert.equal(Number((await pool.query('SELECT count(*) FROM deployment_tasks')).rows[0].count),0);pass('隔离草稿预览包含备案电话，无Agent任务且禁止他人访问');
 const publication=await req('/api/sites/s1/publish',{});assert.equal(publication.r.status,202);const snapshot=(await pool.query('SELECT snapshot FROM releases WHERE id=$1',[publication.d.id])).rows[0].snapshot;assert.equal(snapshot.site.icp_number,'沪ICP备2026044197号-1');await req('/api/sites/s1/content',{icp_number:'新草稿备案号'});assert.equal(snapshot.site.icp_number,'沪ICP备2026044197号-1');pass('发布快照固定备案资料，不随后续草稿变化');
 assert.equal((await req('/api/infrastructure/storage/check',{},pc)).r.status,403);const probe=await req('/api/infrastructure/storage/check',{});assert.equal(probe.d.driver,'local');assert.equal(probe.d.ok,false);pass('存储检测仅管理员可用，local不会误报真实OSS通过');
 const badEntries=entries.map(([p,b])=>[p,p==='publisher.config.json'?Buffer.from(b.toString().replace('icp-fields','unknown-capability')):b]);assert.equal((await upload(zip(badEntries))).r.status,400);pass('不支持的模板能力拒绝导入');
 // ZIP extraction limits are independent from publication package limits.
 const fixture=join(root,'over.zip');await fs.writeFile(fixture,zip([['assets/x.txt','12345']]));const out=join(root,'over');await fs.mkdir(out);process.env.TEMPLATE_MAX_UNPACKED_MB='0.000001';await assert.rejects(extractZip(fixture,out));delete process.env.TEMPLATE_MAX_UNPACKED_MB;pass('解压体积限制实际生效');
 console.log(results.length+' template checks passed');
}finally{child.kill();await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1500))]);if(child.exitCode===null)child.kill('SIGKILL');await pool.end();await maintenance.end()}
