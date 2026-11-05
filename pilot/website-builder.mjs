import { transaction } from './db.mjs';
import { id,fail,body,json,siteFor,siteView,audit,accountScope } from './common.mjs';
import * as billing from './billing.mjs';
import { aiMode,aiImageMode,generateWebsiteHero } from './ai-article.mjs';
import { websiteInput,generateWebsite } from './ai-website.mjs';
import { websiteThemes,normalizeWebsiteSpec } from './website-renderer.mjs';
import { buildWebsite } from './templates.mjs';

const jobView=row=>({id:row.id,status:row.status==='review'&&['released','refunded'].includes(row.order_status)?'failed':row.status,error:row.error,createdAt:row.created_at,finishedAt:row.finished_at});
const isDemo=input=>aiMode()==='demo'&&(!input.imageCount||aiImageMode()==='demo');
function checkModels(input){if(!isDemo(input)&&(aiMode()!=='provider'||input.imageCount&&aiImageMode()!=='aliyun'))fail('请先配置所需的文字和图片模型；或取消首页配图',503)}
async function requireIdle(c,site){if((await c.query("SELECT 1 FROM website_builder_jobs j JOIN billing_orders o ON o.id=j.order_id WHERE j.site_id=$1 AND (j.status IN ('queued','running') OR j.status='review' AND o.status IN ('held','review'))",[site])).rowCount)fail('该网站已有建站任务或待核查账单，请先处理',409)}
async function recordDraft(c,site,spec,instruction,actor,revision){
 const next=revision+1;await c.query('UPDATE website_builder_drafts SET spec=$1,revision=$2,updated_at=now() WHERE site_id=$3',[spec,next,site]);
 await c.query('INSERT INTO website_builder_versions(site_id,revision,spec,instruction,actor) VALUES($1,$2,$3,$4,$5)',[site,next,spec,instruction,actor]);return next;
}

