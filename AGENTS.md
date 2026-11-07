# AGENTS.md — 数告星发布中心 v1.5.1

本文件为后续维护者提供仓库地图和改造约束。当前版本为 **v1.5.1**。提交变更前阅读本文及相关模块文档；不要把本文件中的示例或流程描述当作线上服务当前状态的证明。

v1.3.5：角色页面权限见 `pilot/permissions.mjs`，员工账号状态迁移为 007，停用账号必须同时拒绝新登录并撤销旧会话。代理商状态响应不得包含 GEO Key。视频仅预留能力接口，不支持真实生成。标签后的 SSH 接入增量见 `docs/服务器自动接入与Provisioner.md`；不要将增量描述为原标签包含的功能。页面权限回归为 `node tests/permissions-ui.mjs`。

## 运行与验证

SSH 接入本地增量：迁移 009，API 为 `pilot/provisioning.mjs`，独立执行器为 `provisioner/`，页面为 `public/provisioning-ui.js`。仅直营管理员、明确公网 IP 白名单、固定 SSH 指纹、预检后二次确认安装。只支持空闲 Ubuntu 22.04/24.04 x86_64 root/systemd；既有网站服务或保留端口占用必须阻止。SSH 凭据只在执行器内存暂存10分钟，不落库、不写日志。安装失败或状态不明不得自动重复安装。成功必须由主控验证 Agent 回连，不能仅凭 SSH 返回成功。专项测试 `npm run test:provisioning` 使用真实 SSH2/SFTP 协议，但远端 systemd 和回连是测试端模拟，不能作为真实云主机验收证据。

人民币计费本地增量：迁移 008，核心 `pilot/billing.mjs`，前端 `public/billing-ui.js`，专项验证 `npm run test:billing`。余额以整数分保存，变更必须使用事务并保留追加式流水；图文必须先报价和预占后调用供应商。不得对超时订单自动释放或再次调用模型。原 v1.3.5 标签未移动；使用说明见 `docs/人民币计费使用与验收.md`。

- Node.js：要求 24 或更新版本；项目使用原生 ESM。
- 本地完整试点：`npm run dev`。默认控制台 API 为 `http://127.0.0.1:4418`，由本机 Caddy 提供网站预览 `http://127.0.0.1:4420/sites/s1/`。
- 演示登录：`admin / Admin123!`。仅用于本机演示数据库，禁止用于生产。
- `npm test`：主发布闭环。
- `npm run test:alerts`：告警事件与重复抑制契约。
- `npm run test:ai`：文章生成与 DeepSeek / 百炼接口契约模拟。
- `npm run backup`：通过 Docker Compose 导出 PostgreSQL 与平台文件备份。
- `npm run test:frontend`、`npm run test:multi-site`、`npm run test:phase1`：前端、多站点、阶段一回归。
- `npm run test:templates`：客户模板上传和验证；需要通过 `TEST_TEMPLATE` 指向符合模板协议的外部测试模板目录。
- 检查模块语法：`node --check <path>`；提交前运行 `git diff --check`。

完整部署和运行说明见 `docs/正式试点版架构与运行.md`、`docs/deployment.md`。AI 配置见 `docs/AI图文创作配置.md`；Agent 与客户现有 Caddy 共存见 `docs/客户Agent与现有Caddy共存.md`。

## 系统结构

本地智能建站增量：迁移011，`pilot/website-builder.mjs` 管理独立草稿、历史、生成任务与权限；`pilot/ai-website.mjs` 负责受控JSON生成；`pilot/website-renderer.mjs` 统一渲染预览与发布页面；`public/website-builder-ui.js` 为控制台入口。现有Worker轮询持久化建站任务，不新增容器。官网正式草稿保存在 `sites.content.builder`，生成草稿须显式应用后才进入原发布快照。建站沿用一次文章文字单价及0/1张图片单价；预占、任务登记同事务，草稿持久化与扣款同事务；Worker失联不得自动重发供应商请求。运行 `npm run test:website`，说明见 `docs/AI智能建站简易版.md`。该功能纳入v1.3.9；生产部署状态需独立核实。

