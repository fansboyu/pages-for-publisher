import { transaction } from './db.mjs';
import { id,siteFor,siteView,audit,fail } from './common.mjs';
export async function enqueuePublish(pool,user,siteId){return transaction(pool,async c=>{
 const site=await siteFor(c,user,siteId,true),template=(await c.query('SELECT * FROM templates WHERE id=$1',[site.template_id])).rows[0];
 if(!template)fail('模板版本不存在');
 const articles=(await c.query("SELECT * FROM articles WHERE site_id=$1 AND status='published' ORDER BY updated_at DESC,id",[siteId])).rows.map(a=>({id:a.id,title:a.title,summary:a.summary,body:a.body,format:a.format,updated:a.updated_at.toISOString()}));
 const {key,...content}=siteView(site);const snapshot={site:content,articles,template:{id:template.id,version:template.version},revision:Number(site.revision)};
 const release=id('r'),job=id('b');await c.query('INSERT INTO releases(id,site_id,template_id,snapshot,created_by) VALUES($1,$2,$3,$4,$5)',[release,siteId,template.id,snapshot,user.name]);
 await c.query('INSERT INTO build_jobs(id,release_id,site_id) VALUES($1,$2,$3)',[job,release,siteId]);await audit(c,siteId,user.name,'创建网站构建任务');
 return {id:release,status:'queued',job_id:job};
})}
export async function enqueueDeploy(c,site,release,kind,by){const task=id('d');await c.query('INSERT INTO deployment_tasks(id,site_id,server_id,release_id,kind,created_by,domain) VALUES($1,$2,$3,$4,$5,$6,$7)',[task,site.id,site.server_id,release,kind,by,site.domain]);return task}
export async function rollback(pool,user,siteId,release){return transaction(pool,async c=>{
 const site=await siteFor(c,user,siteId,true),target=(await c.query("SELECT * FROM releases WHERE id=$1 AND site_id=$2 AND archive_key IS NOT NULL AND status IN ('live','ready','deploy_failed')",[release,siteId])).rows[0];if(!target)fail('版本不可用');
 if((await c.query("SELECT 1 FROM build_jobs WHERE site_id=$1 AND status IN ('queued','building') UNION ALL SELECT 1 FROM deployment_tasks WHERE site_id=$1 AND status IN ('queued','running')",[siteId])).rowCount)fail('请等待当前发布完成后再回滚',409);
 if(site.server_id)return {id:await enqueueDeploy(c,site,release,'rollback',user.name),status:'queued'};
 await c.query('UPDATE sites SET active_release=$1,deployed_at=now() WHERE id=$2',[release,siteId]);await audit(c,siteId,user.name,'回滚预览版本');return {ok:true};
})}
