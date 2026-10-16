import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { database,migrate,transaction,project } from '../pilot/db.mjs';
import { importTemplate,dataRoot } from '../pilot/templates.mjs';
import { hash } from '../pilot/common.mjs';
export async function importLegacy(pool,sqliteFile){
 await migrate(pool);if((await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount)throw Error('迁移目标必须为空数据库，禁止覆盖已有试点数据');
 const source=resolve(sqliteFile),oldRoot=dirname(source),sqlite=new DatabaseSync(source,{readOnly:true});let legacy;try{legacy=JSON.parse(sqlite.prepare('SELECT value FROM state WHERE id=1').get().value)}finally{sqlite.close()}
 const template=await importTemplate(pool,join(project,'pilot','templates','basic'),'基础企业官网');
 const clients=new Map();for(const site of legacy.sites)clients.set(site.agency+'\0'+site.client,{id:'c'+hash(site.agency+'\0'+site.client).slice(0,20),agency:site.agency,name:site.client});
 // 数据库事务失败不会改变原SQLite；目标文件仅复制到新目录。
 for(const folder of ['media','objects','releases']){try{await fs.cp(join(oldRoot,folder),join(dataRoot(),folder),{recursive:true,errorOnExist:false,force:false})}catch(e){if(e.code!=='ENOENT')throw e}}
 await transaction(pool,async c=>{
  for(const a of legacy.agencies)await c.query('INSERT INTO agencies VALUES($1,$2,$3)',[a.id,a.name,a.level||'基础版']);
  for(const x of clients.values())await c.query('INSERT INTO clients VALUES($1,$2,$3)',[x.id,x.agency,x.name]);
  for(const u of legacy.users)await c.query('INSERT INTO users(id,username,password_hash,name,role,agency_id) VALUES($1,$2,$3,$4,$5,$6)',[u.id,u.username,u.password.includes(':')?u.password:'local-platform-v1:'+u.password,u.name,u.role,u.agency]);
  for(const s of legacy.servers||[])await c.query('INSERT INTO servers(id,name,token_hash,last_seen,version,revoked) VALUES($1,$2,$3,$4,$5,$6)',[s.id,s.name,s.tokenHash,s.lastSeen,s.version,s.revoked||false]);
  for(const s of legacy.sites)await c.query('INSERT INTO sites(id,client_id,name,domain,type,color,content,api_key,server_id,template_id,active_release) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[s.id,clients.get(s.agency+'\0'+s.client).id,s.name,s.domain,s.type||'企业官网',s.color||'#426c5b',{title:s.title,intro:s.intro,phone:s.phone},s.key,s.serverId||null,template.id,s.active]);
  for(const a of legacy.articles)await c.query('INSERT INTO articles(id,site_id,external_id,title,summary,body,format,status,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[a.id,a.site,a.external||null,a.title,a.summary||'',a.body||'',a.format||'text',a.status,a.updated]);
  for(const m of legacy.media||[])await c.query('INSERT INTO media(id,site_id,name,object_key,url,size,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[m.id,m.site,m.name,m.key||null,m.url,m.size,m]);
  for(const r of legacy.releases){let snapshot={legacy:true};try{snapshot=JSON.parse(await fs.readFile(join(oldRoot,'releases',r.site,r.id,'snapshot.json'),'utf8'));if(snapshot.site)delete snapshot.site.key}catch{}await c.query('INSERT INTO releases(id,site_id,template_id,snapshot,status,created_by,created_at,archive_key,sha256,bytes,pages,format,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[r.id,r.site,template.id,snapshot,r.status,r.by||'旧版迁移',r.time,r.archiveKey||null,r.sha256||null,r.bytes||null,r.pages||null,'legacy-json-v1',r.error||null])}
  for(const d of legacy.deployments||[])await c.query('INSERT INTO deployment_tasks(id,site_id,server_id,release_id,kind,created_by,domain,status,attempts,error,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[d.id,d.site,d.server,d.release,d.kind,d.by,d.domain,['succeeded','failed'].includes(d.status)?d.status:'cancelled',d.attempts||0,['queued','running'].includes(d.status)?'旧版未完成任务不自动重放，请重新发布':d.error||null,d.time]);
  for(const log of legacy.logs||[])await c.query('INSERT INTO audit_logs(site_id,actor,action,created_at) VALUES($1,$2,$3,$4)',[log.site,log.who,log.action,log.time]);
 });return {sites:legacy.sites.length,articles:legacy.articles.length,releases:legacy.releases.length,users:legacy.users.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){if(!process.argv[2])throw Error('Usage: node scripts/import-legacy.mjs path/to/platform.sqlite');const db=database();try{console.log('Legacy imported:',await importLegacy(db,process.argv[2]))}finally{await db.end()}}
