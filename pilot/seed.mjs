import { join } from 'node:path';
import { project,transaction } from './db.mjs';
import { importTemplate } from './templates.mjs';
import { password,token } from './common.mjs';
export async function seed(db){
 if((await db.query('SELECT 1 FROM users LIMIT 1')).rowCount)return;
 const demo=process.env.DEMO_MODE==='true';if(!demo&&String(process.env.BOOTSTRAP_ADMIN_PASSWORD||'').length<14)throw Error('首次启动需设置至少14位 BOOTSTRAP_ADMIN_PASSWORD，演示模式请显式设置 DEMO_MODE=true');
 const template=await importTemplate(db,join(project,'pilot','templates','basic'),'基础企业官网');
 await transaction(db,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtext('site-control-seed'))");if((await c.query('SELECT 1 FROM users LIMIT 1')).rowCount)return;
  if(demo)await c.query("INSERT INTO agencies VALUES('a1','优选数字服务','专业版'),('a2','远山网络工作室','基础版')");else await c.query("INSERT INTO agencies VALUES('a1','直营客户','专业版')");
  await c.query('INSERT INTO users(id,username,password_hash,name,role) VALUES($1,$2,$3,$4,$5)',['u1','admin',password(demo?'Admin123!':process.env.BOOTSTRAP_ADMIN_PASSWORD),'平台管理员','admin']);
  if(!demo)return;
  await c.query('INSERT INTO users(id,username,password_hash,name,role,agency_id) VALUES($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',['u2','agency',password('Agency123!'),'优选代理商','agency','a1','u3','partner',password('Partner123!'),'独立代理商','agency','a2']);
  const sites=[['s1','c1','a1','上海优佳家政','优佳家政官网','www.youjiajiazheng.cn','家政服务','让家的美好，从优佳开始','13400617908'],['s2','c2','a1','上海百信锁具','百信锁具官网','baixinsuoju.com','生活服务','用专业，守护每一次安心回家','13151145114'],['s3','c3','a2','远山生活','远山品牌展示站','demo.local','品牌展示','为日常，创造更多可能','待填写']];
  for(const [id,client,agency,name,site,domain,type,title,phone]of sites){await c.query('INSERT INTO clients VALUES($1,$2,$3)',[client,agency,name]);await c.query('INSERT INTO sites(id,client_id,name,domain,type,content,api_key,template_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,client,site,domain,type,{title,phone,intro:'专业、细致的服务，让每一次托付更加安心。'},token(),template.id])}
  await c.query("INSERT INTO articles(id,site_id,title,summary,body,status) VALUES('p1','s1','如何选择适合家庭的服务','从日常需求出发，选择合适的专业服务。','提前沟通服务范围、服务时间与家庭习惯，建立清晰的服务预期。','published')");
 });
}
