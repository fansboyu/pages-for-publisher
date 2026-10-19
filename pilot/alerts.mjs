import { createHash } from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
async function send(db,incident){
 const url=String(process.env.ALERT_WEBHOOK_URL||'').trim();if(!url)return;
 const key=digest(incident.fingerprint),prior=(await db.query('SELECT last_sent_at FROM alert_deliveries WHERE fingerprint=$1',[key])).rows[0];
 const cooldown=Number(process.env.ALERT_COOLDOWN_MINUTES||60)*60000;if(prior&&Date.now()-new Date(prior.last_sent_at).getTime()<cooldown)return;
 const target=new URL(url);if(!['https:','http:'].includes(target.protocol))throw Error('ALERT_WEBHOOK_URL must use HTTP(S)');
 const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'数告星发布中心',title:incident.title,text:incident.text,occurredAt:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`Alert webhook HTTP ${response.status}`);
 await db.query('INSERT INTO alert_deliveries(fingerprint,last_sent_at) VALUES($1,now()) ON CONFLICT(fingerprint) DO UPDATE SET last_sent_at=now()',[key]);
}
export async function checkAndSendAlerts(db){
 const incidents=[];
 const builds=(await db.query("SELECT b.id,b.error,s.name site_name FROM build_jobs b JOIN sites s ON s.id=b.site_id WHERE b.status='failed' AND b.finished_at>now()-interval '24 hours' ORDER BY b.finished_at DESC LIMIT 20")).rows;
 for(const row of builds)incidents.push({fingerprint:`build:${row.id}`,title:'网站构建失败',text:`网站：${row.site_name}\n任务：${row.id}\n错误：${row.error||'未知错误'}`});
 const tasks=(await db.query("SELECT d.id,d.error,d.server_id,s.name site_name,sv.name server_name FROM deployment_tasks d JOIN sites s ON s.id=d.site_id JOIN servers sv ON sv.id=d.server_id WHERE d.status='failed' AND d.finished_at>now()-interval '24 hours' ORDER BY d.finished_at DESC LIMIT 20")).rows;
 for(const row of tasks)incidents.push({fingerprint:`deploy:${row.id}`,title:'网站部署失败',text:`网站：${row.site_name}\n服务器：${row.server_name}\n任务：${row.id}\n错误：${row.error||'未知错误'}`});
 const offline=(await db.query("SELECT DISTINCT sv.id,sv.name FROM servers sv JOIN sites si ON si.server_id=sv.id WHERE NOT sv.revoked AND (sv.last_seen IS NULL OR sv.last_seen<now()-interval '2 minutes')")).rows;
 for(const row of offline)incidents.push({fingerprint:`offline:${row.id}`,title:'客户 Agent 离线',text:`服务器：${row.name}\nAgent 超过2分钟没有心跳，请检查客户服务器网络和 Agent 服务。`});
 const active=(await db.query("SELECT id FROM servers WHERE NOT revoked AND last_seen>now()-interval '30 seconds'")).rows;
 for(const row of active)await db.query('DELETE FROM alert_deliveries WHERE fingerprint=$1',[digest(`offline:${row.id}`)]);
 for(const incident of incidents)try{await send(db,incident)}catch(error){console.error('告警发送失败:',error.message)}
 return incidents.length;
}
