import { promises as fs } from 'node:fs';
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8')),admin=new URL(config.caddyAdmin);
if(!['127.0.0.1','localhost','[::1]'].includes(admin.hostname))throw Error('Caddy管理接口必须只监听本机');
let ready=false;
for(let i=0;i<60;i++){
 try{const r=await fetch(new URL('/config/',admin),{headers:{Origin:admin.origin},signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break}}catch{}
 await new Promise(r=>setTimeout(r,500));
}
if(!ready){console.error('Caddy管理接口未就绪');process.exit(1)}
