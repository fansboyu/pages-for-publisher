import {transaction} from './db.mjs';
import {id,siteFor,accountScope,audit,esc,fail} from './common.mjs';
import {safeHtml} from '../html.mjs';
import {saveArticle} from './article-store.mjs';
import {enqueuePublishInTransaction} from './publishing.mjs';
import {generateArticle,generateCover,generateInlineImages,aiMode,aiImageMode} from './ai-article.mjs';
import * as billing from './billing.mjs';
// Durable article tasks: reservation and enqueue share one transaction.
export async function queueArticle(db,user,site,b,demo){
 const jobId=id('aij');
 const reserved=await billing.reserve(db,user,site.id,b,demo,async(c,order)=>{
  const snapshot=await siteFor(c,user,site.id,true);
  snapshot.knowledge=(await c.query('SELECT category,title,content,terms FROM client_knowledge WHERE client_id=$1 ORDER BY category,title LIMIT 20',[snapshot.client_id])).rows;
  await c.query('INSERT INTO ai_article_jobs(id,site_id,actor_id,order_id,input,site_snapshot,demo) VALUES($1,$2,$3,$4,$5,$6,$7)',[jobId,site.id,user.id,order,b,snapshot,demo]);
 },'article');
 if(reserved.replay)return reserved.replay;
 return {jobId,status:'queued'};
}
export async function processArticleJob(db,store){
 // A lost lease may have reached the paid provider. Never resend it automatically.
 await transaction(db,async c=>{
  const lost=(await c.query("UPDATE ai_article_jobs SET status='review',error='AI Worker失联，请核对账单；不会自动重复生成',lease_until=NULL WHERE status='running' AND lease_until<now() RETURNING order_id,result")).rows;
  for(const row of lost)if(!row.result)await c.query("UPDATE billing_orders SET status='review' WHERE id=$1 AND status='held'",[row.order_id]);
 });
 const job=(await db.query("UPDATE ai_article_jobs SET status='running',lease_until=now()+interval '60 seconds' WHERE id=(SELECT id FROM ai_article_jobs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")).rows[0];
 if(!job)return false;
 const pulse=setInterval(()=>db.query("UPDATE ai_article_jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND status='running'",[job.id]).catch(()=>{}),15000);
 let user;
 try{
  const actor=(await db.query('SELECT * FROM users WHERE id=$1 AND NOT disabled',[job.actor_id])).rows[0];if(!actor)fail('生成账号已停用',403);user=accountScope(actor);
  await siteFor(db,user,job.site_id);
  const site=job.site_snapshot,b=job.input,order=(await db.query('SELECT * FROM billing_orders WHERE id=$1',[job.order_id])).rows[0];
  if(order?.status!=='held')fail('账单已不处于预占状态，停止生成',409);
  if(job.demo?(aiMode()!=='demo'||aiImageMode()==='aliyun'):(aiMode()!=='provider'||aiImageMode()!=='aliyun'))fail('AI Worker模型配置与任务报价模式不一致',503);
  b.region=String(b.region||site.region||'');
  b.keywords=String(b.keywords||site.target_keywords||'');
  const generated=await generateArticle(site,b);
  const cover=await generateCover(generated,site,b),inline=await generateInlineImages(generated,site,b);
  const assets=[];
  for(const [index,item] of [cover,...inline].entries()){
   const image=await store.image(site.id,{...item,name:index===0?'AI文章封面.png':`AI正文配图${index}.png`});
   assets.push({...image,mode:item.mode,alt:item.alt||generated.title,sectionIndex:item.sectionIndex});
  }
  const hero=assets[0],bodyHtml=generated.sections.map((section,index)=>
   `<h2>${esc(section.heading)}</h2>${section.html}${assets.slice(1).filter(image=>image.sectionIndex===index).map(image=>
    `<figure><img src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy"><figcaption>${esc(image.alt)}</figcaption></figure>`).join('')}`
  ).join('\n');
  // Article, media records, charge, publish outbox and task completion commit together.
  await transaction(db,async c=>{
   const current=(await c.query('SELECT * FROM users WHERE id=$1 AND NOT disabled FOR SHARE',[job.actor_id])).rows[0];
   if(!current)fail('生成账号已停用',403);
   const actor=accountScope(current);await siteFor(c,actor,site.id,true);
   if(!(await c.query("SELECT 1 FROM ai_article_jobs WHERE id=$1 AND status='running' AND lease_until>now() FOR UPDATE",[job.id])).rowCount)throw Error('AI任务租约超时，等待核查');
   for(const image of assets)await c.query('INSERT INTO media(id,site_id,name,object_key,url,size,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[image.id,site.id,image.name,image.key,image.url,image.size,image]);
   const articleId=await saveArticle(c,site,{title:generated.title,summary:generated.summary,body:bodyHtml,format:'html',status:'published',seo_title:generated.seoTitle,seo_description:generated.seoDescription,seo_keywords:generated.seoKeywords,cover_image_url:hero.url,ai_model:generated.mode==='provider'?process.env.AI_TEXT_MODEL:'demo'});
   const release=await enqueuePublishInTransaction(c,actor,site.id);
   const result={article:{id:articleId,title:generated.title,summary:generated.summary,body:safeHtml(bodyHtml),coverImageUrl:hero.url,inlineImages:assets.slice(1).map(({url,alt,sectionIndex})=>({url,alt,sectionIndex}))},release,mode:generated.mode,imageMode:hero.mode,imageCount:assets.length,billing:{orderId:order.id,amountCents:Number(order.amount_cents)}};
   await audit(c,site.id,actor.name,'AI生成图文并自动发布文章');
   await billing.settle(c,order.id,actor,result);
   await c.query("UPDATE ai_article_jobs SET status='succeeded',result=$1,lease_until=NULL,finished_at=now() WHERE id=$2",[result,job.id]);
  });
 }catch(error){
  const order=(await db.query('SELECT status FROM billing_orders WHERE id=$1',[job.order_id])).rows[0];
  if(order?.status==='held'&&(await db.query("SELECT 1 FROM ai_article_jobs WHERE id=$1 AND status='running'",[job.id])).rowCount)await billing.failed(db,job.order_id,user||{name:'AI Worker'},error);
  const status=(await db.query('SELECT status FROM billing_orders WHERE id=$1',[job.order_id])).rows[0]?.status;
  await db.query("UPDATE ai_article_jobs SET status=$1,error=$2,lease_until=NULL,finished_at=now() WHERE id=$3 AND status='running'",[status==='review'?'review':'failed',String(error.message).slice(0,1000),job.id]);
 }finally{clearInterval(pulse)}
 return true;
}
