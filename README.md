# 多租户静态发布中心

面向多个客户静态官网的统一发布平台。平台管理员管理客户、GitHub 仓库、模板和 Cloudflare 配置；客户负责人登录后只管理自己公司名下的网站文章。

## 两种角色

| 角色 | 可访问内容 |
| --- | --- |
| `platform_admin` | 全部客户、全部站点、创建客户负责人、GitHub/Cloudflare 配置、任务 |
| `client_owner` | 自己客户名下全部网站、文章发布/编辑/删除、发布任务 |

## 数据流

`客户后台 / 外部 Webhook → API → PostgreSQL → Redis 队列 → Worker → GitHub publish → Cloudflare Pages`

## 目录

```text
api/    NestJS API 和构建 Worker
web/    Vue 3 + Element Plus 管理端与客户文章后台
docs/   架构和部署说明
```

## 启动顺序

1. 复制 `api/.env.example` 为 `api/.env`，填写数据库、JWT 与 GitHub Token。
2. 启动 API、Worker、PostgreSQL、Redis。
3. 启动或构建 `web/`，设置 `VITE_API_BASE_URL` 指向 API 域名。
4. 用 `POST /admin/v1/bootstrap` 创建唯一的平台管理员。

首次部署后，由平台管理员创建客户、客户负责人和客户站点；客户负责人登录后即可发布、编辑、删除文章。
