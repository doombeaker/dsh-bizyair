# 发布与维护

这份文档说明两件事：把这个插件整理成可持续维护的仓库，以及怎么让它出现在 DSH 的插件市场（Discover）。

---

## 一、仓库结构

```
dsh-bizyair/
├── package.json          # name / version / exports / dsh.bundle + dsh.client
├── cordis.patch.yml      # bundle patch：插入一行 bizyair 插件（含默认 config）
├── index.js              # Loader 入口（带 cache-busting 的动态 import，便于热重载）
├── client.js             # Web 面板（settings.section + conversation.view）
├── lib/
│   ├── impl.js           # 工具注册、任务注册表、Web 路由、审批、审计
│   ├── api.js            # BizyAir HTTP 客户端、OSS 直传、下载、密钥探针
│   └── catalog.js         # 目录装饰、检索、schema 投影、校验、成本估算
├── data/catalog.json     # 构建产物（235 模型 + schema + 封面线索）
├── scripts/
│   ├── build-catalog.mjs # 从 BizyAir 公开文档重建 catalog.json
│   └── build-index.mjs   # 生成插件市场 index（format 1）
├── market/index.example.json
├── locale/{en,zh}.json
├── icon.svg
├── docs/PUBLISHING.md
├── CHANGELOG.md
└── LICENSE
```

`.gitignore` 已排除：`node_modules/`、`.cache/`（构建抓取的页面缓存，约 50 MB）、`bizyair/`（运行时产物）、`*.key`。

### 发布前要改的地方

包名已改为 **`dsh-bizyair`**（已确认 npm 上可用），`private` 已移除，`cordis.patch.yml` 与 `client.js` 的模块 id 已同步。若改用 scoped 名（如 `@you/dsh-bizyair`），改 `package.json.name`、`cordis.patch.yml.name`、`client.js` 里的 `id:` 三处，然后重装：

```
plugin_manager install_bundle  target=<该目录绝对路径>
```

---

## 二、DSH 插件市场的真实形态

当前这个构建里**没有"提交到官方商店"的入口**。插件市场（Discover 页）是**用户配置的插件索引（index）**：

- 官方目录是随 DSH 一起发布的（`list_bundles` 里 `official: true` 的那些），不能提交
- 第三方插件通过 **plugin index（JSON，format 1）** 分发：你把它托管在任意 HTTPS 地址，用户把该地址加进 Discover
- 该能力由一个实验性 bundle 提供：`@deepseek-ai/dsh-experimental-plugin-market-bundle`（默认关闭）

所以"上架"= **npm 发布包 + 托管一个 index.json + 用户添加索引地址**。

### index 格式（format 1，已对照校验器源码）

校验器是 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex`，硬性要求：

```jsonc
{
  "format": 1,                                  // 必须
  "title": { "en": "…", "zh": "…" },            // 必须，且必须含 en
  "description": { "en": "…" },                 // 可选
  "metadata": {
    "categories": { "media": { "title": { "en": "Media generation" } } },
    "labels": {}, "sortKeys": {}                // 可选；插件只能引用已声明的 id
  },
  "plugins": [
    {
      "name": "dsh-bizyair",                    // 必须：合法 npm 包名
      "title": { "en": "…" },                   // 可选
      "description": { "en": "…" },             // 可选
      "icon": "icon.svg",                       // 可选：https 绝对地址，或与 index 同源的相对地址
      "author": "…", "homepage": "https://…",   // 可选
      "repository": { "url": "https://…", "directory": "sub/dir" },  // 可选
      "metadata": { "category": "media", "keywords": ["…"], "labels": [], "sortKeys": {} },
      "versions": [
        {
          "version": "0.9.1",                   // 必须：精确 SemVer，不可重复
          "publishTimestamp": 1793966283,       // 必须：Unix 秒（整数）
          "source": { "type": "npm" },          // 或 {"type":"git","url":"https://…","commit":"40位sha","path":"可选"}
          "engines": { "dsh": ">=0.2.0" }       // 可选：SemVer range
        }
      ]
    }
  ]
}
```

安装参数由 index 决定：

- npm → `pnpm add dsh-bizyair@0.9.1`（可带 `registry`）
- git → `git+https://….git#<commit>&path:/<dir>`

**硬性坑**：

