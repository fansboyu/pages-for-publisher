import { relative,dirname,join } from 'node:path';

export const analyticsClient = `(()=>{const s=document.currentScript;if(!s)return;const site=s.dataset.site,endpoint=s.dataset.endpoint;if(!site||!endpoint)return;try{const key='publisher-analytics:'+site;let visitor=localStorage.getItem(key);if(!visitor){visitor=crypto.randomUUID?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,visitor)}const referrer=(()=>{try{return document.referrer?new URL(document.referrer).hostname:''}catch{return''}})(),ua=navigator.userAgent||'',device=/ipad|tablet/i.test(ua)?'tablet':/mobile|android|iphone/i.test(ua)?'mobile':'desktop',body=JSON.stringify({site,visitor,path:location.pathname.slice(0,256)||'/',referrer,device}),blob=new Blob([body],{type:'text/plain;charset=UTF-8'});if(!navigator.sendBeacon(endpoint,blob))fetch(endpoint,{method:'POST',mode:'cors',credentials:'omit',keepalive:true,body:blob}).catch(()=>{})}catch{}})();`;

export function analyticsFilesForPage(page,siteId,endpoint){
 const scriptPath=relative(dirname(page),'publisher-analytics.js').replace(/\\/g,'/')||'publisher-analytics.js';
 const safe=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 return `<script defer src="${scriptPath}" data-publisher-analytics data-site="${safe(siteId)}" data-endpoint="${safe(endpoint)}"></script>`;
}

export const analyticsClientPath=join('publisher-analytics.js');
