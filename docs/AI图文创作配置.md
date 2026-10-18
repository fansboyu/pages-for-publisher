# AI 图文创作配置

AI 图文创作由两类模型协作：DeepSeek 生成文章结构、正文和各段配图计划；阿里云百炼按画面描述生成图片。发布中心下载百炼的临时图片链接，将图片转存到当前图片存储（本地或 OSS），插入正文对应小节，然后自动创建网站发布任务。

默认生成 1 张封面和 2 张正文图，创作页面可选择 2 或 3 张正文图。图片按文章小节定位，阿里云临时结果 URL 不会直接写进客户网站。上传 OSS 需启用 `STORAGE_DRIVER=oss` 并确保图片公网 HTTPS 域名可读。

## 环境变量

文本模型和图片模型使用独立密钥及地域地址，配置只放在 API 和 Worker 的服务端环境中：

```dotenv
AI_TEXT_BASE_URL=https://api.deepseek.com/v1
AI_TEXT_API_KEY=DeepSeek密钥
AI_TEXT_MODEL=DeepSeek控制台中的模型名
AI_TEXT_MAX_TOKENS=8192

ALIYUN_IMAGE_BASE_URL=https://dashscope.aliyuncs.com
ALIYUN_IMAGE_API_KEY=阿里云百炼API密钥
ALIYUN_IMAGE_MODEL=百炼控制台中的图片模型名
ALIYUN_IMAGE_API_STYLE=text2image
ALIYUN_IMAGE_SIZE=1280*720
AI_INLINE_IMAGE_COUNT=2
AI_IMAGE_TIMEOUT_MS=300000
ALIYUN_IMAGE_POLL_INTERVAL_MS=10000
```

`ALIYUN_IMAGE_BASE_URL` 要与百炼 API Key 所属地域匹配。北京公共域名可用上例；如果控制台要求业务空间专属域名，请填写完整域名，可包含 `/api/v1`，程序会自动规范路径。不同地域的 Key 和接入域名不可混用。

`ALIYUN_IMAGE_API_STYLE=text2image` 使用万相文生图接口 `/services/aigc/text2image/image-synthesis`，适用于文生图 V1/V2 接口。`ALIYUN_IMAGE_API_STYLE=multimodal` 使用异步图像生成接口 `/services/aigc/image-generation/generation`，适用于 Wan 2.6/2.7 一类新接口。分辨率必须符合所选模型规格；例如旧万相接口可选 `1280*720`，Wan 2.7 通常选择 `1K` 或 `2K`。百炼任务 URL 会过期，系统取得结果后立即下载并转存。

`AI_INLINE_IMAGE_COUNT` 支持 1–3 张正文图，缺省为 2；页面也能按篇选择 2 或 3 张。每篇图片总数是在正文图之外加 1 张封面。`AI_IMAGE_TIMEOUT_MS` 默认 5 分钟，图片任务按 `ALIYUN_IMAGE_POLL_INTERVAL_MS` 间隔查询，默认 10 秒。

## 本地配置与启动

复制 `.env.local.example` 为被 Git 忽略的 `.env.local`，填写模型配置后运行 `npm run dev`；启动脚本会读取此文件，API、Worker 和本地 Agent 使用同一进程环境。也可以在 PowerShell 会话中设置上述变量：

```powershell
$env:AI_TEXT_BASE_URL="https://api.deepseek.com/v1"
$env:AI_TEXT_API_KEY="填入本机的DeepSeek密钥"
$env:AI_TEXT_MODEL="填入已开通的DeepSeek模型名"
$env:ALIYUN_IMAGE_BASE_URL="填入与百炼Key对应的地域地址"
$env:ALIYUN_IMAGE_API_KEY="填入本机的百炼密钥"
$env:ALIYUN_IMAGE_MODEL="填入已开通的图片模型名"
$env:ALIYUN_IMAGE_API_STYLE="text2image"
npm run dev
```

真实 OSS 验证时还需在 `.env.local` 中配置 OSS 图片 Bucket、地域、RAM 凭据及 HTTPS 图片域名，并将 `STORAGE_DRIVER=oss`。只想本机检查文章和发布链路时，可先使用 `local`，但这不代表 OSS 公网访问已验收。`.env.local` 已加入 Git 忽略规则，切勿将实际密钥提交到仓库。

## 检查与限制

无文本模型配置时使用明确标记的本地演示文案；无百炼图片配置时生成本地演示图片。文本或图片 API 调用失败会返回错误，不会把演示内容伪装成真实模型结果。单张下载图片上限为 5MB，服务端会转换成 WebP 并保存到素材存储。实际企业内容会发送给 DeepSeek 和百炼，使用前应确认企业数据处理授权与模型账户用量。

API 约定参考阿里云百炼官方的[万相文生图 API](https://help.aliyun.com/zh/model-studio/text-to-image-api-reference)和[图像生成与编辑 API](https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference)。
