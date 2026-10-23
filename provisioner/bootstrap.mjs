import { promises as fs,createReadStream } from 'node:fs';
import { createHash,randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join,dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec,sftp,mkdir,write,upload } from './ssh.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileHash(path){const sum=createHash('sha256');for await(const chunk of createReadStream(path))sum.update(chunk);return sum.digest('hex')}
export const runtimePaths=()=>({node:process.env.PROVISIONER_NODE_BINARY||'/usr/local/bin/node',caddy:process.env.PROVISIONER_CADDY_BINARY||'/opt/bootstrap/caddy'});
export async function runtimesReady(){try{for(const path of Object.values(runtimePaths())){const file=await fs.open(path,'r');try{const bytes=Buffer.alloc(4);await file.read(bytes,0,4,0);if(!bytes.equals(Buffer.from([127,69,76,70])))return false}finally{await file.close()}}return true}catch{return false}}
const agentUnit=`[Unit]
Description=Site deployment agent provisioned by publish center
After=network-online.target site-agent-caddy.service
Wants=network-online.target
Requires=site-agent-caddy.service
[Service]
User=site-agent
Group=site-agent-web
WorkingDirectory=/opt/site-control
ExecStartPre=/opt/site-control/bin/node /opt/site-control/agent/wait-caddy.mjs /etc/site-agent/agent.json
ExecStart=/opt/site-control/bin/node /opt/site-control/agent/agent.mjs /etc/site-agent/agent.json
Restart=on-failure
RestartSec=5
TimeoutStartSec=45
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/site-agent
[Install]
WantedBy=multi-user.target
`;
const caddyUnit=`[Unit]
Description=Dedicated site agent Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=site-caddy
Group=site-agent-web
WorkingDirectory=/var/lib/site-agent-caddy
Environment=XDG_DATA_HOME=/var/lib/site-agent-caddy/data
Environment=XDG_CONFIG_HOME=/var/lib/site-agent-caddy/config
ExecStart=/opt/site-control/bin/caddy run --resume --config /var/lib/site-agent-caddy/bootstrap.json
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/site-agent-caddy
[Install]
WantedBy=multi-user.target
`;
export function installScript(stage){
 if(!/^\/tmp\/site-agent-[a-f0-9]{24}$/.test(stage))throw Error('非法暂存目录');
 return `set -eu
stage=${stage}
cd "$stage"
sha256sum -c SHA256SUMS >/dev/null
./bin/node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
./bin/caddy version >/dev/null
for p in /opt/site-control /etc/site-agent /var/lib/site-agent /var/lib/site-agent-caddy /etc/systemd/system/site-agent.service /etc/systemd/system/site-agent-caddy.service; do test ! -e "$p"; test ! -L "$p"; done
test -z "$(ss -H -ltn | awk '{n=split($4,p,":");if(p[n] ~ /^(80|443|2019|4322)$/)print p[n]}')"
for u in site-agent site-caddy; do if id "$u" >/dev/null 2>&1; then exit 1; fi; done
if getent group site-agent-web >/dev/null; then exit 1; fi
made_opt=0; made_etc=0; made_data=0; made_caddy=0; made_group=0; made_agent_user=0; made_caddy_user=0; made_units=0; success=0
cleanup() {
 code=$?
 if [ "$success" != 1 ]; then
  if [ "$made_units" = 1 ]; then systemctl disable --now site-agent.service site-agent-caddy.service >/dev/null 2>&1 || true; rm -f /etc/systemd/system/site-agent.service /etc/systemd/system/site-agent-caddy.service; systemctl daemon-reload || true; fi
  if [ "$made_opt" = 1 ]; then rm -rf /opt/site-control; fi
  if [ "$made_etc" = 1 ]; then rm -rf /etc/site-agent; fi
  if [ "$made_data" = 1 ]; then rm -rf /var/lib/site-agent; fi
  if [ "$made_caddy" = 1 ]; then rm -rf /var/lib/site-agent-caddy; fi
  if [ "$made_agent_user" = 1 ]; then userdel site-agent || true; fi
  if [ "$made_caddy_user" = 1 ]; then userdel site-caddy || true; fi
  if [ "$made_group" = 1 ]; then groupdel site-agent-web || true; fi
 fi
 rm -rf "$stage"
 exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
mkdir /opt/site-control; made_opt=1
mkdir /etc/site-agent; made_etc=1
mkdir /var/lib/site-agent; made_data=1
mkdir /var/lib/site-agent-caddy; made_caddy=1
groupadd --system site-agent-web; made_group=1
useradd --system --gid site-agent-web --home-dir /var/lib/site-agent --no-create-home --shell /usr/sbin/nologin site-agent; made_agent_user=1
useradd --system --gid site-agent-web --home-dir /var/lib/site-agent-caddy --no-create-home --shell /usr/sbin/nologin site-caddy; made_caddy_user=1
cp -R bin agent pilot node_modules /opt/site-control/
cp package.json /opt/site-control/package.json
find /opt/site-control -type d -exec chmod 0755 {} +
find /opt/site-control -type f -exec chmod 0644 {} +
chmod 0755 /opt/site-control/bin/node /opt/site-control/bin/caddy
chown site-agent:site-agent-web /var/lib/site-agent; chmod 0750 /var/lib/site-agent
chown site-caddy:site-agent-web /var/lib/site-agent-caddy; chmod 0700 /var/lib/site-agent-caddy
chown root:site-agent-web /etc/site-agent; chmod 0750 /etc/site-agent
install -m 0600 -o site-agent -g site-agent-web etc/agent.json /etc/site-agent/agent.json
install -m 0600 -o site-caddy -g site-agent-web etc/bootstrap.json /var/lib/site-agent-caddy/bootstrap.json
made_units=1
install -m 0644 etc/site-agent.service /etc/systemd/system/site-agent.service
install -m 0644 etc/site-agent-caddy.service /etc/systemd/system/site-agent-caddy.service
systemctl daemon-reload
systemctl enable --now site-agent-caddy.service
systemctl enable --now site-agent.service
systemctl is-active --quiet site-agent-caddy.service
systemctl is-active --quiet site-agent.service
success=1
echo INSTALLED=1
`;
}
export async function dependencyFiles(entry='tar-stream'){
 const files=new Map(),seen=new Map();
 async function walk(path,prefix){for(const entry of await fs.readdir(path,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('依赖包含不支持的符号链接');const next=join(path,entry.name),dest=prefix+'/'+entry.name;if(entry.isDirectory())await walk(next,dest);else if(entry.isFile())files.set(dest,await fs.readFile(next))}}
 async function visit(name,from){
  if(!/^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/.test(name))throw Error('依赖名称无效');
  const req=createRequire(from);let path=dirname(req.resolve(name));let pkg;
  for(;;){try{pkg=JSON.parse(await fs.readFile(join(path,'package.json'),'utf8'));if(pkg.name===name)break}catch{}const parent=dirname(path);if(parent===path)throw Error('找不到安装依赖');path=parent}
  if(seen.has(name)){if(seen.get(name)!==pkg.version)throw Error('依赖版本冲突');return}seen.set(name,pkg.version);
  await walk(path,'node_modules/'+name);for(const dependency of Object.keys(pkg.dependencies||{}))await visit(dependency,join(path,'package.json'));
 }
 await visit(entry,join(root,'package.json'));return files;
}
export async function payload(config){
 const files=await dependencyFiles();
 for(const path of ['agent/agent.mjs','agent/wait-caddy.mjs','pilot/archive.mjs'])files.set(path,await fs.readFile(join(root,path)));
 files.set('package.json',Buffer.from('{"type":"module"}'));
 files.set('etc/agent.json',Buffer.from(JSON.stringify({control:config.control,token:config.token,root:'/var/lib/site-agent',mode:'production',caddyAdmin:'http://127.0.0.1:2019',healthPort:4322,pollMs:2000})));
 files.set('etc/bootstrap.json',Buffer.from('{"admin":{"listen":"127.0.0.1:2019"}}'));
 files.set('etc/site-agent.service',Buffer.from(agentUnit));files.set('etc/site-agent-caddy.service',Buffer.from(caddyUnit));
 return files;
}
export async function install(client,config,progress){
 if(!await runtimesReady())throw Error('Provisioner缺少Linux ELF运行时；请使用专用Linux容器构建后安装');
 const files=await payload(config);
 const stage='/tmp/site-agent-'+randomBytes(12).toString('hex'),channel=await sftp(client),dirs=new Set([stage]);
 try{
  await mkdir(channel,stage);const directory=async path=>{const parts=path.split('/').filter(Boolean);let current=stage;for(const part of parts){current+='/'+part;if(!dirs.has(current)){await mkdir(channel,current);dirs.add(current)}}};
  const checks=[];progress('uploading','正在上传固定Agent代码、运行时和依赖');
  for(const [path,content]of files){await directory(path.split('/').slice(0,-1).join('/'));await write(channel,stage+'/'+path,content);checks.push(hash(content)+'  '+path)}
  await directory('bin');for(const [name,path]of Object.entries(runtimePaths())){await upload(channel,path,stage+'/bin/'+name);checks.push(await fileHash(path)+'  bin/'+name)}
  await write(channel,stage+'/SHA256SUMS',checks.join('\n')+'\n');
  progress('installing','正在安装专用服务；失败仅清理本任务新增内容');
  const output=await exec(client,installScript(stage),300000);if(!output.includes('INSTALLED=1'))throw Error('安装结果未确认，需要人工核查');
 }finally{channel.end();for(const value of files.values())if(Buffer.isBuffer(value))value.fill(0);await exec(client,'rm -rf -- '+stage+'\n',10000).catch(()=>{})}
}
