import { transaction } from './db.mjs';
import { id,hash,fail,body,json,siteFor,accountScope,audit } from './common.mjs';
import { accountFor } from './billing.mjs';
import { safeHtml } from '../html.mjs';
import { externalMode,providerInfo,channelPage,channelById,submitExternal,queryExternal } from './external-provider.mjs';

async function ledger(c,account,order,kind,amount,actor,note){const wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1',[account])).rows[0];await c.query('INSERT INTO billing_ledger(account_id,order_id,kind,amount_cents,balance_cents,held_cents,actor,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[account,order,kind,amount,wallet.balance_cents,wallet.held_cents,actor,note])}
export async function externalRoute(db,user,req,res,path){
 if(!path.startsWith('/api/external/'))return false;
 const url=new URL(req.url,'http://localhost'),action=path.slice('/api/external/'.length);
 if(action==='channels'&&req.method==='GET'){
  const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||12),search=String(url.searchParams.get('search')||'').slice(0,100),industry=String(url.searchParams.get('industry')||'').slice(0,50),region=String(url.searchParams.get('region')||'').slice(0,50);
  if(!Number.isInteger(page)||page<1||page>10000||![12,24,48].includes(pageSize))fail('分页参数无效');
  const filters=Object.fromEntries(Array.from({length:9},(_,i)=>['field_'+(i+1),String(url.searchParams.get('field_'+(i+1))||'').slice(0,20)]));if(Object.values(filters).some(v=>v&&!/^\d{4,6}$/.test(v)))fail('筛选参数无效');const sort=url.searchParams.get('sort')||'';if(!['','asc','desc'].includes(sort))fail('排序参数无效');const params={page,pageSize,search,industry,region,filters,sort},key=hash(JSON.stringify(['facets-v1',externalMode(),params])),cached=(await db.query('SELECT payload FROM external_channel_cache WHERE cache_key=$1 AND expires_at>now()',[key])).rows[0];
  if(cached){json(res,{...cached.payload,cached:true,provider:providerInfo()});return true}
  const result=await channelPage(params);await db.query("INSERT INTO external_channel_cache VALUES($1,$2,now()+interval '5 minutes') ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",[key,result]);await db.query('DELETE FROM external_channel_cache WHERE expires_at<now()');json(res,{...result,cached:false,provider:providerInfo()});return true;
 }
 if(action==='batches'&&req.method==='GET'){
  const site=await siteFor(db,user,url.searchParams.get('site'));
  const rows=(await db.query('SELECT b.id,b.mode,b.status,b.created_at,b.billing_id,q.snapshot,o.status billing_status FROM external_publish_batches b JOIN external_publish_quotes q ON q.id=b.quote_id JOIN billing_orders o ON o.id=b.billing_id WHERE b.site_id=$1 ORDER BY b.created_at DESC LIMIT 30',[site.id])).rows;
  const orders=(await db.query('SELECT * FROM external_publish_orders WHERE batch_id=ANY($1::text[]) ORDER BY id',[rows.map(b=>b.id)])).rows;
  json(res,{provider:providerInfo(),batches:rows.map(b=>({id:b.id,mode:b.mode,status:b.status,createdAt:b.created_at,billingId:b.billing_id,billingStatus:b.billing_status,title:b.snapshot.article.title,amountCents:b.snapshot.amountCents,orders:orders.filter(o=>o.batch_id===b.id).map(o=>({id:o.id,channel:o.channel.name,status:o.status,error:o.error,resultUrl:o.result_url,providerId:o.provider_order_id,amountCents:o.amount_cents}))}))});return true;
 }
 if(req.method!=='POST')fail('方法不允许',405);const input=await body(req);
 if(action==='quote'){
  const site=await siteFor(db,user,input.site),article=(await db.query('SELECT id,title,body,format,cover_image_url FROM articles WHERE id=$1 AND site_id=$2',[input.article,site.id])).rows[0];if(!article||!article.title||!article.body)fail('请选择该网站一篇有正文的文章');
  if(!Array.isArray(input.channels)||input.channels.length<1||input.channels.length>10)fail('每批请选择1至10个渠道');const ids=[...new Set(input.channels.map(String))].sort();if(ids.length!==input.channels.length)fail('渠道不能重复');
  const channels=await Promise.all(ids.map(async channelId=>{const cached=(await db.query("SELECT payload FROM external_channel_cache WHERE expires_at>now() AND payload->>'mode'='live' AND EXISTS (SELECT 1 FROM jsonb_array_elements(payload->'items') item WHERE item->>'id'=$1) ORDER BY expires_at DESC LIMIT 1",[channelId])).rows[0];return channelById(channelId,cached?.payload?.page||1,cached?.payload?.pageSize||48)})),quote=id('eq');
  const amountCents=channels.reduce((n,c)=>n+c.costCents,0),mock=externalMode()==='mock';const snapshot={mode:externalMode(),article:{...article,body:article.format==='html'?safeHtml(article.body):article.body},channels,amountCents:mock?0:amountCents,costReferenceCents:amountCents,note:mock?'模拟模式免费；参考资源价格不是正式报价。':'供应商目录价格，仅供确认；正式投稿将按供应商实际规则收费。'};
  await db.query("INSERT INTO external_publish_quotes VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes')",[quote,site.id,user.id,article.id,snapshot]);json(res,{quoteId:quote,expiresIn:120,...snapshot});return true;
 }
 if(action==='batches'){
  if(!/^[\w-]{8,100}$/.test(input.requestKey||''))fail('请求编号无效');
  const result=await transaction(db,async c=>{
   const q=(await c.query('SELECT * FROM external_publish_quotes WHERE id=$1',[input.quoteId])).rows[0];if(!q||q.actor_id!==user.id)fail('报价不存在',404);await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['billing:'+q.site_id]);const site=await siteFor(c,user,q.site_id,true);
   const previous=(await c.query('SELECT id,quote_id FROM external_publish_batches WHERE site_id=$1 AND request_key=$2',[site.id,input.requestKey])).rows[0];if(previous){if(previous.quote_id!==q.id)fail('请求编号已用于其他报价',409);return {id:previous.id,replay:true}}
   if(new Date(q.expires_at)<new Date())fail('报价过期，请重新报价',409);if(q.snapshot.mode!==externalMode()||!['mock','live'].includes(externalMode()))fail('供应商模式已变更，暂不可投稿',503);
   if((await c.query('SELECT 1 FROM external_publish_batches WHERE quote_id=$1',[q.id])).rowCount)fail('该报价已提交，请查看订单',409);
   const account=await accountFor(c,site),wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[account])).rows[0];await c.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[site.client_id]);const amount=q.snapshot.amountCents;
   if(externalMode()==='mock'&&amount!==0)fail('模拟订单金额异常',503);if(Number(wallet.balance_cents)-Number(wallet.held_cents)<amount)fail('可用余额不足',402);
   const batch=id('eb'),bill=id('bill');await c.query('UPDATE billing_accounts SET held_cents=held_cents+$1 WHERE id=$2',[amount,account]);
   await c.query("INSERT INTO billing_orders(id,account_id,site_id,client_id,actor_id,request_key,fingerprint,amount_cents,price_snapshot,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'held')",[bill,account,site.id,site.client_id,user.id,'external-'+input.requestKey,hash(q.id),amount,{service:'external',mode:q.snapshot.mode,channels:q.snapshot.channels.length}]);await ledger(c,account,bill,'hold',amount,user.name,'外部发布模拟批次预占');
   await c.query('INSERT INTO external_publish_batches(id,site_id,actor_id,quote_id,request_key,billing_id,mode) VALUES($1,$2,$3,$4,$5,$6,$7)',[batch,site.id,user.id,q.id,input.requestKey,bill,q.snapshot.mode]);
  for(const channel of q.snapshot.channels)await c.query('INSERT INTO external_publish_orders(id,batch_id,channel,amount_cents) VALUES($1,$2,$3,$4)',[id('eo'),batch,channel,externalMode()==='mock'?0:channel.costCents]);await audit(c,site.id,user.name,'提交外部发布批次 '+batch);return {id:batch,replay:false};
  });json(res,result,202);return true;
 }
 fail('外部发布操作不存在',404);
}

