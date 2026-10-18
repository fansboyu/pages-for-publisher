# 客户网站回滚与OSS配置（v1.3.1）

本文基于 pilot/publishing.mjs、pilot/agent-api.mjs、agent/agent.mjs、storage-adapter.mjs 的实际行为。

## 1. 回滚恢复什么

每次发布冻结官网资料、已发布文章及模板版本，构建完整tar.gz归档。回滚直接重新部署历史产物，不重新构建，不覆盖后台当前资料、文章、模板绑定或服务器绑定。

例如：V1上线 → 修改并发布V2 → 回滚V1。访客看到V1，后台编辑内容仍是V2；此时再次发布会使用当前内容和当前绑定模板生成新版本。

固定在模板中的图片、CSS、JS随发布包恢复；文章引用的OSS图片只保存URL，必须保留原对象。回滚不恢复被删除的OSS对象，也不会清除浏览器/CDN已有缓存。

## 2. 回滚执行步骤

1. 在「发布与版本」选择网站，选择可回滚历史版本。后台界面目前展示曾上线live版本的回滚按钮。
2. API校验账号范围、目标版本属于该站点且有归档记录。后端允许live、ready、deploy_failed版本作为目标，但元数据存在不保证OSS对象仍存在。
3. 该网站存在queued/building构建，或queued/running部署时拒绝回滚，防止与正在执行的发布冲突。
4. 已绑定服务器：创建rollback部署任务，目标是当前绑定服务器和当前网站域名。Agent离线时等待，旧网站继续服务。
5. Agent领取任务，下载历史包。即使本机曾有相同版本目录，当前实现仍会下载和校验归档。
6. 校验包SHA-256、站点/版本身份、文件清单及路径，写入 `root/sites/<site-id>/releases/<release-id>`。
7. 保留同机其他网站路由，生成完整Caddy配置，仅改变目标网站目录；热加载后检查首页HTTP状态、版本响应头和HTML。
8. 本机检查成功后保存agent-state.json，再向总控回报。总控收到成功回执后更新active_release。回报中断时Agent会保留待报告结果并重试。
9. 热加载后的本机验证失败会尝试恢复原配置，后台显示失败。恢复原配置也可能失败，不构成高可用保证。

未绑定客户服务器时，回滚只切换总控预览的活动版本，不执行客户服务器部署。

## 3. 回滚的边界

- 单站点版本切换不会主动回滚同机其他网站；整机或Caddy故障仍可能影响所有网站。
- 回滚使用当前域名、服务器绑定；历史快照不会恢复旧DNS、旧服务器或证书配置。
- 迁移服务器后旧节点路由清理尚未自动实现。
- Agent验证的是本机HTTP；回滚后仍应从外部检查域名、HTTPS和关键页面。
- 客户网站回滚不是数据库恢复，也不是总控应用镜像回退。

## 4. OSS对象分工

| 内容 | Bucket | 对象前缀 | 读取方式 |
| --- | --- | --- | --- |
| 运营上传图片 | OSS_MEDIA_BUCKET | media/sites/<site-id>/<内容哈希>.webp | 长期稳定的HTTPS图片URL |
| 完整网站包 | OSS_ARCHIVE_BUCKET | archives/sites/<site-id>/<release-id>.tar.gz | Agent短期签名URL，代码有效期3600秒 |
| 内容快照 | OSS_ARCHIVE_BUCKET | archives/sites/<site-id>/<release-id>.snapshot.json.gz | 私有存储 |
| 模板原始ZIP | OSS_ARCHIVE_BUCKET | templates/<内容哈希>/source.zip | 私有存储 |

两个Bucket必须不同，当前代码使用同一个OSS_REGION访问它们，应建在同一区域。解压模板和总控预览仍在platform-data卷；启用OSS后仍需备份该卷和PostgreSQL。

## 5. 配置示例

在总控的 `.env`配置，以下为占位示例，不可直接使用：

```dotenv
STORAGE_DRIVER=oss
# 留空时归档跟随STORAGE_DRIVER；也可单独设置oss或local。
ARCHIVE_STORAGE_DRIVER=
OSS_REGION=oss-cn-shanghai
OSS_MEDIA_BUCKET=你的图片bucket
OSS_ARCHIVE_BUCKET=你的私有归档bucket
OSS_ACCESS_KEY_ID=受限RAM账号AccessKeyID
OSS_ACCESS_KEY_SECRET=对应AccessKeySecret
OSS_STS_TOKEN=
MEDIA_PUBLIC_BASE_URL=https://img.example.cn
PUBLIC_BASE_URL=https://admin.example.cn
```

