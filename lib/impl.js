/**
 * BizyAir model-plaza tools for DeepSeek Harness.
 *
 * Exposes the public BizyAir Model API (235 endpoints: image / video / audio)
 * as model-facing tools, with a catalog built from BizyAir's LLM documentation.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BizyAirError, downloadArtifact, isTerminal, mediaKind, probeKey, queryTask, resolveKey,
  sleep, submitTask, uploadInput, waitForTask,
} from './api.js'
import {
  decorateCatalog, describeModel, estimateCost, selectModels, validateParams,
} from './catalog.js'

export const name = 'bizyair'
export const inject = ['tools']

const CATALOG_PATH = fileURLToPath(new URL('../data/catalog.json', import.meta.url))
const PACKAGE_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

const DEFAULTS = {
  apiBase: 'https://api.bizyair.ai',
  metaBase: 'https://meta.bizyair.ai',
  webBase: 'https://www.bizyair.ai',
  apiKeyEnv: 'BIZYAIR_API_KEY',
  apiKeyFile: '',
  apiKey: '',
  outputDir: 'bizyair',
  panelCwd: '',
  waitSeconds: 45,
  backgroundPollSeconds: 1200,
  pollIntervalSeconds: 5,
  approvalThresholdUsd: 20,
  allowedOutputs: ['images', 'videos', 'audios'],
  logMaskFields: 'prompt, image_urls, input',
  refreshOnStart: false,
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  let catalog
  try {
    catalog = loadCatalogSync(CATALOG_PATH)
  } catch (error) {
    ctx.logger?.warn?.(`bizyair: catalog unavailable: ${error.message}`)
    return
  }
  const models = new Map(catalog.models.map(model => [model.endpoint, model]))
  const allowed = Array.isArray(config.allowedOutputs) && config.allowedOutputs.length ? config.allowedOutputs : null
  const listCatalog = allowed
    ? { ...catalog, models: catalog.models.filter(model => (model.outputs ?? []).some(kind => allowed.includes(kind))) }
    : catalog
  const pending = new Map()

  const section = ctx.get?.('systemPrompt')?.section?.({
    name: 'bizyair',
    order: 62,
    text: () => `## BizyAir media models (image / video / audio)

BizyAir exposes paid, asynchronous model APIs. Use them when the user asks for generated images, video, speech, or music that you cannot produce locally.

- Discover: \`bizyair_models\` (filter by \`output\`, \`edition\`, \`task\`, keyword, \`max_price\`). Prefer \`edition: "economy"\` or \`"self-hosted"\` when the user wants cheap options.
- Inspect before calling: \`bizyair_model\` returns the documented parameters, defaults, enums, upload limits, and the price table. Never invent parameter names or values.
- Local files must be uploaded with \`bizyair_upload\` first; media parameters (\`image_urls\`, \`video_urls\`, \`audio_urls\`, \`ref_audios\`, …) take public URLs.
- Cost: \`bizyair_price\` estimates one call. Calls estimated at or above $${config.approvalThresholdUsd} require approval; the tool asks automatically, and only \`confirm_cost: true\` bypasses that check after the user has explicitly agreed.
- Long tasks: video/audio generation is asynchronous. \`bizyair_generate\` returns quickly with \`request_id\` (and usually a \`job_id\`); report that to the user instead of blocking, then fetch results with \`bizyair_task\` or \`job_output\`.
- Artifacts are downloaded into \`${config.outputDir}/<date>/<request_id>/\` in the workspace; reference the returned paths.`,
  })
  if (section && ctx.effect) ctx.effect(() => section)

  const resolveWorkspaceRoot = () =>
    config.panelCwd || firstWorkspacePath(ctx) || ctx.get?.('workingDirectory')?.defaultDirectory || process.cwd()
  const runStore = createRunStore(resolveWorkspaceRoot, config.outputDir)

  const tools = [
    modelsTool(ctx, config, listCatalog),
    modelTool(ctx, config, catalog, models),
    generateTool(ctx, config, models, pending, runStore),
    taskTool(ctx, config, pending, runStore),
    uploadTool(ctx, config),
    priceTool(ctx, config, models),
  ]
  const registerAll = () => {
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => { disposers.forEach(dispose => dispose()); pending.clear() }
  }
  const dispose = ctx.effect ? ctx.effect(registerAll) : registerAll()
  let routesAttached = false
  const attachRoutes = () => {
    if (routesAttached) return true
    routesAttached = registerRoutes(ctx, config, listCatalog, models, runStore, resolveWorkspaceRoot)
    return routesAttached
  }
  if (!attachRoutes()) {
    // The web server service may mount after this plugin at cold start.
    const timer = setInterval(() => { if (attachRoutes()) clearInterval(timer) }, 300)
    if (ctx.effect) ctx.effect(() => () => clearInterval(timer))
    else setTimeout(() => clearInterval(timer), 60000)
  }
  return async () => { await dispose?.() }
}

function loadCatalogSync(path) {
  return decorateCatalog(JSON.parse(readFileSync(path, 'utf8')))
}

/* ------------------------------------------------------------------ tools */

function modelsTool(ctx, config, catalog) {
  return {
    name: 'bizyair_models',
    description: 'Search BizyAir\'s model plaza (235 image, video, and audio model APIs). Returns endpoint ids with title, task, edition, output kind, and starting price. Use output="image"|"video"|"audio" to narrow, edition="self-hosted"|"economy"|"official" for the provider tier, and keywords to match names.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Keywords matched against endpoint, title, and description (e.g. "wan 3.0", "tts", "background remover").' },
        output: { type: 'string', description: 'Restrict by produced artifact kind.', enum: ['image', 'video', 'audio'] },
        task: { type: 'string', description: 'Restrict by task suffix, e.g. text-to-image, image-to-video, text-to-speech.' },
        edition: { type: 'string', description: 'Provider tier. "self-hosted" and "economy" are usually the cheapest.', enum: ['self-hosted', 'economy', 'official'] },
        max_price: { type: 'number', description: 'Only models whose lowest published unit price is at or below this many USD.' },
        limit: { type: 'integer', description: 'Maximum rows to return (1-40, default 12).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer' },
          shown: { type: 'integer' },
          models: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                endpoint: { type: 'string' }, title: { type: 'string' }, task: { type: 'string' },
                edition: { type: 'string' }, outputs: { type: 'array', items: { type: 'string' } },
                price: { type: 'string' }, description: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatModelList(value) }],
    },
    execute(args) {
      const rows = selectModels(catalog, args ?? {})
      const narrowed = rows.models.filter(model => true)
      return jsonSafe({
        total: rows.total,
        shown: narrowed.length,
        models: narrowed,
      })
    },
  }
}

