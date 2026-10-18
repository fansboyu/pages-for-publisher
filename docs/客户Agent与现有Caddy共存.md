# 客户Agent与现有Caddy共存

默认Agent使用专用Caddy，并加载整份配置。已有业务占用80/443时，不能直接使用默认模式接管其管理接口。需要先备份运行中的Caddy JSON、Caddyfile和相关配置，再启用共存模式。

## 共存配置

在管理员注册得到的Agent配置中增加：

```json
{
  "sharedCaddy": true,
  "sharedServer": "srv0"
}
```

这两项应合并进完整配置，不可替代control、token、root等原有字段。完整示例为 `deploy/agent.shared.example.json`。sharedServer是当前Caddy JSON中 `apps.http.servers` 下已有的公开HTTP服务器名称，必须实际核对，不能假设总是srv0。共存模式用于production。

`caddyAdmin=http://127.0.0.1:2019`仍是本机Caddy管理接口。Agent通过它读取配置、加载网站路由；它不是总控地址、官网地址或公网服务端口，不应对公网开放。`healthPort=4322`是仅监听回环地址的站点本机检查端口。

## 路由边界

- Agent读取最新运行配置，给自己管理的路由添加与数据根目录关联的独立标识，只替换这些路由。
- 保留现有反向代理、静态业务、全局TLS/日志/存储及其他HTTP服务器配置。
- 支持ETag的Caddy使用If-Match保护配置合并；冲突时重新读取并有限重试。旧版Caddy通过带独立标识的子路由及健康检查服务更新，只插入或修改Agent拥有的子配置，不替换现有路由数组或全局配置。
- 新网站域名与其他现有业务域名或通配匹配冲突时拒绝部署，不接管旧域名。
- 新网站仍从独立版本目录提供服务；更新或回滚只改变目标站点版本。
- 健康检查服务使用独立名称和回环端口，端口需要空闲。
- 每30秒核对并恢复Agent管理路由；配置无变化时不重复加载。手工从原Caddyfile加载配置后，托管路由可能短暂缺失，随后恢复。

不要修改或丢失Agent路由上的管理标识，不要随意改变root或sharedServer。Agent停止后不会主动删除已加载的路由。卸载、迁移服务器或移交域名时需要单独核对和清理。

## 服务安装和验证

参考 `deploy/site-agent-shared.service`，按实际Node路径调整ExecStart。需同时部署agent/agent.mjs、agent/wait-caddy.mjs、pilot/archive.mjs和tar-stream依赖。使用site-agent用户、caddy组，配置文件只允许服务账号读取，网站目录允许Caddy读取。

服务等待Caddy管理接口就绪后启动；PartOf使Caddy服务重启时Agent也重新接入。现有Caddy可继续使用原Caddyfile启动，Agent随后补充托管路由，不需要替换原Caddyfile。

上线前验证已有域名和接口，再接入Agent，比较原路由与全局配置；确认原业务仍可访问、Agent在线及管理/健康端口仅监听回环地址。新域名发布后仍需单独验收DNS、HTTPS和关键页面。

回归命令：`node tests/shared-caddy.mjs`，需要可运行的Caddy，或通过CADDY_BIN指定路径。测试覆盖旧业务保留、新站更新/回滚、域名冲突拒绝、并发配置保护和重复恢复。
