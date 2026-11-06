#!/usr/bin/env node
/**
 * Build data/catalog.json from BizyAir's public LLM documentation.
 *
 * Sources (all public, no auth):
 *   - https://www.bizyair.ai/sitemap-model-api-1.xml      -> the 235 model endpoints
 *   - <plaza>/llms.txt                                    -> parameter table, outputs, constraints
 *   - <plaza> (HTML)                                      -> title, description, edition badge
 *   - https://www.bizyair.ai/llms/price                   -> per-endpoint price tables
 *
 * Usage: node scripts/build-catalog.mjs [--refresh]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache')
const OUT = join(ROOT, 'data', 'catalog.json')
const ORIGIN = 'https://www.bizyair.ai'
const UA = 'dsh-bizyair-catalog/1.0 (+https://www.bizyair.ai)'
const REFRESH = process.argv.includes('--refresh')
const CONCURRENCY = 8

async function fetchText(url, { cacheKey, retries = 3 } = {}) {
  const path = cacheKey ? join(CACHE, cacheKey) : null
  if (path && !REFRESH && existsSync(path)) return readFile(path, 'utf8')
  let last
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' } })
      if (!res.ok) throw new Error(`${res.status} ${url}`)
      const text = await res.text()
      if (path) {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text)
      }
      return text
    } catch (error) {
      last = error
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
  throw last
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      out[index] = await fn(items[index], index)
    }
  }))
  return out
}

const TYPE = {
  string: 'string', number: 'number', integer: 'integer', boolean: 'boolean',
  'string[]': 'array', 'number[]': 'array', 'object[]': 'array', object: 'object',
}

function parseDefault(raw, type) {
  const value = raw.trim().replace(/<br\/?>.*$/s, '').trim()
  if (!value) return undefined
  if (type === 'boolean') return value === 'true'
  if (type === 'number' || type === 'integer') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  if (type === 'array') {
    try { return JSON.parse(value) } catch { return undefined }
  }
  return value
}

/** Parse one doc's "Request Parameters" table into a JSON Schema plus hints. */
export function parseParams(doc) {
  const start = doc.indexOf('### 2. Request Parameters')
  if (start < 0) return null
  const end = doc.indexOf('### 3. Response Example', start)
  const section = doc.slice(start, end < 0 ? undefined : end)
  const properties = {}
  const required = []
  const hints = {}
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) continue
    if (/^\|\s*(Parameter|:?-{3,})/.test(line)) continue
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    if (cells.length < 4) continue
    const [name, rawType, flag, rawDesc] = cells
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) continue
    const type = TYPE[rawType] ?? (rawType.endsWith('[]') ? 'array' : 'string')
    const desc = rawDesc.replace(/<br\s*\/?>/gi, '\n').trim()
    const readable = desc
      .replace(/⟨bz_enum_json⟩.*?⟨\/bz_enum_json⟩\s*/gs, '')
      .replace(/Automatically fills the default value when omitted:[^\n]*/gi, '')
      .replace(/Value range:[^\n]*/gi, '')
      .replace(/Step:[^\n]*/gi, '')
      .replace(/Minimum uploads:[^\n]*/gi, '')
      .replace(/Maximum uploads:[^\n]*/gi, '')
      .replace(/\n{2,}/g, '\n')
      .trim()
    const prop = { type, description: readable }
    const enumMatch = desc.match(/⟨bz_enum_json⟩(.*?)⟨\/bz_enum_json⟩/s)
    if (enumMatch) {
      try {
        const values = JSON.parse(enumMatch[1])
        if (Array.isArray(values) && values.length) prop.enum = values
      } catch { /* keep free-form */ }
    }
    const range = desc.match(/Value range:\s*(-?[\d.]+)\s*~\s*(-?[\d.]+)/)
    if (range) {
      prop.minimum = Number(range[1])
      prop.maximum = Number(range[2])
    }
    const step = desc.match(/Step:\s*([\d.]+)/)
    if (step && Number(step[1]) > 0) prop.multipleOf = Number(step[1])
    const def = desc.match(/Automatically fills the default value when omitted:\s*([^\n]+)/)
    if (def) {
      const value = parseDefault(def[1], type)
      if (value !== undefined) prop.default = value
    }
    if (type === 'array') {
      const itemType = rawType.startsWith('number') ? 'number' : 'string'
      prop.items = itemType === 'string' && /url/i.test(name)
        ? { type: 'string', format: 'uri' }
        : { type: itemType }
      const min = desc.match(/Minimum uploads:\s*(\d+)/)
      const max = desc.match(/Maximum uploads:\s*(\d+)/)
      const exact = desc.match(/items:\s*(\d+)/)
      if (min) prop.minItems = Number(min[1])
      if (max) prop.maxItems = Number(max[1])
      if (exact && !min && !max) {
        prop.minItems = Number(exact[1])
        prop.maxItems = Number(exact[1])
      }
      if (/supported formats:/i.test(desc)) {
        const formats = desc.match(/Supported formats:\s*([a-z0-9,\s]+)/i)?.[1]
        if (formats) hints[name] = { formats: formats.split(',').map(s => s.trim()).filter(Boolean) }
      }
    }
    if (desc.includes('mutually exclusive')) hints[name] = { ...(hints[name] ?? {}), exclusiveWith: true }
    properties[name] = prop
    if (flag === 'Required') required.push(name)
  }
  if (!Object.keys(properties).length) return null
  const schema = { type: 'object', additionalProperties: true, properties }
  if (required.length) schema.required = required
  return { schema, hints }
}

