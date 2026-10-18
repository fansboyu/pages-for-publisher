# 当前系统架构（v1.3.1）

## 运行结构

```text
管理员 / 代理商 / GEO
        ↓ HTTPS
总控主机 Caddy → frontend（public/，Jodit）→ API（pilot/server.mjs）
                                            ↓
                                     PostgreSQL 分表存储
                                            ↓ 持久化构建请求
                                     Worker → Redis / BullMQ
                                            ↓
                              固定模板 + 冻结内容 → 完整 tar.gz
                                            ↓
                                       本地存储 / OSS
                                            ↓
客户 Agent（主动领取总控任务）→ 校验归档 → 专用 Caddy 切换站点目录
```

生产入口为根目录 `compose.production.yml`：五个常驻容器 frontend、api、worker、postgres、redis，以及一次性 migrate。外层总控Caddy与客户侧Caddy是不同实例。客户服务器不连接数据库或Redis。

## 代码入口

| 路径 | 职责 |
| --- | --- |
| public/ | 当前后台界面、富文本、模板与部署操作 |
| pilot/server.mjs | Session认证、管理API、GEO接口 |
| pilot/publishing.mjs | 冻结快照、发布任务、回滚 |
| pilot/worker.mjs | 数据库任务补投、串行构建、归档 |
| pilot/agent-api.mjs | Agent认证、租约、任务回执 |
| pilot/templates.mjs、pilot/template-upload.mjs | 模板协议、上传、静态生成与安全预览 |
| agent/agent.mjs | 客户服务器上的多站点部署程序 |
| storage-adapter.mjs | 图片处理、本地/OSS存储、签名下载与检测 |
| pilot/migrations/ | 显式数据库迁移 |

历史SQLite入口 `server.mjs`、`deployment.mjs` 和只读迁移工具仍保留，默认入口为 `pilot/`。

## 数据和权限

- 管理员可管理全平台；代理商只能操作自己归属的网站。客户目前是归属实体，没有独立客户登录角色。
- 后台使用数据库Session和HttpOnly Cookie；GEO使用站点API Key；Agent使用服务器独立Token。
- 业务数据包括 agencies、clients、users、sessions、servers、sites、templates、articles、media、releases、build_jobs、deployment_tasks、audit_logs、draft_previews。
- 发布时在事务中保存不可变内容快照与构建请求；Worker根据快照构建，同站点按版本顺序执行。
- 绑定客户服务器后，只有Agent部署成功回执才更新活动版本。未绑定服务器的构建完成仅用于总控侧预览。

## 部署和恢复边界

同一客户服务器运行一个Agent和专用Caddy，通过域名托管多个网站。每站目录为 `root/sites/<site-id>/releases/<release-id>`。总控停机不直接停止已部署静态页面，外部图片仍依赖对应存储服务。

API和Worker目前依赖共享的platform-data卷。跨主机扩容需要共享文件存储改造；当前没有自动容灾或客户服务器池。Agent本机HTTP验证不代表公网DNS和HTTPS验收。

参阅[部署说明](deployment.md)、[模板接入规范](官网模板接入规范.md)、[网站回滚与OSS配置](网站回滚与OSS配置.md)。