function formatModelList(value) {
  if (!value.models.length) return 'No BizyAir models matched those filters.'
  const lines = value.models.map(model =>
    `- ${model.endpoint} — ${model.title} [${model.task}] · ${model.edition} · ${model.outputs.join('+')} · ${model.price}`)
  return `${value.shown} of ${value.total} matching models:\n${lines.join('\n')}`
}

function modelTool(ctx, config, catalog, models) {
  return {
    name: 'bizyair_model',
    description: 'Return the exact API specification of one BizyAir model: documented parameters (types, enums, defaults, ranges, upload limits), an example payload, the price table, and documentation links. Always call this before bizyair_generate.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string', description: 'Model endpoint id from bizyair_models, e.g. "wan-3-0-prime-official/text-to-video".' },
      },
      required: ['endpoint'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: formatModelSpec(value) }],
    },
    execute(args) {
      const model = models.get(normalizeEndpoint(args.endpoint))
      if (!model) throw new BizyAirError(`Unknown BizyAir endpoint "${args.endpoint}". Use bizyair_models to find one.`, { code: 'UNKNOWN_ENDPOINT' })
      return jsonSafe(describeModel(model))
    },
  }
}

function formatModelSpec(spec) {
  const params = spec.parameters.map(p => {
    const bits = [`${p.required ? '*' : ''}${p.name}: ${p.type}`]
    if (p.enum) bits.push(`enum=${JSON.stringify(p.enum)}`)
    if (p.default !== undefined) bits.push(`default=${JSON.stringify(p.default)}`)
    if (p.minimum !== undefined || p.maximum !== undefined) bits.push(`range=${p.minimum ?? ''}..${p.maximum ?? ''}`)
    if (p.multipleOf !== undefined) bits.push(`step=${p.multipleOf}`)
    if (p.minItems !== undefined || p.maxItems !== undefined) bits.push(`items=${p.minItems ?? ''}..${p.maxItems ?? ''}`)
    return `- ${bits.join(' ')}${p.description ? ` — ${p.description.replace(/\n/g, ' / ')}` : ''}`
  })
  return [
    `# ${spec.title} (${spec.endpoint})`,
    `${spec.task} · ${spec.edition} · outputs: ${spec.outputs.join(', ')}`,
    spec.description,
    '',
    '## Parameters (* = required)',
    ...params,
    '',
    '## Example payload',
    JSON.stringify(spec.example, null, 2),
    '',
    '## Price',
    spec.price ? `${spec.price.table}${spec.price.note ? `\nNote: ${spec.price.note}` : ''}` : 'No published price for this endpoint.',
    '',
    `Docs: ${spec.docsUrl}`,
  ].filter(Boolean).join('\n')
}

function generateTool(ctx, config, models, pending, runStore) {
  return {
    name: 'bizyair_generate',
    description: 'Submit a BizyAir generation task, validate parameters against the model specification, estimate and gate cost, then wait briefly for the result. If the task is still running after the wait window, a background job keeps polling and this returns a request_id and job_id — report them and use bizyair_task or job_output later. Images are returned inline when ready; video/audio are saved into the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string', description: 'Model endpoint id from bizyair_models / bizyair_model.' },
        params: { type: 'object', additionalProperties: true, description: 'Model parameters exactly as documented by bizyair_model (prompt, resolution, duration, image_urls, …).' },
        wait_seconds: { type: 'integer', description: 'How long to wait inline before handing the task to a background job (0-1200, default 45).' },
        background: { type: 'boolean', description: 'Return immediately after submitting and poll in a background job.' },
        confirm_cost: { type: 'boolean', description: 'Set true only after the user explicitly agreed to this cost; it bypasses the approval prompt.' },
      },
      required: ['endpoint', 'params'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          request_id: { type: 'string' },
          status: { type: 'string' },
          endpoint: { type: 'string' },
          job_id: { type: 'string' },
          estimate: { type: 'object', additionalProperties: true },
          outputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                kind: { type: 'string' }, path: { type: 'string' }, url: { type: 'string' },
                name: { type: 'string' }, attachment: { type: 'object', additionalProperties: true },
              },
            },
          },
          message: { type: 'string' },
          cost_times: { type: 'object', additionalProperties: true },
        },
      },
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 180_000,
    async execute(args, exec) {
      const endpoint = normalizeEndpoint(args.endpoint)
      const model = models.get(endpoint)
      if (!model) throw new BizyAirError(`Unknown BizyAir endpoint "${args.endpoint}". Use bizyair_models to find one.`, { code: 'UNKNOWN_ENDPOINT' })
      const params = args.params ?? {}
      validateParams(model, params)
      const estimate = estimateCost(model, params)
      await gate(config, ctx, exec, model, estimate, args.confirm_cost)

      const key = await resolveKey(config)
      const cwd = await workingDirectory(ctx, exec)
      const submitted = await submitTask(config, key, endpoint, params, exec.signal)
      const requestId = submitted.request_id
      try {
        await runStore?.load?.()
        runStore?.upsert?.({
          id: `run-${requestId}`,
          requestId,
          endpoint,
          title: model.title,
          task: model.task,
          params: summarize(params),
          estimate,
          status: 'queued',
          outputs: {},
          source: 'chat',
        })
      } catch { /* registry is best effort */ }
      pending.set(requestId, { endpoint, params, cwd, createdAt: Date.now(), estimate })
      await audit(cwd, config, { type: 'submit', endpoint, params: summarize(params), requestId, estimate })
      const waitMs = Math.min(1200, Math.max(0, Number(args.wait_seconds ?? config.waitSeconds))) * 1000
      if (args.background === true || waitMs === 0) {
        const jobId = await startJob(ctx, config, exec, { endpoint, requestId, cwd, key })
        return runningValue(endpoint, requestId, jobId, estimate)
      }
      const deadline = Date.now() + waitMs
      let task = await queryTask(config, key, requestId, exec.signal)
      while (!isTerminal(task) && Date.now() < deadline) {
        await sleep(Math.min(config.pollIntervalSeconds * 1000, Math.max(500, deadline - Date.now())), exec.signal)
        task = await queryTask(config, key, requestId, exec.signal)
      }
      if (!isTerminal(task)) {
        const jobId = await startJob(ctx, config, exec, { endpoint, requestId, cwd, key })
        return runningValue(endpoint, requestId, jobId, estimate)
      }
      return collect(ctx, config, { endpoint, requestId, task, cwd, estimate, key })
    },
  }
}