function parseOutputs(doc) {
  const keys = new Set()
  for (const m of doc.matchAll(/outputs\.([a-z_]+)\b/g)) keys.add(m[1])
  return [...keys]
}

function parsePrice(markdown) {
  const blocks = new Map()
  const chunks = markdown.split(/\n### /).slice(1)
  for (const chunk of chunks) {
    const endpoint = chunk.match(/\*\*Endpoint\*\*:\s*`([^`]+)`/)?.[1]
    if (!endpoint) continue
    const title = chunk.split('\n')[0].trim()
    const tableLines = chunk.split('\n').filter(l => l.trim().startsWith('|'))
    const rows = []
    let header = null
    for (const line of tableLines) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      if (/^:?-{3,}$/.test(cells[0])) continue
      if (!header) { header = cells; continue }
      rows.push(cells)
    }
    if (!header) continue
    const valueColumn = header[header.length - 1]
    const unitMatch = valueColumn.match(/Price per (.+)/i)
    const unit = unitMatch ? `per_${unitMatch[1].trim().replace(/\s+/g, '_').toLowerCase()}` : 'per_call'
    const dims = header.slice(0, -1)
    const entries = []
    for (const row of rows) {
      const priceText = row[row.length - 1] ?? ''
      const price = Number((priceText.match(/\$?\s*([\d.]+)/) ?? [])[1])
      if (!Number.isFinite(price)) continue
      const dim = {}
      dims.forEach((d, i) => { dim[d] = row[i] })
      entries.push({ dim, price })
    }
    if (!entries.length) continue
    const note = chunk.split('\n').filter(l => l.trim().startsWith('>')).join('\n').replace(/^>\s?/gm, '').trim()
    blocks.set(endpoint, {
      title,
      unit,
      dimension: dims.length ? dims.join(' / ') : null,
      dimensions: dims,
      rows: entries,
      note: note || null,
      display: `${dims.length ? dims.join(' / ') + ' — ' : ''}${header[header.length - 1]}: ${entries.map(e => `${Object.values(e.dim).filter(Boolean).join('/') || 'any'} $${e.price}`).join(', ')}`,
    })
  }
  return blocks
}

function parseDetail(html) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim() ?? null
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1]
    ?? html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? null
  const badges = [...html.matchAll(/<span class="font-sans text-label-xs font-semibold whitespace-nowrap[^"]*">([^<]+)<\/span>/g)]
    .map(m => m[1])
  const edition = badges.includes('Self-hosted') ? 'self-hosted'
    : badges.includes('Economy') ? 'economy'
      : badges.includes('Official') ? 'official' : null
  const vendor = badges.includes('Third-party') ? 'third-party' : edition === 'self-hosted' ? 'bizyair' : null
  const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? null
  const cover = ogImage && ogImage.startsWith('https://storage.bizyair.ai/') ? ogImage : null
  const icon = html.match(/https:\/\/storage\.bizyair\.ai\/icons\/models\/[A-Za-z0-9._-]+/)?.[0] ?? null
  const bg = html.match(/https:\/\/storage\.bizyair\.ai\/icons\/model_bg\/[A-Za-z0-9._-]+/)?.[0] ?? null
  return { title, description: description ? decodeEntities(description) : null, edition, vendor, cover, icon, bg }
}

function decodeEntities(text) {
  return text.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

async function main() {
  console.log('fetching sitemap…')
  const sitemap = await fetchText(`${ORIGIN}/sitemap-model-api-1.xml`, { cacheKey: 'sitemap.xml' })
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
  console.log(`endpoints: ${urls.length}`)

  const priceMarkdown = await fetchText(`${ORIGIN}/llms/price`, { cacheKey: 'price.md' })
  const prices = parsePrice(priceMarkdown)
  console.log(`price blocks: ${prices.size}`)

  const models = await mapLimit(urls, CONCURRENCY, async (url) => {
    const endpoint = url.replace(`${ORIGIN}/modelzoo/`, '')
    const [model, ...rest] = endpoint.split('/')
    const doc = await fetchText(`${url}/llms.txt`, { cacheKey: `doc/${endpoint}.md` })
    const html = await fetchText(url, { cacheKey: `page/${endpoint}.html` })
    const detail = parseDetail(html)
    const parsed = parseParams(doc)
    return {
      endpoint,
      model,
      task: rest.join('/'),
      title: detail.title ?? endpoint,
      description: detail.description,
      edition: detail.edition,
      vendor: detail.vendor,
      cover: detail.cover,
      icon: detail.icon,
      bg: detail.bg,
      outputs: parseOutputs(doc),
      schema: parsed?.schema ?? null,
      hints: parsed?.hints ?? null,
      price: prices.get(endpoint) ?? null,
      docsUrl: `${url}/llms.txt`,
      plazaUrl: url,
    }
  })

  const catalog = {
    generatedAt: new Date().toISOString(),
    source: { sitemap: `${ORIGIN}/sitemap-model-api-1.xml`, docs: `${ORIGIN}/modelzoo/<model>/<task>/llms.txt`, price: `${ORIGIN}/llms/price` },
    stats: {
      models: models.length,
      withSchema: models.filter(m => m.schema).length,
      withPrice: models.filter(m => m.price).length,
      editions: countBy(models, m => m.edition),
    },
    models,
  }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(catalog))
  console.log('stats', catalog.stats)
  console.log(`wrote ${OUT} (${(JSON.stringify(catalog).length / 1024).toFixed(0)} KiB)`)
}

function countBy(items, fn) {
  const out = {}
  for (const item of items) {
    const key = fn(item) ?? 'unknown'
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

main().catch((error) => { console.error(error); process.exit(1) })