async function reconcileBatches(db){
 const batches=(await db.query("SELECT b.*,o.status billing_status FROM external_publish_batches b JOIN billing_orders o ON o.id=b.billing_id WHERE b.status IN ('queued','processing','review') ORDER BY b.created_at LIMIT 100")).rows;
 for(const batch of batches)await transaction(db,async c=>{
  await c.query('SELECT id FROM external_publish_batches WHERE id=$1 FOR UPDATE',[batch.id]);const bill=(await c.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE',[batch.billing_id])).rows[0];
  if(['released','refunded'].includes(bill.status)){await c.query("UPDATE external_publish_orders SET status='failed',error='管理员已释放模拟账单，不再继续执行' WHERE batch_id=$1 AND status IN ('queued','submitting','processing','review')",[batch.id]);await c.query("UPDATE external_publish_batches SET status='failed' WHERE id=$1",[batch.id]);return}
  const orders=(await c.query('SELECT status,amount_cents FROM external_publish_orders WHERE batch_id=$1',[batch.id])).rows;
  if(orders.some(o=>o.status==='review')){await c.query("UPDATE external_publish_batches SET status='review' WHERE id=$1",[batch.id]);await c.query("UPDATE billing_orders SET status='review',error='外部发布存在结果不明任务，禁止重复提交' WHERE id=$1 AND status='held'",[bill.id]);return}
  if(orders.some(o=>['queued','submitting','processing'].includes(o.status))){await c.query("UPDATE external_publish_batches SET status='processing' WHERE id=$1",[batch.id]);return}
  if(!['held','review'].includes(bill.status))return;
  const charge=orders.filter(o=>o.status==='published').reduce((n,o)=>n+o.amount_cents,0),held=Number(bill.amount_cents),successful=orders.filter(o=>o.status==='published').length;
  await c.query('SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE',[bill.account_id]);await c.query('UPDATE billing_accounts SET held_cents=held_cents-$1,balance_cents=balance_cents-$2 WHERE id=$3',[held,charge,bill.account_id]);
  await c.query("UPDATE billing_orders SET status=$1,amount_cents=$2,result=$3,finished_at=now() WHERE id=$4",[successful?'charged':'released',successful?charge:held,{batch:batch.id,successful,failed:orders.length-successful,quotedCents:held},bill.id]);
  if(successful)await ledger(c,bill.account_id,bill.id,'charge',charge,'外发Worker','外部发布模拟成功结算');if(held>charge||!successful)await ledger(c,bill.account_id,bill.id,'release',held-charge,'外发Worker','外部发布失败部分释放');
  await c.query('UPDATE external_publish_batches SET status=$1 WHERE id=$2',[successful===orders.length?'succeeded':successful?'partial':'failed',batch.id]);
 });
}
export async function processExternalJob(db){
 await db.query("UPDATE external_publish_orders SET status='review',error='提交执行器中断，结果不明；不自动重发',lease_until=NULL WHERE status='submitting' AND lease_until<now()");
 const order=await transaction(db,async c=>{const row=(await c.query("SELECT o.*,b.site_id,b.actor_id,b.mode,q.snapshot FROM external_publish_orders o JOIN external_publish_batches b ON b.id=o.batch_id JOIN external_publish_quotes q ON q.id=b.quote_id JOIN billing_orders bill ON bill.id=b.billing_id WHERE o.status IN ('queued','processing') AND o.next_poll_at<=now() AND bill.status IN ('held','review') ORDER BY o.next_poll_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;await c.query("UPDATE external_publish_orders SET status='submitting',lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1",[row.id]);return row});
 if(!order){await reconcileBatches(db);return false}
 try{
  const actor=(await db.query('SELECT * FROM users WHERE id=$1',[order.actor_id])).rows[0];if(!actor||actor.disabled)throw Error('账号停用，请管理员核查订单');await siteFor(db,accountScope(actor),order.site_id);
  if(order.mode!==externalMode())throw Error('供应商模式变更，暂停执行并核查');
  const result=order.status==='queued'?await submitExternal(order):await queryExternal(order);
  if(!['failed','processing','published'].includes(result.status))throw Error('无法识别供应商状态');
  if(result.url&&!/^https:\/\//.test(result.url))throw Error('结果链接无效');
  await db.query("UPDATE external_publish_orders SET status=$1,provider_order_id=COALESCE($2,provider_order_id),result_url=$3,error=$4,lease_until=NULL,next_poll_at=now()+interval '2 seconds',updated_at=now() WHERE id=$5 AND status='submitting'",[result.status,result.providerId||null,result.url||null,result.error||null,order.id]);
 }catch(error){await db.query("UPDATE external_publish_orders SET status='review',error=$1,lease_until=NULL,updated_at=now() WHERE id=$2 AND status='submitting'",[String(error.message).slice(0,400),order.id])}
 await reconcileBatches(db);return true;
}