function runningValue(endpoint, requestId, jobId, estimate) {
  return {
    request_id: requestId,
    status: 'running',
    endpoint,
    job_id: jobId ?? undefined,
    estimate,
    outputs: [],
    message: jobId
      ? `Task submitted. A background job (${jobId}) is polling; call bizyair_task with request_id "${requestId}" or read job_output later.`
      : `Task submitted. Call bizyair_task with request_id "${requestId}" later to collect the result.`,
  }
}

function taskTool(ctx, config, pending, runStore) {
  return {
    name: 'bizyair_task',
    description: 'Query one BizyAir task by request_id. On success it downloads the artifacts into the workspace and returns them (images inline, video/audio as file paths); on failure it returns the provider error message. Safe to call repeatedly.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request_id: { type: 'string', description: 'The request_id returned by bizyair_generate.' },
        wait_seconds: { type: 'integer', description: 'Wait up to this many seconds for completion before returning status (0-1200, default 0).' },
        download: { type: 'boolean', description: 'Download artifacts when the task has succeeded (default true).' },
      },
      required: ['request_id'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 300_000,
    async execute(args, exec) {
      const key = await resolveKey(config)
      const requestId = String(args.request_id).trim()
      const waitMs = Math.min(1200, Math.max(0, Number(args.wait_seconds ?? 0))) * 1000
      let task
      if (waitMs > 0) {
        task = await waitForTask(config, key, requestId, {
          signal: exec.signal, timeoutMs: waitMs, intervalMs: config.pollIntervalSeconds * 1000,
        })
      } else {
        task = await queryTask(config, key, requestId, exec.signal)
      }
      const known = pending.get(requestId)
      const cwd = known?.cwd ?? await workingDirectory(ctx, exec)
      const endpoint = known?.endpoint ?? 'unknown'
      if (!isTerminal(task)) {
        return jsonSafe({ request_id: requestId, status: task.status ?? 'pending', endpoint, outputs: [], message: `Still ${task.status ?? 'pending'}; query again later.` })
      }
      if (String(task.status).toLowerCase() === 'failed') {
        return jsonSafe({
          request_id: requestId, status: 'failed', endpoint, outputs: [],
          message: task.message || 'The task failed without a message.',
          task: { created_at: task.created_at, ended_at: task.ended_at },
        })
      }
      return collect(ctx, config, { endpoint, requestId, task, cwd, estimate: known?.estimate, key, download: args.download !== false })
    },
  }
}

async function collect(ctx, config, { endpoint, requestId, task, cwd, estimate, key, download = true }) {
  const outputs = []
  const urls = []
  for (const [kind, list] of Object.entries(task.outputs ?? {})) {
    for (const url of list ?? []) urls.push({ kind, url })
  }
  const dir = join(cwd, config.outputDir, dateStamp(), requestId)
  if (download && urls.length) {
    for (const [index, entry] of urls.entries()) {
      try {
        const artifact = await downloadArtifact(entry.url, dir, index)
        const record = {
          kind: artifact.kind,
          name: artifact.name,
          path: relativeTo(cwd, artifact.path),
          url: entry.url,
          bytes: artifact.bytes,
        }
        if (artifact.kind === 'image') {
          const saved = await saveImageAttachment(ctx, artifact, index)
          if (saved.ref) record.attachment = saved.ref
          else if (saved.error) record.attachmentError = saved.error
          if (saved.missing) record.attachmentMissing = true
        }
        outputs.push(record)
      } catch (error) {
        outputs.push({ kind: mediaKind(entry.url), name: null, path: null, url: entry.url, error: error.message })
      }
    }
    await writeFile(join(dir, 'result.json'), JSON.stringify({ endpoint, requestId, task, estimate, outputs }, null, 2)).catch(() => {})
    try {
      await runStore?.load?.()
      runStore?.upsert?.({
        id: `run-${requestId}`,
        requestId,
        endpoint,
        status: String(task.status).toLowerCase(),
        outputs: task.outputs ?? {},
        costTimes: task.cost_times ?? {},
        finishedAt: new Date().toISOString(),
        paths: outputs.map(output => output.path).filter(Boolean),
      })
    } catch { /* best effort */ }
    await audit(cwd, config, { type: 'result', endpoint, requestId, estimate, outputs: outputs.map(o => ({ kind: o.kind, path: o.path, url: o.url })), costTimes: task.cost_times })
  }
  return jsonSafe({
    request_id: requestId,
    status: String(task.status).toLowerCase(),
    endpoint,
    estimate,
    outputs,
    message: outputs.length
      ? `Saved to ${relativeTo(cwd, dir)}`
      : 'Task succeeded but returned no downloadable artifact.',
    cost_times: task.cost_times ?? {},
  })
}

async function saveImageAttachment(ctx, artifact, index) {
  const attachments = ctx.get?.('attachments')
  if (!attachments?.saveImage) return { missing: true }
  try {
    const data = await readFile(artifact.path)
    const ref = await attachments.saveImage({
      data,
      mediaType: imageMediaType(artifact),
      name: artifact.name || `bizyair-${index + 1}.png`,
    })
    return { ref }
  } catch (error) {
    return { error: error?.message ?? String(error), code: error?.code }
  }
}

const IMAGE_MEDIA_TYPE = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
}