- 图片域名尚未配置好时，可使用 `STORAGE_DRIVER=local`、`ARCHIVE_STORAGE_DRIVER=oss`，只启用私有归档；后台检测只覆盖已启用的OSS部分，不代表图片OSS已验收。
- OSS_REGION填SDK区域标识，不填完整URL；Bucket填名称，不带https或路径。
- MEDIA_PUBLIC_BASE_URL是对象路径的根URL，建议使用稳定图片域名。例如代码追加 `media/sites/...`，不要在基础地址重复填写 `/media`。
- PUBLIC_BASE_URL是总控正式HTTPS地址，用于部分本地资源绝对地址，不是客户网站域名。
- 当前没有独立OSS_ENDPOINT配置项，不要假设可以仅通过新增该环境变量切换内网Endpoint。
- API和Worker都要读取一致的OSS配置。客户Agent只需要总控Token和短期下载地址，不配置OSS AccessKey。
- 修改 `.env` 后执行 `docker compose -f compose.production.yml up -d --force-recreate api worker`。单纯restart不重新读取Compose环境文件。

## 6. 图片公开访问与归档私有访问

图片必须能通过MEDIA_PUBLIC_BASE_URL匿名HTTPS读取。推荐私有图片Bucket配合CDN私有回源，CDN对访客提供稳定公开URL；也可采用受控的公共只读方案，禁止公共写。

私有Bucket配上普通CNAME不会自动获得匿名访问能力，需要正确配置CDN私有回源授权。网站HTML保存长期图片URL，不应使用会过期的图片签名链接。

归档Bucket保持私有，禁止匿名下载模板、发布包和快照。Agent使用带签名的临时URL，不向OSS发送总控Agent Token。客户服务器需要能够访问OSS公网HTTPS下载域名。

## 7. RAM与凭据

使用受限RAM用户或适当的临时凭据，不使用主账号AccessKey。当前业务及存储自检所需对象权限为oss:PutObject、oss:GetObject、oss:DeleteObject。授权范围包括：

```text
acs:oss:*:*:<图片bucket>/media/*
acs:oss:*:*:<归档bucket>/archives/*
acs:oss:*:*:<归档bucket>/templates/*
```

以上是资源范围示意，不是完整RAM策略JSON。自检使用 `media/sites/storage-probe-*`、`archives/probes/*`、`templates/probes/*`，只授权正式站点子目录会导致检测失败。

STS模式需同时填写临时AccessKeyID、临时Secret和OSS_STS_TOKEN。当前适配器启动时读取凭据，没有自动续期逻辑；到期前需由外部流程更新环境并重建API/Worker。切勿只替换Token而保留不匹配的AccessKey。

## 8. 保留、迁移与验证

- 回滚依赖历史tar.gz，生命周期规则不能提前删除仍需回滚的对象；避免把需即时回滚的包转入需要恢复等待的归档存储类型。
- 历史页面依赖原图片对象及原图片域名，图片留存策略需覆盖历史版本使用期。
- 当前没有按版本引用安全清理旧图片/归档的功能；删除前需要核对数据库版本和对象依赖。
- 从local切换oss仅改变后续读写驱动，不会自动搬迁旧归档、素材或重写既有图片URL；直接切换可能导致旧版本回滚下载失败，需先迁移并核对原对象key和图片地址。
- 在后台「模板管理 → OSS存储检测」执行真实检测，验证图片匿名HTTPS、私有对象读写、匿名拒绝、签名下载和测试对象清理。
- 检测通过后还需上传真实图片、发布网站，并从客户服务器验证历史版本回滚。总控检测通过不能替代客户网络验收。

## 9. 官方参考

- [OSS访问域名与网络连接](https://www.alibabacloud.com/help/en/oss/user-guide/access-and-network-overview)
- [CDN私有OSS回源](https://help.aliyun.com/en/cdn/user-guide/grant-alibaba-cloud-cdn-access-permissions-on-private-oss-buckets)
- [STS临时凭据](https://www.alibabacloud.com/help/en/oss/developer-reference/use-temporary-access-credentials-provided-by-sts-to-access-oss)
- [OSS SDK权限与配置](https://www.alibabacloud.com/help/en/oss/user-guide/oss-sdk-quick-start)
