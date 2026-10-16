import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { database,migrate,project } from '../pilot/db.mjs';
import { seed } from '../pilot/seed.mjs';
import { localEnv } from './pilot-env.mjs';
Object.assign(process.env,await localEnv());process.env.DEMO_MODE??='true';process.env.PORT??='4418';process.env.PUBLIC_BASE_URL??=`http://127.0.0.1:${process.env.PORT}`;
const base=process.env.PUBLIC_BASE_URL,root=join(project,'storage','pilot-local-node'),webPort=Number(process.env.CADDY_PORT||4420),adminPort=Number(process.env.CADDY_ADMIN_PORT||4421),children=[];
try{const r=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});if(r.ok){console.log(`正式试点版已经运行：${base}，不重复启动进程。`);process.exit(0)}}catch{}
await fs.mkdir(root,{recursive:true});const db=database();await migrate(db);await seed(db);await db.end();
function launch(cmd,args,env={}){const p=spawn(cmd,args,{cwd:project,env:{...process.env,...env},stdio:'inherit',windowsHide:true});children.push(p);p.on('error',console.error);return p}
async function wait(url){for(let i=0;i<60;i++){try{if((await fetch(url,{headers:{Origin:new URL(url).origin}})).ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error('启动超时：'+url)}
try{
 const conf=join(root,'bootstrap.json'),caddyStorage={module:'file_system',root:join(root,'certificates')};await fs.writeFile(conf,JSON.stringify({admin:{listen:`127.0.0.1:${adminPort}`},storage:caddyStorage}));
 launch(process.execPath,['pilot/server.mjs']);launch(process.execPath,['pilot/worker.mjs']);launch(process.env.CADDY_BIN||join(project,'tools',process.platform==='win32'?'caddy.exe':'caddy'),['run','--config',conf],{APPDATA:join(root,'config'),XDG_CONFIG_HOME:join(root,'config')});await wait(base+'/health');await wait(`http://127.0.0.1:${adminPort}/config/`);
 const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin123!'})});if(!r.ok)throw Error('演示管理员登录失败，请单独运行API/Worker');const cookie=r.headers.get('set-cookie').split(';')[0];
 const api=async(path,b)=>{const r=await fetch(base+'/api/'+path,{method:b?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d};
 const configFile=join(root,'agent.json');let cfg;try{cfg=JSON.parse(await fs.readFile(configFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;const s=await api('infrastructure/servers',{name:'正式试点本地节点 · Caddy'});cfg={server:s.id,control:base,token:s.token,root:join(root,'agent'),mode:'local',port:webPort,caddyAdmin:`http://127.0.0.1:${adminPort}`,pollMs:1000,storage:caddyStorage};await fs.writeFile(configFile,JSON.stringify(cfg,null,2),{mode:0o600})}
 await api('infrastructure/bind',{site:'s1',server:cfg.server});launch(process.execPath,['agent/agent.mjs',configFile]);const state=await api('state');if(!state.builds.some(b=>b.site==='s1'&&['queued','building'].includes(b.status)))await api('sites/s1/publish',{});
 console.log(`\n正式试点后台：${base}\n真实 Caddy 网站：http://127.0.0.1:${webPort}/sites/s1/\nPostgreSQL 18.6 + Redis / BullMQ 独立 Worker 已启动。\n`);
 const stop=()=>{for(const p of children)p.kill();setTimeout(()=>process.exit(),1500)};process.on('SIGINT',stop);process.on('SIGTERM',stop);await new Promise(()=>{});
}catch(e){for(const p of children)p.kill();console.error(e);process.exitCode=1}