function imageMediaType(artifact) {
  const ext = String(artifact.name ?? '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0]
  if (ext && IMAGE_MEDIA_TYPE[ext]) return IMAGE_MEDIA_TYPE[ext]
  const declared = String(artifact.contentType ?? '').toLowerCase()
  if (IMAGE_MEDIA_TYPE[`.${declared.split('/')[1]}`]) return `.${declared.split('/')[1]}` === '.jpg' ? 'image/jpeg' : declared
  return 'image/png'
}

function renderResult(value) {
  const blocks = []
  const lines = [`BizyAir ${value.endpoint} — ${value.status}${value.request_id ? ` (request_id ${value.request_id})` : ''}`]
  if (value.estimate?.usd != null) lines.push(`Estimated cost: $${value.estimate.usd} (${value.estimate.label}); actual billing is reported in BizyAir's call history.`)
  if (value.job_id) lines.push(`Background job: ${value.job_id}`)
  if (value.message) lines.push(value.message)
  for (const output of value.outputs ?? []) {
    if (output.attachment) {
      blocks.push({ type: 'image', attachment: output.attachment })
      lines.push(`${output.kind}: ${output.path ?? output.url ?? ''}`)
    } else if (output.path) {
      const hint = output.attachmentMissing ? ' (inline preview unavailable)'
        : output.attachmentError ? ` (inline preview failed: ${output.attachmentError})` : ''
      lines.push(`${output.kind}: ${output.path}${hint}`)
    } else if (output.url) {
      lines.push(`${output.kind}: ${output.url}${output.error ? ` (download failed: ${output.error})` : ''}`)
    }
  }
  return [{ type: 'text', text: lines.filter(Boolean).join('\n') }, ...blocks]
}

function uploadTool(ctx, config) {
  return {
    name: 'bizyair_upload',
    description: 'Upload a local image, video, or audio file to BizyAir and return a public URL to use in media parameters (image_urls, video_urls, audio_urls, ref_audios, …). Relative paths resolve from the session working directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative or absolute path of the file to upload.' },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string' }, name: { type: 'string' }, bytes: { type: 'integer' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Uploaded ${value.name} (${value.bytes} bytes)\nURL: ${value.url}` }],
    },
    timeoutMs: 300_000,
    async execute(args, exec) {
      const key = await resolveKey(config)
      const cwd = await workingDirectory(ctx, exec)
      const target = isAbsolute(args.path) ? args.path : resolvePath(cwd, args.path)
      const data = await readFile(target)
      if (data.length > 200 * 1024 * 1024) throw new BizyAirError('File is larger than the 200 MB upload limit')
      const uploaded = await uploadInput(config, key, { data, filename: basename(target), signal: exec.signal })
      await audit(cwd, config, { type: 'upload', file: basename(target), bytes: data.length, url: uploaded.url })
      return jsonSafe({ url: uploaded.url, name: basename(target), bytes: data.length })
    },
  }
}

