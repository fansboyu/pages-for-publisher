import { promises as fs } from 'node:fs';
import { resolve,join,dirname } from 'node:path';
import OSS from 'ali-oss';
import sharp from 'sharp';
import { createHash,randomBytes } from 'node:crypto';

export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function createStorage(root){
 const driver=process.env.STORAGE_DRIVER||'local';
 if(!['local','oss'].includes(driver))throw Error('STORAGE_DRIVER must be local or oss');
 let mediaClient,archiveClient;
 const publicBase=(process.env.MEDIA_PUBLIC_BASE_URL||'').replace(/\/$/,'');
 if(driver==='oss'){
  for(const key of ['OSS_REGION','OSS_MEDIA_BUCKET','OSS_ARCHIVE_BUCKET','MEDIA_PUBLIC_BASE_URL','OSS_ACCESS_KEY_ID','OSS_ACCESS_KEY_SECRET'])if(!process.env[key])throw Error(`Missing ${key}`);
  if(!publicBase.startsWith('https://'))throw Error('OSS 图片域名必须使用 HTTPS');
  if(process.env.OSS_MEDIA_BUCKET===process.env.OSS_ARCHIVE_BUCKET)throw Error('素材与发布归档必须使用不同 Bucket');
  const options={region:process.env.OSS_REGION,accessKeyId:process.env.OSS_ACCESS_KEY_ID,accessKeySecret:process.env.OSS_ACCESS_KEY_SECRET,secure:true,...(process.env.OSS_STS_TOKEN?{stsToken:process.env.OSS_STS_TOKEN}:{})};
  mediaClient=new OSS({...options,bucket:process.env.OSS_MEDIA_BUCKET});archiveClient=new OSS({...options,bucket:process.env.OSS_ARCHIVE_BUCKET});
 }
 function localPath(key){const base=resolve(root,'objects'),path=resolve(base,key);if(!path.startsWith(base+'/')&&!path.startsWith(base+'\\'))throw Error('非法存储路径');return path}
 return {
  driver,
  info(){return {driver,mediaBase:publicBase||'/objects/media/',mediaBucket:driver==='oss'?process.env.OSS_MEDIA_BUCKET:null,archiveBucket:driver==='oss'?process.env.OSS_ARCHIVE_BUCKET:null}},
  async image(site,b){
   const m=String(b.data||'').match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);if(!m)throw Error('仅支持 PNG、JPEG、WebP');
   const original=Buffer.from(m[2],'base64');if(original.length>5*1024*1024)throw Error('原图不能超过 5MB');
   const image=sharp(original,{limitInputPixels:40000000}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true});
   const {data,info}=await image.webp({quality:82}).toBuffer({resolveWithObject:true});
   const key=`media/sites/${site}/${sha256(data)}.webp`;
   if(driver==='oss')await mediaClient.put(key,data,{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=31536000, immutable'}});
   else {const path=localPath(key);await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,data)}
   return {id:randomBytes(12).toString('hex'),site,name:String(b.name||'图片').slice(0,200),key,url:driver==='oss'?`${publicBase}/${key}`:`/objects/${key}`,size:data.length,originalSize:original.length,width:info.width,height:info.height,driver};
  },
  async putArchive(key,data){if(driver==='oss')await archiveClient.put(key,data,{headers:{'Content-Type':'application/gzip'}});else{const path=localPath(key);await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,data)}return key},
  async putTemplate(key,data){if(!/^templates\/[a-f0-9]{64}\/source\.zip$/.test(key))throw Error('非法模板对象路径');if(driver==='oss')await archiveClient.put(key,data,{headers:{'Content-Type':'application/zip'}});else{const path=localPath(key);await fs.mkdir(dirname(path),{recursive:true});await fs.writeFile(path,data)}return key},
  async probe(){
   if(driver!=='oss')return {ok:false,driver,checks:[{name:'存储模式',ok:false,note:'当前仍为local，未启用真实OSS'}]};
   const unique='storage-probe-'+randomBytes(12).toString('hex'),mediaKey=`media/sites/${unique}/probe.webp`,archiveKey=`archives/probes/${unique}.tar.gz`,templateKey=`templates/probes/${unique}.zip`,checks=[],created=[];
   const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true})}catch(e){checks.push({name,ok:false,note:String(e.code||e.name||'Error').slice(0,100),status:e.status||null})}};
   const bytes=Buffer.from('sitecontrol-storage-probe');
   await check('图片Bucket写入',async()=>{const image=await sharp({create:{width:2,height:2,channels:3,background:'#159570'}}).webp().toBuffer();await mediaClient.put(mediaKey,image,{headers:{'Content-Type':'image/webp'}});created.push([mediaClient,mediaKey])});
   await check('图片匿名HTTPS访问',async()=>{const r=await fetch(`${publicBase}/${mediaKey}`,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok||!r.headers.get('content-type')?.includes('image/'))throw Error('PublicImageUnavailable');const expected=(await mediaClient.get(mediaKey)).content;if(sha256(Buffer.from(await r.arrayBuffer()))!==sha256(expected))throw Error('ImageMismatch')});
   for(const [key,label]of [[archiveKey,'发布包'],[templateKey,'模板ZIP']]){
    await check(label+'私有归档读写',async()=>{await archiveClient.put(key,bytes);created.push([archiveClient,key]);if(sha256((await archiveClient.get(key)).content)!==sha256(bytes))throw Error('Mismatch')});
    await check(label+'签名下载',async()=>{const r=await fetch(archiveClient.signatureUrl(key,{expires:60,method:'GET'}),{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok||sha256(Buffer.from(await r.arrayBuffer()))!==sha256(bytes))throw Error('SignedDownloadFailed')});
    await check(label+'禁止匿名访问',async()=>{const r=await fetch(`https://${process.env.OSS_ARCHIVE_BUCKET}.${process.env.OSS_REGION}.aliyuncs.com/${key}`,{signal:AbortSignal.timeout(12000),redirect:'error'});if(![401,403].includes(r.status))throw Error('PrivateAccessNotVerified')});
   }
   for(const [client,key]of created)await check('清理本次测试对象',()=>client.delete(key));
   return {ok:checks.every(x=>x.ok),driver,checks};
  },
  async readArchive(key){if(!key.startsWith('archives/'))throw Error('非法归档对象');if(driver==='oss')return (await archiveClient.get(key)).content;return fs.readFile(localPath(key))},
  archiveDownloadUrl(key){if(!key.startsWith('archives/'))throw Error('非法归档对象');return driver==='oss'?archiveClient.signatureUrl(key,{expires:3600,method:'GET'}):null},
  localPublicFile(key){if(!key.startsWith('media/'))throw Error('禁止读取私有发布归档');return localPath(key)}
 };
}
