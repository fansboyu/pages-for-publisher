import { promises as fs,createWriteStream } from 'node:fs';
import { join,dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { dataRoot,templateFiles,validate,importTemplate,buildWebsite } from './templates.mjs';
import { id,fail,siteFor,siteView } from './common.mjs';
import { contentFields } from './content-fields.mjs';
const maxUpload=()=>Number(process.env.TEMPLATE_MAX_COMPRESSED_MB||64)*1024*1024;
const maxExpand=()=>Number(process.env.TEMPLATE_MAX_UNPACKED_MB||256)*1024*1024;
const maxFiles=()=>Number(process.env.TEMPLATE_MAX_FILES||10000);
const allowed=/\.(html|css|js|json|xml|txt|webp|png|jpe?g|gif|ico|svg|woff2?|ttf|webmanifest|pdf)$/i;
export function zipPath(name){
 if(typeof name!=='string'||name.length>450||name.startsWith('/')||/[\\:\x00-\x1f]/.test(name)||name.split('/').some(x=>x==='..'||x==='.'||x.startsWith('.')))fail('ZIP中存在非法或隐藏路径');
 return name;
}
export async function extractZip(archive,destination){
 const zip=await new Promise((ok,no)=>yauzl.open(archive,{lazyEntries:true,validateEntrySizes:true},(e,z)=>e?no(e):ok(z)));
 let count=0,total=0;const seen=new Set();
 try{await new Promise((ok,no)=>{
  let ended=false;const error=e=>{if(!ended){ended=true;zip.close();no(e)}};
  zip.on('error',error);zip.on('end',()=>{ended=true;ok()});
  zip.on('entry',entry=>{(async()=>{
   const name=zipPath(entry.fileName),lower=name.toLowerCase();
   if(++count>maxFiles()||seen.has(lower))fail('ZIP文件过多或存在重复路径');seen.add(lower);
   const mode=(entry.externalFileAttributes>>>16)&0xf000;
   if(mode&&mode!==0x8000&&mode!==0x4000)fail('ZIP不允许软链接或特殊文件');
   if(entry.generalPurposeBitFlag&1)fail('不支持加密ZIP');
   if(name.endsWith('/')){await fs.mkdir(join(destination,name),{recursive:true});zip.readEntry();return}
   if(!allowed.test(name))fail('ZIP包含不支持的文件：'+name);
   if(entry.uncompressedSize>maxExpand()||total+entry.uncompressedSize>maxExpand())fail('ZIP解压体积超限');
   const stream=await new Promise((yes,bad)=>zip.openReadStream(entry,(e,s)=>e?bad(e):yes(s)));
   const dest=join(destination,name);await fs.mkdir(dirname(dest),{recursive:true});
   await pipeline(stream,new Transform({transform(chunk,encoding,cb){total+=chunk.length;cb(total>maxExpand()?Error('ZIP解压体积超限'):null,chunk)}}),createWriteStream(dest,{flags:'wx',mode:0o640}));
   zip.readEntry();
  })().catch(error)});zip.readEntry();
 });}finally{zip.close()}
 const entries=await fs.readdir(destination,{withFileTypes:true});
 let root=destination;
 try{await fs.access(join(root,'publisher.config.json'))}catch{
  if(entries.length!==1||!entries[0].isDirectory())fail('ZIP根目录缺少publisher.config.json，只支持单层外包目录');
  root=join(destination,entries[0].name);
 }
 const files=await templateFiles(root),config=validate(files);
 return {root,config,report:{ok:true,files:files.size,unpackedBytes:total,protocol:config.protocol||'standard-static-v1',checks:['安全解压','协议与能力','电话与备案占位符','完整网站构建及资源检查']}};
}
let busy=false;
export async function uploadTemplate(req,db,store,user,url){
 if(busy)fail('已有模板上传/校验进行中，请稍后重试',429);busy=true;
 const temp=join(dataRoot(),'uploads',id('upload'));
 try{
  if(req.headers['content-type']?.split(';')[0]!=='application/zip')fail('请上传ZIP文件，Content-Type为application/zip');
  if(Number(req.headers['content-length']||0)>maxUpload())fail('模板ZIP超过大小限制',413);
  const name=String(url.searchParams.get('name')||'客户官网').trim().slice(0,100);
  await fs.mkdir(temp,{recursive:true});const archive=join(temp,'source.zip'),folder=join(temp,'files');await fs.mkdir(folder);
  let size=0;await pipeline(req,new Transform({transform(chunk,encoding,cb){size+=chunk.length;cb(size>maxUpload()?Object.assign(Error('模板ZIP超过大小限制'),{status:413}):null,chunk)}}),createWriteStream(archive,{flags:'wx',mode:0o600}));
  const checked=await extractZip(archive,folder);
  let defaults={};try{defaults=JSON.parse(await fs.readFile(join(checked.root,'templates/site.defaults.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')fail('模板初始化资料JSON无效')}
  const dummy={name:'校验网站',client:'校验客户',domain:'example.invalid',title:'校验标题',intro:'校验介绍',phone:'10000000000',icp_number:'待运营核对',icp_url:'https://beian.miit.gov.cn/'};
  await buildWebsite({site:dummy,articles:[{id:'template-validation',title:'测试文章',summary:'资源校验',body:'模板校验，不会发布',format:'text',updated:new Date().toISOString()}]},{source_path:checked.root});
  // importTemplate 使用同一受控导入根；上传临时目录不能开放成任意文件系统路径。
  const row=await importTemplate(db,checked.root,name,{upload:true});
  const key=`templates/${row.version}/source.zip`;await store.putTemplate(key,await fs.readFile(archive));
  const report={...checked.report,defaults:{name:String(defaults.name||'').slice(0,100),phone:String(defaults.phone||'').slice(0,40),icp_number:String(defaults.icp_number||'').slice(0,200),icp_url:'https://beian.miit.gov.cn/'}};
  await db.query('UPDATE templates SET archive_key=$1,upload_bytes=$2,report=$3 WHERE id=$4',[key,size,report,row.id]);
  await db.query('INSERT INTO audit_logs(actor,action) VALUES($1,$2)',[user.name,'上传并校验模板 '+row.id]);
  return {id:row.id,name:row.name,version:row.version,report};
 }finally{busy=false;await fs.rm(temp,{recursive:true,force:true})}
}
export async function draftPreview(db,user,siteId){
 const expired=(await db.query('DELETE FROM draft_previews WHERE id IN (SELECT id FROM draft_previews WHERE expires_at<now() LIMIT 20) RETURNING id')).rows;
 for(const row of expired)if(/^pv[a-z0-9]+$/.test(row.id))await fs.rm(join(dataRoot(),'draft-previews',row.id),{recursive:true,force:true});
 const site=await siteFor(db,user,siteId),template=(await db.query('SELECT * FROM templates WHERE id=$1',[site.template_id])).rows[0];
 const articles=(await db.query("SELECT * FROM articles WHERE site_id=$1 AND status='published' ORDER BY updated_at DESC,id",[siteId])).rows.map(a=>({id:a.id,title:a.title,summary:a.summary,body:a.body,format:a.format,updated:a.updated_at.toISOString()}));
 const {key,...content}=siteView(site);contentFields(content);
 const files=await buildWebsite({site:content,articles},template),preview=id('pv'),folder=join(dataRoot(),'draft-previews',preview);
 for(const [path,bytes]of files){const dest=join(folder,path);await fs.mkdir(dirname(dest),{recursive:true});await fs.writeFile(dest,bytes)}
 await db.query('INSERT INTO draft_previews(id,site_id,created_by,source_path) VALUES($1,$2,$3,$4)',[preview,siteId,user.id,folder]);
 return {url:`/api/draft-preview/${preview}/`,pages:[...files.keys()].filter(p=>p.endsWith('.html')),expiresIn:1800};
}