function priceTool(ctx, config, models) {
  return {
    name: 'bizyair_price',
    description: 'Estimate the USD cost of one BizyAir call from the published price table, using the same parameters you would pass to bizyair_generate. Approximate for multi-dimension pricing; the BizyAir call history is authoritative.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        endpoint: { type: 'string', description: 'Model endpoint id.' },
        params: { type: 'object', additionalProperties: true, description: 'The parameters you intend to use (resolution, duration, input text, …).' },
      },
      required: ['endpoint'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value.display }],
    },
    execute(args, exec) {
      const model = models.get(normalizeEndpoint(args.endpoint))
      if (!model) throw new BizyAirError(`Unknown BizyAir endpoint "${args.endpoint}"`, { code: 'UNKNOWN_ENDPOINT' })
      const estimate = estimateCost(model, args.params ?? {})
      const threshold = config.approvalThresholdUsd
      const display = [
        `${model.title} (${model.endpoint})`,
        model.price ? `Price table: ${model.price.display}` : 'No published price.',
        estimate.usd === null ? 'Estimate: unknown' : `Estimate: $${estimate.usd} for ${estimate.label}${estimate.row && Object.keys(estimate.row).length ? ` at ${Object.entries(estimate.row).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`,
        estimate.usd !== null && estimate.usd >= threshold ? `This exceeds the $${threshold} approval threshold; bizyair_generate will ask for approval.` : '',
        model.price?.note ? `Note: ${model.price.note}` : '',
      ].filter(Boolean).join('\n')
      return jsonSafe({ endpoint: model.endpoint, ...estimate, threshold, display })
    },
  }
}

/* ----------------------------------------------------------- web panel API */

/** First registered workspace directory, so installs outside this machine write somewhere sensible. */
function firstWorkspacePath(ctx) {
  try {
    const list = ctx.get?.('workspaceRegistry')?.list?.()
    if (Array.isArray(list)) {
      const found = list.find(item => typeof item?.path === 'string' && item.path)
      if (found) return found.path
    }
  } catch { /* registry unavailable */ }
  return undefined
}

function keyPathOf(config) {
  if (config.apiKeyFile) return config.apiKeyFile
  if (config.keyPath) return config.keyPath
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'bizyair.key')
}

async function readStoredKey(config) {
  for (const candidate of [keyPathOf(config), config.apiKeyFile].filter(Boolean)) {
    try {
      const text = await readFile(candidate, 'utf8')
      const key = text.trim().split(/\s+/).pop()
      if (key) return { key, path: candidate }
    } catch { /* try next */ }
  }
  const envName = config.apiKeyEnv || 'BIZYAIR_API_KEY'
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) return { key: fromEnv, path: `env:${envName}` }
  if (config.apiKey?.trim()) return { key: config.apiKey.trim(), path: 'config' }
  return null
}

function maskKey(key) {
  if (!key) return null
  return key.length <= 8 ? `${key.slice(0, 2)}…` : `${key.slice(0, 3)}…${key.slice(-4)}`
}

/**
 * Durable run registry for the panel: every generation (from chat tools or the
 * panel) becomes a record, so results survive model switching and reloads.
 */
function createRunStore(rootOrResolver, outputDir) {
  const resolveRoot = typeof rootOrResolver === 'function' ? rootOrResolver : () => rootOrResolver
  const fileOf = () => join(resolveRoot(), outputDir, 'runs.json')
  const store = { loaded: false, list: [], timer: null }
  const load = async () => {
    if (store.loaded) return store.list
    try {
      const raw = JSON.parse(await readFile(fileOf(), 'utf8'))
      store.list = Array.isArray(raw?.runs) ? raw.runs : []
    } catch { store.list = [] }
    store.loaded = true
    return store.list
  }
  const flush = () => {
    if (store.timer) clearTimeout(store.timer)
    store.timer = setTimeout(async () => {
      store.timer = null
      try {
        await mkdir(join(resolveRoot(), outputDir), { recursive: true })
        await writeFile(fileOf(), JSON.stringify({ version: 1, runs: store.list.slice(0, 200) }, null, 2))
      } catch { /* best effort */ }
    }, 250)
  }
  const upsert = (record) => {
    const index = store.list.findIndex(run => run.id === record.id)
    if (index >= 0) store.list[index] = { ...store.list[index], ...record, updatedAt: new Date().toISOString() }
    else store.list.unshift({ createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...record })
    flush()
    return store.list[index >= 0 ? index : 0]
  }
  const byRequest = (requestId) => store.list.find(run => run.requestId === requestId)
  return { get file() { return fileOf() }, store, load, upsert, byRequest, flush }
}

/** Serve the model plaza and task calls to the Web panel (same-origin routes). */
function registerRoutes(ctx, config, listCatalog, models, runs, sharedRoot) {
  const web = ctx.get?.('webServer')
  if (!web?.register) return false
  const panelRoot = () => (typeof sharedRoot === 'function' ? sharedRoot() : sharedRoot) || config.panelCwd || firstWorkspacePath(ctx) || ctx.get?.('workingDirectory')?.defaultDirectory || process.cwd()
  let keyState = { configured: false, valid: null, checkedAt: null }

  const featuredCache = { at: 0, data: null }
  const updateCache = { at: 0, latest: null, error: null }
  const sitemapCache = { at: 0, list: null }

  function compareVersions(left, right) {
    const parse = value => {
      const [core, pre] = String(value ?? '').split('-')
      const nums = core.split('.').map(part => Number.parseInt(part, 10) || 0)
      return { nums, pre: pre ?? '' }
    }
    const a = parse(left)
    const b = parse(right)
    for (let i = 0; i < Math.max(a.nums.length, b.nums.length); i++) {
      const delta = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
      if (delta !== 0) return delta
    }
    if (a.pre === b.pre) return 0
    if (!a.pre) return 1
    if (!b.pre) return -1
    return a.pre.localeCompare(b.pre)
  }

  async function latestPublishedVersion() {
    if (Date.now() - updateCache.at < 10 * 60 * 1000) return updateCache
    const manager = ctx.get?.('pluginManager')
    let installed = null
    let available = []
    let source = null
    let note = null
    try {
      const list = await manager?.listVersions?.('dsh-bizyair')
      if (list?.status === 'listed') {
        installed = list.installed ?? null
        available = (list.versions ?? [])
          .filter(version => version.bundle !== false && !version.incompatible && !version.deprecated)
          .map(version => version.version)
      } else if (list?.status === 'refused') {
        note = list.reason ?? list.problem ?? null
      }
    } catch (error) {
      note = error?.message ?? String(error)
    }
    if (!available.length) {
      try {
        const response = await fetch('https://registry.npmjs.org/dsh-bizyair/latest', { signal: AbortSignal.timeout(6000) })
        if (response.ok) {
          const doc = await response.json()
          if (typeof doc?.version === 'string') available = [doc.version]
        }
      } catch (error) {
        updateCache.error = error?.message ?? String(error)
      }
    }
    try {
      const bundles = await manager?.listBundles?.()
      const self = Array.isArray(bundles) ? bundles.find(item => item?.name === 'dsh-bizyair') : undefined
      source = self?.source ?? null
    } catch { /* source is advisory */ }
    const candidates = available.filter(version => compareVersions(version, pluginVersion) > 0)
    const stable = candidates.find(version => !version.includes('-'))
    updateCache.latest = stable ?? candidates[0] ?? null
    updateCache.installed = installed
    updateCache.source = source
    updateCache.note = note
    updateCache.at = Date.now()
    return updateCache
  }

  async function plazaOrder() {
    const response = await fetch('https://www.bizyair.ai/modelzoo?sort=recently_add', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []
    const html = await response.text()
    const found = html.match(/\/modelzoo\/[a-z0-9-]+\/[a-z0-9\-/]+/g) ?? []
    const seen = []
    for (const raw of found) {
      const endpoint = raw.replace('/modelzoo/', '')
      if (!seen.includes(endpoint)) seen.push(endpoint)
    }
    return seen
  }

  async function sitemapNewestFirst() {
    if (sitemapCache.list && Date.now() - sitemapCache.at < 6 * 3600 * 1000) return sitemapCache.list
    const response = await fetch('https://www.bizyair.ai/sitemap-model-api-1.xml', { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return []
    const xml = await response.text()
    const order = [...xml.matchAll(/<loc>https:\/\/www\.bizyair\.ai\/modelzoo\/([^<]+)<\/loc>/g)].map(m => m[1])
    sitemapCache.list = order.reverse()
    sitemapCache.at = Date.now()
    return sitemapCache.list
  }

  /** Newest model per category, following the plaza's own ordering where possible. */
  async function featuredModels() {
    if (featuredCache.data && Date.now() - featuredCache.at < 30 * 60 * 1000) return featuredCache.data
    const [plaza, sitemap] = await Promise.all([plazaOrder().catch(() => []), sitemapNewestFirst().catch(() => [])])
    const ranked = []
    for (const endpoint of [...plaza, ...sitemap]) {
      if (models.has(endpoint) && !ranked.includes(endpoint)) ranked.push(endpoint)
    }
    const wanted = [
      { task: 'text-to-image', key: 'textToImage' },
      { task: 'text-to-video', key: 'textToVideo' },
      { task: 'text-to-speech', key: 'textToSpeech' },
    ]
    const groups = {}
    for (const { task, key } of wanted) {
      const picks = []
      for (const endpoint of ranked) {
        const model = models.get(endpoint)
        if (!model || model.task !== task) continue
        picks.push(endpoint)
        if (picks.length === 3) break
      }
      groups[key] = picks
    }
    const all = Object.values(groups).flat()
    const covers = {}
    await Promise.all(all.map(async (endpoint) => {
      try {
        const resolved = await resolveCover(endpoint)
        if (resolved.cover) covers[endpoint] = resolved.cover
      } catch { /* cover is optional */ }
    }))
    const data = { groups, covers, generatedAt: new Date().toISOString() }
    featuredCache.data = data
    featuredCache.at = Date.now()
    return data
  }

  const coverCache = new Map()
  async function resolveCover(endpoint) {
    const hit = coverCache.get(endpoint)
    if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.data
    const response = await fetch(`https://www.bizyair.ai/modelzoo/${endpoint}`, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error(`model page ${response.status}`)
    const html = await response.text()
    const images = [...new Set(html.match(/https:\/\/storage\.bizyair\.ai\/[A-Za-z0-9/._-]+\.(?:png|jpe?g|webp)/g) ?? [])]
    const video = [...new Set(html.match(/https:\/\/storage\.bizyair\.ai\/[A-Za-z0-9/._-]+\.(?:mp4|webm|mov)/g) ?? [])][0] ?? null
    const og = html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? null
    const input = images.find(url => /\/inputs\//.test(url)) ?? null
    const output = (og && /outputs_examples/.test(og) ? og : null) ?? images.find(url => /\/outputs_examples\//.test(url)) ?? null
    const bg = images.find(url => /\/icons\/model_bg\//.test(url)) ?? null
    const icon = images.find(url => /\/icons\/models\//.test(url)) ?? null
    const preferInput = /image-tools|image-to-image|video-edit|video-extend|image-upscaler/.test(endpoint)
    const sized = (url, width = 320) =>
      `${url}${url.includes('?') ? '&' : '?'}x-oss-process=image/resize,w_${width}/format,webp`
    const poster = url => `${url}${url.includes('?') ? '&' : '?'}x-oss-process=video/snapshot,t_1000,f_jpg,w_640`
    let cover = null
    if (preferInput && input) cover = sized(input)
    else if (output) cover = sized(output)
    else if (input) cover = sized(input)
    else if (video) cover = poster(video)
    else if (bg) cover = sized(bg)
    const data = {
      endpoint,
      cover,
      coverSource: preferInput && input ? 'input' : output ? 'output' : input ? 'input' : video ? 'video' : 'bg',
      input, output, video, bg, icon,
      fetchedAt: new Date().toISOString(),
    }
    coverCache.set(endpoint, { at: Date.now(), data })
    return data
  }

  async function refreshRun(run) {
    if (!run || run.status === 'success' || run.status === 'failed') return run
    try {
      const key = await resolveKey(config)
      const task = await queryTask(config, key, run.requestId)
      const status = String(task.status ?? 'pending').toLowerCase()
      return runs.upsert({
        id: run.id,
        status,
        message: task.message ?? null,
        outputs: task.outputs ?? {},
        costTimes: task.cost_times ?? {},
        finishedAt: status === 'success' || status === 'failed' ? new Date().toISOString() : null,
      })
    } catch (error) {
      return runs.upsert({ id: run.id, status: run.status, refreshError: error?.message ?? String(error) })
    }
  }
  const routes = []
  let clientLoad = null
  const pluginVersion = (() => {
    try { return JSON.parse(readFileSync(PACKAGE_PATH, 'utf8')).version ?? 'unknown' } catch { return 'unknown' }
  })()

  const panelModels = () => listCatalog.models.map(model => ({
    endpoint: model.endpoint,
    title: model.title,
    task: model.task,
    edition: model.editionLabel,
    outputs: model.outputsLabel,
    description: model.description ?? '',
    cover: model.cover ?? null,
    icon: model.icon ?? null,
    bg: model.bg ?? null,
    price: model.price ? { table: model.price.display, note: model.price.note, unit: model.price.unit, dimensions: model.price.dimensions } : null,
    priceFrom: model.priceFrom?.display ?? null,
    schema: model.schema,
    defaults: model.defaults ?? null,
    order: model.order ?? null,
    example: describeModel(model).example,
    docsUrl: model.docsUrl,
    plazaUrl: model.plazaUrl,
  }))

  const resource = async (request) => {
    const url = new URL(request.url)
    const path = url.pathname.replace(/^\/bizyair\/api/, '')
    const method = request.method.toUpperCase()
    try {
      if (path === '/health' && method === 'GET') {
        const graph = ctx.get?.('clientModules')?.graph?.()
        const ids = Array.isArray(graph?.entries) ? graph.entries.map(entry => entry.id)
          : Array.isArray(graph?.modules) ? graph.modules.map(module => module.id) : null
        const stored = await readStoredKey(config)
        return json({
          pluginVersion,
          config: {
            apiBase: config.apiBase,
            outputDir: config.outputDir,
            keyPath: keyPathOf(config),
            panelCwd: config.panelCwd || null,
            workspaceRoot: panelRoot(),
            approvalThresholdUsd: config.approvalThresholdUsd,
          },
          clientInGraph: Array.isArray(ids) ? ids.some(id => id === 'dsh-bizyair' || id === '@local/dsh-bizyair') : null,
          clientLoad,
          key: {
            configured: !!stored,
            path: stored?.path ?? null,
            masked: maskKey(stored?.key),
            valid: keyState.valid,
            checkedAt: keyState.checkedAt,
            error: keyState.error ?? null,
          },
        })
      }
      if (path === '/update' && method === 'GET') {
        const info = await latestPublishedVersion()
        const latest = info.latest
        const updateAvailable = !!latest && compareVersions(latest, pluginVersion) > 0
        const linkInstall = String(info.source ?? '').startsWith('link:')
        const manager = ctx.get?.('pluginManager')
        const canSelfUpgrade = updateAvailable && !linkInstall && typeof manager?.updateBundle === 'function'
        return json({
          current: pluginVersion,
          installedVersion: info.installed ?? pluginVersion,
          latest,
          updateAvailable,
          canSelfUpgrade,
          installSource: info.source,
          reason: canSelfUpgrade ? null : (linkInstall ? 'link-install' : (info.note ?? null)),
          checkedAt: new Date(info.at || Date.now()).toISOString(),
          error: info.error ?? undefined,
        })
      }
      if (path === '/featured' && method === 'GET') {
        try {
          return json(await featuredModels())
        } catch (error) {
          return json({ error: error?.message ?? String(error) }, 502)
        }
      }
      if (path === '/cover' && method === 'GET') {
        const endpoint = normalizeEndpoint(url.searchParams.get('endpoint') ?? '')
        if (!endpoint || !models.has(endpoint)) return json({ error: 'unknown endpoint' }, 404)
        try {
          return json(await resolveCover(endpoint))
        } catch (error) {
          return json({ error: error?.message ?? String(error) }, 502)
        }
      }
      if (path === '/file' && method === 'GET') {
        const target = url.searchParams.get('url')
        const name = url.searchParams.get('name') || 'bizyair-output'
        if (!target) return json({ error: 'missing url' }, 400)
        let parsed
        try { parsed = new URL(target) } catch { return json({ error: 'invalid url' }, 400) }
        if (!/^https?:$/.test(parsed.protocol) || !/(^|\.)bizyair\.ai$/.test(parsed.hostname)) {
          return json({ error: 'only BizyAir storage URLs can be proxied' }, 400)
        }
        const upstream = await fetch(parsed)
        if (!upstream.ok) return json({ error: `upstream ${upstream.status}` }, 502)
        const buffer = Buffer.from(await upstream.arrayBuffer())
        const filename = String(name).replace(/[^a-zA-Z0-9._-]/g, '_')
        return new Response(buffer, {
          headers: {
            'content-type': upstream.headers.get('content-type') || 'application/octet-stream',
            'content-disposition': `attachment; filename="${filename}"`,
            'content-length': String(buffer.length),
            'cache-control': 'no-store',
          },
        })
      }
      if (path === '/runs' && method === 'GET') {
        await runs.load()
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20))
        const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0)
        const status = (url.searchParams.get('status') ?? '').toLowerCase()
        let rows = runs.store.list
        if (status) {
          rows = rows.filter(run => {
            const value = String(run.status ?? '').toLowerCase()
            return status === 'active' ? value !== 'success' && value !== 'failed' : value === status
          })
        }
        const page = rows.slice(offset, offset + limit)
        const active = page.filter(run => run.status !== 'success' && run.status !== 'failed')
        for (const run of active.slice(0, 8)) await refreshRun(run)
        return json({ runs: page, total: rows.length, offset, limit, file: runs.file })
      }
      if (path === '/key' && method === 'GET') {
        const stored = await readStoredKey(config)
        if (stored && !keyState.checkedAt) {
          const probe = await probeKey(config, stored.key)
          keyState = { ...probe }
        }
        return json({
          configured: !!stored,
          path: stored?.path ?? null,
          masked: maskKey(stored?.key),
          valid: keyState.valid,
          checkedAt: keyState.checkedAt,
          error: keyState.error ?? null,
        })
      }
      if (path === '/catalog' && method === 'GET') {
        return json({ generatedAt: listCatalog.generatedAt, stats: listCatalog.stats, models: panelModels() })
      }
      if (path === '/task' && method === 'GET') {
        const id = url.searchParams.get('id')
        if (!id) return json({ error: 'missing id' }, 400)
        const key = await resolveKey(config)
        const task = await queryTask(config, key, id)
        const run = runs.byRequest(id)
        if (run) {
          const status = String(task.status ?? 'pending').toLowerCase()
          runs.upsert({
            id: run.id,
            status,
            message: task.message ?? null,
            outputs: task.outputs ?? {},
            costTimes: task.cost_times ?? {},
            finishedAt: status === 'success' || status === 'failed' ? new Date().toISOString() : null,
          })
        }
        return json({
          request_id: task.request_id,
          status: String(task.status ?? 'pending').toLowerCase(),
          outputs: task.outputs ?? {},
          message: task.message ?? null,
          cost_times: task.cost_times ?? {},
        })
      }
      return json({ error: 'not found' }, 404)
    } catch (error) {
      return json({ error: error?.message ?? String(error) }, 400)
    }
  }

  const postHandler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/^\/bizyair\/post/, '')
    try {
      if (path === '/upgrade') {
        const manager = ctx.get?.('pluginManager')
        const info = await latestPublishedVersion()
        const target = info.latest
        const linkInstall = String(info.source ?? '').startsWith('link:')
        if (!target) return sendJson(res, 400, { error: 'no newer version' })
        if (linkInstall) return sendJson(res, 409, { error: 'link-install', message: 'This profile uses a local link install; replace it manually.' })
        if (typeof manager?.updateBundle !== 'function') return sendJson(res, 501, { error: 'upgrade-unsupported' })
        const requestId = `upgrade-${Date.now()}`
        sendJson(res, 202, { started: true, target, requestId })
        setTimeout(async () => {
          try {
            ctx.logger?.info?.(`bizyair: upgrading to ${target}`)
            await manager.updateBundle('dsh-bizyair', target, { requestId })
            ctx.logger?.info?.(`bizyair: upgrade to ${target} finished`)
          } catch (error) {
            ctx.logger?.warn?.(`bizyair: upgrade to ${target} failed: ${error?.message ?? error}`)
          }
        }, 400)
        return
      }
      if (path === '/key-check') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const provided = String(body.key ?? '').trim()
        const stored = await readStoredKey(config)
        const target = provided || stored?.key
        if (!target) return sendJson(res, 200, { configured: false, valid: false, error: 'no key to test' })
        const probe = await probeKey(config, target)
        if (!provided) keyState = { ...probe, error: probe.error }
        return sendJson(res, 200, {
          configured: !!stored,
          source: provided ? 'input' : (stored?.path ?? 'unknown'),
          path: stored?.path ?? null,
          masked: maskKey(target),
          ...probe,
        })
      }
      if (path === '/key') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const key = String(body.key ?? '').trim()
        if (!key) return sendJson(res, 400, { error: 'empty key' })
        const stored = await readStoredKey(config)
        const probe = await probeKey(config, key)
        if (!probe.valid) {
          return sendJson(res, 200, {
            configured: !!stored,
            saved: false,
            path: stored?.path ?? null,
            masked: maskKey(stored?.key),
            ...probe,
          })
        }
        const target = keyPathOf(config)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, `${key}\n`, { mode: 0o600 })
        keyState = { ...probe }
        return sendJson(res, 200, { configured: true, saved: true, path: target, masked: maskKey(key), ...probe })
      }
      if (path === '/save') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const url = String(body.url ?? '')
        if (!/^https?:\/\//.test(url)) return sendJson(res, 400, { error: 'invalid url' })
        const requestId = String(body.requestId ?? 'adhoc').replace(/[^a-zA-Z0-9-]/g, '')
        const dir = join(panelRoot(), config.outputDir, dateStamp(), requestId)
        const artifact = await downloadArtifact(url, dir, Number(body.index ?? 0))
        return sendJson(res, 200, { path: relativeTo(panelRoot(), artifact.path), bytes: artifact.bytes })
      }
      if (path === '/client-loaded') {
        clientLoad = { at: new Date().toISOString(), version: url.searchParams.get('v') || 'unknown' }
        ctx.logger?.info?.(`bizyair: panel loaded in the Web client (${clientLoad.version})`)
        return sendJson(res, 200, { ok: true })
      }
      if (path === '/runs/delete') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        await runs.load()
        runs.store.list = runs.store.list.filter(run => run.id !== body.id)
        runs.flush()
        return sendJson(res, 200, { ok: true })
      }
      if (path === '/runs/clear') {
        await runs.load()
        runs.store.list = []
        runs.flush()
        return sendJson(res, 200, { ok: true })
      }
      if (path === '/runs/save') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        await runs.load()
        const run = runs.store.list.find(item => item.id === body.id)
        if (!run) return sendJson(res, 404, { error: 'unknown run' })
        const urls = collectOutputUrls(run.outputs)
        if (!urls.length) return sendJson(res, 400, { error: 'run has no outputs' })
        const dir = join(panelRoot(), config.outputDir, dateStamp(), run.requestId)
        const paths = []
        for (const [index, url] of urls.entries()) {
          const artifact = await downloadArtifact(url, dir, index)
          paths.push(relativeTo(panelRoot(), artifact.path))
        }
        runs.upsert({ id: run.id, savedPaths: paths })
        return sendJson(res, 200, { paths })
      }
      if (path === '/quote') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const model = models.get(normalizeEndpoint(body.endpoint))
        if (!model) return sendJson(res, 404, { error: 'unknown endpoint' })
        return sendJson(res, 200, estimateCost(model, body.params ?? {}))
      }
      if (path === '/generate') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
        const endpoint = normalizeEndpoint(body.endpoint)
        const model = models.get(endpoint)
        if (!model) return sendJson(res, 404, { error: 'unknown endpoint' })
        const params = body.params ?? {}
        validateParams(model, params)
        const key = await resolveKey(config)
        const submitted = await submitTask(config, key, endpoint, params)
        const estimate = estimateCost(model, params)
        const cwd = panelRoot()
        await audit(cwd, config, { type: 'panel-submit', endpoint, params: summarize(params), requestId: submitted.request_id, estimate })
        await runs.load()
        const run = runs.upsert({
          id: `run-${submitted.request_id}`,
          requestId: submitted.request_id,
          endpoint,
          title: model.title,
          task: model.task,
          params: summarize(params),
          estimate,
          status: 'queued',
          outputs: {},
        })
        return sendJson(res, 200, { request_id: submitted.request_id, run_id: run.id, endpoint, estimate })
      }
      if (path === '/upload') {
        const key = await resolveKey(config)
        const name = url.searchParams.get('name') || 'input.bin'
        const data = await readBody(req)
        if (data.length > 200 * 1024 * 1024) return sendJson(res, 413, { error: 'file exceeds 200 MB' })
        const uploaded = await uploadInput(config, key, { data, filename: name })
        return sendJson(res, 200, { url: uploaded.url, name, bytes: data.length })
      }
      return sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      return sendJson(res, 400, { error: error?.message ?? String(error) })
    }
  }

  try {
    const register = () => web.register({ kind: 'prefix', path: '/bizyair/api', resource })
    routes.push(ctx.effect ? ctx.effect(register) : register())
  } catch (error) {
    ctx.logger?.warn?.(`bizyair: panel GET routes unavailable: ${error.message}`)
  }
  try {
    const register = () => web.register({ kind: 'prefix', path: '/bizyair/post', handler: postHandler })
    routes.push(ctx.effect ? ctx.effect(register) : register())
  } catch (error) {
    ctx.logger?.warn?.(`bizyair: panel POST routes unavailable: ${error.message}`)
  }
  return true
}

