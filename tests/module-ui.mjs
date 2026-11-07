import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {localEnv} from '../scripts/pilot-env.mjs';
import {migrate,project} from '../pilot/db.mjs';
import {seed} from '../pilot/seed.mjs';

// Browser dependency is supplied by the developer/test runtime, not the application image.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const env=await localEnv(),name='module_ui_'+Date.now(),maintenance=new pg.Pool({connectionString:env.DATABASE_URL});
await maintenance.query(`CREATE DATABASE "${name}"`);
const url=new URL(env.DATABASE_URL);url.pathname='/'+name;
const db=new pg.Pool({connectionString:url.href}),root=join(project,'storage','module-ui-tests',name),children=[];
await fs.mkdir(root,{recursive:true});
const runtime={...process.env,...env,DATABASE_URL:url.href,DEMO_MODE:'true',COOKIE_SECURE:'false',EXTERNAL_PUBLISH_MODE:'mock',GEO_QUERY_MODE:'demo',STORAGE_DRIVER:'local',ARCHIVE_STORAGE_DRIVER:'local',DATA_ROOT:root,AI_TEXT_API_KEY:'',AI_API_KEY:'',AI_TEXT_MODEL:'',ALIYUN_IMAGE_API_KEY:'',AI_IMAGE_API_KEY:'',DASHSCOPE_API_KEY:'',ALIYUN_IMAGE_MODEL:''};
let browser;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<100;i++){try{if(await fn())return}catch{}await delay(100)}throw Error('Local test startup timed out')}
function start(file){const child=spawn(process.execPath,[file],{cwd:project,env:runtime,windowsHide:true,stdio:['ignore','ignore','pipe']});child.stderr.on('data',()=>{});children.push(child);return child}
async function login(page,user='admin',password='Admin123!'){
 await page.goto(runtime.PUBLIC_BASE_URL);
 await page.locator('#login input[name=username]').fill(user);await page.locator('#login input[name=password]').fill(password);
 await page.locator('#login button').click();await page.locator('.workspace-home').waitFor();
}
const selector=view=>view==='external'?'[data-external-section="media"]':`[data-view="${view}"]`;
async function go(page,view){await page.locator(selector(view)).first().click();await page.waitForTimeout(150)}
try{
 Object.assign(process.env,{DEMO_MODE:'true',DATA_ROOT:root});await migrate(db);await seed(db);
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');runtime.PORT=String(socket.address().port);await new Promise(r=>socket.close(r));runtime.PUBLIC_BASE_URL='http://127.0.0.1:'+runtime.PORT;
 start('pilot/server.mjs');start('pilot/ai-worker.mjs');await until(async()=>(await fetch(runtime.PUBLIC_BASE_URL+'/health')).ok);
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await login(page);
 for(const asset of ['module-ui.js','module-ui.css'])assert.equal((await fetch(runtime.PUBLIC_BASE_URL+'/'+asset)).status,200);
 const views=['dashboard','sites','releases','builder','ai','articles','video','knowledge','media','content','external','geoquery','analytics','billing','clients','team','templates','infrastructure','provisioning','api'];
 for(const view of views){await go(page,view);if(view!=='dashboard')await page.locator(`.module-content[data-module="${view}"] .module-hero`).waitFor();assert.equal(await page.locator('main.content').evaluate(n=>n.scrollWidth>n.clientWidth+2),false,view+' desktop overflow')}
 console.log('PASS 20 real module pages load, one hero per module, assets served, desktop width fits');

 await go(page,'content');await page.locator('#content-form input[name=title]').fill('UI验收保存标题');
 assert.equal(await page.locator('.content-preview h3').textContent(),'UI验收保存标题');
 let response=page.waitForResponse(r=>r.url().endsWith('/content')&&r.request().method()==='POST');
 await page.locator('#content-form button.primary').click();assert.equal((await response).status(),200);
 await page.waitForTimeout(200);assert.equal((await db.query("SELECT content->>'title' title FROM sites WHERE id='s1'")).rows[0].title,'UI验收保存标题');

 await go(page,'knowledge');await page.locator('#knowledge-form input[name=title]').fill('UI验收企业事实');await page.locator('#knowledge-form textarea[name=content]').fill('这是本地隔离数据库中的企业服务资料。');
 response=page.waitForResponse(r=>r.url().includes('/knowledge')&&r.request().method()==='POST');await page.locator('#knowledge-form button').click();assert.equal((await response).status(),200);
 await page.getByText('企业简介 · UI验收企业事实',{exact:false}).waitFor();
 console.log('PASS moved forms preserve real saves; live preview escapes text; knowledge remains customer-scoped');

 await go(page,'articles');await page.locator('.module-list-search input').fill('not-existing-UI-test');assert(await page.locator('.module-filter-empty').isVisible());
 await page.locator('.module-list-search input').fill('');await page.locator('#new-article').click();await page.locator('.modal').waitFor();await page.locator('.modal [data-close]').first().click();

 await go(page,'billing');await page.getByRole('tab',{name:'价格、充值与预算',exact:true}).click();
 await page.locator('#billing-prices input[name=article]').fill('0.10');await page.locator('#billing-prices input[name=image]').fill('0.20');
 response=page.waitForResponse(r=>r.url().endsWith('/billing')&&r.request().method()==='POST');await page.locator('#billing-prices button').click();assert.equal((await response).status(),200);
 await page.waitForTimeout(200);assert(await page.locator('#billing-prices').isVisible());
 await go(page,'infrastructure');await page.getByRole('tab',{name:'部署任务',exact:true}).click();assert.equal(await page.locator('#module-infrastructure-deployments').isVisible(),true);
 await page.getByRole('tab',{name:'服务器与绑定',exact:true}).click();assert(await page.locator('#bind-form').isVisible());
 console.log('PASS list filtering, article editor, billing form binding and server management tabs');

 await go(page,'external');await page.locator('.module-advanced-filters summary').click();assert(await page.locator('.module-advanced-filters').getAttribute('open')!==null);
 assert(await page.locator('[data-external-section="records"]').count());
 await go(page,'ai');await page.locator('#ai-form input[name=topic]').fill('本地界面验收文章');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#ai-form button[type=submit]').click();
 await page.locator('.module-ai-task.task-succeeded').waitFor({timeout:30000});
 await page.locator('.ai-result').waitFor();assert.equal((await db.query('SELECT count(*)::int n FROM ai_article_jobs WHERE status=\'succeeded\'')).rows[0].n,1);
 assert.equal((await db.query('SELECT sum(amount_cents)::int n FROM billing_orders')).rows[0].n,0);
 assert.equal(await page.locator('#ai-form input[name=topic]').count(),1);
 console.log('PASS real demo AI task: quote confirmation, queue polling, successful result and zero upstream fees');

 await page.setViewportSize({width:390,height:844});
 for(const view of views.filter(v=>v!=='dashboard')){
  if(!await page.locator('.side.mobile-open').count())await page.locator('#mobile-nav-toggle').click();
  await page.locator('.side '+selector(view)).first().click();await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2),false,view+' mobile overflow');
 }
 const agency=await browser.newPage({viewport:{width:1440,height:960}});await login(agency,'agency','Agency123!');
 for(const view of ['templates','infrastructure','provisioning','api'])assert.equal(await agency.locator(`[data-view="${view}"]`).count(),0);
 await go(agency,'billing');await agency.locator('.module-balance-overview').waitFor();assert.equal(await agency.locator('#billing-prices,#billing-recharge').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS all module mobile widths and original agency/admin permission boundaries');
}finally{
 await browser?.close();
 await Promise.all(children.map(async child=>{if(child.exitCode!==null)return;const end=once(child,'exit');child.kill();await Promise.race([end,delay(2000)]);if(child.exitCode===null){child.kill('SIGKILL');await end}}));
 await db.end();await maintenance.query(`DROP DATABASE "${name}" WITH (FORCE)`);await maintenance.end();
}
