import sharp from 'sharp';
import { esc } from './common.mjs';

const textBaseUrl=()=>String(process.env.AI_TEXT_BASE_URL||process.env.AI_BASE_URL||'https://api.deepseek.com/v1').replace(/\/$/,'');
const textApiKey=()=>process.env.AI_TEXT_API_KEY||process.env.AI_API_KEY||'';
const imageApiKey=()=>process.env.ALIYUN_IMAGE_API_KEY||process.env.AI_IMAGE_API_KEY||process.env.DASHSCOPE_API_KEY||'';
const imageBaseUrl=()=>String(process.env.ALIYUN_IMAGE_BASE_URL||'https://dashscope.aliyuncs.com').replace(/\/$/,'').replace(/\/api\/v1$/,'');
const imageModel=()=>process.env.ALIYUN_IMAGE_MODEL||process.env.AI_IMAGE_MODEL||'';
const imageCount=()=>Math.max(1,Math.min(3,Number(process.env.AI_INLINE_IMAGE_COUNT)||2));
const fetchJson=async(url,options={},timeout=Number(process.env.AI_TIMEOUT_MS||90000))=>{const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error(`AI服务请求失败（HTTP ${response.status}）`);return response.json()};
const parseJson=text=>{const clean=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');try{return JSON.parse(clean)}catch{throw Error('AI返回内容不是有效JSON，请重试')}};
const words=value=>String(value||'').slice(0,300).trim();
function demoArticle(site,input){
 const topic=words(input.topic)||'服务选择指南',keywords=words(input.keywords).split(/[,，、\s]+/).filter(Boolean).slice(0,8),brand=site.client_name||site.name||'本企业',service=site.type||'本地服务',intro=String(site.content?.intro||'以清晰沟通和稳定服务，为客户解决实际问题。');
 const focus=keywords[0]||service,place=words(input.region)||'';
 const localPrefix=place&&!focus.startsWith(place)?place+' ':'';
 return {title:`${localPrefix}${focus}怎么选？${topic}实用指南`,summary:`围绕${focus}和${topic}，梳理需求确认、服务比较与沟通要点，帮助读者更清楚地做出适合自己的选择。`,seo_title:`${localPrefix}${focus}｜${topic}｜${brand}`,seo_description:`${brand}整理${topic}实用要点，介绍选择${focus}时可关注的服务范围、沟通细节与体验标准。`,seo_keywords:keywords.length?keywords.join(', '):[place,focus,service].filter(Boolean).join(', '),sections:[
  ['先明确实际需求',`在了解${focus}前，建议先梳理使用场景、时间安排和最关心的问题。把需求说具体，有助于后续比较服务内容。可以列出优先事项和需要特别留意的地方，沟通时逐项确认，减少信息遗漏。`],
  ['比较服务范围与流程',`不同服务的内容和流程可能存在差异。可以重点了解服务包含哪些事项、需要提前准备什么，以及遇到变化时如何沟通。比较时不仅看宣传介绍，也要确认预约、上门、完成反馈等实际环节，按自己的需求判断是否合适。`],
  ['关注沟通与服务细节',`预约前确认时间、地址、联系人和服务边界；服务过程中及时反馈实际情况。信息越明确，双方越容易形成合理预期。若需求临时变化，应先沟通调整方式和可执行范围，并保留清晰的联系渠道，避免因理解不同影响体验。`],
  ['结合自身情况做决定',`${brand}专注于${service}。${intro}建议结合自己的需求、服务说明和沟通体验综合判断，选择适合当前情况的方案。遇到不确定事项时，可以先提出具体问题，再根据答复、时间安排和服务细节作决定，不必只依据单一宣传说法。`]
 ].map(([heading,content])=>({heading,content})),imagePrompts:[]};
}

export function aiMode(){return textApiKey()&&process.env.AI_TEXT_MODEL?'provider':'demo'}
export function aiImageMode(){return imageApiKey()&&imageModel()?'aliyun':'demo'}
export function configuredInlineImageCount(){return imageCount()}

export async function generateArticle(site,input){
 const mode=aiMode();let article;
 if(mode==='provider'){
  const response=await fetchJson(`${textBaseUrl()}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${textApiKey()}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.AI_TEXT_MODEL,max_tokens:Math.max(2048,Math.min(12000,Number(process.env.AI_TEXT_MAX_TOKENS)||8192)),temperature:0.7,response_format:{type:'json_object'},messages:[
   {role:'system',content:'你是企业官网的中文内容编辑。只能使用给出的企业资料，不得编造价格、资质、门店、客户案例、服务承诺或地区事实。围绕关键词写实用、自然、原创的文章，避免堆砌关键词和绝对化宣传。返回JSON对象，字段：title、summary、seo_title、seo_description、seo_keywords（字符串数组）、sections（数组，每项含heading和html；正文不少于4节，适合直接发布）、imagePrompts（数组，按正文顺序提供适合插入文章的配图计划，每项含sectionIndex从0开始、alt、prompt；画面须对应对应段落，不含文字和logo，风格统一）。配图计划不少于用户指定的正文图片数量。HTML只用h2、h3、p、ul、ol、li、strong、blockquote。'},
   {role:'user',content:JSON.stringify({business:{name:site.client_name,website:site.name,domain:site.domain,industry:site.type,introduction:site.content?.intro,services:site.content?.services,phone:site.content?.phone},topic:words(input.topic),keywords:words(input.keywords),region:words(input.region),tone:words(input.tone)||'专业、清楚、亲和',targetLength:Math.max(600,Math.min(2400,Number(input.targetLength)||1000)),inlineImageCount:Math.max(1,Math.min(3,Number(input.imageCount)||imageCount()))})}
  ]})});
  article=parseJson(response.choices?.[0]?.message?.content);
 }else article=demoArticle(site,input);
 const title=words(article.title);if(title.length<4)throw Error('文章标题生成失败，请调整主题后重试');
 const sections=Array.isArray(article.sections)?article.sections:[];if(sections.length<2)throw Error('文章正文过短，请调整主题后重试');
 const cleanSections=sections.map(section=>({heading:words(section.heading)||'内容说明',html:String(section.html||`<p>${esc(words(section.content))}</p>`)}));
 const body=cleanSections.map(section=>`<h2>${esc(section.heading)}</h2>${section.html}`).join('\n');
 if(body.replace(/<[^>]*>/g,'').trim().length<180)throw Error('文章正文未达到自动发布质量要求');
 const prompts=Array.isArray(article.imagePrompts)?article.imagePrompts:[];
 return {mode,title,summary:words(article.summary),seoTitle:words(article.seo_title)||title,seoDescription:words(article.seo_description||article.summary),seoKeywords:Array.isArray(article.seo_keywords)?article.seo_keywords.map(words).filter(Boolean).join(', '):words(article.seo_keywords),sections:cleanSections,imagePrompts:prompts.map(p=>({sectionIndex:Number.isInteger(Number(p.sectionIndex))?Number(p.sectionIndex):0,alt:words(p.alt),prompt:words(p.prompt)})),body};
}

function svgCover(title,brand,topic){const safe=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));const chars=[...String(title||'')],line1=chars.slice(0,15).join(''),line2=chars.slice(15,30).join(''),single=!line2,topicY=single?375:425;return Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#102e27"/><stop offset="1" stop-color="#237b61"/></linearGradient><pattern id="p" width="52" height="52" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.4" fill="#d9efcf" opacity=".22"/></pattern></defs><rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#p)"/><circle cx="1015" cy="105" r="185" fill="#bde7aa" opacity=".12"/><circle cx="1120" cy="540" r="240" fill="#a4d7af" opacity=".1"/><rect x="90" y="88" width="10" height="82" rx="5" fill="#bde7aa"/><text x="128" y="134" fill="#d7eccd" font-family="Microsoft YaHei,sans-serif" font-size="28" letter-spacing="5">${safe(brand).slice(0,28)}</text><text x="90" y="285" fill="#fff" font-family="Microsoft YaHei,sans-serif" font-size="48" font-weight="700"><tspan x="90">${safe(line1)}</tspan>${line2?`<tspan x="90" dy="60">${safe(line2)}</tspan>`:''}</text><text x="92" y="${topicY}" fill="#d6e8db" font-family="Microsoft YaHei,sans-serif" font-size="25">${safe(topic).slice(0,32)}</text><rect x="92" y="500" width="128" height="4" rx="2" fill="#bde7aa"/><text x="92" y="555" fill="#d6e8db" font-family="Arial,sans-serif" font-size="18" letter-spacing="3">PUBLISH CENTER · ARTICLE SERIES</text></svg>`)}

async function aliyunImage(prompt){
 const base=imageBaseUrl(),model=imageModel(),key=imageApiKey(),style=process.env.ALIYUN_IMAGE_API_STYLE||'text2image',timeout=Number(process.env.AI_IMAGE_TIMEOUT_MS||300000),interval=Math.max(250,Number(process.env.ALIYUN_IMAGE_POLL_INTERVAL_MS||10000));
 if(!key||!model)throw Error('请配置阿里云图片模型 API Key 与模型名称');
 const multimodal=style==='multimodal';if(!['text2image','multimodal'].includes(style))throw Error('ALIYUN_IMAGE_API_STYLE 仅支持 text2image 或 multimodal');
 const endpoint=multimodal?'image-generation/generation':'text2image/image-synthesis',input=multimodal?{messages:[{role:'user',content:[{text:prompt}]}]}:{prompt};
 const created=await fetchJson(`${base}/api/v1/services/aigc/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-DashScope-Async':'enable'},body:JSON.stringify({model,input,parameters:{size:process.env.ALIYUN_IMAGE_SIZE||(multimodal?'1K':'1280*720'),n:1}}),timeout});
 const task=created.output?.task_id;if(!task)throw Error(created.message||created.code||'阿里云未返回图片任务编号');
 const expires=Date.now()+timeout;let result;
 while(Date.now()<expires){await new Promise(resolve=>setTimeout(resolve,interval));result=await fetchJson(`${base}/api/v1/tasks/${encodeURIComponent(task)}`,{headers:{Authorization:`Bearer ${key}`}},Math.min(30000,timeout));const status=result.output?.task_status;if(status==='SUCCEEDED')break;if(status==='FAILED'||status==='CANCELED')throw Error(`阿里云图片生成失败：${result.output?.message||result.message||status}`)}
 if(result?.output?.task_status!=='SUCCEEDED')throw Error('等待阿里云图片生成超时');
 const url=result.output?.results?.[0]?.url||result.output?.choices?.[0]?.message?.content?.find(x=>x.image)?.image;if(!url)throw Error('阿里云任务完成但未返回图片地址');
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!/(^|\.)aliyuncs\.com$/i.test(parsed.hostname))throw Error('阿里云返回了不受支持的图片地址');
 const response=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!response.ok)throw Error('阿里云生成图片下载失败');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>20*1024*1024)throw Error('阿里云生成图片超过20MB');
 const webp=await sharp(bytes,{limitInputPixels:40000000}).rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();if(webp.length>5*1024*1024)throw Error('AI图片压缩后仍超过5MB');
 return {data:`data:image/webp;base64,${webp.toString('base64')}`,name:'阿里云AI配图.webp',mode:'aliyun'};
}

export async function generateCover(article,site,input){
 if(aiImageMode()==='aliyun')return aliyunImage(`为企业官网文章制作封面图。企业：${site.client_name||site.name}；行业：${site.type}；主题：${words(input.topic)}；标题：${article.title}；地区：${words(input.region)}。${words(input.imageStyle)||'简洁、可信、专业的真实摄影风格'}，横版构图，主体明确，适合中文企业官网；画面中不要生成文字、标志、水印。`);
 const bytes=await sharp(svgCover(article.title,site.client_name||site.name,input.topic)).png().toBuffer();return {data:`data:image/png;base64,${bytes.toString('base64')}`,name:'文章主题配图.png',mode:'demo'};
}

export async function generateInlineImages(article,site,input){
 const count=Math.max(0,Math.min(3,Number(input.imageCount)||imageCount()));if(!count)return [];
 const plans=Array.from({length:count},(_,i)=>{const planned=article.imagePrompts[i],sectionIndex=Math.min(article.sections.length-1,Math.max(0,Number(planned?.sectionIndex??Math.round((i+1)*article.sections.length/(count+1))-1)));const section=article.sections[sectionIndex];return {sectionIndex,alt:words(planned?.alt)||`${section.heading}配图`,prompt:words(planned?.prompt)||`企业官网文章正文配图。行业：${site.type}；地区：${words(input.region)}；文章标题：${article.title}；对应小节：${section.heading}；内容：${section.html.replace(/<[^>]*>/g,' ').slice(0,400)}。${words(input.imageStyle)||'简洁、可信、专业的真实摄影风格'}，横版构图；不要文字、标志或水印。`}});
 return Promise.all(plans.map(async(plan,i)=>({...await (aiImageMode()==='aliyun'?aliyunImage(plan.prompt):generateCover({...article,title:plan.alt},site,{...input,topic:plan.alt})),...plan,index:i})));
}
