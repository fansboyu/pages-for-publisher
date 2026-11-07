# 数告星发布中心 v1.5.1

多客户官网制作、AI图文、静态发布与回滚、客户Agent部署、外部媒体投稿、GEO查询及金额管理。

## v1.5.1 更新

全模块沿用工作台视觉，统一主题横幅、表单、列表与状态。账单与服务器页面分为页签，长记录支持本地分页，AI图文展示真实任务状态。业务API、权限和数据库结构保持原有逻辑。

- [全模块UI与验收说明](docs/全模块UI统一与本地验收.md)

## v1.5.0 更新

发布、AI创作、媒体、GEO 四类 Worker 独立运行；AI图文采用持久化异步任务。升级涉及迁移018及异步接口变化，需要同步更新API、前端和Worker。

- [四类Worker架构、接口变化与升级说明](docs/四类Worker拆分与本地验证.md)

## v1.4.0基础功能详细文档

- [系统功能详细介绍](docs/v1.4.0-系统功能详细介绍.md)：功能清单、角色、运营流程与已知边界。
- [前端UI与API调用说明](docs/v1.4.0-前端UI与API调用说明.md)：页面结构、组件、接口映射与交互状态。
- [后端架构与API参考](docs/v1.4.0-后端架构与API参考.md)：容器关系、持久数据、接口字段、任务状态和升级步骤。

## 快速开始

要求Node.js 24+、Docker、项目支持的PostgreSQL稳定版和Redis，以及本机Caddy（CADDY_BIN或tools/caddy.exe）。

```sh
npm ci
npm run dev
```

默认API/控制台 http://127.0.0.1:4418 ，客户站体验 http://127.0.0.1:4420/sites/s1/ 。独立前端容器通过npm run frontend:local构建，入口4419。开发时可单独覆盖PORT，临时4424不是生产固定端口。

本地演示账号admin / Admin123!；agency / Agency123!；partner / Partner123!。仅供本地演示，不用于生产。敏感配置放Git忽略的.env.local；生产保持原.env。

生产入口compose.production.yml；external profile复用一个Worker处理媒体投稿与GEO；provisioning profile可选SSH接入。迁移001～017须在启动业务前完成，external-worker与API共享platform-data:/data。

## 验证

npm test验证官网构建/部署/回滚主闭环；npm run test:website、test:geo、test:external、test:billing、test:permissions、test:frontend检查对应模块。真实供应商调用与OSS联合验收不由模拟测试代替。

GEO初始单价0.20元/问题/平台，正式计费默认关闭且GEO_QUERY_MODE默认为demo。公开截图不等于公开查询记录。Kimi正式查询、B2B和自媒体渠道、视频真实生成仍未开放。

外部媒体目录已通过真实只读验证，真实付费投稿、GEO与OSS联合验收仍需明确额度后进行。本次源码发布不代表生产服务器已升级。
