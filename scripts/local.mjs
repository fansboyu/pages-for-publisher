import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),local=join(root,'storage','local-node');await fs.mkdir(local,{recursive:true});
const port=process.env.PORT||4318,caddyPort=Number(process.env.CADDY_PORT||4320),adminPort=Number(process.env.CADDY_ADMIN_PORT||4321),control=`http://127.0.0.1:${port}`;
const bin=process.env.CADDY_BIN||join(root,'tools',process.platform==='win32'?'caddy.exe':'caddy');
const children=[];function launch(cmd,args,env={}){const p=spawn(cmd,args,{cwd:root,env:{...process.env,...env},stdio:'inherit',windowsHide:true});children.push(p);p.on('error',e=>console.error(e.message));return p}
async function wait(url){for(let i=0;i<60;i++){try{const r=await fetch(url,{headers:{Origin:new URL(url).origin}});if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,500))}throw Error(`启动失败：${url}`)}
try{
 const bootstrap={admin:{listen:`127.0.0.1:${adminPort}`},storage:{module:'file_system',root:join(local,'certificates')},apps:{http:{servers:{web:{listen:[`127.0.0.1:${caddyPort}`],automatic_https:{disable:true},routes:[{handle:[{handler:'static_response',body:'Caddy ready: deploy your first site',status_code:200}]}]}}}}};
 const conf=join(local,'bootstrap.json');await fs.writeFile(conf,JSON.stringify(bootstrap));
 launch(process.execPath,['server.mjs']);launch(bin,['run','--config',conf],{APPDATA:join(local,'config'),XDG_CONFIG_HOME:join(local,'config')});await wait(control);await wait(`http://127.0.0.1:${adminPort}/config/`);
 const login=await fetch(control+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin123!'})});if(!login.ok)throw Error('本地演示管理员登录失败');const cookie=login.headers.get('set-cookie').split(';')[0];
 const api=async(path,body)=>{const r=await fetch(control+'/api/'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d};
 const configFile=join(local,'agent.json');let config;try{config=JSON.parse(await fs.readFile(configFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;const server=await api('infrastructure/servers',{name:'本地测试节点 · Caddy'});config={control,token:server.token,server:server.id,root:join(local,'agent'),mode:'local',caddyAdmin:`http://127.0.0.1:${adminPort}`,port:caddyPort,pollMs:2000,storage:bootstrap.storage};await fs.writeFile(configFile,JSON.stringify(config,null,2),{mode:0o600})}
 await api('infrastructure/bind',{site:'s1',server:config.server});launch(process.execPath,['agent/agent.mjs',configFile]);
 // 先等待 Agent 注册心跳，再触发一次演示发布。
 await new Promise(r=>setTimeout(r,1500));const state=await api('state');if(!state.deployments.some(d=>d.site==='s1'&&['queued','running'].includes(d.status)))await api('sites/s1/publish',{});
 console.log(`\n总控：${control}\nCaddy 网站：http://127.0.0.1:${caddyPort}/sites/s1/\n服务器注册、OSS模式、部署任务见「服务器与部署」。\n`);
 const stop=()=>{for(const p of children)p.kill();setTimeout(()=>process.exit(0),1000)};process.on('SIGINT',stop);process.on('SIGTERM',stop);await new Promise(()=>{});
}catch(e){for(const p of children)p.kill();console.error(e);process.exitCode=1}
