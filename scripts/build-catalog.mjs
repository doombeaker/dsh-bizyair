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
    const lines = chunk.split('\n')
    const tables = []
    let header = null
    let columns = null
    let rows = []
    const flush = () => {
      if (!header || !rows.length) { header = null; columns = null; rows = []; return }
      tables.push({ header, columns, rows })
      header = null; columns = null; rows = []
    }
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('|')) { flush(); continue }
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      if (/^:?-{3,}/.test(cells[0])) continue
      const priceIndex = cells.findIndex(cell => /price per/i.test(cell))
      if (priceIndex >= 0) {
        flush()
        header = cells
        columns = cells.map((cell, index) => ({ cell, index }))
          .filter(({ cell }) => !/notes?|description/i.test(cell))
        continue
      }
      if (!header) continue
      rows.push(cells)
    }
    flush()
    if (!tables.length) continue

    const parsedTables = tables.map(table => {
      const priceCell = table.header.find(cell => /price per/i.test(cell))
      const priceIndex = table.header.indexOf(priceCell)
      const unitMatch = priceCell.match(/Price per (.+)/i)
      const unit = unitMatch ? `per_${unitMatch[1].trim().replace(/\s+/g, '_').toLowerCase()}` : 'per_call'
      const dims = table.columns.filter(col => col.index !== priceIndex)
      const entries = []
      for (const row of table.rows) {
        const priceText = row[priceIndex] ?? ''
        const price = Number((priceText.match(/\$?\s*([\d.]+)/) ?? [])[1])
        if (!Number.isFinite(price)) continue
        const dim = {}
        for (const col of dims) dim[col.cell] = row[col.index]
        entries.push({ dim, price })
      }
      if (!entries.length) return null
      const note = chunk.split('\n').filter(l => l.trim().startsWith('>')).join('\n').replace(/^>\s?/gm, '').trim()
      return {
        unit,
        header: table.header,
        dimensions: dims.map(col => col.cell),
        rows: entries,
        note: note || null,
      }
    }).filter(Boolean)
    if (!parsedTables.length) continue

    const primary = parsedTables.find(table => table.unit === 'per_call')
      ?? parsedTables.find(table => table.unit !== 'per_image')
      ?? parsedTables[0]
    const display = parsedTables.map(table => {
      const valueColumn = table.header[table.header.indexOf(table.header.find(c => /price per/i.test(c)))]
      const dims = table.dimensions
      const lines = table.rows.map(entry =>
        `${dims.map(dim => `${dim}=${entry.dim[dim] ?? ''}`).join(' / ') || 'any'} $${entry.price}`)
      return `${valueColumn}: ${lines.join(', ')}`
    }).join('\n')

    blocks.set(endpoint, {
      title,
      unit: primary.unit,
      dimension: primary.dimensions.length ? primary.dimensions.join(' / ') : null,
      dimensions: primary.dimensions,
      rows: primary.rows,
      tables: parsedTables,
      note: parsedTables.map(table => table.note).filter(Boolean).join('\n') || null,
      display,
    })
  }
  return blocks
}

/** Parse the playground spec embedded in a model page (escaped JSON in the flight payload). */
export function parsePlayground(html) {
  const marker = 'input_params'
  let start = html.indexOf(marker)
  if (start < 0) return null
  const arrStart = html.indexOf('[', start)
  if (arrStart < 0) return null
  let depth = 0
  let inString = false
  let end = -1
  for (let i = arrStart; i < html.length; i++) {
    const ch = html[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '\\') { i++; continue }
    if (ch === '"') { inString = true; continue }
    if (ch === '[') depth++
    else if (ch === ']') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return null
  const raw = html.slice(arrStart, end + 1)
  const json = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  try {
    const value = JSON.parse(json)
    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function applyPlayground(model, playground) {
  if (!Array.isArray(playground) || !playground.length) return
  const defaults = {}
  const order = {}
  for (const field of playground) {
    const name = field?.field_name
    if (typeof name !== 'string' || !name) continue
    const value = field.field_value
    if (value !== '' && value !== null && value !== undefined) defaults[name] = value
    if (Number.isFinite(field.sort)) order[name] = field.sort
    const prop = model.schema?.properties?.[name]
    const options = field.field_options
    if (prop && options && typeof options === 'object') {
      if (prop.minimum === undefined && Number.isFinite(options.min)) prop.minimum = options.min
      if (prop.maximum === undefined && Number.isFinite(options.max)) prop.maximum = options.max
      if (prop.multipleOf === undefined && Number.isFinite(options.step) && options.step > 0) prop.multipleOf = options.step
    }
  }
  for (const [name, value] of Object.entries(defaults)) {
    const prop = model.schema?.properties?.[name]
    if (prop && prop.default === undefined) prop.default = value
  }
  model.defaults = defaults
  model.order = order
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
    const segments = endpoint.split('/')
    const model = segments[0]
    // `task` is the leaf action; `taskPath` keeps the category prefix
    // (image-tools/watermark-remover) for filtering and display.
    const task = segments[segments.length - 1]
    const taskPath = segments.slice(1).join('/')
    const doc = await fetchText(`${url}/llms.txt`, { cacheKey: `doc/${endpoint}.md` })
    const html = await fetchText(url, { cacheKey: `page/${endpoint}.html` })
    const detail = parseDetail(html)
    const parsed = parseParams(doc)
    const assembled = {
      endpoint,
      model,
      task,
      taskPath,
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
    applyPlayground(assembled, parsePlayground(html))
    return assembled
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
