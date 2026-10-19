import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkAndSendAlerts } from '../pilot/alerts.mjs';

const received=[],deliveries=new Map(),server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);received.push(JSON.parse(Buffer.concat(chunks)));res.writeHead(200);res.end('{}')});server.listen(0,'127.0.0.1');await once(server,'listening');
process.env.ALERT_WEBHOOK_URL=`http://127.0.0.1:${server.address().port}/alerts`;
const db={async query(sql,params=[]){
 if(sql.includes('FROM build_jobs'))return {rows:[{id:'b-test',site_name:'演示站',error:'模板缺失'}]};
 if(sql.includes('FROM deployment_tasks'))return {rows:[{id:'d-test',site_name:'演示站',server_name:'客户节点',error:'Agent拒绝'}]};
 if(sql.includes('DISTINCT sv.id'))return {rows:[{id:'srv-test',name:'离线节点'}]};
 if(sql.includes('FROM servers WHERE NOT revoked AND last_seen>'))return {rows:[]};
 if(sql.includes('SELECT last_sent_at'))return {rows:deliveries.has(params[0])?[{last_sent_at:new Date()}]:[]};
 if(sql.includes('INSERT INTO alert_deliveries')){deliveries.set(params[0],new Date());return {rows:[]}}
 if(sql.includes('DELETE FROM alert_deliveries')){deliveries.delete(params[0]);return {rows:[]}}
 throw Error('Unexpected query '+sql);
}};
try{assert.equal(await checkAndSendAlerts(db),3);assert.equal(received.length,3);assert.equal(await checkAndSendAlerts(db),3);assert.equal(received.length,3);assert(received.some(x=>x.title==='客户 Agent 离线'));console.log('PASS Worker 告警覆盖构建/部署失败和 Agent 离线，并抑制重复通知')}finally{server.close()}
