/**
 * BizyAir model plaza — Web panel.
 *
 * Seats: Settings → 模型广场 (primary) and a Conversation view (after the first
 * message). Model browsing, schema-driven parameters, live cost estimate, task
 * state with a JSON view, artifact saving, and API-key management.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bizyair',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState } = React

    const LONG_FIELDS = /^(prompt|negative_prompt|input|text|lyrics|emo_text|description)$/
    const IMAGE_EXT = /\.(png|jpe?g|webp|gif)(\?|$)/i
    const VIDEO_EXT = /\.(mp4|webm|mov)(\?|$)/i
    const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus|m4a)(\?|$)/i
    const LANG_KEY = 'bizyair.lang'
    const KEY_URL = 'https://www.bizyair.ai/user/api-key'
    const PRICE_URL = 'https://www.bizyair.ai/price'
    const SIGNUP_URL = 'https://www.bizyair.ai/login'
    const PLAZA_URL = 'https://www.bizyair.ai/modelzoo?sort=recently_add'
    let hostCtx = null

    /** Survives view unmount (the conversation renders one view at a time). */
    const uiState = {
      tab: 'models',
      query: '',
      kind: '',
      edition: '',
      endpoint: null,
      params: {},
    }

    const S = {
      zh: {
        title: 'BizyAir 模型广场', subtitle: '图像 · 视频 · 音频',
        tabModels: '模型广场', tabRuns: '任务', tabSettings: 'API Key',
        runsTitle: '任务记录', runsEmpty: '还没有任务。生成一次后会出现在这里。',
        runsActive: '运行中', runsClear: '清空已完成', expand: '查看详情', collapse: '收起',
        reuse: '复用参数', delete: '删除', rerunHint: '参数已载入，确认后点生成',
        search: '搜索模型、任务或厂商…',
        kinds: { all: '全部类型', image: '图像', video: '视频', audio: '音频' },
        editions: { all: '全部版本', 'Self-hosted': '自营', Economy: '经济版', Official: '官方' },
        loading: '正在加载模型目录…', loadFailed: '模型目录加载失败', retry: '重试',
        noModels: '没有匹配的模型', clearFilters: '清除筛选', models: '个模型',
        empty: '从左侧选择一个模型', params: '参数', required: '必填', reset: '恢复默认',
        missingRequired: '还有必填参数未填写',
        price: '查看价格', estimate: '预估费用', estimateEmpty: '填写参数后自动估算',
        browseAll: '在 BizyAir 浏览全部模型', recommend: '推荐模型',
        gImage: '文生图', gVideo: '文生视频', gVoice: '文生语音',
        exampleTag: '示例', noResultYet: '还没有结果，点上方「生成」', currentModel: '当前模型',
        submitting: '提交中…', submittingHint: '正在提交任务，等待 BizyAir 返回 request_id…',
        loadMore: '加载更多', statusAll: '全部状态',
        loadingFeatured: '正在加载最新热门模型…', featuredFailed: '热门模型加载失败',
        featuredPriceNote: '按价格从低到高推荐；单价为单次/每秒价格，以 BizyAir 账单为准。',
        upgradedTo: '已升级到 {v}',
        upgradeApplied: '已生效', upgradeNeedsRestart: '需要重启 DSH',
        upgradeRunning: '进行中', upgradeUnavailable: '未完成',
        updateAvailable: '发现新版本 {latest}（当前 {current}）',
        copyUpgrade: '复制升级指令', upgradeNow: '立即升级', version: '版本', lastUpgrade: '上次升级',
        upgradeConfirm: '将卸载当前版本并安装 {latest}。进行中的任务会中断轮询（已提交的任务本身不受影响）。安装失败会自动回滚。\n\n升级过程中请不要重启 DSH。继续？',
        upgrading: '正在升级…',
        upgradeDone: '升级完成，请手动刷新页面以加载新版本。',
        reloadPage: '刷新页面',
        upgradeTimeout: '升级未在预期时间内完成，请查看插件列表或应用日志。',
        upgradeInstalledRestart: '已安装 {latest}，需要重启 DSH 后生效（当前运行的仍是旧代码）。',
        upgradeFailed: '升级失败：{error}',
        upgradeLinkInstall: '当前安装方式不支持一键升级。',
        upgradePrompt: '帮我升级 dsh-bizyair 插件到 {latest}：先卸载当前版本，再安装 {latest}。',
        releaseNotes: '更新日志',
        run: '生成', running: '生成中', queued: '排队中', pending: '准备中',
        success: '已完成', failed: '失败', elapsed: '用时',
        result: '结果', json: '状态 JSON', requestParams: '请求 JSON',
        copied: '已复制', copyUrl: '复制链接',
        save: '保存到工作区', saving: '保存中…', saved: '已保存到', open: '在新窗口打开',
        docs: '文档', plaza: '在 BizyAir 打开',
        download: '下载', close: '关闭', prev: '上一张', next: '下一张', original: '原始链接',
        today: '今天', yesterday: '昨天', earlier: '更早',
        zoomHint: '滚轮缩放 · 拖拽平移 · 双击还原', zoomReset: '还原',
        runsSearch: '搜索任务：模型、提示词、状态…',
        quickHint: '从左侧选一个模型，或直接点下面的常用模型开始。',
        upload: '上传文件', uploading: '上传中…', uploadFailed: '上传失败',
        addUrl: '添加 URL', remove: '移除',
        confirmCost: '本次调用预计花费 $AMOUNT，是否继续？',
        costNote: '费用以 BizyAir 调用记录为准。',
        keyTitle: 'API Key',
        keyIntro: '在 BizyAir 账号菜单（右上角头像 → API Key）获取密钥。密钥保存在本机 $DSH_HOME/bizyair.key（仅本人可读），不会写入配置文件或对话。',
        keyValueIntro: '注册 BizyAir 送 $1 ≈ 200 张图（$0.005/张）或 8 条 5 秒 720P 视频（$0.025/秒）。价格以 BizyAir 账单为准。',
        keySignup: '去注册并获取 API Key',
        keyPlaceholder: 'sk-…', keySave: '保存并校验', keyCheck: '测试连接',
        keySaved: '已保存', keyValid: '连接正常', keyInvalid: '密钥无效或已过期',
        keyNotSaved: '未保存：密钥无效，已保留原有密钥',
        keyTestingInput: '正在校验输入框中的密钥…',
        keyTestingStored: '正在校验已保存的密钥…',
        keyChecking: '正在校验…', keyHint: '未配置密钥时，对话内工具会返回配置指引。',
        keyMasked: '当前密钥', statusOk: '已连接', statusBad: '未连接',
        getKey: '前往 BizyAir 获取 API Key', keyHelp: '密钥无效或缺失时，可以到 BizyAir 账号页重新生成。',
        statusUnknown: '未校验', statusNoKey: '无密钥', langToggle: 'EN',
      },
      en: {
        title: 'BizyAir model plaza', subtitle: 'Image · Video · Audio',
        tabModels: 'Models', tabRuns: 'Runs', tabSettings: 'API key',
        runsTitle: 'Runs', runsEmpty: 'No runs yet. Generate once and it shows up here.',
        runsActive: 'running', runsClear: 'Clear finished', expand: 'Details', collapse: 'Hide',
        reuse: 'Reuse parameters', delete: 'Delete', rerunHint: 'Parameters loaded — press Generate',
        search: 'Search models, tasks, or vendors…',
        kinds: { all: 'All kinds', image: 'Image', video: 'Video', audio: 'Audio' },
        editions: { all: 'All editions', 'Self-hosted': 'Self-hosted', Economy: 'Economy', Official: 'Official' },
        loading: 'Loading model catalog…', loadFailed: 'Failed to load the catalog', retry: 'Retry',
        noModels: 'No matching models', clearFilters: 'Clear filters', models: 'models',
        empty: 'Pick a model on the left', params: 'Parameters', required: 'required', reset: 'Reset',
        missingRequired: 'Some required parameters are empty',
        price: 'Price', estimate: 'Estimated cost', estimateEmpty: 'Estimate appears as you fill parameters',
        browseAll: 'Browse all models on BizyAir', recommend: 'Recommended',
        gImage: 'Text to image', gVideo: 'Text to video', gVoice: 'Text to speech',
        exampleTag: 'example', noResultYet: 'No result yet — press Generate above', currentModel: 'Current model',
        submitting: 'Submitting…', submittingHint: 'Submitting the task and waiting for BizyAir to return a request_id…',
        loadMore: 'Load more', statusAll: 'All statuses',
        loadingFeatured: 'Loading the newest popular models…', featuredFailed: 'Failed to load featured models',
        featuredPriceNote: 'Recommended cheapest first; unit prices are per call or per second and follow your BizyAir billing.',
        upgradedTo: 'Upgraded to {v}',
        upgradeApplied: 'Done', upgradeNeedsRestart: 'Restart DSH to finish',
        upgradeRunning: 'In progress', upgradeUnavailable: 'Not completed',
        updateAvailable: 'Update available: {latest} (installed {current})',
        copyUpgrade: 'Copy upgrade request', upgradeNow: 'Upgrade now', version: 'Version', lastUpgrade: 'Last upgrade',
        upgradeConfirm: 'This uninstalls the current version and installs {latest}. Running tasks stop polling (submitted tasks are unaffected). A failed install rolls back automatically.\n\nDo not restart DSH while the upgrade is running. Continue?',
        upgrading: 'Upgrading…',
        upgradeDone: 'Upgrade finished — refresh the page to load the new version.',
        reloadPage: 'Refresh page',
        upgradeTimeout: 'The upgrade did not finish in time; check the plugin list or the app log.',
        upgradeInstalledRestart: 'Installed {latest}; restart DSH for it to take effect (the old code is still running).',
        upgradeFailed: 'Upgrade failed: {error}',
        upgradeLinkInstall: 'This installation cannot upgrade itself.',
        upgradePrompt: 'Upgrade the dsh-bizyair plugin to {latest}: uninstall the current version, then install {latest}.',
        releaseNotes: 'Changelog',
        run: 'Generate', running: 'Generating', queued: 'Queued', pending: 'Pending',
        success: 'Completed', failed: 'Failed', elapsed: 'elapsed',
        result: 'Result', json: 'Status JSON', requestParams: 'Request JSON',
        copied: 'Copied', copyUrl: 'Copy link',
        save: 'Save to workspace', saving: 'Saving…', saved: 'Saved to', open: 'Open in a new tab',
        docs: 'Docs', plaza: 'Open on BizyAir',
        download: 'Download', close: 'Close', prev: 'Previous', next: 'Next', original: 'Original URL',
        today: 'Today', yesterday: 'Yesterday', earlier: 'Earlier',
        zoomHint: 'Wheel to zoom · drag to pan · double-click to reset', zoomReset: 'Reset',
        runsSearch: 'Search runs: model, prompt, status…',
        quickHint: 'Pick a model on the left, or start with one of these.',
        upload: 'Upload file', uploading: 'Uploading…', uploadFailed: 'Upload failed',
        addUrl: 'Add URL', remove: 'Remove',
        confirmCost: 'This run is estimated at $AMOUNT. Continue?',
        costNote: 'BizyAir call history is authoritative for billing.',
        keyTitle: 'API key',
        keyIntro: 'Get a key from the BizyAir avatar menu → API Key. It is stored locally in $DSH_HOME/bizyair.key (owner-only) and never written to config files or the chat.',
        keyValueIntro: 'A new BizyAir account includes $1 ≈ 200 images ($0.005 each) or 8 five-second 720P videos ($0.025/second). Prices follow your BizyAir billing.',
        keySignup: 'Sign up and get an API key',
        keyPlaceholder: 'sk-…', keySave: 'Save and verify', keyCheck: 'Test connection',
        keySaved: 'Saved', keyValid: 'Connected', keyInvalid: 'Key is invalid or expired',
        keyNotSaved: 'Not saved: the key is invalid, the stored key is unchanged',
        keyTestingInput: 'Verifying the key in the field…',
        keyTestingStored: 'Verifying the stored key…',
        keyChecking: 'Verifying…', keyHint: 'Without a key, chat tools return setup instructions.',
        keyMasked: 'Current key', statusOk: 'Connected', statusBad: 'Not connected',
        getKey: 'Get an API key on BizyAir', keyHelp: 'If the key is missing or rejected, regenerate one in your BizyAir account.',
        statusUnknown: 'Unverified', statusNoKey: 'No key', langToggle: '中文',
      },
    }

    function detectLang() {
      try {
        const stored = window.localStorage.getItem(LANG_KEY)
        if (stored === 'zh' || stored === 'en') return stored
      } catch { /* ignore */ }
      try {
        const snapshot = hostCtx?.locale?.getLocale?.()
        const id = snapshot?.id ?? snapshot?.locale ?? snapshot?.current ?? ''
        if (/^zh/i.test(String(id))) return 'zh'
        if (/^en/i.test(String(id))) return 'en'
      } catch { /* ignore */ }
      return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
    }

    async function getJson(url, init) {
      const response = await fetch(url, init)
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.error) throw new Error(payload?.error || `${response.status} ${response.statusText}`)
      return payload
    }

    function postJson(url, body) {
      return getJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    const SPIN_STYLE = [
      '@keyframes bizyair-spin{to{transform:rotate(360deg)}}',
      '.bizyair-spin{width:12px;height:12px;border-radius:50%;border:2px solid currentColor;',
      'border-top-color:transparent;display:inline-block;animation:bizyair-spin .8s linear infinite;vertical-align:-1px}',
      '.bizyair-row{transition:background .12s ease}',
      '.bizyair-row:hover{background:color-mix(in srgb,currentColor 7%,transparent)}',
      '.bizyair-scroll::-webkit-scrollbar{width:8px}',
      '.bizyair-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,currentColor 18%,transparent);border-radius:4px}',
    ].join('')

    const theme = {
      border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
      subtle: '1px solid color-mix(in srgb, currentColor 9%, transparent)',
      muted: 'color-mix(in srgb, currentColor 60%, transparent)',
      soft: 'color-mix(in srgb, currentColor 5%, transparent)',
      softer: 'color-mix(in srgb, currentColor 3%, transparent)',
      accent: 'color-mix(in srgb, #7b4bff 80%, currentColor)',
      ok: '#1a7f37', bad: '#d1242f', warn: '#bf8700',
    }

    function cleanText(text) {
      return String(text ?? '')
        .replace(/⟨bz_enum_json⟩.*?⟨\/bz_enum_json⟩\s*/gs, '')
        .replace(/Automatically fills the default value when omitted:[^\n]*/gi, '')
        .replace(/Value range:[^\n]*/gi, '')
        .replace(/Step:[^\n]*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    const EDITION_TONE = { 'Self-hosted': '#1a7f37', Economy: '#bf8700', Official: '#3b6ef5' }

    const inputStyle = {
      width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 7,
      border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      background: 'color-mix(in srgb, currentColor 4%, transparent)',
      color: 'inherit', font: 'inherit', fontSize: 12.5, outline: 'none',
    }

    const smallButton = {
      padding: '5px 10px', borderRadius: 7, cursor: 'pointer', font: 'inherit', fontSize: 11.5,
      border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
      background: 'transparent', color: 'inherit',
    }

    const iconButton = { ...smallButton, padding: '2px 7px', lineHeight: 1.2 }

    const lightboxNav = {
      background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)',
      borderRadius: 999, width: 36, height: 36, cursor: 'pointer', font: 'inherit', fontSize: 18,
      display: 'grid', placeItems: 'center', padding: 0, lineHeight: 1,
    }

    function primaryButton(disabled) {
      return {
        padding: '8px 18px', borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit', fontSize: 13, fontWeight: 600, color: 'white',
        display: 'inline-flex', gap: 8, alignItems: 'center',
        background: theme.accent, opacity: disabled ? 0.55 : 1,
      }
    }

    function secondaryButton(disabled) {
      return {
        padding: '7px 14px', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit', fontSize: 12.5, border: theme.border, background: 'transparent',
        color: 'inherit', display: 'inline-flex', gap: 8, alignItems: 'center',
        opacity: disabled ? 0.55 : 1,
      }
    }

    function segmentStyle(active) {
      return {
        padding: '5px 13px', borderRadius: 7, cursor: 'pointer', font: 'inherit', fontSize: 12.5,
        border: 'none', background: active ? theme.accent : 'transparent',
        color: active ? 'white' : 'inherit', fontWeight: active ? 600 : 400,
      }
    }

    function clusterStyle(active) {
      return {
        padding: '5px 11px', cursor: 'pointer', font: 'inherit', fontSize: 12,
        border: 'none', background: active ? theme.soft : 'transparent',
        color: 'inherit', fontWeight: active ? 600 : 400,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }
    }

    function tabButton(active, label) {
      return {
        padding: '5px 11px', borderRadius: 7, cursor: 'pointer', font: 'inherit', fontSize: 12.5,
        border: active ? `1px solid ${theme.accent}` : theme.subtle,
        background: active ? theme.soft : 'transparent',
        color: 'inherit', fontWeight: active ? 600 : 400,
      }
    }

    function Spinner() {
      return h('span', { className: 'bizyair-spin', 'aria-hidden': 'true' })
    }

    function Dot(props) {
      const color = props.color
      return h('span', {
        'aria-hidden': 'true',
        style: {
          width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block',
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)`,
        },
      })
    }

    function updateBannerNote(upgrading, note, t) {
      if (upgrading && !note) return h('span', { style: { color: theme.muted, fontSize: 11.5 } }, t.upgrading)
      if (!note) return null
      return h('span', {
        style: {
          fontSize: 11.5,
          color: note.tone === 'ok' ? theme.ok : note.tone === 'bad' ? theme.bad : theme.warn,
        },
      }, note.text)
    }

    function Chip(props) {
      return h('span', {
        style: {
          display: 'inline-block', padding: '1px 7px', borderRadius: 999, fontSize: 11,
          border: theme.border, color: theme.muted, whiteSpace: 'nowrap',
        },
      }, props.children)
    }

    function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(text); return true }
        const area = document.createElement('textarea')
        area.value = text
        document.body.append(area)
        area.select()
        document.execCommand('copy')
        area.remove()
        return true
      } catch { return false }
    }

    function fileNameOf(url, index) {
      try {
        const name = new URL(url).pathname.split('/').pop()
        if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name
      } catch { /* ignore */ }
      return `bizyair-${index + 1}`
    }

    function coverUrl(cover, width = 320) {
      const sep = cover.includes('?') ? '&' : '?'
      return `${cover}${sep}x-oss-process=image/resize,w_${width}/format,webp`
    }

    function modelImage(model, width) {
      const source = model?.cover || model?.bg
      return source ? coverUrl(source, width) : null
    }

    function priceUrlOf(model) {
      const base = model?.plazaUrl
      if (!base) return PRICE_URL
      return `${base}${base.includes('?') ? '&' : '?'}tab=price`
    }

    function posterUrl(url, width = 640) {
      const sep = url.includes('?') ? '&' : '?'
      return `${url}${sep}x-oss-process=video/snapshot,t_1000,f_jpg,w_${width}`
    }

    function thumbUrl(url, width = 160) {
      const sep = url.includes('?') ? '&' : '?'
      return `${url}${sep}x-oss-process=image/resize,w_${width}/format,webp`
    }

    function downloadHref(url, name) {
      return `/bizyair/api/file?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
    }

    /** Render plain text with http(s) URLs as clickable anchors. */
    function linkify(text) {
      const value = String(text ?? '')
      const pattern = /https?:\/\/[^\s)]+/g
      const nodes = []
      let last = 0
      let match
      while ((match = pattern.exec(value)) !== null) {
        if (match.index > last) nodes.push(value.slice(last, match.index))
        nodes.push(h('a', {
          key: `${match.index}-${match[0]}`,
          href: match[0], target: '_blank', rel: 'noreferrer',
          style: { color: 'inherit', textDecoration: 'underline', wordBreak: 'break-all' },
        }, match[0]))
        last = match.index + match[0].length
      }
      if (last < value.length) nodes.push(value.slice(last))
      return nodes
    }

    function collectUrls(outputs) {
      const urls = []
      for (const list of Object.values(outputs ?? {})) for (const url of list ?? []) urls.push(url)
      return urls
    }

    function Field(props) {
      const { prop, name, value, onChange, t, prefilled } = props
      const [busy, setBusy] = useState(0)

      const label = h('div', {
        style: { fontSize: 12, color: theme.muted, marginBottom: 5, display: 'flex', gap: 5, alignItems: 'baseline', flexWrap: 'wrap' },
      },
      h('span', { style: { color: 'inherit', fontWeight: 600 } }, name),
      prop.required ? h('span', { style: { color: theme.bad } }, '*') : null,
      prefilled ? h('span', {
        style: {
          fontSize: 9.5, padding: '0 5px', borderRadius: 4, lineHeight: '15px',
          border: theme.subtle, color: theme.muted,
        },
      }, t.exampleTag) : null,
      cleanText(prop.description) ? h('span', { style: { opacity: 0.72 } }, cleanText(prop.description).split('\n')[0]) : null)

      if (prop.enum) {
        return h('div', { style: { marginBottom: 14 } }, label,
          h('select', {
            value: value ?? '', onChange: event => onChange(event.target.value),
            style: { ...inputStyle, padding: '5px 8px' },
          }, prop.enum.map(option => h('option', { key: String(option), value: String(option) }, String(option)))))
      }

      if (prop.type === 'boolean') {
        return h('div', { style: { marginBottom: 14 } }, label,
          h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' } },
            h('input', { type: 'checkbox', checked: value === true, onChange: event => onChange(event.target.checked) }),
            value === true ? 'true' : 'false'))
      }

      if (prop.type === 'number' || prop.type === 'integer') {
        return h('div', { style: { marginBottom: 14 } }, label,
          h('input', {
            type: 'number', value: value ?? '',
            min: prop.minimum, max: prop.maximum, step: prop.multipleOf ?? (prop.type === 'integer' ? 1 : 'any'),
            onChange: event => onChange(event.target.value === '' ? undefined : Number(event.target.value)),
            style: inputStyle,
          }))
      }

      if (prop.type === 'array') return h(ArrayField, { prop, name, value, onChange, t, label, busy, setBusy })

      if (LONG_FIELDS.test(name)) {
        return h('div', { style: { marginBottom: 14 } }, label,
          h('textarea', {
            value: value ?? '', rows: 3, onChange: event => onChange(event.target.value),
            style: { ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.55 },
          }))
      }

      return h('div', { style: { marginBottom: 14 } }, label,
        h('input', { value: value ?? '', onChange: event => onChange(event.target.value), style: inputStyle }))
    }

    function ArrayField(props) {
      const { name, value, onChange, t, label, busy, setBusy, prop } = props
      const list = Array.isArray(value) ? value : []
      const uploading = busy > 0

      const rows = list.map((item, index) => h('div', {
        key: `${index}-${item}`, style: { display: 'flex', gap: 6, alignItems: 'center' },
      },
      h('input', {
        value: item, style: inputStyle,
        onChange: event => {
          const next = list.slice()
          next[index] = event.target.value
          onChange(next)
        },
      }),
      h('button', {
        type: 'button', title: t.remove, style: iconButton,
        onClick: () => onChange(list.filter((_, i) => i !== index)),
      }, '×')))

      async function pick(event) {
        const files = [...(event.target.files ?? [])]
        event.target.value = ''
        if (!files.length) return
        setBusy(n => n + files.length)
        for (const file of files) {
          try {
            const response = await fetch(`/bizyair/post/upload?name=${encodeURIComponent(file.name)}`, {
              method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' },
            })
            const payload = await response.json()
            if (!response.ok || payload.error) throw new Error(payload.error || t.uploadFailed)
            onChange([...(Array.isArray(value) ? value : []), payload.url])
          } catch (error) {
            window.alert(`${t.uploadFailed}: ${error.message}`)
          } finally {
            setBusy(n => Math.max(0, n - 1))
          }
        }
      }

      const uploadLabel = h('label', {
        style: { ...smallButton, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: uploading ? 0.6 : 1 },
      },
      uploading ? h(Spinner, null) : null,
      uploading ? t.uploading : t.upload,
      h('input', { type: 'file', multiple: true, style: { display: 'none' }, onChange: pick }))

      const tools = h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
        h('button', { type: 'button', style: smallButton, onClick: () => onChange([...list, '']) }, t.addUrl),
        uploadLabel,
        prop.maxItems ? h('span', { style: { color: theme.muted, fontSize: 11 } }, `${list.length}/${prop.maxItems}`) : null)

      return h('div', { style: { marginBottom: 14 } }, label,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          rows.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, rows) : null,
          tools))
    }

    function StatusChip(props) {
      const { status, t } = props
      const map = {
        running: { label: t.running, color: theme.accent, spin: true },
        queued: { label: t.queued, color: theme.warn, spin: true },
        pending: { label: t.pending, color: theme.warn, spin: true },
        success: { label: t.success, color: theme.ok },
        failed: { label: t.failed, color: theme.bad },
      }
      const entry = map[status] ?? { label: status, color: theme.muted }
      return h('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: entry.color },
      }, entry.spin ? h(Spinner, null) : h(Dot, { color: entry.color }), entry.label)
    }

    function Lightbox(props) {
      const { urls, index, setIndex, onClose, t } = props
      const url = urls[index]
      const name = fileNameOf(url, index)
      const isImage = IMAGE_EXT.test(url)
      const [copied, setCopied] = useState(false)
      const [zoom, setZoom] = useState(1)
      const [offset, setOffset] = useState({ x: 0, y: 0 })
      const copyTimer = useRef(null)
      const zoomRef = useRef(1)
      const stageRef = useRef(null)
      const dragRef = useRef(null)
      const touchRef = useRef(null)

      useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
      useEffect(() => {
        setZoom(1); zoomRef.current = 1; setOffset({ x: 0, y: 0 })
      }, [index, url])

      function applyZoom(next) {
        const value = Math.min(6, Math.max(1, next))
        zoomRef.current = value
        setZoom(value)
        if (value === 1) setOffset({ x: 0, y: 0 })
      }

      useEffect(() => {
        const node = stageRef.current
        if (!node || !isImage) return undefined
        const onWheel = event => {
          event.preventDefault()
          applyZoom(zoomRef.current * (event.deltaY < 0 ? 1.12 : 0.9))
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [url, isImage])

      function copyUrl() {
        if (!copyText(url)) return
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 1500)
      }

      useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') onClose()
          if (urls.length < 2) return
          if (event.key === 'ArrowRight') setIndex((index + 1) % urls.length)
          if (event.key === 'ArrowLeft') setIndex((index - 1 + urls.length) % urls.length)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [index, urls.length, onClose, setIndex])

      let media
      if (isImage) {
        media = h('img', {
          src: url, alt: '', draggable: false,
          style: { display: 'block', maxWidth: '92vw', maxHeight: '74vh', objectFit: 'contain', borderRadius: 4 },
        })
      } else if (VIDEO_EXT.test(url)) {
        media = h('video', { src: url, controls: true, autoPlay: true, poster: posterUrl(url), style: { maxWidth: '92vw', maxHeight: '74vh', borderRadius: 4 } })
      } else if (AUDIO_EXT.test(url)) {
        media = h('audio', { src: url, controls: true, autoPlay: true, style: { width: 'min(560px, 92vw)' } })
      } else {
        media = h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { color: 'white', fontSize: 13 } }, url)
      }

      const stage = h('div', {
        ref: stageRef,
        onClick: event => event.stopPropagation(),
        onDoubleClick: () => (isImage ? applyZoom(zoomRef.current > 1 ? 1 : 2.2) : null),
        onMouseDown: event => {
          if (!isImage || zoomRef.current === 1) return
          event.preventDefault()
          dragRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y }
        },
        onMouseMove: event => {
          const drag = dragRef.current
          if (!drag) return
          setOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y })
        },
        onMouseUp: () => { dragRef.current = null },
        onMouseLeave: () => { dragRef.current = null },
        onTouchStart: event => {
          const touch = event.touches[0]
          touchRef.current = { x: touch.clientX, y: touch.clientY }
        },
        onTouchEnd: event => {
          const start = touchRef.current
          touchRef.current = null
          if (!start || zoomRef.current !== 1 || urls.length < 2) return
          const touch = event.changedTouches[0]
          const dx = touch.clientX - start.x
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(touch.clientY - start.y)) {
            setIndex(dx < 0 ? (index + 1) % urls.length : (index - 1 + urls.length) % urls.length)
          }
        },
        style: {
          display: 'inline-block', lineHeight: 0, userSelect: 'none',
          cursor: isImage ? (zoom > 1 ? 'grab' : 'zoom-in') : 'default',
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transition: dragRef.current ? 'none' : 'transform .1s ease',
        },
      }, media)

      const nav = urls.length > 1
        ? h(React.Fragment, null,
          h('button', {
            type: 'button', title: t.prev, onClick: () => setIndex((index - 1 + urls.length) % urls.length),
            style: { position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', ...lightboxNav },
          }, '‹'),
          h('button', {
            type: 'button', title: t.next, onClick: () => setIndex((index + 1) % urls.length),
            style: { position: 'absolute', right: 18, top: '50%', transform: 'translateY(-50%)', ...lightboxNav },
          }, '›'))
        : null

      return h('div', {
        role: 'dialog', 'aria-modal': 'true',
        onClick: onClose,
        style: {
          position: 'fixed', inset: 0, background: 'rgba(8, 8, 12, 0.86)', zIndex: 100000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'hidden',
        },
      },
      h('button', {
        type: 'button', title: t.close, onClick: onClose,
        style: { position: 'absolute', top: 16, right: 20, ...lightboxNav, fontSize: 20, padding: '2px 10px' },
      }, '×'),
      nav,
      h('div', {
        onClick: event => event.stopPropagation(),
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: '94vw' },
      },
      stage,
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' } },
        h('span', { style: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5 } },
          `${name}${urls.length > 1 ? ` · ${index + 1}/${urls.length}` : ''}`),
        zoom > 1
          ? h('button', {
            type: 'button', onClick: () => applyZoom(1),
            style: {
              padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: 'rgba(255,255,255,0.82)', font: 'inherit', cursor: 'pointer', fontSize: 12,
            },
          }, `${Math.round(zoom * 100)}% · ${t.zoomReset}`)
          : null,
        h('a', {
          href: downloadHref(url, name), download: name,
          style: {
            padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.28)',
            background: 'rgba(255,255,255,0.12)', color: '#fff', textDecoration: 'none', fontSize: 12.5,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          },
        }, '↓ ' + t.download),
        h('button', {
          type: 'button', onClick: copyUrl,
          style: {
            padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
            background: copied ? 'rgba(255,255,255,0.2)' : 'transparent',
            color: 'rgba(255,255,255,0.82)', font: 'inherit', cursor: 'pointer', fontSize: 12,
          },
        }, copied ? t.copied : t.copyUrl)),
      isImage ? h('div', { style: { color: 'rgba(255,255,255,0.4)', fontSize: 10.5 } }, t.zoomHint) : null))
    }

    function Outputs(props) {
      const { outputs, t, onCopy, onOpen } = props
      const urls = collectUrls(outputs)
      if (!urls.length) return null
      const media = urls.map((url, index) => {
        if (IMAGE_EXT.test(url)) {
          return h('div', {
            key: url, title: 'zoom', role: 'button', tabIndex: 0,
            style: { display: 'block', alignSelf: 'flex-start', maxWidth: '100%', lineHeight: 0, cursor: 'zoom-in' },
            onClick: () => onOpen?.(urls, index),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') onOpen?.(urls, index) },
          }, h('img', {
            src: url, alt: '',
            style: {
              display: 'block', width: 'auto', height: 'auto',
              maxWidth: '100%', maxHeight: 520, objectFit: 'contain',
              borderRadius: 10, border: theme.border,
            },
          }))
        }
        if (VIDEO_EXT.test(url)) {
          return h('video', {
            key: url, src: url, controls: true, preload: 'metadata', poster: posterUrl(url),
            style: { alignSelf: 'flex-start', maxWidth: '100%', maxHeight: 420, borderRadius: 10, border: theme.border },
          })
        }
        if (AUDIO_EXT.test(url)) {
          return h('audio', { key: url, src: url, controls: true, style: { width: 380, maxWidth: '100%' } })
        }
        return h('a', { key: url, href: url, target: '_blank', rel: 'noreferrer', style: { fontSize: 12 } }, url)
      })
      return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 } },
        media,
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', { type: 'button', style: smallButton, onClick: () => onCopy(urls[0]) }, t.copyUrl),
          h('a', {
            href: downloadHref(urls[0], fileNameOf(urls[0], 0)), download: fileNameOf(urls[0], 0),
            style: { ...smallButton, textDecoration: 'none', color: 'inherit' },
          }, '↓ ' + t.download),
          h('button', { type: 'button', style: smallButton, onClick: () => onOpen?.(urls, 0) }, t.expand)))
    }

    function TaskPanel(props) {
      const {
        task, rawTask, result, view, setView, t, elapsed, saving, savedPath,
        saveAll, markCopied, copied, onOpen,
      } = props
      if (!task) return null

      const meta = h('div', {
        style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
      },
      rawTask?.cost_times?.total_cost_time
        ? h('span', { style: { color: theme.muted, fontSize: 12 } },
          `${(rawTask.cost_times.total_cost_time / 1000).toFixed(1)}s`)
        : null,
      task.request_id
        ? h('button', {
          type: 'button', style: smallButton,
          onClick: () => markCopied('id', task.request_id),
        }, copied === 'id' ? t.copied : task.request_id.slice(0, 8))
        : null,
      h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
        h('button', { type: 'button', style: tabButton(view === 'result', t.result), onClick: () => setView('result') }, t.result),
        h('button', { type: 'button', style: tabButton(view === 'json', t.json), onClick: () => setView('json') }, t.json)))

      const failure = task.message && task.status === 'failed'
        ? h('div', { style: { color: theme.bad, fontSize: 12.5, marginBottom: 10 } }, task.message)
        : null

      const json = h('pre', {
        style: {
          margin: 0, padding: 12, borderRadius: 9, border: theme.subtle, background: theme.softer,
          fontSize: 11.5, lineHeight: 1.5, overflow: 'auto', maxHeight: 420,
        },
      }, JSON.stringify(rawTask ?? task, null, 2))

      const successBody = result
        ? h('div', null,
          h(Outputs, { outputs: result.outputs, t, onCopy: url => markCopied('url', url), onOpen }),
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' } },
            h('button', { type: 'button', onClick: saveAll, disabled: saving, style: secondaryButton(saving) },
              saving ? h(Spinner, null) : null, saving ? t.saving : t.save),
            savedPath ? h('span', { style: { color: theme.ok, fontSize: 12 } }, `${t.saved} ${savedPath}`) : null))
        : null

      return h('div', { style: { marginTop: 18 } }, meta, failure, view === 'json' ? json : successBody)
    }

    function ModelRow(props) {
      const { model, selected, onSelect } = props
      const tone = EDITION_TONE[model.edition] ?? theme.muted
      const glyph = (model.outputs ?? []).includes('videos') ? '\u25B6'
        : (model.outputs ?? []).includes('audios') ? '\u266A' : '\u25A3'
      return h('button', {
        type: 'button', onClick: () => onSelect(model), className: 'bizyair-row',
        'data-endpoint': model.endpoint,
        style: {
          display: 'flex', gap: 9, alignItems: 'center', width: '100%', textAlign: 'left',
          padding: '7px 8px', marginBottom: 5, borderRadius: 9, cursor: 'pointer',
          font: 'inherit', fontSize: 12.5, color: 'inherit',
          border: selected?.endpoint === model.endpoint ? `1px solid ${theme.accent}` : theme.subtle,
          background: selected?.endpoint === model.endpoint ? theme.soft : 'transparent',
        },
      },
      h('div', {
        style: {
          width: 42, height: 42, flex: '0 0 auto', borderRadius: 8, overflow: 'hidden',
          background: theme.softer, border: theme.subtle, display: 'grid', placeItems: 'center',
        },
      }, modelImage(model, 96)
        ? h('img', {
          src: modelImage(model, 96), alt: '', loading: 'lazy',
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
        })
        : (model.icon && !/icons\/models\/bizyair\.(png|svg)$/i.test(model.icon))
          ? h('img', {
            src: model.icon, alt: '', loading: 'lazy',
            style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
          })
          : h('span', { style: { fontSize: 16, color: theme.muted, opacity: 0.75 } }, glyph)),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div', {
          title: model.title,
          style: {
            fontWeight: 600, lineHeight: 1.35, marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, model.title),
        h('div', { style: { color: theme.muted, fontSize: 10.5, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h('span', {
            style: {
              fontSize: 9.5, padding: '0 5px', borderRadius: 4, lineHeight: '15px',
              border: `1px solid color-mix(in srgb, ${tone} 45%, transparent)`,
              color: tone, whiteSpace: 'nowrap',
            },
          }, model.edition),
          h('span', null, model.task))))
    }

    /**
     * Merge a page into the loaded list. Polling replaces the first window,
     * which shifts offsets as new runs arrive; merging by id keeps already
     * loaded rows, refreshes their state, and prepends newcomers without
     * duplicating or dropping entries.
     */
    function mergeRuns(current, incoming, append) {
      if (append) {
        const seen = new Set(current.map(run => run.id))
        return [...current, ...incoming.filter(run => !seen.has(run.id))]
      }
      const remaining = new Map(current.map(run => [run.id, run]))
      const next = []
      for (const run of incoming) {
        const previous = remaining.get(run.id)
        next.push(previous ? { ...previous, ...run } : run)
        remaining.delete(run.id)
      }
      for (const leftover of remaining.values()) next.push(leftover)
      return next
    }

    function RunsPane(props) {
      const { t, catalog, onReuse, onPreview } = props
      const PAGE = 20
      const [runs, setRuns] = useState(null)
      const [total, setTotal] = useState(0)
      const [error, setError] = useState(null)
      const [expanded, setExpanded] = useState(null)
      const [saving, setSaving] = useState(null)
      const [savedPaths, setSavedPaths] = useState({})
      const [query, setQuery] = useState('')
      const [status, setStatus] = useState('')
      const [loadingMore, setLoadingMore] = useState(false)
      const runsRef = useRef([])
      const headSizeRef = useRef(PAGE)

      useEffect(() => { runsRef.current = runs ?? [] }, [runs])

      async function fetchPage({ append = false } = {}) {
        const limit = append ? PAGE : Math.max(PAGE, headSizeRef.current)
        const offset = append ? headSizeRef.current : 0
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
        if (status) params.set('status', status)
        const payload = await getJson(`/bizyair/api/runs?${params.toString()}`)
        setTotal(payload.total ?? 0)
        setRuns(current => mergeRuns(current ?? [], payload.runs ?? [], append))
        // Coverage grows only by the contiguous window this page represents.
        headSizeRef.current = append
          ? headSizeRef.current + PAGE
          : Math.max(headSizeRef.current, payload.runs.length)
        setError(null)
      }

      useEffect(() => {
        fetchPage().catch(loadError => setError(loadError.message))
        const timer = setInterval(() => {
          const alive = runsRef.current.some(run => run.status !== 'success' && run.status !== 'failed')
          if (alive) fetchPage().catch(() => {})
        }, 4000)
        return () => clearInterval(timer)
      }, [status])

      async function more() {
        setLoadingMore(true)
        try { await fetchPage({ append: true }) } catch (loadError) { setError(loadError.message) } finally { setLoadingMore(false) }
      }

      async function save(run) {
        setSaving(run.id)
        try {
          const payload = await postJson('/bizyair/post/runs/save', { id: run.id })
          setSavedPaths(current => ({ ...current, [run.id]: payload.paths.join(', ') }))
        } catch (saveError) {
          setError(saveError.message)
        } finally {
          setSaving(null)
        }
      }

      async function remove(run) {
        try {
          await postJson('/bizyair/post/runs/delete', { id: run.id })
          setRuns(current => (current ?? []).filter(item => item.id !== run.id))
          setTotal(value => Math.max(0, value - 1))
        } catch (removeError) {
          setError(removeError.message)
        }
      }

      if (error && !runs) return h('div', { style: { padding: 20, color: theme.bad, fontSize: 13 } }, error)
      if (!runs) {
        return h('div', { style: { padding: 20, color: theme.muted, display: 'flex', gap: 10, alignItems: 'center' } },
          h(Spinner, null), t.loading)
      }

      const active = runs.filter(run => run.status !== 'success' && run.status !== 'failed')
      const needle = query.trim().toLowerCase()
      const filtered = needle
        ? runs.filter(run => `${run.endpoint} ${run.title ?? ''} ${run.status} ${run.params?.prompt ?? run.params?.input ?? ''}`
          .toLowerCase().includes(needle))
        : runs

      const dayKey = value => {
        const date = new Date(value ?? Date.now())
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      }
      const todayKey = dayKey(new Date())
      const yesterdayKey = dayKey(new Date(Date.now() - 86400000))
      const groups = []
      for (const run of filtered) {
        const key = dayKey(run.createdAt)
        let group = groups.find(item => item.key === key)
        if (!group) {
          group = { key, label: key === todayKey ? t.today : key === yesterdayKey ? t.yesterday : t.earlier, items: [] }
          groups.push(group)
        }
        group.items.push(run)
      }

      function thumb(url, index, urls) {
        const isImage = IMAGE_EXT.test(url)
        const isVideo = VIDEO_EXT.test(url)
        const isAudio = AUDIO_EXT.test(url)
        return h('button', {
          key: url, type: 'button', title: 'preview', onClick: () => onPreview?.(urls, index),
          style: {
            width: 84, height: 84, borderRadius: 8, border: theme.border, background: theme.softer,
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            padding: 0, cursor: 'zoom-in', color: 'inherit', font: 'inherit',
          },
        }, isImage
          ? h('img', {
            src: thumbUrl(url), alt: '', loading: 'lazy',
            style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
          })
          : isVideo
            ? h('div', { style: { position: 'relative', width: '100%', height: '100%', background: '#000' } },
              h('img', {
                src: posterUrl(url, 320), alt: '', loading: 'lazy',
                style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
              }),
              h('span', {
                style: { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 18, textShadow: '0 1px 4px rgba(0,0,0,0.65)' },
              }, '▶'))
            : h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, color: theme.muted } },
              h('span', { style: { fontSize: isAudio ? 20 : 16, lineHeight: 1 } }, isAudio ? '♪' : 'FILE'),
              h('span', { style: { fontSize: 10 } }, isAudio ? 'audio' : 'file')))
      }

      function card(run) {
        const model = catalog?.models.find(item => item.endpoint === run.endpoint)
        const title = run.title ?? model?.title ?? run.endpoint
        const urls = collectUrls(run.outputs)
        const shown = urls.slice(0, 3)
        const thumbs = shown.map((url, index) => thumb(url, index, urls))
        const rest = urls.length - shown.length
        const prompt = run.params?.prompt ?? run.params?.input ?? run.params?.text ?? ''
        const elapsedMs = run.costTimes?.total_cost_time
        const isOpen = expanded === run.id
        const running = run.status !== 'success' && run.status !== 'failed'

        const details = isOpen
          ? h('div', { style: { marginTop: 10 } },
            h('pre', {
              style: {
                margin: 0, padding: 10, borderRadius: 8, border: theme.subtle, background: theme.softer,
                fontSize: 11, lineHeight: 1.5, overflow: 'auto', maxHeight: 220,
              },
            }, JSON.stringify({ endpoint: run.endpoint, params: run.params, outputs: run.outputs, message: run.message ?? null }, null, 2)))
          : null

        return h('div', {
          key: run.id,
          style: {
            border: isOpen ? `1px solid ${theme.accent}` : theme.subtle,
            borderLeft: running ? `3px solid ${theme.accent}` : undefined,
            borderRadius: 10, padding: '10px 12px', marginBottom: 8,
            background: running ? theme.softer : 'transparent',
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h(StatusChip, { status: run.status, t }),
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, title),
          h('span', { style: { color: theme.muted, fontSize: 10.5 } }, run.endpoint),
          h('span', { style: { color: theme.muted, fontSize: 11 } }, run.createdAt ? new Date(run.createdAt).toLocaleTimeString() : ''),
          elapsedMs ? h('span', { style: { color: theme.muted, fontSize: 11 } }, `${(elapsedMs / 1000).toFixed(1)}s`) : null,
          run.estimate?.usd != null ? h('span', { style: { color: theme.muted, fontSize: 11 } }, `~$${run.estimate.usd}`) : null),
        prompt ? h('div', { style: { color: theme.muted, fontSize: 12, marginBottom: 8, lineHeight: 1.5 } },
          String(prompt).slice(0, 200)) : null,
        run.message && run.status === 'failed'
          ? h('div', { style: { color: theme.bad, fontSize: 12, marginBottom: 6 } }, run.message) : null,
        (thumbs.length || rest > 0)
          ? h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' } },
            thumbs,
            rest > 0 ? h('span', { style: { color: theme.muted, fontSize: 11 } }, `+${rest}`) : null)
          : null,
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h('button', { type: 'button', style: smallButton, onClick: () => setExpanded(isOpen ? null : run.id) }, isOpen ? t.collapse : t.expand),
          urls.length ? h('button', {
            type: 'button', style: secondaryButton(saving === run.id), disabled: saving === run.id, onClick: () => save(run),
          }, saving === run.id ? h(Spinner, null) : null, saving === run.id ? t.saving : t.save) : null,
          savedPaths[run.id] ? h('span', { style: { color: theme.ok, fontSize: 11.5, alignSelf: 'center' } }, `${t.saved} ${savedPaths[run.id]}`) : null,
          h('button', { type: 'button', style: smallButton, onClick: () => onReuse(run) }, t.reuse),
          h('button', { type: 'button', style: { ...smallButton, color: theme.bad }, onClick: () => remove(run) }, t.delete)),
        details)
      }

      const header = h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' },
      },
      h('div', { style: { fontSize: 13.5, fontWeight: 700 } }, t.runsTitle),
      h('span', { style: { color: theme.muted, fontSize: 11.5 } }, `${runs.length}/${total}`),
      (() => {
        const estimated = runs.reduce((sum, run) => sum + (Number(run.estimate?.usd) || 0), 0)
        return estimated > 0
          ? h('span', { style: { color: theme.muted, fontSize: 11.5 } }, `~$${estimated.toFixed(3)}`)
          : null
      })(),
      active.length
        ? h('span', { style: { color: theme.accent, fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' } },
          h(Spinner, null), `${active.length} ${t.runsActive}`)
        : null,
      h('input', {
        value: query, placeholder: t.runsSearch, onChange: event => setQuery(event.target.value),
        style: { ...inputStyle, marginLeft: 'auto', maxWidth: 220 },
      }),
      h('select', {
        value: status, onChange: event => setStatus(event.target.value),
        style: { ...inputStyle, width: 'auto', padding: '5px 8px' },
      },
      h('option', { value: '' }, t.statusAll),
      h('option', { value: 'active' }, t.runsActive),
      h('option', { value: 'success' }, t.success),
      h('option', { value: 'failed' }, t.failed)),
      h('button', {
        type: 'button', style: smallButton,
        onClick: async () => { await postJson('/bizyair/post/runs/clear', {}); setTotal(0); setRuns([]) },
      }, t.runsClear))

      if (!total) {
        return h('div', { style: { padding: 16 } }, header,
          h('div', { style: { color: theme.muted, fontSize: 13, padding: '18px 0' } }, t.runsEmpty))
      }

      if (!filtered.length) {
        return h('div', { style: { padding: 16 } }, header,
          h('div', { style: { color: theme.muted, fontSize: 13, padding: '18px 0' } }, t.noModels))
      }

      return h('div', { className: 'bizyair-scroll', style: { padding: 16, overflowY: 'auto' } },
        header,
        groups.map(group => h('div', { key: group.key },
          h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 8px', color: theme.muted, fontSize: 11.5 },
          },
          h('span', { style: { fontWeight: 600 } }, group.label),
          h('span', { style: { opacity: 0.7 } }, `${group.items.length}`),
          h('span', { style: { flex: 1, height: 1, background: 'color-mix(in srgb, currentColor 8%, transparent)' } })),
          group.items.map(card))),
        runs.length < total
          ? h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: 8 } },
            h('button', { type: 'button', style: secondaryButton(loadingMore), disabled: loadingMore, onClick: more },
              loadingMore ? h(Spinner, null) : null, loadingMore ? t.loading : t.loadMore))
          : null)
    }

    function SettingsPane(props) {
      const { t, updateInfo } = props
      const [status, setStatus] = useState(null)
      const [keyInput, setKeyInput] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)

      useEffect(() => { getJson('/bizyair/api/key').then(setStatus).catch(() => {}) }, [])

      async function save() {
        if (!keyInput.trim()) return
        setBusy(true); setMessage(null)
        try {
          const result = await postJson('/bizyair/post/key', { key: keyInput.trim() })
          setStatus(current => (result.saved ? result : (current ?? result)))
          setMessage(result.saved
            ? { text: t.keyValid, tone: 'ok' }
            : { text: `${t.keyNotSaved} · ${withKeyUrl(result.error ?? t.keyInvalid)}`, tone: 'warn' })
          if (result.saved) setKeyInput('')
        } catch (error) {
          setMessage({ text: error.message, tone: 'warn' })
        } finally {
          setBusy(false)
        }
      }

      async function check() {
        const typed = keyInput.trim()
        setBusy(true); setMessage({ text: typed ? t.keyTestingInput : t.keyTestingStored, tone: 'muted' })
        try {
          const result = await postJson('/bizyair/post/key-check', typed ? { key: typed } : {})
          if (!typed) setStatus(result)
          setMessage(result.valid
            ? { text: `${t.keyValid}${result.source === 'input' ? ` · ${t.keyTestingInput}` : ''}`, tone: 'ok' }
            : {
              text: `${typed ? `${t.keyNotSaved} · ` : ''}${withKeyUrl(result.error ?? t.keyInvalid)}`,
              tone: 'warn',
            })
        } catch (error) {
          setMessage({ text: error.message, tone: 'warn' })
        } finally {
          setBusy(false)
        }
      }

      const withKeyUrl = detail => /https?:\/\//.test(detail) ? detail : `${t.keyInvalid} · ${KEY_URL}`

      const configured = !!status?.configured
      const valid = status?.valid
      const stateLabel = !configured ? t.statusNoKey : valid === true ? t.statusOk : valid === false ? t.statusBad : t.statusUnknown
      const stateColor = !configured ? theme.muted : valid === true ? theme.ok : valid === false ? theme.bad : theme.warn

      const line = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13 } },
        h(Dot, { color: stateColor }),
        h('span', { style: { fontWeight: 600, color: stateColor } }, stateLabel),
        status?.masked ? h('span', { style: { color: theme.muted, fontSize: 12 } }, `${t.keyMasked}: ${status.masked}`) : null,
        status?.checkedAt
          ? h('span', { style: { color: theme.muted, fontSize: 11.5 } }, new Date(status.checkedAt).toLocaleTimeString())
          : null)

      const form = h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        h('input', {
          value: keyInput, type: 'password', placeholder: t.keyPlaceholder,
          onChange: event => setKeyInput(event.target.value),
          style: { ...inputStyle, flex: 1, minWidth: 220 },
          onKeyDown: event => { if (event.key === 'Enter') save() },
        }),
        h('button', {
          type: 'button', onClick: save, disabled: busy || !keyInput.trim(),
          style: primaryButton(busy || !keyInput.trim()),
        }, busy ? h(Spinner, null) : null, t.keySave),
        h('button', {
          type: 'button', onClick: check, disabled: busy || (!configured && !keyInput.trim()),
          style: secondaryButton(busy || (!configured && !keyInput.trim())),
        }, t.keyCheck))

      const toneColor = !message ? theme.muted
        : message.tone === 'ok' ? theme.ok : message.tone === 'warn' ? theme.warn : theme.muted
      const feedback = message
        ? h('div', { style: { marginTop: 12, fontSize: 12.5, color: toneColor, lineHeight: 1.6 } }, linkify(message.text))
        : null

      const helpLink = (!configured || valid === false)
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 } },
          !configured
            ? h('p', { style: { margin: 0, color: 'inherit', fontSize: 12.5, lineHeight: 1.7 } }, t.keyValueIntro)
            : null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { color: theme.muted, fontSize: 11.5 } }, !configured ? null : t.keyHelp),
            h('a', {
              href: !configured ? SIGNUP_URL : KEY_URL, target: '_blank', rel: 'noreferrer',
              style: {
                padding: '6px 12px', borderRadius: 8, border: `1px solid ${theme.accent}`,
                color: 'inherit', fontSize: 12, textDecoration: 'none', fontWeight: 600,
              },
            }, `${!configured ? t.keySignup : t.getKey} ↗`)))
        : null

      return h('div', { className: 'bizyair-scroll', style: { padding: 20, maxWidth: 660, overflowY: 'auto' } },
        h('h3', { style: { margin: '0 0 8px', fontSize: 15 } }, t.keyTitle),
        h('p', { style: { color: theme.muted, fontSize: 12.5, lineHeight: 1.6, margin: '0 0 16px' } }, t.keyIntro),
        line,
        form,
        feedback,
        helpLink,
        updateInfo?.lastUpgrade
          ? h('p', { style: { color: theme.muted, fontSize: 11 } },
            `${t.lastUpgrade} ${updateInfo.lastUpgrade.from ?? '?'} → ${updateInfo.lastUpgrade.target ?? '?'} · ${
              updateInfo.lastUpgrade.application === 'applied' ? t.upgradeApplied
                : updateInfo.lastUpgrade.application === 'restart-required' ? t.upgradeNeedsRestart
                  : updateInfo.lastUpgrade.application === 'failed' || updateInfo.lastUpgrade.application === 'cancelled' ? t.upgradeUnavailable
                    : t.upgradeRunning}`)
          : null,
        h('p', { style: { color: theme.muted, fontSize: 11.5, marginTop: 16, lineHeight: 1.6 } }, t.keyHint),
        status?.path
          ? h('p', { style: { color: theme.muted, fontSize: 11 } },
            `${t.version} ${status.pluginVersion ?? '?'} · ${status.path}`)
          : null)
    }

    function View() {
      const [lang, setLang] = useState(detectLang)
      const t = S[lang]
      const [tab, setTab] = useState(() => uiState.tab)
      const [catalog, setCatalog] = useState(null)
      const [error, setError] = useState(null)
      const [query, setQuery] = useState(() => uiState.query)
      const [kind, setKind] = useState(() => uiState.kind)
      const [edition, setEdition] = useState(() => uiState.edition)
      const [selected, setSelected] = useState(null)
      const [params, setParams] = useState({})
      const [estimate, setEstimate] = useState(null)
      const [task, setTask] = useState(null)
      const [rawTask, setRawTask] = useState(null)
      const [result, setResult] = useState(null)
      const [view, setView] = useState('result')
      const [detailTab, setDetailTab] = useState('params')
      const [submitting, setSubmitting] = useState(false)
      const [touched, setTouched] = useState(() => new Set())
      const [now, setNow] = useState(Date.now())
      const [saving, setSaving] = useState(false)
      const [savedPath, setSavedPath] = useState(null)
      const [copied, setCopied] = useState(null)
      const [preview, setPreview] = useState(null)
      const listRef = useRef(null)
      const [keyStatus, setKeyStatus] = useState(null)
      const [updateInfo, setUpdateInfo] = useState(null)
      const [upgrading, setUpgrading] = useState(false)
      const [upgradeReady, setUpgradeReady] = useState(false)
      const [upgradeNote, setUpgradeNote] = useState(null)
      const [featured, setFeatured] = useState(null)
      const [featuredError, setFeaturedError] = useState(null)
      const [upgradeToast, setUpgradeToast] = useState(null)

      const pollRef = useRef(null)
      const startedAtRef = useRef(null)
      const reuseRef = useRef(null)
      const copiedTimer = useRef(null)

      useEffect(() => {
        try { window.localStorage.setItem(LANG_KEY, lang) } catch { /* ignore */ }
      }, [lang])

      useEffect(() => { uiState.tab = tab }, [tab])
      useEffect(() => { uiState.query = query }, [query])
      useEffect(() => { uiState.kind = kind }, [kind])
      useEffect(() => { uiState.edition = edition }, [edition])

      useEffect(() => {
        getJson('/bizyair/api/update?refresh=1').then(setUpdateInfo).catch(() => {})
      }, [])

      useEffect(() => {
        let alive = true
        getJson('/bizyair/api/key')
          .then(status => { if (alive) setKeyStatus(status) })
          .catch(() => {})
        return () => { alive = false }
      }, [tab])

      useEffect(() => {
        let alive = true
        getJson('/bizyair/api/featured')
          .then(data => { if (alive) { setFeatured(data); setFeaturedError(null) } })
          .catch(error => { if (alive) setFeaturedError(error.message) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        getJson('/bizyair/api/catalog').then(setCatalog).catch(err => setError(err.message))
        return () => {
          if (pollRef.current) clearInterval(pollRef.current)
          if (copiedTimer.current) clearTimeout(copiedTimer.current)
        }
      }, [])

      useEffect(() => {
        if (!task || (task.status !== 'running' && task.status !== 'queued' && task.status !== 'pending')) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [task])

      useEffect(() => {
        if (!updateInfo?.current) return
        let pending = null
        try { pending = window.localStorage.getItem('bizyair.pendingUpgrade') } catch { /* ignore */ }
        if (!pending) return
        if (updateInfo.current === pending) {
          setUpgradeToast(pending)
        }
        try { window.localStorage.removeItem('bizyair.pendingUpgrade') } catch { /* ignore */ }
      }, [updateInfo])

      useEffect(() => {
        if (!catalog || selected || !uiState.endpoint) return
        const model = catalog.models.find(item => item.endpoint === uiState.endpoint)
        if (model) setSelected(model)
      }, [catalog])

      const models = useMemo(() => {
        const rows = catalog?.models ?? []
        const needle = query.trim().toLowerCase()
        return rows.filter(model => {
          if (kind && !model.outputs.includes(kind)) return false
          if (edition && model.edition !== edition) return false
          if (!needle) return true
          return `${model.endpoint} ${model.title} ${model.description}`.toLowerCase().includes(needle)
        })
      }, [catalog, query, kind, edition])

      useEffect(() => {
        if (!selected) return
        const container = listRef.current
        const row = container?.querySelector(`[data-endpoint="${selected.endpoint.replace(/"/g, '\\"')}"]`)
        if (!container || !row) return
        // Only move the list's own scrollTop: scrollIntoView() would also scroll
        // ancestor containers and drag the parameter pane out of view.
        const listRect = container.getBoundingClientRect()
        const rowRect = row.getBoundingClientRect()
        // Center the target when it is far from the middle; leave near rows alone so
        // clicking a visible row does not make the list jump for no reason.
        const listCenter = listRect.top + listRect.height / 2
        const rowCenter = rowRect.top + rowRect.height / 2
        if (Math.abs(rowCenter - listCenter) <= listRect.height * 0.3) return
        const desired = container.scrollTop + (rowRect.top - listRect.top) - (listRect.height - rowRect.height) / 2
        const max = container.scrollHeight - container.clientHeight
        container.scrollTop = Math.max(0, Math.min(desired, max))
      }, [selected?.endpoint])

      useEffect(() => {
        if (!selected) return
        uiState.endpoint = selected.endpoint
        const reuse = reuseRef.current
        reuseRef.current = null
        const cached = uiState.params[selected.endpoint]
        const base = { ...(selected.example ?? {}), ...(selected.defaults ?? {}) }
        const initial = (reuse && reuse.endpoint === selected.endpoint)
          ? { ...base, ...reuse.params }
          : cached
            ? { ...base, ...cached }
            : base
        for (const [name, prop] of Object.entries(selected.schema?.properties ?? {})) {
          if (initial[name] === undefined && prop.default !== undefined) initial[name] = prop.default
          if (prop.enum && initial[name] === undefined) initial[name] = prop.enum[0]
          if (prop.type === 'boolean' && initial[name] === undefined) initial[name] = false
          if (prop.type === 'array') {
            const current = Array.isArray(initial[name]) ? initial[name] : []
            initial[name] = current.filter(item => typeof item === 'string' && !item.startsWith('<'))
          }
          if (typeof initial[name] === 'string' && initial[name].startsWith('<')) initial[name] = ''
        }
        setParams(initial)
        setTask(null); setResult(null); setRawTask(null); setSavedPath(null)
        setView('result'); setDetailTab('params'); setTouched(new Set())
      }, [selected])

      useEffect(() => {
        if (!selected) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
          postJson('/bizyair/post/quote', { endpoint: selected.endpoint, params })
            .then(payload => { if (!cancelled) setEstimate(payload) })
            .catch(() => { if (!cancelled) setEstimate(null) })
        }, 320)
        return () => { cancelled = true; clearTimeout(timer) }
      }, [selected, params])

      useEffect(() => {
        if (!selected) return
        const cached = uiState.params[selected.endpoint]
        if (!Object.keys(params).length && cached && Object.keys(cached).length) return
        uiState.params[selected.endpoint] = params
      }, [params, selected])

      const missingRequired = useMemo(() => {
        const required = selected?.schema?.required ?? []
        return required.filter(name => params[name] === undefined || params[name] === null || params[name] === '')
      }, [selected, params])

      const busy = !!task && (task.status === 'running' || task.status === 'queued' || task.status === 'pending')

      function setParam(name, value) {
        setParams(current => ({ ...current, [name]: value }))
        setTouched(current => {
          if (current.has(name)) return current
          const next = new Set(current)
          next.add(name)
          return next
        })
      }

      async function selfUpgrade() {
        const latest = updateInfo?.latest
        if (!latest || upgrading) return
        const ok = typeof window.confirm === 'function'
          ? window.confirm(t.upgradeConfirm.replace('{latest}', latest))
          : true
        if (!ok) return
        setUpgrading(true); setUpgradeNote(null)
        try {
          setUpgradeNote({ tone: 'muted', text: t.upgrading })
          try { window.localStorage.setItem('bizyair.pendingUpgrade', latest) } catch { /* ignore */ }
          const started = await postJson('/bizyair/post/upgrade', {})
          if (!started?.started) throw new Error(started?.error ?? 'upgrade did not start')
          const baseline = updateInfo.current
          const startedAt = Date.now()
          for (let i = 0; i < 60; i++) {
            await new Promise(resolve => setTimeout(resolve, 1500))
            let info = null
            try { info = await getJson('/bizyair/api/update?refresh=1') } catch { /* swap in progress */ }

            const outcome = info?.lastUpgrade && info.lastUpgrade.requestId === started.requestId
              ? info.lastUpgrade
              : null

            if (outcome?.phase === 'done') {
              if (outcome.application === 'applied' && info.current === latest) {
                setUpgradeNote({ tone: 'ok', text: t.upgradeDone })
                setUpgradeReady(true)
                return
              }
              if (outcome.application === 'restart-required' || outcome.application === 'applied') {
                setUpgradeNote({ tone: 'warn', text: t.upgradeInstalledRestart.replace('{latest}', latest) })
                return
              }
              if (outcome.application === 'failed' || outcome.application === 'cancelled') {
                setUpgradeNote({ tone: 'bad', text: t.upgradeFailed.replace('{error}', outcome.restartReason ?? outcome.application) })
                return
              }
            }
            if (outcome?.phase === 'failed') {
              setUpgradeNote({ tone: 'bad', text: t.upgradeFailed.replace('{error}', t.upgradeUnavailable) })
              return
            }

            if (info?.current === latest) {
              setUpgradeNote({ tone: 'ok', text: t.upgradeDone })
              setUpgradeReady(true)
              return
            }
            // Only as a last resort, and never during the swap window itself.
            if (Date.now() - startedAt > 25000 && info?.installedVersion === latest && info?.current !== latest && !outcome) {
              setUpgradeNote({ tone: 'warn', text: t.upgradeInstalledRestart.replace('{latest}', latest) })
              return
            }
          }
          setUpgradeNote({ tone: 'warn', text: t.upgradeTimeout })
        } catch (error) {
          setUpgradeNote({ tone: 'bad', text: t.upgradeFailed.replace('{error}', error.message) })
        } finally {
          setUpgrading(false)
        }
      }

      function markCopied(what, text) {
        if (!copyText(text)) return
        setCopied(what)
        if (copiedTimer.current) clearTimeout(copiedTimer.current)
        copiedTimer.current = setTimeout(() => setCopied(null), 1500)
      }

      function openPreview(urls, index = 0) {
        setPreview({ urls, index })
      }

      function reuseRun(run) {
        const model = catalog?.models.find(item => item.endpoint === run.endpoint)
        if (!model) return
        reuseRef.current = { endpoint: run.endpoint, params: run.params ?? {} }
        setSelected(model)
        setTab('models')
      }

      async function run() {
        if (!selected || missingRequired.length || busy || submitting) return
        if (estimate?.usd != null && estimate.usd >= 20) {
          const ok = typeof window.confirm === 'function' ? window.confirm(t.confirmCost.replace('$AMOUNT', estimate.usd)) : true
          if (!ok) return
        }
        setResult(null); setRawTask(null); setError(null); setSavedPath(null)
        setSubmitting(true)
        setDetailTab('result')
        try {
          const submitted = await postJson('/bizyair/post/generate', { endpoint: selected.endpoint, params })
          startedAtRef.current = Date.now()
          setTask({ request_id: submitted.request_id, status: 'running', startedAt: startedAtRef.current })
          setDetailTab('result')
          setNow(Date.now())
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = setInterval(async () => {
            try {
              const snapshot = await getJson(`/bizyair/api/task?id=${encodeURIComponent(submitted.request_id)}`)
              setRawTask(snapshot)
              setTask({ ...snapshot, startedAt: startedAtRef.current })
              if (snapshot.status === 'success' || snapshot.status === 'failed') {
                clearInterval(pollRef.current)
                pollRef.current = null
                if (snapshot.status === 'success') setResult(snapshot)
              }
            } catch (pollError) {
              clearInterval(pollRef.current)
              pollRef.current = null
              setError(pollError.message)
            }
          }, 4000)
        } catch (runError) {
          setError(runError.message)
          setDetailTab('params')
        } finally {
          setSubmitting(false)
        }
      }

      async function saveAll() {
        const urls = collectUrls(result?.outputs)
        if (!urls.length) return
        setSaving(true); setSavedPath(null)
        try {
          const paths = []
          for (const [index, url] of urls.entries()) {
            const saved = await postJson('/bizyair/post/save', { url, index, requestId: task?.request_id })
            paths.push(saved.path)
          }
          setSavedPath(paths.join(', '))
        } catch (saveError) {
          setError(saveError.message)
        } finally {
          setSaving(false)
        }
      }

      const elapsed = busy && startedAtRef.current
        ? Math.max(0, Math.round((now - startedAtRef.current) / 1000))
        : null

      const segmented = h('div', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 2, padding: 2,
          borderRadius: 9, border: theme.subtle, background: theme.softer,
        },
      },
      h('button', { type: 'button', style: segmentStyle(tab === 'models'), onClick: () => setTab('models') }, t.tabModels),
      h('button', { type: 'button', style: segmentStyle(tab === 'runs'), onClick: () => setTab('runs') }, t.tabRuns))

      const keyColor = !keyStatus
        ? theme.muted
        : keyStatus.valid === true ? theme.ok : keyStatus.valid === false ? theme.bad : theme.warn

      const cluster = h('div', {
        style: { display: 'inline-flex', alignItems: 'center', borderRadius: 9, border: theme.subtle, overflow: 'hidden' },
      },
      h('button', {
        type: 'button', style: clusterStyle(tab === 'settings'),
        onClick: () => setTab('settings'), title: t.tabSettings,
      }, h(Dot, { color: keyColor }), t.tabSettings),
      h('span', { style: { width: 1, height: 16, background: 'color-mix(in srgb, currentColor 14%, transparent)' } }),
      h('button', {
        type: 'button', style: clusterStyle(false), title: 'language',
        onClick: () => setLang(lang === 'zh' ? 'en' : 'zh'),
      }, t.langToggle))

      const dismissedUpdate = (() => {
        try { return window.localStorage.getItem('bizyair.dismissedUpdate') } catch { return null }
      })()

      const updateBanner = updateInfo?.updateAvailable && dismissedUpdate !== updateInfo.latest
        ? h('div', {
          style: {
            display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 16px', borderBottom: theme.border,
            background: 'color-mix(in srgb, #7b4bff 10%, Canvas)',
            color: 'inherit', fontSize: 12.5,
          },
        },
        h('span', { style: { fontWeight: 600 } },
          t.updateAvailable.replace('{latest}', updateInfo.latest).replace('{current}', updateInfo.current)),
        h('span', { style: { color: theme.muted, fontSize: 11.5 } },
          updateInfo.canSelfUpgrade ? null : t.upgradeLinkInstall),
        updateBannerNote(upgrading, upgradeNote, t),
        upgradeReady
          ? h('button', {
            type: 'button', onClick: () => window.location.reload(),
            style: { ...primaryButton(false), marginLeft: 'auto', padding: '6px 14px', fontSize: 12 },
          }, t.reloadPage)
          : updateInfo.canSelfUpgrade
            ? h('button', {
              type: 'button', onClick: selfUpgrade, disabled: upgrading,
              style: { ...primaryButton(upgrading), marginLeft: 'auto', padding: '6px 14px', fontSize: 12 },
            }, upgrading ? h(React.Fragment, null, h(Spinner, null), t.upgrading) : t.upgradeNow)
            : null,
        h('button', {
          type: 'button', style: { ...smallButton, marginLeft: updateInfo.canSelfUpgrade ? 0 : 'auto' },
          onClick: () => markCopied(
            'upgrade',
            t.upgradePrompt.replaceAll('{latest}', updateInfo.latest).replaceAll('{current}', updateInfo.current),
          ),
        }, copied === 'upgrade' ? t.copied : t.copyUpgrade),
        h('a', {
          href: 'https://github.com/doombeaker/dsh-bizyair/releases',
          target: '_blank', rel: 'noreferrer',
          style: { fontSize: 11.5, color: 'inherit', textDecoration: 'underline' },
        }, t.releaseNotes),
        h('button', {
          type: 'button', title: t.close, style: iconButton,
          onClick: () => {
            try { window.localStorage.setItem('bizyair.dismissedUpdate', updateInfo.latest) } catch { /* ignore */ }
            setUpdateInfo(current => (current ? { ...current, updateAvailable: false } : current))
          },
        }, '×'))
        : null

      const upgradeToastBanner = upgradeToast
        ? h('div', {
          style: {
            display: 'flex', gap: 10, alignItems: 'center', padding: '7px 16px',
            borderBottom: theme.border, background: 'color-mix(in srgb, #1a7f37 10%, Canvas)',
            fontSize: 12.5,
          },
        },
        h('span', { style: { fontWeight: 600, color: theme.ok } }, t.upgradedTo.replace('{v}', upgradeToast)),
        h('button', {
          type: 'button', title: t.close, style: { ...iconButton, marginLeft: 'auto' },
          onClick: () => setUpgradeToast(null),
        }, '×'))
        : null

      const header = h('div', {
        style: {
          padding: '11px 16px', borderBottom: theme.border, display: 'flex', alignItems: 'center',
          gap: 10, flexWrap: 'wrap', background: theme.softer,
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
        h('div', { style: { fontSize: 15, fontWeight: 700 } }, t.title),
        catalog ? h('span', { style: { color: theme.muted, fontSize: 11.5 } },
          `${catalog.models.length} ${t.models} · ${catalog.generatedAt?.slice(0, 10) ?? ''}`) : null),
      h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        segmented,
        h('span', { style: { color: theme.muted, fontSize: 11 } }, '|'),
        cluster))

      const filters = h('div', { style: { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 } },
        h('input', { value: query, placeholder: t.search, onChange: event => setQuery(event.target.value), style: inputStyle }),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('select', {
            value: kind, onChange: event => setKind(event.target.value),
            style: { ...inputStyle, padding: '5px 8px', flex: 1 },
          },
          h('option', { value: '' }, t.kinds.all),
          h('option', { value: 'image' }, t.kinds.image),
          h('option', { value: 'video' }, t.kinds.video),
          h('option', { value: 'audio' }, t.kinds.audio)),
          h('select', {
            value: edition, onChange: event => setEdition(event.target.value),
            style: { ...inputStyle, padding: '5px 8px', flex: 1 },
          },
          h('option', { value: '' }, t.editions.all),
          h('option', { value: 'Self-hosted' }, t.editions['Self-hosted']),
          h('option', { value: 'Economy' }, t.editions.Economy),
          h('option', { value: 'Official' }, t.editions.Official))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 2 } },
          h('a', {
            href: PLAZA_URL, target: '_blank', rel: 'noreferrer',
            style: { fontSize: 11, color: theme.muted, textDecoration: 'underline' },
          }, `${t.browseAll} ↗`),
          selected
            ? h('button', {
              type: 'button',
              onClick: () => { setSelected(null); uiState.endpoint = null },
              style: { ...smallButton, padding: '2px 8px', fontSize: 10.5, marginLeft: 'auto' },
            }, `← ${t.recommend}`)
            : null))

      const selectedHidden = !!selected && !models.some(model => model.endpoint === selected.endpoint)

      const currentBar = selected ? h('div', {
        style: {
          display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px',
          borderTop: theme.border, borderBottom: theme.border, background: theme.softer,
        },
      },
      h('span', { style: { color: theme.muted, fontSize: 10.5, whiteSpace: 'nowrap' } }, t.currentModel),
      h('span', {
        title: selected.title,
        style: {
          flex: 1, minWidth: 0, fontWeight: 600, fontSize: 11.5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
      }, selected.title),
      selectedHidden
        ? h('button', {
          type: 'button', style: { ...iconButton, fontSize: 10, padding: '2px 6px' },
          onClick: () => { setQuery(''); setKind(''); setEdition('') },
        }, t.clearFilters)
        : null,
      h('button', {
        type: 'button', title: t.recommend, style: iconButton,
        onClick: () => { setSelected(null); uiState.endpoint = null },
      }, '×')) : null

      const list = models.length
        ? h('div', {
          ref: listRef, className: 'bizyair-scroll',
          style: {
            overflowY: 'auto', overscrollBehavior: 'contain', flex: 1, minHeight: 0,
            padding: '0 8px 240px',
          },
        },
          models.map(model => h(ModelRow, {
            key: model.endpoint, model, selected,
            onSelect: target => setSelected(current => {
              if (current?.endpoint === target.endpoint) { uiState.endpoint = null; return null }
              uiState.endpoint = target.endpoint
              return target
            }),
          })))
        : h('div', { style: { padding: 16, color: theme.muted, fontSize: 13, textAlign: 'center' } },
          t.noModels,
          catalog ? h('div', null, h('button', {
            type: 'button', style: { ...smallButton, marginTop: 10 },
            onClick: () => { setQuery(''); setKind(''); setEdition('') },
          }, t.clearFilters)) : null)

      const left = h('div', {
        style: { width: 300, borderRight: theme.border, display: 'flex', flexDirection: 'column', minHeight: 0 },
      }, filters, currentBar, list)

      const meta = selected ? h('div', {
        style: { display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6, fontSize: 12.5 },
      },
      h('a', {
        href: priceUrlOf(selected), target: '_blank', rel: 'noreferrer',
        style: { fontSize: 12, color: 'inherit', textDecoration: 'underline' },
      }, `${t.price} ↗`),
      estimate?.usd != null
        ? h('div', { style: { fontWeight: 700 } }, `${t.estimate}: $${estimate.usd} · ${estimate.label}`)
        : h('div', { style: { color: theme.muted } }, t.estimateEmpty),
      selected.docsUrl ? h('a', { href: selected.docsUrl, target: '_blank', rel: 'noreferrer', style: { fontSize: 12 } }, t.docs) : null,
      selected.plazaUrl ? h('a', { href: selected.plazaUrl, target: '_blank', rel: 'noreferrer', style: { fontSize: 12 } }, t.plaza) : null) : null

      const orderOf = name => {
        const value = selected?.order?.[name]
        return Number.isFinite(value) ? value : 1000
      }

      const headerBlock = selected
        ? h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
            h('h2', { style: { fontSize: 17, margin: 0 } }, selected.title),
            h(Chip, null, selected.edition),
            h(Chip, null, selected.outputs.join('+')),
            h(Chip, null, selected.endpoint)),
          h('div', { style: { color: theme.muted, fontSize: 12.5, margin: '8px 0 12px', lineHeight: 1.55 } }, selected.description),
          meta)
        : null

      const fieldEntries = selected
        ? Object.entries(selected.schema?.properties ?? {})
          .map(([name, prop], index) => ({ name, prop, index }))
          .sort((a, b) => orderOf(a.name) - orderOf(b.name) || a.index - b.index)
        : []

      const fields = selected ? h('div', {
        style: {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '0 18px', maxWidth: 980, alignItems: 'start',
        },
      },
      fieldEntries.map(({ name, prop }) => {
        const wide = LONG_FIELDS.test(name) || prop.type === 'array' || (prop.enum?.length ?? 0) > 8
        const prefilled = !!selected.defaults && Object.hasOwn(selected.defaults, name) && !touched.has(name)
        return h('div', { key: name, style: { gridColumn: wide ? '1 / -1' : 'auto', minWidth: 0 } },
          h(Field, { prop, name, t, prefilled, value: params[name], onChange: value => setParam(name, value) }))
      })) : null

      const runDisabled = busy || submitting || missingRequired.length > 0

      const actionBar = selected ? h('div', {
        style: {
          position: 'sticky', top: 0, zIndex: 6, display: 'flex', gap: 10, alignItems: 'center',
          flexWrap: 'wrap', padding: '10px 0', margin: '0 0 12px',
          background: 'Canvas', borderBottom: theme.border,
        },
      },
      h('button', {
        type: 'button', onClick: run, disabled: runDisabled, style: primaryButton(runDisabled),
      }, submitting
        ? h(React.Fragment, null, h(Spinner, null), t.submitting)
        : busy
          ? h(React.Fragment, null, h(Spinner, null), `${task?.status === 'queued' ? t.queued : t.running}${elapsed !== null ? ` · ${elapsed}s` : ''}`)
          : t.run),
      task && !busy ? h(StatusChip, { status: task.status, t }) : null,
      elapsed !== null && !busy ? h('span', { style: { color: theme.muted, fontSize: 12 } }, `${t.elapsed} ${elapsed}s`) : null,
      h('button', {
        type: 'button', style: smallButton,
        onClick: () => setParams({ ...(selected.example ?? {}), ...(selected.defaults ?? {}) }),
      }, t.reset),
      h('button', {
        type: 'button', style: smallButton,
        onClick: () => markCopied('params', JSON.stringify({ endpoint: selected.endpoint, params }, null, 2)),
      }, copied === 'params' ? t.copied : t.requestParams),
      missingRequired.length
        ? h('span', { style: { color: theme.warn, fontSize: 12 } }, `${t.missingRequired}: ${missingRequired.join(', ')}`)
        : null) : null

      const tabRow = selected ? h('div', {
        style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 },
      },
      h('button', {
        type: 'button', style: segmentStyle(detailTab === 'params'), onClick: () => setDetailTab('params'),
      }, t.params),
      h('button', {
        type: 'button', style: segmentStyle(detailTab === 'result'), onClick: () => setDetailTab('result'),
      }, t.result,
      task ? h('span', { style: { marginLeft: 6 } }, h(Dot, {
        color: task.status === 'failed' ? theme.bad : task.status === 'success' ? theme.ok : theme.accent,
      })) : null)) : null

      const paramsPane = selected
        ? h('div', null, fields, h('div', { style: { color: theme.muted, fontSize: 11.5, marginTop: 6 } }, t.costNote))
        : null

      const submittingPane = submitting && !task
        ? h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', color: theme.muted, fontSize: 13, padding: '10px 0' } },
          h(Spinner, null), t.submittingHint)
        : null

      const resultPane = submittingPane ?? (task
        ? h(TaskPanel, {
          task, rawTask, result, view, setView, t, elapsed, saving, savedPath,
          saveAll, markCopied, copied, onOpen: openPreview,
        })
        : h('div', { style: { color: theme.muted, fontSize: 13, padding: '10px 0' } }, t.noResultYet))

      const featuredGroups = useMemo(() => {
        const planned = [
          { key: 'textToImage', task: 'text-to-image', label: t.gImage },
          { key: 'textToVideo', task: 'text-to-video', label: t.gVideo },
          { key: 'textToSpeech', task: 'text-to-speech', label: t.gVoice },
        ]
        const rows = catalog?.models ?? []
        return planned.map(group => {
          const endpoints = featured?.groups?.[group.key] ?? []
          const picked = endpoints
            .map(endpoint => rows.find(item => item.endpoint === endpoint))
            .filter(Boolean)
          const editionRank = { 'Self-hosted': 0, Economy: 1, Official: 2 }
          const ordered = [...picked].sort((left, right) =>
            (editionRank[left.edition] ?? 3) - (editionRank[right.edition] ?? 3)
            || (left.priceFrom?.usd ?? 99) - (right.priceFrom?.usd ?? 99))
          return { ...group, models: ordered }
        })
      }, [featured, catalog, lang])

      const coverOf = model => featured?.covers?.[model.endpoint] ?? null

      const outputGlyph = item => (item.outputs ?? []).includes('videos') ? '▶'
        : (item.outputs ?? []).includes('audios') ? '♪' : '▣'

      function quickCard(item) {
        const live = coverOf(item)
        const cover = live ? live : modelImage(item, 320)
        return h('button', {
          key: item.endpoint, type: 'button', className: 'bizyair-row',
          onClick: () => setSelected(item),
          style: {
            width: 152, padding: 0, border: theme.subtle, borderRadius: 12, overflow: 'hidden',
            background: 'transparent', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit',
          },
        },
        h('div', {
          style: {
            width: '100%', aspectRatio: '1 / 1', background: theme.softer,
            display: 'grid', placeItems: 'center', overflow: 'hidden',
          },
        }, cover
          ? h('img', {
            src: live ? cover : coverUrl(cover, 320), alt: '', loading: 'lazy',
            style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
          })
          : h('span', { style: { fontSize: 30, color: theme.muted, opacity: 0.7 } }, outputGlyph(item))),
        h('div', { style: { padding: '8px 10px 10px' } },
          h('div', {
            style: {
              fontSize: 12, fontWeight: 600, lineHeight: 1.35,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            },
          }, item.title),
          h('div', { style: { fontSize: 10.5, color: theme.muted, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('span', null, item.edition),
            h('span', null, '·'),
            h('span', null, item.task))))
      }

      const featuredBlock = !featured && !featuredError
        ? h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, color: theme.muted, fontSize: 12.5 } },
          h(Spinner, null), t.loadingFeatured)
        : featuredError
          ? h('div', { style: { marginTop: 18 } },
            h('div', { style: { color: theme.bad, fontSize: 12.5 } }, `${t.featuredFailed}: ${featuredError}`),
            h('button', {
              type: 'button', style: { ...smallButton, marginTop: 8 },
              onClick: () => { setFeaturedError(null); window.location.reload() },
            }, t.retry))
          : null

      const emptyDetail = h('div', { style: { maxWidth: 660 } },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, t.empty),
        h('div', { style: { color: theme.muted, fontSize: 12.5, marginTop: 6, lineHeight: 1.7 } }, t.quickHint),
        featuredBlock,
        featuredGroups.map(group => (group.models.length
          ? h('div', { key: group.key, style: { marginTop: 16 } },
            h('div', { style: { fontSize: 11.5, fontWeight: 600, color: theme.muted, marginBottom: 8 } }, group.label),
            h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } }, group.models.map(quickCard)))
          : null)),
        h('div', { style: { color: theme.muted, fontSize: 11, marginTop: 12 } }, t.featuredPriceNote),
        h('a', {
          href: PLAZA_URL, target: '_blank', rel: 'noreferrer',
          style: { display: 'inline-block', marginTop: 10, fontSize: 12, color: 'inherit', textDecoration: 'underline' },
        }, `${t.browseAll} ↗`))

      const detail = selected
        ? h('div', null, headerBlock, actionBar, tabRow, detailTab === 'params' ? paramsPane : resultPane)
        : emptyDetail

      const authProblem = !!error && /401|unauthor|api key|invalid/i.test(error)
      const errorLine = error
        ? h('div', { style: { color: authProblem ? theme.warn : theme.bad, fontSize: 12.5, marginBottom: 12 } },
          h('div', null, linkify(error)),
          authProblem
            ? h('a', {
              href: KEY_URL, target: '_blank', rel: 'noreferrer',
              style: { display: 'inline-block', marginTop: 6, fontSize: 12, color: 'inherit', fontWeight: 600 },
            }, `${t.getKey} ↗`)
            : null)
        : null

      const right = h('div', {
        className: 'bizyair-scroll',
        style: { flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 18px 28px' },
      }, errorLine, detail)

      const modelsBody = h('div', { style: { display: 'flex', minHeight: 0, flex: 1 } }, left, right)

      const loading = h('div', { style: { padding: 24, color: theme.muted, display: 'flex', gap: 10, alignItems: 'center' } },
        error ? h('span', null, `${t.loadFailed}: ${error}`) : h(React.Fragment, null, h(Spinner, null), t.loading),
        error ? h('button', { type: 'button', onClick: () => window.location.reload(), style: smallButton }, t.retry) : null)

      let body
      if (tab === 'settings') body = h(SettingsPane, { t, updateInfo })
      else if (tab === 'runs') body = h(RunsPane, { t, catalog, onReuse: reuseRun, onPreview: openPreview })
      else body = catalog ? modelsBody : loading

      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
          maxHeight: 'calc(100vh - 120px)', overflow: 'hidden',
        },
      },
        h('style', null, SPIN_STYLE),
        header,
        updateBanner,
        upgradeToastBanner,
        body,
        preview
          ? h(Lightbox, {
            urls: preview.urls,
            index: preview.index,
            setIndex: index => setPreview(current => current ? { ...current, index } : current),
            onClose: () => setPreview(null),
            t,
          })
          : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        hostCtx = ctx
        try { fetch('/bizyair/post/client-loaded?v=0.10.0+promo1', { method: 'POST' }).catch(() => {}) } catch { /* ignore */ }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'bizyair',
          order: 25,
          label: () => (detectLang() === 'zh' ? '模型广场 · BizyAir' : 'Model plaza · BizyAir'),
        }, View))

        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'bizyair', order: 20, label: 'BizyAir',
        }, View))
      },
    }
  },
})
