# 独立部署说明

本项目与旧版 `github-pages发布中心` 使用不同目录、容器项目和本机端口，迁移时不覆盖旧版。

## API 与 Worker

```bash
cd api
cp .env.example .env
# 编辑 .env：填写 POSTGRES_PASSWORD、DATABASE_URL、JWT_SECRET、GITHUB_TOKEN、CORS_ORIGIN
docker compose up -d --build
```

API 默认只绑定服务器本机 `127.0.0.1:3003`。在 Caddy 中为新 API 域名添加反向代理：

```caddy
api-new.example.com {
    reverse_proxy 127.0.0.1:3003
}
```

## 前端

```bash
cd web
cp .env.example .env
# 将 VITE_API_BASE_URL 改为 API HTTPS 地址
npm install
npm run build
```

将 `web/dist` 部署到独立管理域名，例如 `admin.example.com`。Caddy 静态托管示例：

```caddy
admin.example.com {
    root * /opt/multi-tenant-static-publisher/web/dist
    try_files {path} /index.html
    file_server
}
```

并在 API 的 `CORS_ORIGIN` 中填写 `https://admin.example.com`。

## 首次初始化

先调用一次：

```text
POST /auth/bootstrap
{
  "username": "admin",
  "password": "至少 8 位的初始密码",
  "display_name": "平台管理员"
}
```

该接口仅允许在数据库没有任何账号时成功执行一次。之后用该账号登录，在前端创建客户、客户负责人和客户网站。
