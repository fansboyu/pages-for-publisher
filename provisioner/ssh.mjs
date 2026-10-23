import ssh2 from 'ssh2';
const { Client }=ssh2;
import { fingerprint } from './security.mjs';
export function connect(config,{probe=false}={}){
 return new Promise((resolve,reject)=>{
  const client=new Client();let observed,settled=false;
  const done=error=>{if(settled)return;settled=true;client.destroy();if(probe&&observed)resolve({fingerprint:observed});else reject(error||Error('SSH连接失败'))};
  client.on('error',()=>done(Error(observed&&observed!==config.fingerprint?'SSH主机指纹不匹配':'SSH认证或连接失败')));
  client.once('close',()=>{if(!settled)done(Error('SSH连接提前关闭'))});
  client.once('ready',()=>{if(probe)return done();settled=true;resolve(client)});
  client.connect({host:config.host,port:config.port,username:probe?'fingerprint-probe':config.username,...(!probe&&config.password?{password:config.password}:{}),...(!probe&&config.privateKey?{privateKey:config.privateKey}:{}),readyTimeout:15000,keepaliveInterval:10000,keepaliveCountMax:2,hostVerifier:raw=>{observed=fingerprint(raw);return !probe&&observed===config.fingerprint}});
 });
}
export function exec(client,script,timeout=30000){
 return new Promise((resolve,reject)=>{
  let stream,output='',settled=false;
  const done=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);client.removeListener('close',closed);if(err)reject(err);else resolve(value)};
  const closed=()=>done(Error('SSH连接在执行过程中断开'));
  const timer=setTimeout(()=>{stream?.close();done(Error('SSH命令超时，远端状态需要核查'))},timeout);
  client.once('close',closed);
  client.exec('bash -s',{pty:false},(err,ch)=>{if(err)return done(Error('无法执行SSH固定脚本'));stream=ch;
   ch.on('data',chunk=>{if(output.length<32768)output+=chunk.toString()});ch.stderr.resume();
   ch.once('error',()=>done(Error('SSH命令通信失败')));ch.once('close',code=>code===0?done(null,output):done(Error('远端固定脚本失败（退出码 '+code+'），请核查安装状态')));ch.end(script);
  });
 });
}
export function sftp(client){return new Promise((resolve,reject)=>client.sftp((err,value)=>err?reject(Error('无法启动SFTP传输')):resolve(value)))}
export function mkdir(s,path){return new Promise((resolve,reject)=>s.mkdir(path,{mode:0o700},err=>err?reject(Error('无法创建专用安装暂存目录')):resolve()))}
export function write(s,path,content,mode=0o600){return new Promise((resolve,reject)=>s.writeFile(path,content,{mode},err=>err?reject(Error('上传安装文件失败')):resolve()))}
export function upload(s,local,remote){return new Promise((resolve,reject)=>s.fastPut(local,remote,{mode:0o700},err=>err?reject(Error('上传运行时文件失败')):resolve()))}
