/** Shared helpers: BizyAir HTTP client, OSS upload, artifact downloads. */
import { createHash, createHmac } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class BizyAirError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'BizyAirError'
    this.status = status
    this.code = code
  }
}

/** One key-file location shared by the panel, the tools, and the probes. */
export function keyPathOf(config) {
  if (config.apiKeyFile) return config.apiKeyFile
  if (config.keyPath) return config.keyPath
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'bizyair.key')
}

/** Resolve the API key from config, environment, or the private key file. */
export async function resolveKey(config) {
  const fromConfig = config.apiKey?.trim?.()
  if (fromConfig) return fromConfig
  const envName = config.apiKeyEnv || 'BIZYAIR_API_KEY'
  const fromEnv = process.env[envName]?.trim()
  if (fromEnv) return fromEnv
  for (const candidate of [config.apiKeyFile, keyPathOf(config)].filter(Boolean)) {
    try {
      const text = await readFile(candidate, 'utf8')
      const key = text.trim().split(/\s+/).pop()
      if (key) return key
    } catch { /* try the next location */ }
  }
  throw new BizyAirError(
    `BizyAir API key is not configured. Create or copy one at https://www.bizyair.ai/user/api-key, ` +
    `then save it in the BizyAir panel (API Key tab) or set ${envName} / apiKeyFile in the plugin config.`,
    { code: 'NO_KEY' })
}

async function request(config, key, path, { method = 'GET', body, signal } = {}) {
  const url = `${config.apiBase.replace(/\/$/, '')}${path}`
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (config.logMaskFields) headers['x-bizyair-log-mask-fields'] = config.logMaskFields
  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new BizyAirError(`BizyAir request failed: ${error?.message ?? error}`, { code: 'NETWORK' })
  }
  const text = await response.text()
  let payload
  try { payload = JSON.parse(text) } catch {
    throw new BizyAirError(`BizyAir returned non-JSON (${response.status}): ${text.slice(0, 200)}`, { status: response.status })
  }
  if (response.status === 401) {
    throw new BizyAirError(
      'BizyAir rejected the API key (401). Check that the key is valid and not expired, or create a new one at https://www.bizyair.ai/user/api-key',
      { status: 401, code: 'UNAUTHORIZED' })
  }
  if (payload.status !== true || payload.code !== 20000) {
    throw new BizyAirError(payload.message || `BizyAir error code ${payload.code}`, { status: response.status, code: String(payload.code) })
  }
  return payload.data
}

/** Probe a key without spending money: the upload-token endpoint is free. */
export async function probeKey(config, key) {
  try {
    await request(config, key, '/v1/upload/token?file_name=probe.png&file_type=inputs_temp')
    return { valid: true, checkedAt: new Date().toISOString() }
  } catch (error) {
    return {
      valid: false,
      checkedAt: new Date().toISOString(),
      status: error?.status ?? null,
      code: error?.code ?? null,
      error: error?.message ?? String(error),
    }
  }
}

export function submitTask(config, key, endpoint, params, signal) {
  return request(config, key, `/v1/modelzoo/tasks/openapi/${endpoint}`, { method: 'POST', body: params, signal })
}

export function queryTask(config, key, requestId, signal) {
  return request(config, key, `/v1/modelzoo/tasks/openapi/${requestId}`, { signal })
}

const TERMINAL = new Set(['success', 'failed'])

export function isTerminal(task) {
  return TERMINAL.has(String(task?.status ?? '').toLowerCase())
}

/** Poll a task until terminal, aborted, or the deadline passes. */
export async function waitForTask(config, key, requestId, { signal, timeoutMs, intervalMs = 4000, onTick } = {}) {
  const startedAt = Date.now()
  let task = await queryTask(config, key, requestId, signal)
  onTick?.(task)
  while (!isTerminal(task)) {
    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) return task
    await sleep(intervalMs, signal)
    task = await queryTask(config, key, requestId, signal)
    onTick?.(task)
  }
  return task
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'))
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('aborted')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/flac': '.flac',
  'audio/ogg': '.ogg', 'audio/opus': '.opus', 'model/gltf-binary': '.glb', 'application/zip': '.zip',
}

