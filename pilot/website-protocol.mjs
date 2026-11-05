import { fail } from './common.mjs';

export const websiteProtocol='standard-static-v2';
export const websiteRules=Object.freeze({
 protocol:websiteProtocol,schemaVersion:2,
 required:['article-entry','latest-articles','article-list','article-detail','shared-theme','analytics'],
 fields:{company_name:{source:'site.client',required:true},contact_phone:{source:'site.phone',required:false},icp_number:{source:'site.icp_number',required:false}},
 extensions:{video:{enabled:false},products:{enabled:false}},
});

export function validateV2Config(config,files){
 if(config.protocol!==websiteProtocol)return;
 if(config.schemaVersion!==2)fail('v2模板必须声明 schemaVersion: 2');
 if(!Array.isArray(config.capabilities))fail('v2 capabilities必须为数组');
 if(!Number.isInteger(config.latestArticlesLimit)||config.latestArticlesLimit<1||config.latestArticlesLimit>12)fail('v2首页文章数量必须为1至12');
 for(const capability of websiteRules.required)if(!config.capabilities?.includes(capability))fail('v2模板缺少能力：'+capability);
 for(const path of [config.homePage,config.newsListPage,config.articleTemplate]){
  const html=files.get(path)?.toString()||'';
  if(path===config.homePage&&!html.includes('data-publisher-latest'))fail('v2首页必须标记 data-publisher-latest');
  if(path===config.articleTemplate&&!html.includes('data-publisher-article'))fail('v2详情必须标记 data-publisher-article');
  for(const field of ['company_name','theme_css','site_navigation','site_footer'])if(!html.includes('{{'+field+'}}'))fail(path+' 缺少 '+field);
 }
}

export function validateWebsiteOutput(output,{config,articles,analytics=false,strict=false}){
 if(!strict)return;
 for(const path of [config.homePage,config.newsListPage,...articles.map(a=>config.articleOutput.replace('{{slug}}',a.id))]){
  const html=output.get(path)?.toString();if(!html)fail('协议页面不存在：'+path);
  if(/\{\{[a-z_]+\}\}/.test(html))fail('协议页面残留字段：'+path);
  if(!html.includes('data-publisher-navigation')||!html.includes('data-publisher-footer'))fail('页面缺少统一导航或页脚：'+path);
  if(analytics&&!html.includes('data-publisher-analytics'))fail('页面缺少统计：'+path);
 }
 const home=output.get(config.homePage).toString();
 if(!home.includes('data-publisher-latest'))fail('首页缺少最新文章模块');
 for(const a of articles){const html=output.get(config.articleOutput.replace('{{slug}}',a.id)).toString();if(!html.includes('data-publisher-article'))fail('文章缺少正文区域：'+a.id)}
}