- `pilot/server.mjs`：控制台 HTTP 服务、鉴权、管理 API、AI 文章生成入口及自动发布编排。
- `pilot/worker.mjs`、`pilot/publishing.mjs`：BullMQ 后台队列、站点构建、发布版本与回滚。
- `pilot/ai-article.mjs`：文本/图片供应商调用、文章结构校验、图片下载与压缩。供应商密钥只能由服务端读取。
- `pilot/analytics.mjs`、`pilot/migrations/005_site_analytics.sql`：静态网页埋点脚本、域名配置和按日访问汇总；访客统计设计见 `docs/网站访问统计.md`。
- `pilot/migrations/006_knowledge_regions_alerts.sql`：客户级企业知识库/行业词库、地区站字段及告警去重记录。
- `pilot/alerts.mjs`、`scripts/backup.mjs`：构建/部署/Agent 状态告警，以及 PostgreSQL 与平台文件的一体化备份。
- `pilot/templates.mjs` 和 `pilot/templates/`：模板协议、模板加载、渲染及内置基础模板。
- `agent/agent.mjs`：客户服务器部署 Agent；处理控制端任务、目录切换与 Caddy 配置。`agent/wait-caddy.mjs` 和 `deploy/site-agent-shared.service` 用于与客户已有 Caddy 共存。
- `public/`：管理控制台前端。
- `pilot/migrations/`：PostgreSQL 顺序迁移；结构变化必须新增迁移文件，不要只改建表代码。
- `storage-adapter.mjs`：媒体和发布归档的存储抽象。图片存储由 `STORAGE_DRIVER` 控制，发布包/快照/模板 ZIP 可由 `ARCHIVE_STORAGE_DRIVER` 独立控制。
- `scripts/pilot-env.mjs`、`scripts/pilot-local.mjs`：本机环境加载和试点运行编排；不要让本地密钥进入浏览器或提交历史。

## AI 图文创作链路

1. 管理员在站点创作界面提供主题、关键词、地区、语气、字数、配图风格和正文配图数。
2. 服务端调用兼容 OpenAI Chat Completions 的文本接口（默认 DeepSeek），要求返回文章元信息、分节正文与对应小节的图像提示词。
3. 服务端独立调用阿里云百炼万相异步图片 API：封面 1 张，正文图默认 2 张，可选择 3 张。图片请求在 API 进程内串行排队，并至少间隔 1.1 秒，避免触发北京 `wan2.6-t2i` 每秒 1 次的请求限制。支持 `ALIYUN_IMAGE_API_STYLE=text2image` 与 `multimodal`。
4. 百炼返回的临时 URL 只在服务端下载；压缩为 WebP 并通过存储适配器持久化。成功后把正文图作为 `<figure>` 插入关联小节，并保存文章/SEO 信息。
5. 产品当前采用直接生成并进入发布队列的流程，没有人工审核节点。任一生成、下载或持久化错误应返回可见失败；不得静默把失败描述为已完成发布。

DeepSeek 和百炼配置必须彼此独立。至少需要 `AI_TEXT_BASE_URL`、`AI_TEXT_API_KEY`、`AI_TEXT_MODEL`，以及 `ALIYUN_IMAGE_BASE_URL`、`ALIYUN_IMAGE_API_KEY`、`ALIYUN_IMAGE_MODEL`。图片 API 域名需与 Key 所属地域一致。API Key 不得写入源码、前端、测试固定数据以外的日志或截图。

本地真实配置放在仓库根目录 `.env.local`，从 `.env.local.example` 复制；该文件应保持 Git 忽略。示例配置使用本地媒体存储，真实 OSS 验证需配置 `.env.example` 中的 OSS/RAM 参数、Bucket、地域和可匿名 HTTPS 读取的图片域名，并设置 `STORAGE_DRIVER=oss`。OSS 验证应通过新生成文章中的图片 URL 完成公网读取检查。不要将阿里云主账号密钥放入应用。

未配置供应商凭据时，AI 文章与图片模块会进入 demo 模式。自动化测试使用 mock API，不会证明真实 DeepSeek、百炼、OSS 或公网域名已经可用。报告验证结果时必须清楚区分 mock、demo、本地存储和真实服务验收。

## 改造约束

- 先沿现有服务端/Worker/Agent边界修改，不要把供应商 API 密钥或 OSS 访问密钥暴露到浏览器。
- 外部 API 必须有超时、状态检查和输入/输出校验；百炼临时图片先下载持久化，再写入内容。
- 文章正文用现有模板渲染与发布链路；更改表结构时增加迁移并覆盖迁移后的核心行为测试。
- 修改发布、回滚、站点路由或 Agent Caddy 管理逻辑时，同时检查多站点隔离和现有客户 Caddy 配置共存。
- 改动统计采集时，确保只接受绑定到该站点的 HTTPS 来源域名；域名别名需要同步 Agent 下发与 Caddy 路由，并测试代理商数据隔离。
- 调整配置项时，同步更新 `.env.example`、`.env.pilot.example`、`.env.local.example`（若适用）及对应文档；示例中只能出现占位符。
- 版本发布前检查 `package.json`、`package-lock.json`、`CHANGELOG.md` 和 Git tag 是否一致；运行本次改动对应测试与主发布闭环测试。

## v1.3.4 企业知识库、地区站与运维保障

