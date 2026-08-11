# 架构设计

```text
浏览器（管理员 / 客户负责人）
        │ JWT
        ▼
Vue + Element Plus 前端
        │ HTTPS
        ▼
NestJS API ─── PostgreSQL（客户、用户、站点、文章、任务）
        │
        ▼
Redis / BullMQ ─── Worker ─── GitHub publish ─── Cloudflare Pages
```

## 数据边界

- `platform_admin` 不绑定客户，可访问所有数据。
- `client_owner` 必须绑定一个 `client_id`，只能查询和修改该客户名下的 `sites`。
- 外部 Webhook 使用站点 API Key，不使用客户登录 Token。
- GitHub `master` 保存模板；`publish` 只保存生成后的正式静态文件。

## 最小数据表

`clients`、`users`、`refresh_tokens`、`sites`、`site_credentials`、`articles`、`build_jobs`。

## 发布规则

任何新建、编辑、删除文章都会创建一个 `build_job`。Worker 重新生成首页资讯、资讯列表、文章详情和 sitemap，然后提交到站点的 `publish` 分支。
