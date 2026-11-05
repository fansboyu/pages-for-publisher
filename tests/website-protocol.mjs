import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join,resolve } from 'node:path';
import { buildWebsite,validate,templateFiles } from '../pilot/templates.mjs';
import { demoWebsite } from '../pilot/ai-website.mjs';
import { websiteRules,validateWebsiteOutput } from '../pilot/website-protocol.mjs';
const basic=resolve('pilot/templates/basic'),files=await templateFiles(basic),legacy=validate(files);assert(!legacy.protocol);
const root=resolve('storage/protocol-tests/'+Date.now());await fs.mkdir(root,{recursive:true});
const config={...legacy,protocol:'standard-static-v2',schemaVersion:2,capabilities:[...websiteRules.required],latestArticlesLimit:3};
const pages=new Map(files);pages.set('publisher.config.json',Buffer.from(JSON.stringify(config)));
for(const path of [config.homePage,config.newsListPage,config.articleTemplate]){
 let html='<!doctype html><html><head>{{theme_css}}</head><body>{{site_navigation}}<main '+(path===config.homePage?'data-publisher-latest':'')+'><h1>{{company_name}}</h1>'+(path===config.articleTemplate?'<article data-publisher-article>{{content_html}}</article>':config.articleCardsPlaceholder)+'</main>{{site_footer}}</body></html>';pages.set(path,Buffer.from(html));
}
assert.equal(validate(pages).protocol,'standard-static-v2');const invalid=new Map(pages);invalid.set(config.homePage,Buffer.from('<html>missing</html>'));assert.throws(()=>validate(invalid));
for(const [path,data]of pages){await fs.mkdir(join(root,path,'..'),{recursive:true});await fs.writeFile(join(root,path),data)}
const site={id:'protocol-test',name:'测试官网',client:'协议测试企业',title:'企业介绍',intro:'真实企业资料',domain:'example.test',phone:'13800138000',icp_number:'测试备案号'};
const article={id:'p1',title:'第一篇文章',summary:'测试摘要',body:'<p>正文与图片</p>',format:'html',updated:'2026-11-05T00:00:00.000Z'};
const v2=await buildWebsite({site,articles:[article]},{source_path:root});assert(v2.get('index.html').toString().includes('第一篇文章'));assert(v2.get('news/p1/index.html').toString().includes('data-publisher-footer'));
site.builder=demoWebsite({client_name:site.client,name:site.name,content:site},{theme:'warm',instruction:'设计企业官网'},null,[]);
const built=await buildWebsite({site,articles:[article]},{source_path:basic});for(const path of ['index.html','news/index.html','news/p1/index.html']){const html=built.get(path).toString();assert(html.includes('theme-warm'));assert(html.includes('data-publisher-navigation'));assert(html.includes('data-publisher-footer'));assert(html.includes('data-publisher-analytics'));assert(html.includes('第一篇文章'))}
const updated=await buildWebsite({site,articles:[{...article,title:'第二次文章更新'}]},{source_path:basic});assert(updated.get('index.html').toString().includes('第二次文章更新'));assert(!updated.get('index.html').toString().includes('第一篇文章'));
const empty=await buildWebsite({site,articles:[]},{source_path:basic});assert(empty.get('index.html').toString().includes('暂无文章'));
const broken=new Map(built);broken.set('index.html',Buffer.from('broken'));assert.throws(()=>validateWebsiteOutput(broken,{config:legacy,articles:[article],strict:true}));
console.log('PASS v1兼容、v2接入与拒绝无效模板、统一主题、文章自动刷新、空状态和最终产物检查');
