import assert from 'node:assert/strict';
const base='http://127.0.0.1:4318';
async function request(path,body,cookie){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
const admin=await request('/api/login',{username:'admin',password:'Admin123!'});assert.equal(admin.status,200);
const agent=await request('/api/login',{username:'agency',password:'Agency123!'});const visible=await request('/api/state',null,agent.cookie);assert(visible.data.sites.every(s=>s.agency==='a1'));assert.equal((await request('/api/sites/s3/content',{title:'forbidden'},agent.cookie)).status,403);
const first=await request('/api/sites/s1/publish',{},admin.cookie);assert.equal(first.data.status,'live');
const content=await request('/api/state',null,admin.cookie),site=content.data.sites.find(s=>s.id==='s1'),original=site.title;
await request('/api/sites/s1/content',{title:'发布与回滚验证'},admin.cookie);await request('/api/sites/s1/publish',{},admin.cookie);assert((await(await fetch(base+'/preview/s1/')).text()).includes('发布与回滚验证'));
await request('/api/sites/s1/rollback',{id:first.data.id},admin.cookie);assert((await(await fetch(base+'/preview/s1/')).text()).includes(original));
await request('/api/sites/s1/content',{title:original},admin.cookie);
const webhook=async key=>{const r=await fetch(base+'/webhooks/v1/sites/s1/articles',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({external_id:'smoke-test',title:'GEO 接口连通性验证',content:'本地接口测试草稿',status:'draft'})});return {status:r.status,data:await r.json()}};
assert.equal((await webhook('wrong-key')).status,401);const a=await webhook(site.key),b=await webhook(site.key);assert.equal(a.status,202);assert.equal(a.data.article_id,b.data.article_id);await request('/api/sites/s1/articles',{id:a.data.article_id,remove:true},admin.cookie);
const before=await request('/api/state',null,admin.cookie),beforeRelease=before.data.sites.find(s=>s.id==='s1').active;
await request('/api/sites/s1/articles',{title:'富文本验证',summary:'格式与过滤',body:'<h2>小标题</h2><p style="color:#ff0000">彩色正文<strong>加粗</strong></p><table><tr><td>单元格</td></tr></table><script>alert(1)</script><img src="/media/test.webp" onerror="alert(1)">',format:'html',status:'published'},admin.cookie);
const current=await request('/api/state',null,admin.cookie),rich=current.data.articles.find(a=>a.title==='富文本验证');assert(rich.body.includes('<strong>加粗</strong>'));assert(!rich.body.includes('<script'));assert(!rich.body.includes('onerror'));
await request('/api/sites/s1/publish',{},admin.cookie);const html=await(await fetch(base+'/preview/s1/news/'+rich.id+'/')).text();assert(html.includes('<h2>小标题</h2>'));assert(html.includes('<table>'));assert(!html.includes('&lt;h2&gt;'));
await request('/api/sites/s1/articles',{id:rich.id,remove:true},admin.cookie);await request('/api/sites/s1/rollback',{id:beforeRelease},admin.cookie);
for(const file of ['/vendor/jodit.js','/vendor/jodit.css','/editor.js'])assert.equal((await fetch(base+file)).status,200);
console.log('PASS: login, agent isolation, publish, rollback, webhook idempotency, rich HTML preservation, unsafe HTML filtering and editor assets.');
