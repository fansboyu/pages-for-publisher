import { transaction } from './db.mjs';
import { id,hash,fail,siteFor,audit } from './common.mjs';

export function cents(value){
 const text=String(value??'');if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(text))fail('金额必须是最多两位小数的非负人民币金额');
 const [whole,fraction='']=text.split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(amount>100000000)fail('单次金额不能超过人民币100万元');return amount;
}
function key(value){if(!/^[a-zA-Z0-9_-]{8,100}$/.test(value||''))fail('缺少有效的请求编号，请刷新后重试');return value}
export async function accountFor(db,site){
 const settings=(await db.query('SELECT * FROM billing_client_settings WHERE client_id=$1',[site.client_id])).rows[0];
 const direct=!!settings?.direct,accountId=(direct?'client:':'agency:')+(direct?site.client_id:site.agency_id);
 await db.query('INSERT INTO billing_accounts(id,agency_id,client_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[accountId,direct?null:site.agency_id,direct?site.client_id:null]);
 return accountId;
}
export async function quote(db,user,siteId,input,demo){
 const site=await siteFor(db,user,siteId),prices=(await db.query('SELECT * FROM billing_prices WHERE id=1')).rows[0];
 const inline=Number(input.imageCount??2);if(![1,2,3].includes(inline))fail('正文配图数量仅支持1至3张');
 const snapshot={articleCents:prices.article_cents,imageCents:prices.image_cents,imageCount:inline+1,version:prices.version,demo,textModel:process.env.AI_TEXT_MODEL||'demo',imageModel:process.env.ALIYUN_IMAGE_MODEL||'demo'};
 const amount=demo?0:prices.article_cents+prices.image_cents*(inline+1);
 return {site,amountCents:amount,configured:prices.enabled,demo,price:snapshot};
}
async function ledger(c,account,order,kind,amount,actor,note,requestKey=null){
 const row=(await c.query('SELECT * FROM billing_accounts WHERE id=$1',[account])).rows[0];
 await c.query('INSERT INTO billing_ledger(account_id,order_id,kind,amount_cents,balance_cents,held_cents,actor,note,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[account,order,kind,amount,row.balance_cents,row.held_cents,actor,note,requestKey]);
}
export async function reserve(db,user,siteId,input,demo){
 key(input.requestKey);
 const fingerprint=hash(JSON.stringify(Object.fromEntries(Object.entries(input).filter(([k])=>!['requestKey','quoteVersion','quotedAmountCents'].includes(k)).sort(([a],[b])=>a.localeCompare(b)))));
 return transaction(db,async c=>{
  // Serialise a site's duplicate requests, including concurrent first submissions.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['billing:'+siteId]);
  const q=await quote(c,user,siteId,input,demo);
  const old=(await c.query('SELECT * FROM billing_orders WHERE site_id=$1 AND request_key=$2',[siteId,input.requestKey])).rows[0];
  if(old){if(old.fingerprint!==fingerprint)fail('请求编号已用于不同参数',409);if(old.status==='charged')return {replay:old.result,order:old};if(old.status==='refunded')fail('原生成已退款，请使用新的请求编号重新报价',409);throw Object.assign(Error(old.status==='released'?'上次任务失败，请重新报价后提交新任务':'任务仍处理中或等待对账，请勿重复生成'),{status:409,billingStatus:old.status,billingOrderId:old.id})}
  if(!demo&&!q.configured)fail('请先由直营管理员配置并启用图文价格',503);
  if(!demo&&Number(input.quoteVersion)!==q.price.version)fail('价格已变化，请重新报价',409);
  if(!demo&&Number(input.quotedAmountCents)!==q.amountCents)fail('报价金额已变化，请重新确认',409);
  const account=await accountFor(c,q.site),wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[account])).rows[0];
  if((await c.query("SELECT 1 FROM billing_orders WHERE account_id=$1 AND status IN ('held','review') LIMIT 2",[account])).rowCount>=2)fail('账户已有两项处理中或待对账任务，请稍后再试',429);
  // Client lock protects the monthly budget across its sites.
  await c.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[q.site.client_id]);
  const setting=(await c.query('SELECT monthly_limit_cents FROM billing_client_settings WHERE client_id=$1',[q.site.client_id])).rows[0];
  const used=(await c.query("SELECT COALESCE(sum(amount_cents),0)::text total FROM billing_orders WHERE client_id=$1 AND status IN ('held','review','charged') AND created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'",[q.site.client_id])).rows[0].total;
  if(q.amountCents>0&&setting?.monthly_limit_cents!=null&&Number(used)+q.amountCents>Number(setting.monthly_limit_cents))fail('该客户已达到本月预算',402);
  if(Number(wallet.balance_cents)-Number(wallet.held_cents)<q.amountCents)fail('可用余额不足，请联系直营管理员充值',402);
  const order=id('bill');await c.query('UPDATE billing_accounts SET held_cents=held_cents+$1 WHERE id=$2',[q.amountCents,account]);
  await c.query("INSERT INTO billing_orders(id,account_id,site_id,client_id,actor_id,request_key,fingerprint,amount_cents,price_snapshot,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'held')",[order,account,siteId,q.site.client_id,user.id,input.requestKey,fingerprint,q.amountCents,q.price]);
  await ledger(c,account,order,'hold',q.amountCents,user.name,'图文生成费用预占');return {order:{id:order,amount_cents:q.amountCents},site:q.site};
 });
}
// Caller may use its article transaction so article persistence and charging are atomic.
export async function settle(c,orderId,user,result,release=false,note='图文生成完成'){
 const order=(await c.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
 if(!order||!['held','review'].includes(order.status))fail('账单状态不允许结算',409);
 await c.query('SELECT id FROM billing_accounts WHERE id=$1 FOR UPDATE',[order.account_id]);
 await c.query('UPDATE billing_accounts SET held_cents=held_cents-$1,balance_cents=balance_cents-$2 WHERE id=$3',[order.amount_cents,release?0:order.amount_cents,order.account_id]);
 await c.query('UPDATE billing_orders SET status=$1,result=$2,finished_at=now() WHERE id=$3',[release?'released':'charged',result,orderId]);
 await ledger(c,order.account_id,orderId,release?'release':'charge',order.amount_cents,user.name,note);
}
export async function failed(db,orderId,user,error){
 const uncertain=/timeout|超时|fetch failed|network|socket|ECONN|abort/i.test(String(error.message));
 if(uncertain){await db.query("UPDATE billing_orders SET status='review',error=$2 WHERE id=$1 AND status='held'",[orderId,String(error.message).slice(0,500)]);return}
 await transaction(db,async c=>{await settle(c,orderId,user,null,true,'生成失败，释放费用；上游成本由平台承担');await c.query('UPDATE billing_orders SET error=$1 WHERE id=$2',[String(error.message).slice(0,500),orderId])});
}
export async function dashboard(db,user){
 const admin=user.role==='admin',agency=admin?null:user.agency_id;
 await db.query("INSERT INTO billing_accounts(id,agency_id) SELECT 'agency:'||id,id FROM agencies WHERE ($1::text IS NULL OR id=$1) ON CONFLICT DO NOTHING",[agency]);
 const accounts=(await db.query('SELECT a.*,COALESCE(g.name,c.name) name FROM billing_accounts a LEFT JOIN agencies g ON g.id=a.agency_id LEFT JOIN clients c ON c.id=a.client_id WHERE ($1::text IS NULL OR a.agency_id=$1 OR c.agency_id=$1) ORDER BY a.id',[agency])).rows;
 const ids=accounts.map(a=>a.id),orders=(await db.query('SELECT id,account_id,site_id,client_id,amount_cents,status,error,created_at FROM billing_orders WHERE account_id=ANY($1::text[]) ORDER BY created_at DESC LIMIT 100',[ids])).rows;
 const entries=(await db.query('SELECT * FROM billing_ledger WHERE account_id=ANY($1::text[]) ORDER BY id DESC LIMIT 100',[ids])).rows;
 const clients=(await db.query(`SELECT c.id,c.name,c.agency_id,COALESCE(s.direct,false) direct,s.monthly_limit_cents,COALESCE(u.spent,0)::text spent_cents,COALESCE(u.held,0)::text reserved_cents FROM clients c LEFT JOIN billing_client_settings s ON s.client_id=c.id LEFT JOIN LATERAL (SELECT sum(CASE WHEN status='charged' THEN amount_cents ELSE 0 END) spent,sum(CASE WHEN status IN ('held','review') THEN amount_cents ELSE 0 END) held FROM billing_orders WHERE client_id=c.id AND created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') u ON true WHERE ($1::text IS NULL OR c.agency_id=$1) ORDER BY c.name`,[agency])).rows;
 return {accounts,orders,entries,clients,prices:(await db.query('SELECT * FROM billing_prices WHERE id=1')).rows[0],currency:'CNY'};
}
export async function manage(db,user,b){
 if(user.role!=='admin')fail('仅直营管理员可修改资金和计费规则',403);
 if(b.action==='prices'){
  const article=cents(b.article),image=cents(b.image),video=cents(b.video||'0');if(typeof b.enabled!=='boolean')fail('价格开关无效');
  await transaction(db,async c=>{await c.query('UPDATE billing_prices SET article_cents=$1,image_cents=$2,video_cents=$3,enabled=$4,version=version+1 WHERE id=1',[article,image,video,b.enabled]);await audit(c,null,user.name,'更新人民币生成价格')});return {ok:true};
 }
 if(b.action==='recharge'){
  key(b.requestKey);const amount=cents(b.amount),note=String(b.note||'').trim();if(!amount||!note||note.length>300)fail('请填写正数充值金额及300字以内备注');
  return transaction(db,async c=>{const wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[b.account])).rows[0];if(!wallet)fail('结算账户不存在',404);
   const old=(await c.query('SELECT amount_cents,note FROM billing_ledger WHERE account_id=$1 AND request_key=$2',[b.account,b.requestKey])).rows[0];if(old){if(Number(old.amount_cents)!==amount||old.note!==note)fail('充值请求编号已用于其他金额或备注',409);return {ok:true,replay:true}}
   if(Number(wallet.balance_cents)+amount>100000000)fail('账户余额超过上限');await c.query('UPDATE billing_accounts SET balance_cents=balance_cents+$1 WHERE id=$2',[amount,b.account]);await ledger(c,b.account,null,'recharge',amount,user.name,note,b.requestKey);return {ok:true};});
 }
 if(b.action==='client'){
  const limit=b.limit===''||b.limit==null?null:cents(b.limit);if(typeof b.direct!=='boolean')fail('结算方式无效');
  await transaction(db,async c=>{if(!(await c.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[b.client])).rowCount)fail('客户不存在',404);
   if((await c.query("SELECT 1 FROM billing_orders WHERE client_id=$1 AND status IN ('held','review')",[b.client])).rowCount)fail('客户有待结算任务，暂不能修改预算或结算方式',409);
   await c.query('INSERT INTO billing_client_settings(client_id,direct,monthly_limit_cents) VALUES($1,$2,$3) ON CONFLICT(client_id) DO UPDATE SET direct=$2,monthly_limit_cents=$3',[b.client,b.direct,limit]);
   if(b.direct)await c.query("INSERT INTO billing_accounts(id,client_id) VALUES('client:'||$1,$1) ON CONFLICT DO NOTHING",[b.client]);await audit(c,null,user.name,'更新客户人民币结算方式与月预算');});return {ok:true};
 }
 if(b.action==='resolve'){
  const note=String(b.note||'').trim();if(!note||note.length>300)fail('请填写对账依据，最多300字');if(b.decision!=='release')fail('仅支持核查后释放，成功生成由原任务自动结算');
  await transaction(db,async c=>{const order=(await c.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE',[b.order])).rows[0];if(!order||!['review','held'].includes(order.status))fail('任务不处于待对账状态',409);if(order.status==='held'&&Date.now()-new Date(order.created_at).getTime()<3600000)fail('任务可能仍在执行，请等待至少一小时并核查供应商结果');await settle(c,b.order,user,null,true,'人工核查后释放：'+note)});return {ok:true};
 }
 if(b.action==='refund'){
  const note=String(b.note||'').trim();if(!note||note.length>300)fail('请填写退款依据，最多300字');
  await transaction(db,async c=>{const order=(await c.query("SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE",[b.order])).rows[0];if(!order||order.status!=='charged')fail('只能对已扣款任务退款，不能重复退款',409);
   const wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[order.account_id])).rows[0];if(Number(wallet.balance_cents)+Number(order.amount_cents)>100000000)fail('退款后账户余额超过上限');
   await c.query('UPDATE billing_accounts SET balance_cents=balance_cents+$1 WHERE id=$2',[order.amount_cents,order.account_id]);await c.query("UPDATE billing_orders SET status='refunded' WHERE id=$1",[order.id]);await ledger(c,order.account_id,order.id,'refund',order.amount_cents,user.name,'人工全额退款：'+note);});return {ok:true};
 }
 fail('计费操作无效');
}