- index 地址必须是 **HTTPS 且不经过重定向**（读取端拒绝 redirect）
- 相对 `icon` 会按 index 的 URL 解析，必须与 index **同源**（把 `icon.svg` 放在 `index.json` 旁边即可）
- 内联 `data:` icon 解码后不得超过 32 KiB
- 索引内容**未签名**：真正的约束来自安装后的 `package.json`，不要信任索引里的元数据
- 当前版本**不支持原地升级**：`update-available` 只提示，升级要"卸载 + 重新安装"

### 生成 index

```bash
# npm 分发
node scripts/build-index.mjs --name dsh-bizyair --source npm \
  --author doombeaker --repository https://github.com/you/dsh-bizyair \
  --out market/index.json

# git 分发（会读取当前 HEAD commit）
node scripts/build-index.mjs --name dsh-bizyair --source git \
  --git https://github.com/you/dsh-bizyair \
  --repository https://github.com/you/dsh-bizyair \
  --path "" --out market/index.json
```

`market/index.example.json` 是生成结果示例，可直接对照。

---

## 三、完整发布步骤

1. **改名**
   把 `package.json` 的 `name` 改成可发布的包名，`private` 删掉，同步 `cordis.patch.yml`。
2. **本地自测**
   `plugin_manager install_bundle` 指向该目录，确认工具与面板仍工作（改包名后必须重装一次）。
3. **发布到 npm**
   ```bash
   npm publish --access public
   ```
   `files` 已限定只发布运行所需文件（`index.js`、`client.js`、`lib/*.js`、`data/catalog.json`、`locale/*`、`icon.svg`、`cordis.patch.yml`）。
4. **构建 index 并托管**（CI 已自动化：`.github/workflows/release.yml`）
   ```bash
   node scripts/build-index.mjs --name <包名> --source npm --repo … --out market/index.json
   ```
   把 `index.json` + `icon.svg` 放到同一目录，例如 GitHub Pages：
   `https://you.github.io/dsh-bizyair/index.json`
5. **用户侧启用市场能力**（一次性）
   ```
   plugin_manager set_bundle  target=@deepseek-ai/dsh-experimental-plugin-market-bundle  enabled=true
   ```
   然后在 Web 的 **Plugins → Discover** 里添加你的 index URL。
6. **安装**
   在 Discover 里点安装（走 `plugin_manager.install_bundle`，带索引给出的 spec/registry）。

> 如果将来 DSH 开放官方商店提交，这套产物可以直接复用：npm 包 + format 1 index 就是它的输入格式。

---

## 四、升级（实测结论，2026-11-06 / dsh 0.2.2-rc.1）

`install_bundle` 对已安装的同名包直接返回 `already-installed`，所以升级必须先卸载：

```bash
plugin_manager remove_bundle  target=dsh-bizyair
plugin_manager install_bundle target=dsh-bizyair@0.10.0
```

本次实测（0.9.x 本地 link → npm 0.10.0）：

- `application: applied`，**应用无需重启**
- `/bizyair/api/health` 的 `pluginVersion` 立刻变为新版本，证明加载了新的代码代
- 原因：`index.js` 用带时间戳的动态 import 加载实现，插件重新 apply 时会重新导入

**例外**：如果新版本改动了 `index.js` 本身、`package.json` 的 exports/依赖，或 patch 行结构，
仍需重启应用；客户端面板另需刷新页面（HMR 通常会自动完成）。

验证命令：

```bash
curl -s http://127.0.0.1:<port>/bizyair/api/health | jq '{pluginVersion, clientLoad, key}'
```

## 五、日常维护

| 场景 | 操作 |
|---|---|
| BizyAir 上新模型 | `npm run build:catalog`（默认用 `.cache/` 缓存，快；`--refresh` 强制重抓） |
| 发新版本 | 改 `version` → 更新 `CHANGELOG.md` → `npm publish` → 重新生成 index |
| 改面板/工具代码 | 保存后插件会自动热重载（Host 为动态 import，Client 走 HMR） |
| 调试面板 | `GET /bizyair/api/health` 查看 client 版本与 key 状态 |
| 清理缓存 | 删 `.cache/` 即可，下次构建重新抓取 |
| 校验语法 | `npm run check` |

### 安全提醒

- 密钥只存在 `$DSH_HOME/bizyair.key`（600），或环境变量 / `apiKeyFile`；**不要**写进 config、README、index
- 运行产物与审计在 `<workspace>/bizyair/`，已在 `.gitignore`
- 下载代理 `/bizyair/api/file` 只允许 `*.bizyair.ai`，避免变成任意 URL 转发器