function collectOutputUrls(outputs) {
  const urls = []
  for (const list of Object.values(outputs ?? {})) for (const url of list ?? []) urls.push(url)
  return urls
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 250 * 1024 * 1024) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/* ---------------------------------------------------------------- helpers */

/** Drop undefined members so results stay lossless JSON for the tool pipeline. */
function jsonSafe(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

async function gate(config, ctx, exec, model, estimate, confirmCost) {
  const threshold = Number(config.approvalThresholdUsd ?? 20)
  if (!(estimate.usd !== null && estimate.usd >= threshold)) return
  if (confirmCost === true) return
  const approval = ctx.get?.('approval')
  if (!approval?.request) {
    throw new BizyAirError(
      `Estimated cost $${estimate.usd} is at or above the $${threshold} threshold. ` +
      'Ask the user to confirm, then call again with confirm_cost: true.', { code: 'NEEDS_CONFIRMATION' })
  }
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: 'bizyair_generate',
    callId: exec.callId,
    reason: `BizyAir ${model.endpoint} ≈ $${estimate.usd}`,
    displayReason: {
      en: `Run ${model.title} on BizyAir? Estimated cost ≈ $${estimate.usd} (${estimate.label}).`,
      zh: `在 BizyAir 上运行「${model.title}」？预计费用约 $${estimate.usd}（${estimate.label}）。`,
    },
    signal: exec.signal,
  })
  if (outcome === 'allowed-once') return
  throw new BizyAirError(
    outcome === 'rejected'
      ? 'The user rejected this paid BizyAir call.'
      : `Cost approval was not granted (${outcome}); nothing was submitted.`,
    { code: 'NEEDS_CONFIRMATION' })
}

