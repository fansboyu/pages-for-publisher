# AGENTS.md — 数告星发布中心 v1.3.2

本文件为后续维护者提供仓库地图和改造约束。当前发布版本为 **v1.3.2**。提交变更前阅读本文及相关模块文档；不要把本文件中的示例或流程描述当作线上服务当前状态的证明。

## 运行与验证

- Node.js：要求 24 或更新版本；项目使用原生 ESM。
- 本地完整试点：`npm run dev`。默认控制台 API 为 `http://127.0.0.1:4418`，由本机 Caddy 提供网站预览 `http://127.0.0.1:4420/sites/s1/`。
- 演示登录：`admin / Admin123!`。仅用于本机演示数据库，禁止用于生产。
- `npm test`：主发布闭环。
- `npm run test:ai`：文章生成与 DeepSeek / 百炼接口契约模拟。
- `npm run test:frontend`、`npm run test:multi-site`、`npm run test:phase1`：前端、多站点、阶段一回归。
- `npm run test:templates`：客户模板上传和验证；需要通过 `TEST_TEMPLATE` 指向符合模板协议的外部测试模板目录。
- 检查模块语法：`node --check <path>`；提交前运行 `git diff --check`。

完整部署和运行说明见 `docs/正式试点版架构与运行.md`、`docs/deployment.md`。AI 配置见 `docs/AI图文创作配置.md`；Agent 与客户现有 Caddy 共存见 `docs/客户Agent与现有Caddy共存.md`。

## 系统结构

- `pilot/server.mjs`：控制台 HTTP 服务、鉴权、管理 API、AI 文章生成入口及自动发布编排。
- `pilot/worker.mjs`、`pilot/publishing.mjs`：BullMQ 后台队列、站点构建、发布版本与回滚。
- `pilot/ai-article.mjs`：文本/图片供应商调用、文章结构校验、图片下载与压缩。供应商密钥只能由服务端读取。
- `pilot/templates.mjs` 和 `pilot/templates/`：模板协议、模板加载、渲染及内置基础模板。
- `agent/agent.mjs`：客户服务器部署 Agent；处理控制端任务、目录切换与 Caddy 配置。`agent/wait-caddy.mjs` 和 `deploy/site-agent-shared.service` 用于与客户已有 Caddy 共存。
- `public/`：管理控制台前端。
- `pilot/migrations/`：PostgreSQL 顺序迁移；结构变化必须新增迁移文件，不要只改建表代码。
- `pilot/storage-adapter.mjs`：媒体和发布归档的存储抽象。图片存储由 `STORAGE_DRIVER` 控制，发布包/快照/模板 ZIP 可由 `ARCHIVE_STORAGE_DRIVER` 独立控制。
- `scripts/pilot-env.mjs`、`scripts/pilot-local.mjs`：本机环境加载和试点运行编排；不要让本地密钥进入浏览器或提交历史。

## AI 图文创作链路

1. 管理员在站点创作界面提供主题、关键词、地区、语气、字数、配图风格和正文配图数。
2. 服务端调用兼容 OpenAI Chat Completions 的文本接口（默认 DeepSeek），要求返回文章元信息、分节正文与对应小节的图像提示词。
3. 服务端独立调用阿里云百炼万相异步图片 API：封面 1 张，正文图默认 2 张，可选择 3 张。支持 `ALIYUN_IMAGE_API_STYLE=text2image` 与 `multimodal`。
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
- 调整配置项时，同步更新 `.env.example`、`.env.pilot.example`、`.env.local.example`（若适用）及对应文档；示例中只能出现占位符。
- 版本发布前检查 `package.json`、`package-lock.json`、`CHANGELOG.md` 和 Git tag 是否一致；运行本次改动对应测试与主发布闭环测试。
