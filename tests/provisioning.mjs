import assert from 'node:assert/strict';
import ssh2 from 'ssh2';
const { Server,utils }=ssh2;
import { createServer } from 'node:http';
import { once } from 'node:events';
import { generateKeyPairSync,randomBytes,createHash } from 'node:crypto';
import { promises as fs,createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { createProvisioner } from '../provisioner/server.mjs';
import { target,fingerprint } from '../provisioner/security.mjs';
import { CHECK_SCRIPT,parseReport } from '../provisioner/preflight.mjs';
import { installScript } from '../provisioner/bootstrap.mjs';
import { localEnv } from '../scripts/pilot-env.mjs';
import { migrate,project } from '../pilot/db.mjs';
const temp=await fs.mkdtemp(join(tmpdir(),'site-provision-test-')),testRoot=join(project,'storage','provisioning-tests');await fs.mkdir(testRoot,{recursive:true});
const elf=Buffer.alloc(32);elf.set([127,69,76,70]);elf.writeUInt16LE(62,18);await fs.writeFile(join(temp,'runtime'),elf);
process.env.PROVISIONER_NODE_BINARY=join(temp,'runtime');process.env.PROVISIONER_CADDY_BINARY=join(temp,'runtime');
await fs.writeFile(join(testRoot,'preflight.sh'),CHECK_SCRIPT);await fs.writeFile(join(testRoot,'install.sh'),installScript('/tmp/site-agent-'+'a'.repeat(24)));
const {privateKey:hostKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
const pin=fingerprint(utils.parseKey(hostKey).getPublicSSH()),password='test-only-ssh-password',secret=randomBytes(32).toString('hex');
const files=new Map(),dirs=new Set(['/tmp']),clients=new Set();let authCount=0,installs=0,blocked=false,failInstall=false,callbackBase='',lastConfig;
const goodReport='OS=ubuntu\nVERSION=24.04\nARCH=x86_64\nUID=0\nSYSTEMD=1\nDISK_KB=1000000\nPORTS=\nEXISTING=0\n';
const ssh=new Server({hostKeys:[hostKey]},client=>{
 clients.add(client);client.on('close',()=>clients.delete(client));client.on('error',()=>{});
 client.on('authentication',ctx=>{authCount++;if(ctx.username==='root'&&(ctx.method==='password'&&ctx.password===password||ctx.method==='publickey'))ctx.accept();else ctx.reject()});
 client.on('ready',()=>client.on('session',accept=>{const session=accept();
  session.on('exec',(accept,reject,info)=>{assert.equal(info.command,'bash -s');const stream=accept();let script='';stream.on('data',chunk=>script+=chunk);stream.on('error',()=>{});stream.on('end',()=>{void (async()=>{
   assert(!script.includes(password));if(script.includes('DISK_KB=')){stream.write(blocked?goodReport.replace('PORTS=','PORTS=80,443'):goodReport);stream.exit(0);stream.end();return}
   if(script.includes('sha256sum -c')){installs++;const stage=script.match(/stage=(\/tmp\/site-agent-[a-f0-9]{24})/)[1];const manifest=files.get(stage+'/SHA256SUMS').toString();for(const line of manifest.trim().split('\n')){const [hash,path]=line.split('  ');assert.equal(createHash('sha256').update(files.get(stage+'/'+path)).digest('hex'),hash)}
    lastConfig=JSON.parse(files.get(stage+'/etc/agent.json'));assert.equal(lastConfig.caddyAdmin,'http://127.0.0.1:2019');
    if(failInstall){stream.exit(1);stream.end();return}
    if(callbackBase){const response=await fetch(callbackBase+'/agent/v1/poll',{method:'POST',headers:{Authorization:'Bearer '+lastConfig.token,'Content-Type':'application/json'},body:JSON.stringify({version:'0.3.0'})});assert.equal(response.status,200)}
    stream.write('INSTALLED=1\n');stream.exit(0);stream.end();return;
   }
   assert.match(script,/^rm -rf -- \/tmp\/site-agent-[a-f0-9]{24}\n$/);const path=script.trim().slice('rm -rf -- '.length);for(const key of files.keys())if(key.startsWith(path+'/'))files.delete(key);stream.exit(0);stream.end();
  })().catch(error=>{console.error(error.message);stream.exit(1);stream.end()})})});
  session.on('sftp',accept=>{const s=accept(),handles=new Map();let next=0;const ok=utils.sftp.STATUS_CODE.OK,fail=utils.sftp.STATUS_CODE.FAILURE;
   s.on('error',()=>{});s.on('MKDIR',(rid,path)=>{if(dirs.has(path))s.status(rid,fail);else{dirs.add(path);s.status(rid,ok)}});
   s.on('OPEN',(rid,path,flags,attrs)=>{files.set(path,Buffer.alloc(0));const handle=Buffer.from(String(++next));handles.set(handle.toString(),path);s.handle(rid,handle)});
   s.on('WRITE',(rid,handle,offset,chunk)=>{const path=handles.get(handle.toString()),old=files.get(path)||Buffer.alloc(0),data=Buffer.alloc(Math.max(old.length,offset+chunk.length));old.copy(data);chunk.copy(data,offset);files.set(path,data);s.status(rid,ok)});
   s.on('FSTAT',(rid,handle)=>s.attrs(rid,{mode:0o100600,size:files.get(handles.get(handle.toString()))?.length||0,uid:0,gid:0,atime:0,mtime:0}));
   s.on('SETSTAT',(rid)=>s.status(rid,ok));s.on('FSETSTAT',(rid)=>s.status(rid,ok));s.on('CLOSE',(rid,handle)=>{handles.delete(handle.toString());s.status(rid,ok)});
  });
 }));
});
ssh.listen(0,'127.0.0.1');await once(ssh,'listening');const sshPort=ssh.address().port;
let clock=Date.now();let service=createProvisioner({secret,allowlist:'127.0.0.1/32',testLoopback:true,now:()=>clock});service.server.listen(0,'127.0.0.1');await once(service.server,'listening');const workerBase='http://127.0.0.1:'+service.server.address().port;
async function worker(path,data,auth=secret){const response=await fetch(workerBase+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result}
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,50))}throw Error('等待测试状态超时')}
const jobInput=()=>({id:'prov'+randomBytes(10).toString('hex'),host:'127.0.0.1',port:sshPort,username:'root',password,fingerprint:pin,trusted:true});
let pool,maintenance,api,stream,name;
try{
 assert.throws(()=>target({host:'169.254.169.254'},'0.0.0.0/0'));assert.throws(()=>target({host:'100.100.100.200'},'100.100.100.200/32'));assert.throws(()=>target({host:'127.0.0.1'},'127.0.0.1/32'));assert.throws(()=>target({host:'8.8.8.8'},''));assert.throws(()=>target({host:'8.8.8.8;id'},'8.8.8.8/32'));
 assert.equal(target({host:'8.8.8.8'},'8.8.8.8/32').host,'8.8.8.8');assert(!parseReport(goodReport.replace('VERSION=24.04','VERSION=20.04')).ready);assert(!parseReport(goodReport.replace('UID=0','UID=1000')).ready);
 await assert.rejects(worker('/health',null,'bad'),e=>e.status===401);
 const probed=await worker('/host-key',{host:'127.0.0.1',port:sshPort});assert.equal(probed.fingerprint,pin);assert.equal(authCount,0);
 let input=jobInput();await worker('/jobs',input);let ready=await until(async()=>{const row=await worker('/jobs/'+input.id);return row.status==='ready'&&row});assert(!JSON.stringify(ready).includes(password));assert.equal(ready.report.ready,true);
 await assert.rejects(worker('/jobs/'+input.id+'/install',{confirmed:false,fingerprint:pin,control:'https://control.test',token:'a'.repeat(64)}));assert.equal(installs,0);
 await worker('/jobs/'+input.id+'/cancel',{});
 input=jobInput();input.fingerprint='SHA256:'+'a'.repeat(43);await worker('/jobs',input);assert.equal((await until(async()=>{const row=await worker('/jobs/'+input.id);return row.status==='failed'&&row})).status,'failed');
 blocked=true;input=jobInput();await worker('/jobs',input);assert.equal((await until(async()=>{const row=await worker('/jobs/'+input.id);return row.status==='blocked'&&row})).report.ready,false);assert.equal(installs,0);blocked=false;
 input=jobInput();await worker('/jobs',input);await until(async()=>(await worker('/jobs/'+input.id)).status==='ready');clock+=660000;service.sweep();assert.equal((await worker('/jobs/'+input.id)).status,'expired');clock=Date.now();
 const {privateKey:clientKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});input=jobInput();delete input.password;input.privateKey=clientKey;await worker('/jobs',input);await until(async()=>(await worker('/jobs/'+input.id)).status==='ready');await worker('/jobs/'+input.id+'/cancel',{});
 failInstall=true;input=jobInput();await worker('/jobs',input);await until(async()=>(await worker('/jobs/'+input.id)).status==='ready');await worker('/jobs/'+input.id+'/install',{confirmed:true,fingerprint:pin,control:'https://control.test',token:'b'.repeat(64)});await until(async()=>(await worker('/jobs/'+input.id)).status==='failed');await until(()=>files.size===0);failInstall=false;const initialInstalls=installs;
 console.log('PASS SSH白名单、元数据拦截、探测指纹不发送认证、指纹不匹配拒绝、现有端口阻止、取消与内存凭据过期');
 const env=await localEnv();maintenance=new pg.Pool({connectionString:env.DATABASE_URL});name='provision_test_'+Date.now();await maintenance.query(`CREATE DATABASE "${name}"`);const dbURL=new URL(env.DATABASE_URL);dbURL.pathname='/'+name;pool=new pg.Pool({connectionString:dbURL.href});await migrate(pool);
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));callbackBase='http://127.0.0.1:'+port;
 stream=createWriteStream(join(testRoot,'api.log'));api=spawn(process.execPath,['pilot/server.mjs'],{cwd:project,env:{...process.env,DATABASE_URL:dbURL.href,PORT:String(port),DEMO_MODE:'true',PUBLIC_BASE_URL:'https://control.test',PROVISIONER_CONTROL_URL:'',PROVISIONER_TOKEN:secret,PROVISIONER_URL:workerBase,DATA_ROOT:join(testRoot,'data')},windowsHide:true,stdio:['ignore','pipe','pipe']});api.stdout.pipe(stream);api.stderr.pipe(stream);
 await until(async()=>{try{return (await fetch(callbackBase+'/health')).ok}catch{return false}});
 async function login(username,pw){const response=await fetch(callbackBase+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:pw})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0]}
 const admin=await login('admin','Admin123!'),agency=await login('agency','Agency123!');
 async function req(path,data,cookie=admin){const response=await fetch(callbackBase+'/api/'+path,{method:data?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error),{status:response.status});return result}
 await assert.rejects(req('provisioning',null,agency),e=>e.status===403);await assert.rejects(req('provisioning/host-key',{host:'127.0.0.1',port:sshPort},agency),e=>e.status===403);
 const checkInput={...jobInput(),requestKey:'test-preflight-'+randomBytes(8).toString('hex'),name:'本地SSH协议测试'};delete checkInput.id;
 const job=await req('provisioning/preflight',checkInput);assert.equal((await req('provisioning/preflight',checkInput)).id,job.id);
 await until(async()=>(await req('provisioning/'+job.id)).status==='ready');
 await assert.rejects(req('provisioning/'+job.id+'/install',{confirmed:false,fingerprint:pin}),e=>e.status===400);assert.equal((await pool.query('SELECT count(*) n FROM servers')).rows[0].n,'0');
 await req('provisioning/'+job.id+'/install',{confirmed:true,fingerprint:pin});await until(async()=>{const row=(await pool.query('SELECT status,error FROM provisioning_jobs WHERE id=$1',[job.id])).rows[0];if(row.status==='failed'||row.status==='interrupted')throw Error(JSON.stringify(row));return row.status==='succeeded'},30000);const completed=await req('provisioning/'+job.id);
 assert.equal(installs,initialInstalls+1);assert(completed.serverId);assert.equal((await pool.query('SELECT count(*) n FROM servers')).rows[0].n,'1');assert.equal((await pool.query('SELECT count(*) n FROM sites WHERE server_id=$1',[completed.serverId])).rows[0].n,'0');
 assert.equal(files.size,0);const persisted=JSON.stringify((await pool.query('SELECT row_to_json(p) value FROM provisioning_jobs p')).rows);assert(!persisted.includes(password));assert(!persisted.includes(lastConfig.token));
 assert.equal((await req('provisioning')).jobs[0].status,'succeeded');
 await req('provisioning/'+job.id+'/revoke',{confirmed:true});assert.equal((await fetch(callbackBase+'/agent/v1/poll',{method:'POST',headers:{Authorization:'Bearer '+lastConfig.token,'Content-Type':'application/json'},body:'{}'})).status,401);
 const restartInput={...checkInput,requestKey:'restart-'+randomBytes(8).toString('hex')};const restartJob=await req('provisioning/preflight',restartInput);await until(async()=>(await req('provisioning/'+restartJob.id)).status==='ready');const workerPort=service.server.address().port;service.stop();await new Promise(r=>setTimeout(r,30));service=createProvisioner({secret,allowlist:'127.0.0.1/32',testLoopback:true});service.server.listen(workerPort,'127.0.0.1');await once(service.server,'listening');assert.equal((await req('provisioning/'+restartJob.id)).status,'interrupted');assert.equal(installs,initialInstalls+1);
 console.log('PASS 独立Provisioner经真实SSH2/SFTP测试端上传校验包、API确认登记Token、模拟服务启动与Agent回连、数据库和响应不含凭据、无自动绑定、撤销凭据生效');
}finally{
 service.stop();for(const client of clients)client.destroy();await new Promise(r=>ssh.close(r));if(api){api.kill();await Promise.race([once(api,'exit'),new Promise(r=>setTimeout(r,2000))]);if(api.exitCode===null)api.kill('SIGKILL')}stream?.end();await pool?.end();if(maintenance){if(name)await maintenance.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.end()}
 await fs.rm(temp,{recursive:true,force:true});
}
