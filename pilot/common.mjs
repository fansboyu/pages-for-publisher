import { randomBytes,scryptSync,timingSafeEqual,createHash } from 'node:crypto';
export const id=p=>p+Date.now().toString(36)+randomBytes(6).toString('hex');
export const token=()=>randomBytes(32).toString('hex');
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
export function accountScope(user){if(!user||!['admin','agency'].includes(user.role)||(user.role==='agency'&&!user.agency_id))fail('账号缺少有效代理商归属，请联系管理员',403);return user}
export const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function password(value){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(value,salt,64).toString('hex')}
export function verify(value,encoded){const [salt,digest]=encoded.includes(':')?encoded.split(':'):['local-platform-v1',encoded];const a=Buffer.from(digest,'hex'),b=scryptSync(value,salt,64);return a.length===b.length&&timingSafeEqual(a,b)}
export async function audit(db,site,actor,action){await db.query('INSERT INTO audit_logs(site_id,actor,action) VALUES($1,$2,$3)',[site,actor,action])}
export async function body(req){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>8*1024*1024)fail('请求超过 8MB',413);chunks.push(b)}try{return size?JSON.parse(Buffer.concat(chunks)):{} }catch{fail('JSON 格式错误')}}
export function json(res,data,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
export function siteView(row){return {id:row.id,agency:row.agency_id,client:row.client_name,clientId:row.client_id,name:row.name,domain:row.domain,type:row.type,color:row.color,region:row.region||'',targetKeywords:row.target_keywords||'',...row.content,key:row.api_key,active:row.active_release,serverId:row.server_id,templateId:row.template_id,revision:Number(row.revision)}}
export async function siteFor(db,user,site,lock=false){accountScope(user);const row=(await db.query(`SELECT s.*,c.agency_id,c.name client_name FROM sites s JOIN clients c ON c.id=s.client_id WHERE s.id=$1 ${lock?'FOR UPDATE OF s':''}`,[site])).rows[0];if(!row)fail('网站不存在',404);if(user.role!=='admin'&&row.agency_id!==user.agency_id)fail('无权访问此网站',403);return row}