- `client_knowledge` 按客户保存分类、标题、事实内容和重点行业词；代理商只能访问自己名下客户的数据。AI 生成自动读取该客户的知识库。
- 同一客户可建立多个独立地区站，各站有独立域名、内容草稿、文章、SEO、发布包和访问统计，同时共享客户知识库，地区词和目标词独立。
- 新地区站复制来源站首页初始内容和模板绑定，不复制文章、发布历史或服务器绑定。新建后须补充本地化内容并单独发布；DNS 与 HTTPS 证书由客户/运维配置。
- `npm run backup` 在生产部署目录执行，要求 Compose 的 `api` 与 `postgres` 服务运行。归档包含 PostgreSQL custom dump 与 `/data` 平台文件，不包含 `.env` 或 Redis 队列缓存。备份含网站内容与媒体数据，需按敏感数据管理。
- 可设置 `BACKUP_DIR`、`BACKUP_RETENTION_COUNT`、`BACKUP_COMPOSE_FILE`、`BACKUP_COMPOSE_ENV_FILE`、`BACKUP_DATA_ROOT`、`DOCKER_BIN`。设置 `BACKUP_DATA_ROOT` 时直接归档该目录，否则从运行中的 API 容器读取 `/data`。
- 设置 `ALERT_WEBHOOK_URL` 后，Worker 每分钟检查构建失败、部署失败及绑定站点的 Agent 离线；相同事件按 `ALERT_COOLDOWN_MINUTES` 抑制重复发送，Agent 恢复后清除离线抑制。
- 本地备份不等于异地备份。生产应将备份复制到独立存储并定期在隔离环境验证恢复。

官网协议v2本地增量：pilot/website-protocol.mjs定义规则和最终产物检查，v1/v1.1兼容；AI建站首页文章区和列表详情共用website-renderer，文章路径沿用绑定模板。文档docs/官网协议-v2.md，验证node tests/website-protocol.mjs。不新增迁移、容器或版本标签。

## v1.4.0维护入口

- 版本总览：docs/v1.4.0-系统功能详细介绍.md。
- 前端页面与接口调用：docs/v1.4.0-前端UI与API调用说明.md。
- 后端架构、API契约及部署：docs/v1.4.0-后端架构与API参考.md。
- 连续对话：迁移012，website-conversation.mjs；草稿修改、预览、应用和发布独立。
- 工作台：workspace.mjs只读聚合权限内的数据；不能将演示/本地运行证明为云端验收。
- 外部发布：迁移013/014；external-worker.mjs复用媒体投稿与GEO调度。真实目录已读通，真实付费投稿未联合验收。媒体筛选只作用于供应商当前页，不能宣称全库筛选。
- GEO：迁移015/016/017，geo-workflow.mjs管理报价、单平台账单、租约与独立截图归档；geo-provider.mjs适配小青蛙。默认GEO_QUERY_MODE=demo；每平台20分初始单价，但正式计费默认关闭。客户原预算保留。截图公开读取，不等于公开查询记录。Kimi正式查询暂未验收。
- 提交超时不得重发或自动退款；截图失败只重试归档。新配置项同步三个env示例。专项npm run test:geo、npm run test:external、npm run test:website及主发布回归。
- 生产external-worker须挂载platform-data:/data（DATA_ROOT=/data），与API共享本地截图；OSS使用相同媒体配置。
- 不提交.env、.env.local、运行数据、备份、截图凭据或本地测试报告。发布前检查版本、锁文件、CHANGELOG和标签一致。生产部署需另行授权并保留既有.env。

## v1.5.0：四类 Worker

详见 docs/四类Worker拆分与本地验证.md。迁移018新增ai_article_jobs；图文由API报价/预占并持久化排队，AI Worker执行。文章、媒体记录、结算、发布outbox和任务成功同事务。运行中租约过期转review，禁止自动重发付费生成。API与AI Worker必须使用相同模型模式。新增GET /api/sites/:site/ai-articles/:jobId，权限仍按站点归属校验。

worker.mjs只处理构建/发布与运维告警；ai-worker.mjs处理图文及建站；media-worker.mjs处理媒体；geo-worker.mjs处理查询及截图。external-worker.mjs仅为媒体兼容入口，不再消费GEO。生产启用external profile启动媒体和GEO；升级前停止旧combined worker并等待正在执行的付费请求结束。不要同时运行旧版本的混合Worker。npm run test:workers验证隔离、幂等、租约和四进程启动。

## v1.5.1：全模块工作台风格

public/module-ui.js 和 module-ui.css 为展示层，app.js 在页面HTML建立后、原有业务事件绑定前调用增强。移动节点时不克隆表单，保留ID/name和原处理器；不得把草图示例数据带入真实页面。新增静态资源路由只供前端加载，不改变业务API。账单汇总只统计当前账号可见账户，平台配置按原权限返回。金额、服务器页面的页签不删除隐藏表单。列表分页只作用于当前已加载记录，不能描述为全库搜索。AI进度只读取queued/running/succeeded/failed/review，不虚构模型子阶段百分比。

专项 npm run test:module-ui 使用隔离PostgreSQL、本地API和AI Worker、浏览器，测试20模块、移动端、保存、权限、报价和免费演示图文。需要开发环境提供Playwright，可由PLAYWRIGHT_MODULE_PATH指定其index.mjs；不得因此将浏览器依赖安装到生产镜像。说明见 docs/全模块UI统一与本地验收.md。本地预览不代表生产已更新。
