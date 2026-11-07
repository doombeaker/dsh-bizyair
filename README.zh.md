# BizyAir 模型广场 · DeepSeek Harness 插件

**一块钱，200 张图，快速出片。**

在对话里浏览并运行 BizyAir 模型广场：235 个图像、视频、音频与视觉模型（默认启用 213 个），含参数 schema、费用预估、审批与任务面板。

[English →](README.md)

![dsh-bizyair 面板](https://cdn.jsdelivr.net/gh/doombeaker/dsh-bizyair@main/assets/screenshots/01-models.png)

**装一条命令**：`plugin_manager install_bundle  target=dsh-bizyair`
**费用**：注册 BizyAir 送 $1，≈ 200 张图（$0.005/张）或 8 条 5 秒 720P 视频（$0.025/秒）；估算 ≥ 20 USD 会二次确认，可先用 `bizyair_price` 估价。以 BizyAir 账单为准。

> 维护与发布说明：[docs/PUBLISHING.md](docs/PUBLISHING.md)

## 安装

把这句话交给任意 DSH 会话里的 agent 即可：

> 帮我安装 DSH 插件 `dsh-bizyair`：调用 `plugin_manager` 的 `install_bundle`，target 传 `dsh-bizyair`（npm 包名）。装好后确认插件已激活，并告诉我怎么配置 BizyAir API Key。

它等价于：

```
plugin_manager install_bundle  target=dsh-bizyair
```

不需要先启用插件市场——这条命令直接按 npm 包安装。安装后：

1. 打开 设置 → **模型广场 · BizyAir** → **API Key** 页，粘贴 `sk-...` 并点「保存并校验」
2. 或直接写文件：`printf '%s\n' 'sk-...' > ~/.dsh/bizyair.key`（600 权限）
3. 刷新页面，会话视图里会出现 **BizyAir** 标签

发布的 bundle 配置里不含任何绝对路径：密钥默认在 `$DSH_HOME/bizyair.key`，任务与产物默认落在你第一个已注册的工作区。

### 通过插件市场安装（可选）

```
plugin_manager set_bundle target=@deepseek-ai/dsh-experimental-plugin-market-bundle enabled=true
```

然后在 Plugins → Discover 添加索引：

```
https://doombeaker.github.io/dsh-bizyair/index.json
```

## 配置

- **API Key**：默认从 `$DSH_HOME/bizyair.key`（600 权限）读取，回退环境变量 `BIZYAIR_API_KEY`；更新用 `printf '%s\n' 'sk-...' > ~/.dsh/bizyair.key`
- **费用护栏**：估算 ≥ `approvalThresholdUsd`（默认 20 USD）时通过 `ctx.approval` 二次确认；`confirm_cost: true` 用于用户已明确同意后跳过
- **产物目录**：`<workspace>/bizyair/<YYYYMMDD>/<request_id>/`；审计写入 `bizyair/calls.jsonl`

## 工具（对话内）

| 工具 | 说明 |
|---|---|
| `bizyair_models` | 按关键词 / 产出类型 / 版本（self-hosted、economy、official）/ 价格上限搜索模型 |
| `bizyair_model` | 单个模型的完整参数规格（枚举、默认值、区间、上传限制）、示例 payload、价格表、文档链接 |
| `bizyair_generate` | 校验参数 → 估算成本 → 超阈值审批 → 提交；短任务直接返回结果，长任务转入后台 job 并立即返回 `request_id` + `job_id` |
| `bizyair_task` | 按 `request_id` 查询并下载产物（幂等） |
| `bizyair_upload` | 本地文件 → 三步上传（token → OSS STS → commit）→ 可引用的公网 URL |
| `bizyair_price` | 按价格表估算单次费用（按次 / 按秒 / 按字符 / 按像素） |

对话里也可以直接用内建 `job_output <job_id>` 读取后台任务的进度与结果。

## Web 面板

刷新页面后，会话视图切换器里会出现 **BizyAir** 视图（`conversation.view`，id `bizyair`，order 20）：

- 定位：BizyAir 的引流入口，功能是官网的子集；价格明细、更多模型、账号操作都引导回 bizyair.ai
- 中英双语，**默认英文**，可手动切换并记住选择
- 空态优先推荐便宜档（self-hosted / economy），卡片上标单价
- **任务页**：所有生成（面板或对话）都登记为任务记录，运行中/已完成都在，切换模型、刷新页面、重启都不丢；按今天/昨天/更早分组，可搜索；支持复用参数、保存产物、删除、查看参数与输出 JSON
- **结果预览**：图片/视频/音频统一进灯箱；图片支持滚轮缩放、拖拽平移、双击还原、左右滑动切换；视频用 CDN 首帧作封面
- 左侧：模型列表（搜索、类型、版本筛选、起始价、版本色标）
- 右侧：标题 / 版本徽标 / 描述 / 价格表 / 预估费用 / 文档与广场链接
- 参数区按 catalog schema 自动生成控件：枚举 → 下拉，布尔 → 勾选，数值 → 数字输入（带 min/max/step），文本 → 文本域，`*_urls` → 文件上传（带上传中状态）+ URL 列表；宽屏自动两列
- 必填缺失时禁用「生成」并提示缺哪些参数
- 运行状态：状态色 + 转圈 + 计时；「结果 / 状态 JSON」两个视图
- 结果可预览图片 / 视频 / 音频，支持复制链接、新窗口打开、保存到工作区
- **API Key 页**：粘贴保存、免费探针校验连接（不上传/不产生费用）、红绿状态点、掩码显示与校验时间
- 成本 ≥ 20 USD 时浏览器弹窗确认；请求 JSON 可一键复制

面板通过 Host 侧同源路由工作：

```
GET  /bizyair/api/catalog     模型目录 + schema
GET  /bizyair/api/task?id=    任务状态与产物 URL
POST /bizyair/post/quote      成本估算
POST /bizyair/post/generate   提交任务
POST /bizyair/post/upload     上传文件（原始字节）
GET  /bizyair/api/key         密钥状态（不含密钥本身）
POST /bizyair/post/key        保存并校验密钥
POST /bizyair/post/key-check  仅校验当前密钥
POST /bizyair/post/save       把产物保存到工作区
```

## 数据与刷新

`data/catalog.json`（约 740 KB）由 `scripts/build-catalog.mjs` 生成，来源：

- `https://www.bizyair.ai/sitemap-model-api-1.xml` → endpoint 清单
- `<广场URL>/llms.txt` → 参数表 / 约束 / 输出类型
- 模型页 HTML → 标题、描述、版本徽标、`og:image` 示例封面
- `https://www.bizyair.ai/llms/price` → 价格表

刷新目录：

```bash
cd dsh-bizyair && node scripts/build-catalog.mjs --refresh
```

缓存位于 `.cache/`，可安全删除。

## 架构

```
index.js          Loader 入口（cache-busting 动态 import，便于热重载）
lib/impl.js       工具注册、后台 job、审批、审计、Web 路由
lib/api.js        BizyAir HTTP 客户端、OSS 直传、下载
lib/catalog.js    目录装饰、检索、schema 投影、校验、成本估算
client.js         Web 面板（conversation.view）
data/catalog.json 模型目录快照
scripts/build-catalog.mjs
```

## 已知限制

- 面板结果只播放 CDN 链接，不落盘；需要长期保存请用 `bizyair_task`（下载到工作区）
- 无任务取消：BizyAir 未提供取消接口，后台 job 只能停止轮询
- 面板复用 `conversation.view` 槽位；后续可换到 `sidebar.right` 面板或增加独立页
- 目录里的文本 / 视觉模型默认不暴露（`allowedOutputs: [images, videos, audios]`），改成空数组即可全部启用
- 成本估算对多维阶梯价格是近似值，权威账单在 BizyAir 调用记录

## 许可证

MIT。`icon.svg` 与 `assets/icon-180.png` 中的 BizyAir logo 版权归 BizyAir。
