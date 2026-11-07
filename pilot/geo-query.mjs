import {geoAction,geoSettings} from './geo-workflow.mjs';
import {geoMode} from './geo-provider.mjs';
import {fail,body,json,siteFor} from './common.mjs';
export const geoPlatforms=[{id:1,name:'DeepSeek'},{id:2,name:'豆包'},{id:3,name:'腾讯元宝'},{id:4,name:'通义千问'},{id:5,name:'文心一言'},{id:6,name:'纳米AI'},{id:7,name:'Kimi'},{id:8,name:'智谱AI'}];
export async function geoQueryRoute(db,user,req,res,path){
 if(!path.startsWith('/api/geo-query'))return false;
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'){
  await siteFor(db,user,url.searchParams.get('site'));const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>10000)fail('分页无效');
  const mode=url.searchParams.get('mode')||geoMode();if(!['demo','live'].includes(mode))fail('查询模式无效');const site=url.searchParams.get('site'),rows=(await db.query('SELECT * FROM geo_query_tasks WHERE site_id=$1 AND mode=$2 ORDER BY created_at DESC,id LIMIT 20 OFFSET $3',[site,mode,(page-1)*20])).rows;
  const stats=(await db.query("SELECT count(*)::integer total,count(*) FILTER(WHERE status='hit')::integer hits,count(*) FILTER(WHERE status IN ('queued','processing'))::integer pending,count(DISTINCT brand)::integer brands FROM geo_query_tasks WHERE site_id=$1 AND mode=$2",[site,mode])).rows[0];
  const byPlatform=(await db.query("SELECT platform,count(*)::integer total,count(*) FILTER(WHERE status='hit')::integer hits FROM geo_query_tasks WHERE site_id=$1 AND mode=$2 GROUP BY platform ORDER BY platform",[site,mode])).rows;
  const trend=(await db.query("SELECT (created_at AT TIME ZONE 'Asia/Shanghai')::date::text AS query_day,count(*)::integer total,count(*) FILTER(WHERE status='hit')::integer hits FROM geo_query_tasks WHERE site_id=$1 AND mode=$2 AND created_at>=now()-interval '7 days' GROUP BY query_day ORDER BY query_day",[site,mode])).rows;
  const settings=await geoSettings(db,user);return json(res,{platforms:geoPlatforms.map(p=>({...p,liveSupported:p.id!==7&&settings.enabled_platforms.includes(p.id)})),mode,settings,page,rows:rows.map(({lease_token,lease_until,result,...r})=>r),stats,byPlatform,trend}),true;
 }
 if(req.method!=='POST')fail('方法不允许',405);const input=await body(req);if(input.action){const output=await geoAction(db,user,input);json(res,output,input.action==='submit'?202:200);return true}fail('请先获取报价并确认提交查询',400);
}