export async function websiteBuilderRoute(db,user,req,res,path){
 const match=path.match(/^\/api\/sites\/([^/]+)\/website(?:\/(quote|jobs|draft|apply|preview)(?:\/(.*))?)?$/);if(!match)return false;
 const site=await siteFor(db,user,match[1]),action=match[2];
 if(!action&&req.method==='GET'){
  const draft=(await db.query('SELECT * FROM website_builder_drafts WHERE site_id=$1',[site.id])).rows[0];
  const jobs=(await db.query('SELECT j.id,j.status,j.error,j.created_at,j.finished_at,o.status order_status FROM website_builder_jobs j JOIN billing_orders o ON o.id=j.order_id WHERE j.site_id=$1 ORDER BY j.created_at DESC LIMIT 10',[site.id])).rows;
  const versions=(await db.query('SELECT revision,instruction,actor,created_at FROM website_builder_versions WHERE site_id=$1 ORDER BY revision DESC LIMIT 10',[site.id])).rows;
  const count=(await db.query('SELECT count(*) count FROM client_knowledge WHERE client_id=$1',[site.client_id])).rows[0];
  json(res,{draft:draft?.spec?{spec:draft.spec,revision:draft.revision,appliedRevision:draft.applied_revision,updatedAt:draft.updated_at}:null,jobs:jobs.map(jobView),versions,siteRevision:Number(site.revision),themes:websiteThemes,knowledgeCount:Number(count.count),textMode:aiMode(),imageMode:aiImageMode()});return true;
 }
 if(action==='preview'&&req.method==='GET'){
  const query=new URL(req.url,'http://localhost').searchParams,revision=Number(query.get('revision')||0);if(!Number.isSafeInteger(revision)||revision<0)fail('草稿版本无效');
  const draft=revision?(await db.query('SELECT spec FROM website_builder_versions WHERE site_id=$1 AND revision=$2',[site.id,revision])).rows[0]:(await db.query('SELECT spec FROM website_builder_drafts WHERE site_id=$1',[site.id])).rows[0];if(!draft?.spec)fail('请先生成网站草稿',404);
  const template=(await db.query('SELECT * FROM templates WHERE id=$1',[site.template_id])).rows[0];if(!template)fail('请先绑定网站模板');
  const articles=(await db.query("SELECT * FROM articles WHERE site_id=$1 AND status='published' ORDER BY updated_at DESC,id",[site.id])).rows.map(a=>({...a,updated:a.updated_at.toISOString()}));
  const files=await buildWebsite({site:{...siteView(site),builder:draft.spec},articles},template,{analytics:false});let name=decodeURIComponent(match[3]||'index.html');if(name.endsWith('/'))name+='index.html';const bytes=files.get(name);if(!bytes)fail('预览页面不存在',404);
  const extension=name.slice(name.lastIndexOf('.')),mime=({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.json':'application/json','.xml':'application/xml','.pdf':'application/pdf'})[extension]||'application/octet-stream';
  const output=revision&&name.endsWith('.html')?Buffer.from(bytes.toString().replace(/href="([^"#?]*)"/g,(all,url)=>/^(?:[a-z]+:|\/\/)/i.test(url)?all:`href="${url}?revision=${revision}"`)):bytes;
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"sandbox allow-same-origin; default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"});res.end(output);return true;
 }
 if(req.method!=='POST')fail('方法不允许',405);const b=await body(req);
 if(action==='quote'){
  const input=websiteInput(b);checkModels(input);const q=await billing.quote(db,user,site.id,input,isDemo(input),'website');json(res,{amountCents:q.amountCents,configured:q.configured,demo:q.demo,price:q.price});return true;
 }
 if(action==='jobs'){
  const input=websiteInput(b);checkModels(input);const jobId=id('wb');
  const reservation=await billing.reserve(db,user,site.id,{...input,requestKey:b.requestKey,quoteVersion:b.quoteVersion,quotedAmountCents:b.quotedAmountCents},isDemo(input),async(c,orderId)=>{
   const locked=await siteFor(c,user,site.id,true);await requireIdle(c,site.id);
   await c.query('INSERT INTO website_builder_drafts(site_id) VALUES($1) ON CONFLICT DO NOTHING',[site.id]);const draft=(await c.query('SELECT revision FROM website_builder_drafts WHERE site_id=$1 FOR UPDATE',[site.id])).rows[0];
   if(draft.revision!==input.revision)fail('草稿已被其他操作更新，请刷新后重试',409);
   await c.query('INSERT INTO website_builder_jobs(id,site_id,actor_id,order_id,input,base_revision,site_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[jobId,site.id,user.id,orderId,input,draft.revision,locked.revision]);await audit(c,site.id,user.name,'提交AI智能建站任务');
  });json(res,reservation.replay||{jobId,status:'queued',amountCents:Number(reservation.order.amount_cents)},202);return true;
 }
 if(action==='draft'){
  const result=await transaction(db,async c=>{await siteFor(c,user,site.id,true);await requireIdle(c,site.id);const draft=(await c.query('SELECT * FROM website_builder_drafts WHERE site_id=$1 FOR UPDATE',[site.id])).rows[0];if(!draft?.spec)fail('请先生成草稿');if(Number(b.revision)!==draft.revision)fail('草稿已更新，请刷新后重试',409);
   const spec=normalizeWebsiteSpec(b.spec);spec.companyName=site.client_name;
   if(spec.hero.imageUrl&&spec.hero.imageUrl!==draft.spec.hero?.imageUrl&&!(await c.query('SELECT 1 FROM media WHERE site_id=$1 AND url=$2',[site.id,spec.hero.imageUrl])).rowCount)fail('只能选择该网站素材库中的图片');
   const revision=await recordDraft(c,site.id,spec,'手动调整页面配置',user.name,draft.revision);await audit(c,site.id,user.name,'手动调整建站草稿');return {revision};});json(res,result);return true;
 }
 if(action==='apply'){
  const result=await transaction(db,async c=>{const locked=await siteFor(c,user,site.id,true);await requireIdle(c,site.id);const draft=(await c.query('SELECT * FROM website_builder_drafts WHERE site_id=$1 FOR UPDATE',[site.id])).rows[0];if(!draft?.spec)fail('请先生成草稿');if(Number(b.revision)!==draft.revision||Number(b.siteRevision)!==Number(locked.revision))fail('网站或草稿已更新，请刷新后再保存',409);
   const spec=normalizeWebsiteSpec(draft.spec);await c.query('UPDATE sites SET content=content||$1::jsonb,revision=revision+1 WHERE id=$2',[JSON.stringify({builder:spec,title:spec.hero.title,intro:spec.hero.subtitle}),site.id]);await c.query('UPDATE website_builder_drafts SET applied_revision=revision WHERE site_id=$1',[site.id]);await audit(c,site.id,user.name,'将智能建站草稿保存到官网');return {ok:true,revision:draft.revision};});json(res,result);return true;
 }
 fail('建站操作不存在',404);
}

// Same Worker process, separate persisted jobs. Never repeat a provider call after a lost lease.
export async function processWebsiteJob(db,store){
 await transaction(db,async c=>{const stale=(await c.query("UPDATE website_builder_jobs SET status='review',error='Worker中断，生成状态需核查；不会自动重复调用模型',lease_until=NULL WHERE status='running' AND lease_until<now() RETURNING order_id")).rows;for(const row of stale)await c.query("UPDATE billing_orders SET status='review',error='建站Worker中断，待核查' WHERE id=$1 AND status='held'",[row.order_id])});
 const job=(await db.query("UPDATE website_builder_jobs SET status='running',lease_until=now()+interval '60 seconds' WHERE id=(SELECT id FROM website_builder_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")).rows[0];if(!job)return false;
 const pulse=setInterval(()=>db.query("UPDATE website_builder_jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND status='running'",[job.id]).catch(()=>{}),15000);
 let user;
 try{
  const actor=(await db.query('SELECT * FROM users WHERE id=$1',[job.actor_id])).rows[0];if(!actor||actor.disabled)fail('任务发起账号已停用',403);user=accountScope(actor);
  const site=await siteFor(db,user,job.site_id),draft=(await db.query('SELECT * FROM website_builder_drafts WHERE site_id=$1',[site.id])).rows[0];if(draft.revision!==job.base_revision||Number(site.revision)!==Number(job.site_revision))fail('生成期间网站或草稿发生变更，请重新生成',409);
  const knowledge=(await db.query('SELECT category,title,content,terms FROM client_knowledge WHERE client_id=$1 ORDER BY category,title LIMIT 20',[site.client_id])).rows;
  const generated=await generateWebsite(site,job.input,draft.spec||site.content?.builder,knowledge);let image;
  if(job.input.imageCount){const cover=await generateWebsiteHero(generated.spec,site,job.input);image=await store.image(site.id,{...cover,name:'AI建站首页配图.webp'});generated.spec.hero.imageUrl=image.url}
  const spec=normalizeWebsiteSpec(generated.spec);
  await transaction(db,async c=>{const currentActor=(await c.query('SELECT * FROM users WHERE id=$1',[job.actor_id])).rows[0];if(!currentActor||currentActor.disabled)fail('账号权限已变更',403);const locked=await siteFor(c,accountScope(currentActor),site.id,true),current=(await c.query('SELECT * FROM website_builder_drafts WHERE site_id=$1 FOR UPDATE',[site.id])).rows[0],running=(await c.query('SELECT status FROM website_builder_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
   if(running.status!=='running'||current.revision!==job.base_revision||Number(locked.revision)!==Number(job.site_revision))fail('任务状态或内容已变化，请刷新后核查',409);
   if(image)await c.query('INSERT INTO media(id,site_id,name,object_key,url,size,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[image.id,site.id,image.name,image.key,image.url,image.size,image]);
   const revision=await recordDraft(c,site.id,spec,job.input.instruction,user.name,current.revision);await billing.settle(c,job.order_id,user,{jobId:job.id,draftRevision:revision,mode:generated.mode},false,'AI智能建站草稿生成完成');await c.query("UPDATE website_builder_jobs SET status='succeeded',finished_at=now(),lease_until=NULL,error=NULL WHERE id=$1",[job.id]);await audit(c,site.id,user.name,'AI智能建站生成草稿 v'+revision);
  });
 }catch(error){
  const state=(await db.query('SELECT status FROM website_builder_jobs WHERE id=$1',[job.id])).rows[0];if(state?.status!=='review'){
   await billing.failed(db,job.order_id,user||{name:'建站Worker'},error);const order=(await db.query('SELECT status FROM billing_orders WHERE id=$1',[job.order_id])).rows[0];await db.query("UPDATE website_builder_jobs SET status=$1,error=$2,finished_at=now(),lease_until=NULL WHERE id=$3",[order?.status==='review'?'review':'failed',String(error.message).slice(0,500),job.id]);
  }
 }finally{clearInterval(pulse)}return true;
}
