import {id,fail} from './common.mjs';
import {safeHtml} from '../html.mjs';
export async function saveArticle(c,site,b){
 if(!String(b.title||'').trim())fail('请输入文章标题');if(b.status&&!['draft','published'].includes(b.status))fail('文章状态无效');
 const articleId=b.id||id('p'),format=b.format==='html'||b.content_html!==undefined?'html':'text',raw=b.content_html??b.body??b.content??'',content=format==='html'?safeHtml(raw):String(raw);if(content.length>2*1024*1024)fail('文章正文过大');
 const seo=[String(b.seo_title||'').slice(0,200),String(b.seo_description||'').slice(0,500),String(b.seo_keywords||'').slice(0,1000),String(b.cover_image_url||'').slice(0,2000),String(b.ai_model||'').slice(0,100)];
 if(b.id){const r=await c.query("UPDATE articles SET title=$1,summary=$2,body=$3,format=$4,status=$5,seo_title=$6,seo_description=$7,seo_keywords=$8,cover_image_url=$9,ai_model=$10,ai_generated_at=CASE WHEN $11 THEN now() ELSE ai_generated_at END,updated_at=now() WHERE id=$12 AND site_id=$13 RETURNING id",[String(b.title).slice(0,200),String(b.summary||'').slice(0,500),content,format,b.status==='published'?'published':'draft',...seo,!!b.ai_model,articleId,site.id]);if(!r.rowCount)fail('文章不存在',404)}
 else await c.query('INSERT INTO articles(id,site_id,external_id,title,summary,body,format,status,seo_title,seo_description,seo_keywords,cover_image_url,ai_model,ai_generated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $14 THEN now() END)',[articleId,site.id,b.external_id||null,String(b.title).slice(0,200),String(b.summary||'').slice(0,500),content,format,b.status==='published'?'published':'draft',...seo,!!b.ai_model]);
 await c.query('UPDATE sites SET revision=revision+1 WHERE id=$1',[site.id]);return articleId;
}
