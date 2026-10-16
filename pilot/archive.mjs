import tar from 'tar-stream';
import { gzipSync,gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const sha256=data=>createHash('sha256').update(data).digest('hex');
export const limits=()=>({compressed:Number(process.env.PACKAGE_MAX_COMPRESSED_MB||128)*1024*1024,unpacked:Number(process.env.PACKAGE_MAX_UNPACKED_MB||512)*1024*1024,files:Number(process.env.PACKAGE_MAX_FILES||20000)});
export function checkPath(path){return typeof path==='string'&&path.length<500&&!path.startsWith('/')&&!path.includes('\\')&&!path.includes(':')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..')}
export async function packWebsite(site,release,files,cap=limits()){
 if(files.size>cap.files)throw Error('网站文件数超过限制');let size=0;const manifest={version:2,site,release,files:[]};
 for(const [path,data]of files){if(!checkPath(path)||path==='.release-manifest.json')throw Error('网站文件路径非法');size+=data.length;if(size>cap.unpacked)throw Error('网站展开体积超过限制');manifest.files.push({path,size:data.length,sha256:sha256(data)})}
 const p=tar.pack(),chunks=[];const done=new Promise((resolve,reject)=>{p.on('data',c=>chunks.push(c));p.on('end',resolve);p.on('error',reject)});
 p.entry({name:'.release-manifest.json',mtime:new Date(0),mode:0o640},JSON.stringify(manifest));for(const [name,data]of files)p.entry({name,mtime:new Date(0),mode:0o640},data);p.finalize();await done;
 const bytes=gzipSync(Buffer.concat(chunks));if(bytes.length>cap.compressed)throw Error('网站压缩包超过限制');return bytes;
}
export async function unpackWebsite(bytes,task,cap=limits()){
 if(bytes.length>cap.compressed||sha256(bytes)!==task.sha256)throw Error('发布包 SHA-256 校验失败');
 const raw=gunzipSync(bytes,{maxOutputLength:cap.unpacked+cap.files*2048+1024*1024}),extract=tar.extract(),files=new Map();let size=0;
 await new Promise((resolve,reject)=>{extract.on('entry',(header,stream,next)=>{stream.on('error',reject);if(header.type!=='file'||!checkPath(header.name)||files.has(header.name)||files.size>cap.files||header.size>cap.unpacked){stream.resume();extract.destroy(Error('发布包存在非法路径或条目'));return}const chunks=[];stream.on('data',c=>{size+=c.length;if(size>cap.unpacked+1024*1024)extract.destroy(Error('展开内容超过限制'));chunks.push(c)});stream.on('error',reject);stream.on('end',()=>{files.set(header.name,Buffer.concat(chunks));next()})});extract.on('finish',resolve);extract.on('error',reject);extract.end(raw)});
 const manifest=JSON.parse(files.get('.release-manifest.json')||'null');if(!manifest||manifest.version!==2||manifest.site!==task.site||manifest.release!==task.release||!Array.isArray(manifest.files)||manifest.files.length>cap.files)throw Error('发布清单身份不符');files.delete('.release-manifest.json');
 const seen=new Set();for(const f of manifest.files){const data=files.get(f.path);if(seen.has(f.path)||!data||data.length!==f.size||sha256(data)!==f.sha256)throw Error('文件校验失败');seen.add(f.path)}
 if(seen.size!==files.size||!files.has('index.html'))throw Error('发布清单不完整');return {version:2,site:task.site,release:task.release,files:[...files].map(([path,data])=>({path,data:data.toString('base64'),size:data.length,sha256:sha256(data)}))};
}
