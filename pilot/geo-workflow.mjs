import {transaction} from './db.mjs';
import {id,hash,fail,siteFor,audit} from './common.mjs';
import {accountFor,cents,settle} from './billing.mjs';
import {geoMode,geoConfigured,geoProvider,archiveGeoScreenshot,publicUrl} from './geo-provider.mjs';
export const livePlatforms=[1,2,3,4,5,6,8];
export async function geoSettings(db,user){const p=(await db.query('SELECT * FROM geo_query_prices WHERE id=1')).rows[0];return {...p,mode:geoMode(),liveAvailable:geoConfigured()&&p.enabled&&p.unit_cents>0,screenshotAccess:'public',canManage:user.role==='admin'}}
export function geoInput(input,mode){const brand=String(input.brand||'').trim(),question=String(input.question||'').trim();if(!brand||brand.length>100||!question||question.length>1000)fail('请填写品牌词（最多100字）和问题（最多1000字）');if(!Array.isArray(input.platforms)||!input.platforms.length||input.platforms.length>8||new Set(input.platforms).size!==input.platforms.length||input.platforms.some(p=>!Number.isInteger(p)||!(mode==='live'?livePlatforms:[1,2,3,4,5,6,7,8]).includes(p)))fail('请选择有效平台；Kimi正式查询尚未验收');return {brand,question,platforms:[...input.platforms].sort((a,b)=>a-b)}}
export async function geoAction(db,user,input){
 if(input.action==='prices'){if(user.role!=='admin')fail('仅直营管理员可配置GEO单价',403);const amount=cents(input.unit);if(typeof input.enabled!=='boolean'||(input.enabled&&!amount))fail('启用正式计费须设置正数单价');const platforms=input.platforms;if(platforms!==undefined&&(!Array.isArray(platforms)||new Set(platforms).size!==platforms.length||platforms.some(p=>!livePlatforms.includes(p))||(input.enabled&&!platforms.length)))fail('请选择有效的正式查询平台');await transaction(db,async c=>{await c.query('UPDATE geo_query_prices SET unit_cents=$1,enabled=$2,enabled_platforms=COALESCE($3,enabled_platforms),version=version+1 WHERE id=1',[amount,input.enabled,platforms||null]);await audit(c,null,user.name,'更新GEO查询金额单价')});return {ok:true}}
 const site=await siteFor(db,user,input.site);
 if(input.action==='quote'){
  const mode=input.mode==='demo'?'demo':input.mode==='live'?'live':null;if(!mode)fail('请选择查询模式');const fields=geoInput(input,mode),prices=await geoSettings(db,user);if(mode==='live'&&!prices.liveAvailable)fail('请配置GEO正式模式密钥并启用查询单价',503);
  if(mode==='live'&&fields.platforms.some(p=>!prices.enabled_platforms.includes(p)))fail('所选平台尚未开放',409);const unit=mode==='demo'?0:prices.unit_cents,snapshot={...fields,mode,unitCents:unit,amountCents:unit*fields.platforms.length,priceVersion:prices.version};const quote=id('gquote');await db.query('INSERT INTO geo_query_quotes(id,site_id,actor_id,snapshot) VALUES($1,$2,$3,$4)',[quote,site.id,user.id,snapshot]);return {quoteId:quote,...snapshot,expiresIn:120};
 }
 if(input.action==='submit'){
  if(!/^[\w-]{8,100}$/.test(input.requestKey||''))fail('请求编号无效');
  return transaction(db,async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['billing:'+site.id]);await siteFor(c,user,site.id,true);
   const q=(await c.query('SELECT * FROM geo_query_quotes WHERE id=$1 FOR UPDATE',[input.quoteId])).rows[0];if(!q||q.site_id!==site.id||q.actor_id!==user.id)fail('报价不存在',404);
   const s=q.snapshot,old=(await c.query('SELECT * FROM geo_query_tasks WHERE site_id=$1 AND request_key=$2 ORDER BY platform',[site.id,input.requestKey])).rows;
   if(old.length){if(old.some(t=>t.quote_id!==q.id||t.actor_id!==user.id))fail('请求编号已被使用',409);return {rows:old,replay:true}}
   if(q.submitted_key)fail('报价已提交，请查看查询记录',409);if(new Date(q.expires_at)<new Date())fail('报价已过期，请重新报价',409);
   const p=(await c.query('SELECT * FROM geo_query_prices WHERE id=1 FOR SHARE')).rows[0];if(s.mode==='live'&&(!geoConfigured()||!p.enabled||p.version!==s.priceVersion||p.unit_cents!==s.unitCents||s.platforms.some(id=>!p.enabled_platforms.includes(id))))fail('配置或价格变化，请重新报价',409);
   if(input.confirmedAmountCents!==s.amountCents)fail('请确认报价金额',409);
   const account=await accountFor(c,site),wallet=(await c.query('SELECT * FROM billing_accounts WHERE id=$1 FOR UPDATE',[account])).rows[0];await c.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE',[site.client_id]);
   if((await c.query("SELECT count(*)::integer n FROM geo_query_tasks t JOIN billing_orders b ON b.id=t.billing_id WHERE b.account_id=$1 AND t.status IN ('queued','processing','review')",[account])).rows[0].n>=32)fail('待处理查询较多，请稍后再试',429);
   const limit=(await c.query('SELECT monthly_limit_cents FROM billing_client_settings WHERE client_id=$1',[site.client_id])).rows[0]?.monthly_limit_cents;
   const used=Number((await c.query("SELECT COALESCE(sum(amount_cents),0) used FROM billing_orders WHERE client_id=$1 AND status IN ('held','review','charged') AND created_at>=date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'",[site.client_id])).rows[0].used);
   if(limit!=null&&used+s.amountCents>Number(limit))fail('超出客户月预算',402);if(Number(wallet.balance_cents)-Number(wallet.held_cents)<s.amountCents)fail('可用余额不足',402);
   const rows=[];for(const platform of s.platforms){const bill=id('bill'),task=id('gq');await c.query('UPDATE billing_accounts SET held_cents=held_cents+$1 WHERE id=$2',[s.unitCents,account]);
    await c.query("INSERT INTO billing_orders(id,account_id,site_id,client_id,actor_id,request_key,fingerprint,amount_cents,price_snapshot,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'held')",[bill,account,site.id,site.client_id,user.id,'geo:'+input.requestKey+':'+platform,hash(q.id+':'+platform),s.unitCents,{service:'geo-query',mode:s.mode,platform,unitCents:s.unitCents,version:s.priceVersion}]);
    await c.query("INSERT INTO billing_ledger(account_id,order_id,kind,amount_cents,balance_cents,held_cents,actor,note) SELECT id,$2,'hold',$3,balance_cents,held_cents,$4,'GEO查询费用预占' FROM billing_accounts WHERE id=$1",[account,bill,s.unitCents,user.name]);
    rows.push((await c.query("INSERT INTO geo_query_tasks(id,site_id,actor_id,request_key,brand,question,platform,mode,status,quote_id,billing_id,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,'submit') RETURNING *",[task,site.id,user.id,input.requestKey,s.brand,s.question,platform,s.mode,q.id,bill])).rows[0]);
   }await c.query('UPDATE geo_query_quotes SET submitted_key=$1 WHERE id=$2',[input.requestKey,q.id]);await audit(c,site.id,user.name,'创建GEO查询批次 '+q.id);return {rows,mode:s.mode};
  });
 }
 if(input.action==='retry-archive'){const t=(await db.query('SELECT * FROM geo_query_tasks WHERE id=$1 AND site_id=$2',[input.task,site.id])).rows[0];if(!t||t.archive_state!=='failed')fail('无可重试的截图归档');await db.query("UPDATE geo_query_tasks SET archive_state='pending',archive_attempts=0,phase='archive',next_run_at=now(),archive_error=NULL WHERE id=$1 AND archive_state='failed'",[t.id]);return {ok:true}}
 fail('GEO操作无效');
}
const message=e=>String(e.message||'GEO任务失败').replaceAll(process.env.XIAOQINGWA_API_KEY||'__NO_SECRET__','[redacted]').slice(0,300);
export async function processGeoJob(db,{provider=geoProvider,archive,store}={}){
 // A crashed submit may already have charged the supplier. Never submit it twice.
 await transaction(db,async c=>{const stale=(await c.query("SELECT * FROM geo_query_tasks WHERE phase='submitting' AND lease_until<now() FOR UPDATE SKIP LOCKED")).rows;for(const t of stale){await c.query("UPDATE geo_query_tasks SET phase='review',status='review',error='提交执行器中断，结果不明，禁止自动重发',lease_until=NULL,lease_token=NULL WHERE id=$1",[t.id]);await c.query("UPDATE billing_orders SET status='review',error='GEO提交中断待核查' WHERE id=$1 AND status='held'",[t.billing_id])}});
 const task=await transaction(db,async c=>{const t=(await c.query("SELECT t.* FROM geo_query_tasks t WHERE phase IN ('submit','poll','archive') AND next_run_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!t)return null;t.token=id('lease');await c.query("UPDATE geo_query_tasks SET phase=CASE WHEN phase='submit' THEN 'submitting' ELSE phase END,lease_until=now()+interval '120 seconds',lease_token=$2,attempts=attempts+1 WHERE id=$1",[t.id,t.token]);return t});if(!task)return false;
 async function finish(result){await transaction(db,async c=>{const t=(await c.query('SELECT * FROM geo_query_tasks WHERE id=$1 FOR UPDATE',[task.id])).rows[0];if(t.lease_token!==task.token)return;const b=(await c.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE',[t.billing_id])).rows[0];if(['held','review'].includes(b.status))await settle(c,b.id,{name:'GEO Worker'},{task:t.id,providerId:t.provider_id,status:result.status},result.status===3,result.status===3?'GEO供应商确认失败退款，释放预占':'GEO查询完成（命中或未命中），扣款');else if(b.status!=='charged')throw Error('账单已被核查释放，需人工核对结果');const pending=result.status!==3&&!!result.screenshotUrl;await c.query("UPDATE geo_query_tasks SET status=$2,phase=$3,result=$4,matched_word=$5,share_url=$6,error=$7,archive_state=$8,completed_at=now(),lease_until=NULL,next_run_at=now() WHERE id=$1",[t.id,result.status===3?'failed':result.status===1?'hit':'miss',pending?'archive':'done',result,result.matchedWord||null,publicUrl(result.shareUrl),result.status===3?'供应商确认查询失败已退款':null,pending?'pending':'unavailable'])})}
 try{
  const bill=(await db.query('SELECT status FROM billing_orders WHERE id=$1',[task.billing_id])).rows[0];if(!bill||!['held','review','charged'].includes(bill.status))throw Object.assign(Error('账单已释放，停止自动执行并核查'),{review:true});
  if(task.phase==='submit'){
   const actor=(await db.query('SELECT * FROM users WHERE id=$1',[task.actor_id])).rows[0];if(!actor||actor.disabled)throw Object.assign(Error('账号已停用，未发起查询'),{definitive:true});try{await siteFor(db,actor,task.site_id)}catch{throw Object.assign(Error('账号已失去网站权限，未发起查询'),{definitive:true})}
   const providerId=task.mode==='demo'?'demo-'+task.id:await provider.submit(task);
   await db.query("UPDATE geo_query_tasks SET provider_id=$2,phase='poll',status='processing',lease_until=NULL,next_run_at=now()+interval '15 seconds' WHERE id=$1 AND lease_token=$3",[task.id,providerId,task.token]);
  }else if(task.phase==='poll'){
   const result=task.mode==='demo'?{status:task.platform%2?1:2,matchedWord:task.platform%2?task.brand:'',shareUrl:'',screenshotUrl:''}:await provider.poll(task);
   if(![0,1,2,3].includes(result.status))throw Error('无法识别GEO状态');
   if(result.status===0){if(Date.now()-new Date(task.created_at).getTime()>86400000)throw Object.assign(Error('供应商查询超过24小时，请人工核查'),{review:true});await db.query("UPDATE geo_query_tasks SET lease_until=NULL,next_run_at=now()+interval '30 seconds' WHERE id=$1 AND lease_token=$2",[task.id,task.token])}else await finish(result);
  }else if(task.phase==='archive'){
   const image=await (archive||((t)=>archiveGeoScreenshot(t,store)))(task);if(!image?.url)throw Error('截图归档未返回地址');await db.query("UPDATE geo_query_tasks SET screenshot_url=$2,archive_state='saved',archive_error=NULL,phase='done',lease_until=NULL WHERE id=$1 AND lease_token=$3",[task.id,image.url,task.token]);
  }
 }catch(e){
  if(task.phase==='archive'){const tries=task.archive_attempts+1;await db.query("UPDATE geo_query_tasks SET archive_attempts=$2,archive_error=$3,archive_state=$4,phase=$5,lease_until=NULL,next_run_at=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$6",[task.id,tries,message(e),tries>=5?'failed':'pending',tries>=5?'done':'archive',task.token])}
  else if(task.phase==='submit'&&e.definitive){await finish({status:3,matchedWord:'',screenshotUrl:'',shareUrl:''});await db.query('UPDATE geo_query_tasks SET error=$2 WHERE id=$1',[task.id,message(e)])}
  else if(task.phase==='poll'&&!e.review&&task.attempts<100){await db.query("UPDATE geo_query_tasks SET error=$2,lease_until=NULL,next_run_at=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$3",[task.id,message(e),task.token])}
  else await transaction(db,async c=>{await c.query("UPDATE geo_query_tasks SET status='review',phase='review',error=$2,lease_until=NULL WHERE id=$1 AND lease_token=$3",[task.id,message(e),task.token]);await c.query("UPDATE billing_orders SET status='review',error=$2 WHERE id=$1 AND status='held'",[task.billing_id,message(e)])});
 }return true;
}
