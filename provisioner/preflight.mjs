import { exec } from './ssh.mjs';
export const CHECK_SCRIPT=`set -eu
. /etc/os-release
printf 'OS=%s\nVERSION=%s\nARCH=%s\nUID=%s\n' "$ID" "$VERSION_ID" "$(uname -m)" "$(id -u)"
if [ "$(cat /proc/1/comm)" = systemd ]; then echo SYSTEMD=1; else echo SYSTEMD=0; fi
printf 'DISK_KB=%s\n' "$(df -Pk /opt | awk 'NR==2 {print $4}')"
if command -v ss >/dev/null; then
 listeners=$(ss -H -ltn)
 printf 'PORTS=%s\n' "$(printf '%s\n' "$listeners" | awk '{n=split($4,p,":");if(p[n] ~ /^(80|443|2019|4322)$/)print p[n]}' | sort -u | paste -sd, -)"
else echo PORTS=unknown; fi
existing=0
for p in /opt/site-control /etc/site-agent /var/lib/site-agent /var/lib/site-agent-caddy /etc/systemd/system/site-agent.service /etc/systemd/system/site-agent-caddy.service; do
 if [ -e "$p" ] || [ -L "$p" ]; then existing=1; fi
done
for u in site-agent site-caddy; do if id "$u" >/dev/null 2>&1; then existing=1; fi; done
if getent group site-agent-web >/dev/null; then existing=1; fi
for unit in site-agent.service site-agent-caddy.service; do if systemctl cat "$unit" >/dev/null 2>&1; then existing=1; fi; done
printf 'EXISTING=%s\n' "$existing"
for svc in caddy nginx apache2; do
 if systemctl is-active --quiet "$svc" 2>/dev/null; then printf 'SERVICE=%s\n' "$svc"; fi
done
`;
export function parseReport(output){
 const rows=String(output).split('\n').filter(line=>/^[A-Z_]+=[a-zA-Z0-9.,_-]*$/.test(line)),get=name=>rows.find(x=>x.startsWith(name+'='))?.slice(name.length+1);
 const report={os:get('OS'),version:get('VERSION'),arch:get('ARCH'),root:get('UID')==='0',systemd:get('SYSTEMD')==='1',freeKB:Number(get('DISK_KB')),ports:get('PORTS')||'',existing:get('EXISTING')==='1',services:rows.filter(x=>x.startsWith('SERVICE=')).map(x=>x.slice(8))};
 const reasons=[];
 if(report.os!=='ubuntu'||!['22.04','24.04'].includes(report.version)||report.arch!=='x86_64')reasons.push('首版仅安装Ubuntu 22.04/24.04 x86_64');
 if(!report.root)reasons.push('首版安装需root；暂不支持sudo自动提权');
 if(!report.systemd)reasons.push('需要正在运行systemd的完整主机');
 if(!Number.isFinite(report.freeKB)||report.freeKB<524288)reasons.push('/opt所在分区需至少512MB可用空间');
 if(!rows.some(x=>x.startsWith('PORTS='))||report.ports)reasons.push('80/443/2019/4322端口占用或无法可靠检测；禁止接管现有入口');
 if(report.existing||report.services.length||get('EXISTING')!=='0')reasons.push('存在Agent目录、专用账号或Web服务；首版不覆盖、不自动迁移');
 return {...report,ready:reasons.length===0,reasons};
}
export async function preflight(client){return parseReport(await exec(client,CHECK_SCRIPT))}
