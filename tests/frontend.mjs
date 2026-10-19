import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const docker = async (...args) => (await exec('docker', args, { windowsHide: true })).stdout.trim();
const name = 'sitecontrol-frontend-test-' + Date.now();
// An isolated mock checks transport only; pilot.mjs verifies real business APIs.
const mock = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Set-Cookie', 'session=test; HttpOnly; SameSite=Strict; Path=/');
  if (req.url === '/api/error') res.statusCode = 401;
  res.end(JSON.stringify({ path: req.url, method: req.method, body, host: req.headers.host,
    cookie: req.headers.cookie, authorization: req.headers.authorization, origin: req.headers.origin }));
});
mock.listen(0, '0.0.0.0'); await once(mock, 'listening');
try {
  await docker('run', '-d', '--rm', '--name', name, '--add-host', 'host.docker.internal:host-gateway',
    '-e', `API_UPSTREAM=host.docker.internal:${mock.address().port}`, '-p', '127.0.0.1::8080', 'sitecontrol-frontend:local');
  const mapping = await docker('port', name, '8080/tcp'), base = 'http://' + mapping;
  let ready = false;
  for (let i=0; i<60; i++) {
    try { if ((await fetch(base + '/frontend-health')).ok) { ready=true; break; } } catch {}
    await new Promise(r=>setTimeout(r,250));
  }
  assert(ready, 'frontend ready');
  for (const path of ['/', '/app.js', '/style.css', '/classic.css', '/editor.js', '/editor.css', '/deployment-ui.js', '/analytics-ui.js', '/pilot-ui.js', '/vendor/jodit.js', '/vendor/jodit.css']) {
    const r = await fetch(base+path); assert.equal(r.status,200,path); assert((await r.text()).length>20,path);
    assert.equal(r.headers.get('cache-control'),'no-cache');
  }
  assert.equal((await fetch(base+'/not-a-page')).status,404);
  console.log('PASS 独立容器提供全部后台/编辑器资源，未知页面404');
  for (const path of ['/api/state?site=s1', '/agent/v1/poll', '/webhooks/v1/sites/s1', '/preview/s1/', '/objects/image.webp', '/media/old.webp', '/health']) {
    const r=await fetch(base+path,{method:'POST',headers:{Cookie:'session=abc',Authorization:'Bearer test',Origin:base,'Content-Type':'application/json'},body:'{"test":true}'});
    assert.equal(r.status,200,path); assert(r.headers.get('set-cookie').includes('HttpOnly'));
    const data=await r.json(); assert.equal(data.path,path);assert.equal(data.host,new URL(base).host);
    assert.equal(data.cookie,'session=abc');assert.equal(data.authorization,'Bearer test');assert.equal(data.origin,base);assert.equal(data.body,'{"test":true}');
  }
  assert.equal((await fetch(base+'/api/error')).status,401);
  console.log('PASS 所有后端路由、查询参数、请求体、Host、Cookie、Authorization及错误状态透传');
  await new Promise(r=>mock.close(r));
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/state')).status,502);
  console.log('PASS API离线时前端仍可加载，接口返回502而非错误地返回HTML');
} finally {
  mock.close();
  await docker('stop', name).catch(()=>{});
}
