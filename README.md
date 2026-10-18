# 数告星发布中心 v1.3.1

当前版本 `1.3.1`。本版移除历史仓库分支发布实现，支持图片与私有归档分别选择本地或OSS存储。采用一台客户服务器一个Agent＋一个专用Caddy；每个网站独立目录、域名和发布版本，总控管理绑定与发布，客户网站由自己的服务器持续提供访问。

总控部署入口为根目录 `compose.production.yml`。后端与构建器在 `pilot/`，后台前端在 `public/`，客户部署程序在 `agent/`。模板通过ZIP上传或目录导入，构建归档后由Agent部署。参阅[当前架构](docs/architecture.md)、[部署说明](docs/deployment.md)、[网站回滚与OSS配置](docs/网站回滚与OSS配置.md)。

采用 Node.js 24、PostgreSQL **18.6**、Redis/BullMQ 独立构建 Worker、Caddy 和部署 Agent。PostgreSQL版本已按2026-10-16官方稳定版本核实，拒绝使用RC/beta版本。

生产部署已拆成独立前端、API、Worker、PostgreSQL、Redis五个常驻容器，另有一次性数据库迁移任务。前端内置Jodit资源，不持有数据库/OSS密钥，通过同源代理连接API。见 [前后端容器与依赖](docs/前后端容器与依赖.md)。本地原开发入口保持不变，启动API后可执行 `npm run frontend:local`，在 http://127.0.0.1:4419 体验独立前端容器。

安装依赖后执行 `npm run dev`，启动本项目Docker数据库与Redis，然后启动API、Worker、Agent和真实Caddy。需要Docker正在运行，以及 tools/caddy.exe（Linux可用CADDY_BIN）。

总控 http://127.0.0.1:4418，Caddy体验网站 http://127.0.0.1:4420/sites/s1/。

演示账号：admin / Admin123!；agency / Agency123!；partner / Partner123!。

支持网站创建、代理商范围隔离、官网标题/介绍/电话编辑、Jodit富文本、图片WebP压缩、GEO幂等API、静态网站生成、版本归档、Agent部署与回滚、服务器心跳和任务记录。素材与私有发布包支持本地目录或阿里云OSS存储。

内容、账号与任务分表存储在PostgreSQL；图片与归档支持OSS；开发时本地对象目录位于storage/pilot。模板导入后冻结为独立版本，tar.gz发布包包含固定页面、文章及全部静态资源。默认压缩上限128MB、展开512MB、20000文件，可配置。

旧SQLite版与原数据仍保留，可使用 `npm run dev:legacy`。只读迁移工具为 `scripts/import-legacy.mjs`，目标必须是空PostgreSQL数据库，禁止覆盖已有数据。

执行 `npm test` 在隔离数据库、随机端口和独立队列中进行正式试点链路验证；`npm run test:multi-site` 验证真实Caddy按域名分流、单站更新与回滚。测试默认使用仓库内置模板，不依赖其他客户目录；可通过TEST_CUSTOMER_TEMPLATE指向优佳家政模板再次验收。详见 [正式试点版架构与运行](docs/正式试点版架构与运行.md)。提供生产Compose、显式迁移、OSS配置及Agent服务示例；真实OSS、ECS和公网HTTPS需在配置云资源后验收。
