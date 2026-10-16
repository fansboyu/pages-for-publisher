// 与原发布系统保持同一 Jodit 编辑器与工具栏配置。
window.openArticleEditor=function(a,context){
 const {modal,e,api,refresh,toast,run,site}=context;
 const m=modal(`<h2>${a.id?'编辑文章':'新建文章'}</h2><p class="muted">支持富文本、图片、表格和 HTML 源码，保存后发布网站即可生效。</p><form><label>标题</label><input name="title" value="${e(a.title||'')}" required><label>摘要</label><textarea name="summary">${e(a.summary||'')}</textarea><label>文章正文</label><div class="rich-editor-wrap"><textarea id="rich-body"></textarea></div><p class="editor-tip">左侧 &lt;/&gt; 可切换 HTML 源码；可直接粘贴图片或上传本地图片。</p><label>内容状态</label><select name="status"><option value="draft">草稿</option><option value="published" ${a.status==='published'?'selected':''}>发布内容</option></select><div class="actions"><button type="button" data-close>取消</button><button class="primary" type="submit">保存文章</button></div></form>`);
 m.querySelector('.modal').classList.add('article-editor-modal');
 const editor=Jodit.make(m.querySelector('#rich-body'),{
 height:440,minHeight:360,toolbarAdaptive:false,toolbarSticky:false,language:'zh_cn',spellcheck:true,sourceEditor:'area',useSplitMode:false,showCharsCounter:false,showWordsCounter:false,showXPathInStatusbar:false,
 placeholder:'请输入文章正文内容，支持粘贴完整富文本、内嵌样式、图片和链接',
 buttons:['source','|',...Jodit.defaultOptions.buttons.filter(item=>!(typeof item==='object'&&item?.group==='source'))],
 cleanHTML:{allowedStyles:false,removeEventAttributes:true,safeJavaScriptLink:true,safeLinksTarget:true,fillEmptyParagraph:false},
 uploader:{url:'/api/editor-upload',insertImageAsBase64URI:false,isSuccess:response=>response.success,getMessage:response=>response.message||'图片上传失败',process:response=>({files:response.files,path:'',baseurl:''}),async customUploadFunction(form,progress){try{const urls=[];for(const file of form.values()){if(!(file instanceof File))continue;const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file)});const result=await api(`sites/${site}/media`,{name:file.name,data});urls.push(result.url)}progress(100);return {success:true,files:urls}}catch(error){progress(100);return {success:false,message:error.message,files:[]}}}}
 });
 editor.value=a.format==='html'?(a.body||''):String(a.body||'').split(/\n\n+/).map(p=>`<p>${e(p).replace(/\n/g,'<br>')}</p>`).join('');
 let disposed=false;const dispose=()=>{if(!disposed){disposed=true;editor.destruct()}};
 m.querySelector('[data-close]').addEventListener('click',dispose);
 m.querySelector('form').onsubmit=ev=>{ev.preventDefault();run(async()=>{const values=Object.fromEntries(new FormData(ev.target));await api(`sites/${site}/articles`,{...values,id:a.id,body:editor.value,format:'html'});dispose();m.remove();await refresh();toast('富文本文章已保存，发布网站后生效')})};
};
