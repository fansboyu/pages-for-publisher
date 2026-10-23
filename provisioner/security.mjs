import { isIP } from 'node:net';
import { createHash,timingSafeEqual } from 'node:crypto';
const ipv4=value=>value.split('.').reduce((n,x)=>(n*256+Number(x))>>>0,0);
function within(host,cidr){const [ip,prefix='32']=cidr.split('/'),bits=Number(prefix);if(isIP(ip)!==4||!Number.isInteger(bits)||bits<0||bits>32)return false;const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (ipv4(host)&mask)===(ipv4(ip)&mask)}
export function target(input,allowlist,{testLoopback=false}={}){
 const host=String(input.host||'').trim(),port=Number(input.port||22);
 if(isIP(host)!==4||!Number.isInteger(port)||port<1||port>65535)throw Error('首版仅支持明确的IPv4地址和有效SSH端口');
 const blocked=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','192.0.0.0/24','198.18.0.0/15','224.0.0.0/3'];
 if(!(testLoopback&&host==='127.0.0.1')&&blocked.some(c=>within(host,c)))throw Error('禁止连接内网、回环、云元数据或保留地址');
 const entries=String(allowlist||'').split(/[\s,;]+/).filter(Boolean);
 if(!entries.some(c=>{const bits=Number(c.split('/')[1]??32);return bits>=24&&bits<=32&&within(host,c)}))throw Error('目标不在管理员配置的公网SSH白名单内');
 return {host,port};
}
export const fingerprint=raw=>'SHA256:'+createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
export function sameSecret(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y)}
export function credentials(input){
 const username=String(input.username||'root');if(!/^[a-z_][a-z0-9_-]{0,31}$/.test(username))throw Error('SSH用户名格式无效');
 if(!/^SHA256:[A-Za-z0-9+/]{43}$/.test(String(input.fingerprint||'')))throw Error('必须核对并提供SSH主机SHA256指纹');
 const password=String(input.password||''),privateKey=String(input.privateKey||'');
 if((!password&&!privateKey)||(password&&privateKey)||password.length>1024||privateKey.length>32768)throw Error('请提供密码或私钥中的一种，不支持保存凭据');
 return {username,fingerprint:input.fingerprint,...(password?{password}:{privateKey})};
}
