# 当前部署说明（v1.3.1）

## 总控部署

1. 使用项目根目录的 `compose.production.yml`。准备Docker、总控正式域名和外层Caddy。
2. 将 `.env.pilot.example` 复制为 `.env`，填写数据库/Redis随机密码、`PUBLIC_BASE_URL`、至少14位的 `BOOTSTRAP_ADMIN_PASSWORD`。生产保持 `DEMO_MODE=false`、`COOKIE_SECURE=true`。
3. 本地验证可用 `STORAGE_DRIVER=local`；正式OSS配置见[网站回滚与OSS配置](网站回滚与OSS配置.md)。
4. 创建 `customer-templates` 目录，供可选的服务器目录导入使用；ZIP上传可直接在后台完成。
5. 执行：

```bash
docker compose -f compose.production.yml up -d --build
```

迁移任务成功后API与Worker启动。前端映射 `127.0.0.1:4418`，由总控主机Caddy提供公网HTTPS：

```caddy
admin.example.cn {
    reverse_proxy 127.0.0.1:4418
}
```

前端同源转发 `/api/*`、`/agent/v1/*`、`/webhooks/v1/*` 等接口，不需要额外配置前端API地址。保留原Host，避免影响来源检查。数据库、Redis和API不映射公网端口。

## 客户服务器接入

1. 管理员在「服务器与部署」注册服务器，填写便于辨认的名称，保存一次性Agent配置。
2. 公网IP由运维和DNS管理，不作为认证依据。后台账号、服务器名称、Linux系统用户名无需一致。
3. 客户服务器安装Node.js 24、Caddy、Agent及其依赖。Agent 0.3需要 `agent/agent.mjs`、`pilot/archive.mjs`、`tar-stream` 及传递依赖，保持相对目录结构。
4. 将配置保存至受保护路径，例如 `/etc/site-agent/agent.json`。`control`填写总控HTTPS地址，`token`填写注册凭据，`mode=production`，`root`使用专用目录。
5. Caddy管理接口只监听 `127.0.0.1:2019`。先启动Caddy，再启动Agent；开机服务应等待管理接口可用。示例见 `deploy/`。
6. 在总控创建网站，绑定模板和服务器。网站域名解析到客户服务器公网IP，放通80/443。
7. 填写电话、备案等内容，预览后发布；检查构建、部署任务及公网域名HTTPS。

一台服务器只需一个Agent和专用Caddy，可管理多个网站。客户Agent会加载整份Caddy配置，应与总控入口及其他应用隔离。

## 备份与更新

- 更新前备份PostgreSQL、platform-data卷、OSS对象和相关配置；客户侧保存站点目录、agent-state.json及Caddy证书/配置。
- 修改 `.env` 后需重新创建API和Worker，使环境变量生效：

```bash
docker compose -f compose.production.yml up -d --force-recreate api worker
```

- 应用代码或前端变动后，重新构建相应镜像再部署。上线前核对数据库迁移和版本兼容。
- 回滚客户网站与回退总控应用是不同操作，详见回滚说明。

完整网络与容器说明见[前后端容器与依赖](前后端容器与依赖.md)。
