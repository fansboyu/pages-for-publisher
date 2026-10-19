import assert from 'node:assert/strict';
import sharp from 'sharp';
import { generateArticle,generateCover,generateInlineImages,aiMode,aiImageMode } from '../pilot/ai-article.mjs';

const keys=['AI_API_KEY','AI_TEXT_API_KEY','AI_TEXT_MODEL','AI_BASE_URL','AI_TEXT_BASE_URL','AI_IMAGE_API_KEY','AI_IMAGE_MODEL','ALIYUN_IMAGE_API_KEY','ALIYUN_IMAGE_MODEL','ALIYUN_IMAGE_BASE_URL','ALIYUN_IMAGE_API_STYLE','AI_IMAGE_TIMEOUT_MS','ALIYUN_IMAGE_POLL_INTERVAL_MS'];
for(const key of keys)delete process.env[key];
const site={id:'s-demo',name:'优佳家政官网',client_name:'优佳家政',domain:'www.example.test',type:'家政服务',content:{intro:'专业、细致的服务，让每一次托付更加安心。'}};
const demo=await generateArticle(site,{topic:'春季家庭深度清洁怎么安排',keywords:'上海家政,深度保洁',region:'上海',knowledge:[{title:'真实服务范围',content:'上海浦东提供家庭保洁预约。',terms:['家庭保洁','浦东保洁']} ]});
assert.equal(demo.mode,'demo');assert(demo.title.includes('上海家政'));assert(demo.seoKeywords.includes('家庭保洁'));assert(demo.body.includes('上海浦东提供家庭保洁预约'));assert(demo.body.replace(/<[^>]*>/g,'').length>180);
const demoImage=await generateCover(demo,site,{topic:'春季家庭深度清洁怎么安排'});assert.equal(demoImage.mode,'demo');assert(Buffer.from(demoImage.data.split(',')[1],'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
const demoInline=await generateInlineImages(demo,site,{topic:'春季家庭深度清洁怎么安排',imageCount:2});assert.equal(demoInline.length,2);assert(demoInline.every(x=>x.mode==='demo'&&x.sectionIndex>=0));
console.log('PASS 本地演示生成含关键词的文章、封面与两张段落配图');

const originalFetch=globalThis.fetch,fixture=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#27825d"/></svg>')).png().toBuffer();let imageTasks=0,createHeaders=[],textPayload;
process.env.AI_TEXT_API_KEY='unit-test-text-key';process.env.AI_TEXT_MODEL='deepseek-test';process.env.AI_TEXT_BASE_URL='https://api.deepseek.example/v1';
process.env.ALIYUN_IMAGE_API_KEY='unit-test-aliyun-key';process.env.ALIYUN_IMAGE_MODEL='wanx-test';process.env.ALIYUN_IMAGE_BASE_URL='https://dashscope.example.test';process.env.AI_IMAGE_TIMEOUT_MS='30000';process.env.ALIYUN_IMAGE_POLL_INTERVAL_MS='250';
globalThis.fetch=async(url,options={})=>{
 const target=String(url);
 if(target.endsWith('/chat/completions')){textPayload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'上海家政服务实用指南',summary:'帮助读者了解服务选择要点。',seo_title:'上海家政服务指南',seo_description:'家政服务选择建议',seo_keywords:['上海家政','家庭保洁'],sections:[{heading:'确认需求',html:'<p>提前确认服务范围和时间安排，明确需要处理的具体事项，并列出最关心的问题。充分沟通有助于双方形成合理预期，也能减少遗漏，让服务安排更贴合实际使用场景。</p>'},{heading:'比较流程',html:'<p>了解服务内容、预约方式和沟通流程，再结合自身需要作出选择。比较不同方案时，可以重点核对服务边界、时间安排、准备事项和反馈方式，确认相关信息清楚再进行预约。</p>'},{heading:'沟通细节',html:'<p>事先确认地址、联系人和服务边界，过程中及时反馈变化。对临时调整的事项，先沟通可执行范围和处理方式。选择服务时参考企业公开说明和自己的具体情况，避免仅根据单一宣传作决定。</p>'}],imagePrompts:[{sectionIndex:0,alt:'明确家政服务需求',prompt:'明亮整洁的家庭客厅，清洁人员整理空间，无文字'},{sectionIndex:2,alt:'服务人员沟通细节',prompt:'专业服务人员与客户沟通服务事项，无文字'}]})}}]}),{status:200,headers:{'Content-Type':'application/json'}})}
 if(target.endsWith('/image-synthesis')||target.endsWith('/image-generation/generation')){createHeaders.push({headers:options.headers,body:JSON.parse(options.body)});imageTasks++;return new Response(JSON.stringify({output:{task_id:`task-${imageTasks}`}}),{status:200})}
 if(target.includes('/api/v1/tasks/task-'))return new Response(JSON.stringify({output:{task_status:'SUCCEEDED',results:[{url:`https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test-${encodeURIComponent(target)}.png?Expires=123`}]}}),{status:200});
 if(target.startsWith('https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/'))return new Response(fixture,{status:200,headers:{'Content-Type':'image/png'}});
 throw Error('unexpected AI URL '+target);
};
try{
 assert.equal(aiMode(),'provider');assert.equal(aiImageMode(),'aliyun');
 const knowledge=[{category:'企业事实',title:'服务范围',content:'上海可预约家庭保洁。',terms:['家庭保洁','深度保洁']}];site.knowledge=knowledge;site.region='上海浦东';site.target_keywords='浦东家政,家庭保洁';
 const generated=await generateArticle(site,{topic:'家政服务选择',region:site.region,keywords:site.target_keywords,knowledge});assert.equal(generated.mode,'provider');assert.equal(generated.title,'上海家政服务实用指南');assert.equal(generated.imagePrompts.length,2);
 const generationInput=JSON.parse(textPayload.messages[1].content);assert.equal(generationInput.business.domain,site.domain);assert.equal(generationInput.region,'上海浦东');assert.equal(generationInput.knowledgeBase[0].content,'上海可预约家庭保洁。');assert(generationInput.industryTerms.includes('深度保洁'));
 const cover=await generateCover(generated,site,{topic:'家政服务选择'});assert.equal(cover.mode,'aliyun');
 const inline=await generateInlineImages(generated,site,{topic:'家政服务选择',imageCount:2});assert.equal(inline.length,2);assert(inline.every(x=>x.mode==='aliyun'&&x.data.startsWith('data:image/webp;base64,')));
 process.env.ALIYUN_IMAGE_API_STYLE='multimodal';const multimodal=await generateCover(generated,site,{topic:'家政服务选择'});assert.equal(multimodal.mode,'aliyun');
 assert.equal(imageTasks,4);assert(createHeaders.every(x=>x.headers['X-DashScope-Async']==='enable'&&x.headers.Authorization==='Bearer unit-test-aliyun-key'));assert.equal(createHeaders[3].body.input.messages[0].content[0].text.startsWith('为企业官网文章制作封面图'),true);
 console.log('PASS DeepSeek文本与阿里云百炼异步生图分别调用，覆盖万相与Wan多模态接口及图片压缩');
}finally{globalThis.fetch=originalFetch;for(const key of keys)delete process.env[key]}