export function mediaKind(url = '', contentType = '') {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(url)) return 'image'
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return 'video'
  if (/\.(mp3|wav|flac|ogg|opus|m4a)(\?|$)/i.test(url)) return 'audio'
  if (/\.(glb|gltf|obj|fbx)(\?|$)/i.test(url)) return 'model'
  if (/\.(zip|7z|tar|gz)(\?|$)/i.test(url)) return 'archive'
  return 'file'
}

/** Download one generated artifact into the workspace. */
export async function downloadArtifact(url, targetDir, index, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new BizyAirError(`Download failed (${response.status}): ${url}`, { status: response.status })
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim()
  const buffer = Buffer.from(await response.arrayBuffer())
  const kind = mediaKind(url, contentType)
  const ext = EXT_BY_TYPE[contentType] || guessExtension(url) || '.bin'
  await mkdir(targetDir, { recursive: true })
  const name = `${String(index + 1).padStart(2, '0')}${ext}`
  const path = join(targetDir, name)
  await writeFile(path, buffer)
  return { url, path, name, kind, contentType: contentType || null, bytes: buffer.length }
}

function guessExtension(url) {
  const match = url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)
  return match ? `.${match[1].toLowerCase()}` : null
}

function ossSignature({ method, contentType, contentMd5, date, canonicalHeaders, canonicalResource, secret }) {
  const stringToSign = `${method}\n${contentMd5}\n${contentType}\n${date}\n${canonicalHeaders}${canonicalResource}`
  return createHmac('sha1', secret).update(stringToSign).digest('base64')
}

/**
 * Three-step input upload: token -> OSS STS PUT -> input_resource commit.
 * Returns the permanent-ish URL to reference from media parameters.
 */
export async function uploadInput(config, key, { data, filename, signal }) {
  const token = await request(config, key,
    `/v1/upload/token?file_name=${encodeURIComponent(filename)}&file_type=inputs_temp`, { signal })
  const file = token.file
  const storage = token.storage
  if (!file?.object_key || !storage?.endpoint || !storage?.bucket) {
    throw new BizyAirError('BizyAir upload token response is missing OSS coordinates')
  }
  const endpoint = String(storage.endpoint).replace(/^https?:\/\//, '').replace(/\/$/, '')
  const host = `${storage.bucket}.${endpoint}`
  const objectKey = file.object_key
  const contentType = contentTypeOf(filename)
  const date = new Date().toUTCString()
  const contentMd5 = createHash('md5').update(data).digest('base64')
  const canonicalHeaders = `x-oss-security-token:${file.security_token}\n`
  const canonicalResource = `/${storage.bucket}/${objectKey}`
  const signature = ossSignature({
    method: 'PUT',
    contentType,
    contentMd5,
    date,
    canonicalHeaders,
    canonicalResource,
    secret: file.access_key_secret,
  })
  const put = await fetch(`https://${host}/${objectKey}`, {
    method: 'PUT',
    headers: {
      'content-type': contentType,
      'content-md5': contentMd5,
      date,
      'x-oss-security-token': file.security_token,
      authorization: `OSS ${file.access_key_id}:${signature}`,
    },
    body: data,
    signal,
  })
  if (!put.ok) {
    const detail = await put.text().catch(() => '')
    throw new BizyAirError(`OSS upload failed (${put.status}): ${detail.slice(0, 300)}`, { status: put.status })
  }
  const metaBase = (config.metaBase || 'https://meta.bizyair.ai').replace(/\/$/, '')
  const commitResponse = await fetch(`${metaBase}/v1/input_resource/commit`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: filename, object_key: objectKey }),
    signal,
  })
  const commitPayload = await commitResponse.json().catch(() => null)
  if (!commitResponse.ok || commitPayload?.status !== true || commitPayload?.code !== 20000) {
    throw new BizyAirError(
      `BizyAir input commit failed (${commitResponse.status}): ${commitPayload?.message ?? 'unexpected response'}`,
      { status: commitResponse.status, code: String(commitPayload?.code ?? '') })
  }
  const commit = commitPayload.data
  return { url: commit.url, id: commit.id, objectKey }
}

function contentTypeOf(filename) {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  }[ext] || 'application/octet-stream'
}