async function workingDirectory(ctx, exec) {
  const service = ctx.get?.('workingDirectory')
  if (service?.ensure && exec.agent) return service.ensure(exec.agent, exec.signal)
  if (service?.get && exec.agent?.session) return service.get(exec.agent.session)
  return process.cwd()
}

async function startJob(ctx, config, exec, { endpoint, requestId, cwd, key }) {
  const jobs = ctx.get?.('jobs')
  if (!jobs?.start || !exec.agent?.session?.id) return undefined
  const owner = exec.agent.session.id
  try {
    return jobs.start({
      kind: 'bizyair',
      label: `BizyAir ${endpoint}`,
      owner,
      toolCall: { callId: exec.callId, rootCallId: exec.rootCallId ?? exec.callId },
      run(job) {
        const controller = new AbortController()
        const done = (async () => {
          try {
            job.updateProgress?.('queued')
            let lastStatus = 'queued'
            const task = await waitForTask(config, key, requestId, {
              signal: controller.signal,
              timeoutMs: Number(config.backgroundPollSeconds ?? 1200) * 1000,
              intervalMs: Number(config.pollIntervalSeconds ?? 5) * 1000,
              onTick: (snapshot) => {
                const status = String(snapshot?.status ?? 'unknown')
                if (status !== lastStatus) {
                  lastStatus = status
                  job.append?.(`[${new Date().toISOString()}] ${status}\n`)
                  job.updateProgress?.(status)
                }
              },
            })
            if (!isTerminal(task)) {
              return { status: 'failed', detail: 'stopped after the polling window' }
            }
            if (String(task.status).toLowerCase() === 'failed') {
              return { status: 'failed', detail: task.message || 'task failed' }
            }
            const collected = await collect(ctx, config, { endpoint, requestId, task, cwd, key })
            job.append?.(`result: ${JSON.stringify(collected.outputs ?? [])}\n`)
            job.updateProgress?.('success')
            return { status: 'completed', result: JSON.stringify({ request_id: requestId, endpoint, outputs: collected.outputs }) }
          } catch (error) {
            return { status: 'failed', detail: error?.message ?? String(error) }
          }
        })()
        return {
          cancel(reason) {
            controller.abort(new Error(reason || 'cancelled'))
          },
          done,
        }
      },
    })
  } catch (error) {
    ctx.logger?.warn?.(`bizyair: background job unavailable: ${error.message}`)
    return undefined
  }
}

async function audit(cwd, config, record) {
  try {
    const dir = join(cwd, config.outputDir)
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, 'calls.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`)
  } catch { /* auditing is best effort */ }
}

function summarize(params) {
  const out = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' && value.length > 200) out[key] = `${value.slice(0, 197)}…`
    else out[key] = value
  }
  return out
}

function normalizeEndpoint(value) {
  return String(value ?? '').trim().replace(/^https?:\/\/[^/]+\/modelzoo\//, '').replace(/\/+$/, '')
}

function dateStamp() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}

function relativeTo(cwd, path) {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path
}
