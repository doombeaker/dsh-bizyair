/** Catalog loading, search, schema projection, and cost estimation. */
import { readFile } from 'node:fs/promises'

const EDITION_LABEL = {
  'self-hosted': 'Self-hosted',
  economy: 'Economy',
  official: 'Official',
}

const OUTPUT_LABEL = {
  images: 'image', videos: 'video', audios: 'audio', texts: 'text', models: '3D model', archives: 'archive',
}

export async function loadCatalog(path, { refresh } = {}) {
  if (refresh) {
    try {
      const { execFile } = await import('node:child_process')
      await new Promise((resolve, reject) => {
        execFile(process.execPath, [new URL('../scripts/build-catalog.mjs', import.meta.url).pathname, '--refresh'],
          { timeout: 600_000 }, (error) => error ? reject(error) : resolve())
      })
    } catch { /* keep the bundled snapshot */ }
  }
  const raw = JSON.parse(await readFile(path, 'utf8'))
  return decorateCatalog(raw)
}

/** Add the derived fields every tool expects to a raw catalog document. */
export function decorateCatalog(raw) {
  const models = raw.models.map(model => {
    const segments = String(model.endpoint).split('/')
    const task = segments[segments.length - 1]
    const taskPath = segments.slice(1).join('/')
    return {
    ...model,
    task,
    taskPath,
    description: model.description ?? '',
    editionLabel: EDITION_LABEL[model.edition] ?? model.edition ?? 'unknown',
    outputsLabel: (model.outputs ?? []).map(o => OUTPUT_LABEL[o] ?? o),
    priceFrom: model.price ? lowestPrice(model.price) : null,
    search: `${model.endpoint} ${model.title} ${model.description ?? ''}`.toLowerCase(),
    }
  })
  return { generatedAt: raw.generatedAt, stats: raw.stats, models, byEndpoint: new Map(models.map(m => [m.endpoint, m])) }
}

const UNIT_SUFFIX = {
  per_second: '/s', per_image: '/image', per_call: '/call', per_1000_chars: '/1k chars',
  per_mp: '/MP', per_mp_steps28: '/MP',
}

function lowestPrice(price) {
  const values = price.rows.map(r => r.price).filter(n => Number.isFinite(n))
  if (!values.length) return null
  const suffix = UNIT_SUFFIX[price.unit] ?? ''
  return {
    usd: Math.min(...values),
    unit: price.unit,
    display: price.rows.length === 1 ? `$${values[0]}${suffix}` : `from $${Math.min(...values)}${suffix}`,
  }
}

export function selectModels(catalog, args = {}) {
  const limit = clampInt(args.limit, 1, 40, 12)
  const query = (args.query ?? '').trim().toLowerCase()
  const tokens = query.split(/\s+/).filter(Boolean)
  const outputs = asArray(args.output).map(s => normalizeOutput(s))
  const editions = asArray(args.edition).map(s => String(s).toLowerCase())
  const tasks = asArray(args.task).map(s => String(s).toLowerCase())

  let rows = catalog.models
  if (outputs.length) rows = rows.filter(m => (m.outputs ?? []).some(o => outputs.includes(normalizeOutput(o))))
  if (editions.length) rows = rows.filter(m => editions.includes(String(m.edition)))
  if (tasks.length) rows = rows.filter(m => tasks.some(t => (m.taskPath ?? m.task).toLowerCase().includes(t)))
  if (args.max_price !== undefined) {
    const max = Number(args.max_price)
    if (Number.isFinite(max)) rows = rows.filter(m => m.priceFrom && m.priceFrom.usd <= max)
  }
  if (tokens.length) {
    const scored = []
    for (const model of rows) {
      let score = 0
      for (const token of tokens) {
        if (model.endpoint.toLowerCase().includes(token) || model.title.toLowerCase().includes(token)) score += 2
        else if (model.search.includes(token)) score += 1
      }
      if (score > 0) scored.push([score, model])
    }
    scored.sort((a, b) => b[0] - a[0] || (a[1].priceFrom?.usd ?? 99) - (b[1].priceFrom?.usd ?? 99))
    rows = scored.map(pair => pair[1])
  } else {
    rows = [...rows].sort((a, b) =>
      (a.priceFrom?.usd ?? 99) - (b.priceFrom?.usd ?? 99) || a.endpoint.localeCompare(b.endpoint))
  }
  const total = rows.length
  return {
    total,
    shown: Math.min(total, limit),
    models: rows.slice(0, limit).map(model => ({
      endpoint: model.endpoint,
      title: model.title,
      task: model.task,
      edition: model.editionLabel,
      outputs: model.outputsLabel,
      price: model.priceFrom ? model.priceFrom.display : 'n/a',
      description: truncate(model.description ?? '', 160),
    })),
  }
}

function normalizeOutput(value) {
  const text = String(value).toLowerCase()
  if (/video/.test(text)) return 'videos'
  if (/audio|speech|music/.test(text)) return 'audios'
  if (/image|picture|photo/.test(text)) return 'images'
  return text
}

export function describeModel(model) {
  const properties = model.schema?.properties ?? {}
  const params = Object.entries(properties).map(([name, prop]) => {
    const entry = {
      name,
      type: prop.type,
      required: (model.schema.required ?? []).includes(name),
    }
    if (prop.enum) entry.enum = prop.enum
    if (prop.default !== undefined) entry.default = prop.default
    if (prop.minimum !== undefined) entry.minimum = prop.minimum
    if (prop.maximum !== undefined) entry.maximum = prop.maximum
    if (prop.multipleOf !== undefined) entry.multipleOf = prop.multipleOf
    if (prop.minItems !== undefined) entry.minItems = prop.minItems
    if (prop.maxItems !== undefined) entry.maxItems = prop.maxItems
    if (prop.items?.type) entry.itemType = prop.items.type
    entry.description = cleanDescription(prop.description)
    return entry
  })
  return {
    endpoint: model.endpoint,
    title: model.title,
    task: model.task,
    edition: model.editionLabel,
    outputs: model.outputsLabel,
    description: truncate(model.description ?? '', 400),
    parameters: params,
    example: buildExample(model),
    price: model.price
      ? { unit: model.price.unit, table: model.price.display, note: model.price.note, dimensions: model.price.dimensions }
      : null,
    docsUrl: model.docsUrl,
    plazaUrl: model.plazaUrl,
  }
}

function buildExample(model) {
  const example = {}
  for (const [name, prop] of Object.entries(model.schema?.properties ?? {})) {
    if (prop.default !== undefined) example[name] = prop.default
    else if (prop.enum?.length) example[name] = prop.enum[0]
    else if (prop.type === 'boolean') example[name] = false
    else if (prop.type === 'number' || prop.type === 'integer') example[name] = prop.minimum ?? 1
    else if (prop.type === 'array') example[name] = /url/i.test(name) ? ['<url from bizyair_upload>'] : []
    else if (name === 'prompt' || name === 'input' || name === 'text') example[name] = '<describe what you want>'
  }
  return example
}

export function cleanDescription(text = '') {
  return text
    .replace(/⟨bz_enum_json⟩.*?⟨\/bz_enum_json⟩\s*/gs, '')
    .replace(/Automatically fills the default value when omitted:\s*[^\n]+/g, '')
    .replace(/Minimum uploads:\s*\d+\s*/g, '')
    .replace(/Maximum uploads:\s*\d+\s*/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Validate user-supplied parameters against the catalog schema (best effort). */
export function validateParams(model, params) {
  const schema = model.schema
  if (!schema) return
  for (const key of schema.required ?? []) {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      throw new Error(`${model.endpoint} requires parameter "${key}"`)
    }
  }
  for (const [key, value] of Object.entries(params)) {
    const prop = schema.properties?.[key]
    if (!prop) continue
    if (prop.enum && !prop.enum.includes(value)) {
      throw new Error(`"${key}" must be one of ${prop.enum.join(', ')} (got ${JSON.stringify(value)})`)
    }
    if (typeof value === 'number') {
      if (prop.minimum !== undefined && value < prop.minimum) throw new Error(`"${key}" must be ≥ ${prop.minimum}`)
      if (prop.maximum !== undefined && value > prop.maximum) throw new Error(`"${key}" must be ≤ ${prop.maximum}`)
    }
    if (Array.isArray(value)) {
      if (prop.minItems !== undefined && value.length < prop.minItems) throw new Error(`"${key}" needs at least ${prop.minItems} item(s)`)
      if (prop.maxItems !== undefined && value.length > prop.maxItems) throw new Error(`"${key}" accepts at most ${prop.maxItems} item(s)`)
      if (/url/i.test(key) && value.some(v => typeof v !== 'string' || !/^https?:\/\//.test(v))) {
        throw new Error(`"${key}" items must be public URLs; upload local files with bizyair_upload first`)
      }
    }
  }
}

/** Estimate one call's USD cost from the published price table. */
export function estimateCost(model, params = {}) {
  const price = model.price
  if (!price) return { usd: null, label: 'price unavailable', approximate: true }
  const dimensions = price.dimensions ?? []
  const row = pickRow(price, dimensions, params)
  const unit = price.unit
  let qty = 1
  let qtyLabel = '1 call'
  if (unit === 'per_second') {
    qty = numberParam(params, ['duration', 'seconds', 'video_duration', 'length'], 5)
    qtyLabel = `${qty}s`
  } else if (unit === 'per_image') {
    qty = numberParam(params, ['n', 'num_images', 'image_count', 'count'], 1)
    qtyLabel = `${qty} image(s)`
  } else if (unit === 'per_1000_chars') {
    const text = String(params.input ?? params.text ?? params.prompt ?? '')
    const chars = Math.max(100, Math.ceil(text.length / 100) * 100)
    return { usd: round(row.price * chars / 1000), label: `${chars} chars`, approximate: true, row: row.dim }
  } else if (unit === 'per_mp') {
    const mp = megapixels(params)
    return { usd: round(row.price * mp), label: `${mp.toFixed(2)} MP`, approximate: true, row: row.dim }
  } else if (unit.startsWith('per_mp_steps')) {
    const mp = megapixels(params)
    const divisor = Number(unit.match(/steps\s*\/\s*(\d+)/)?.[1] ?? 28)
    const steps = numberParam(params, ['steps', 'num_inference_steps'], divisor)
    return { usd: round(row.price * mp * steps / divisor), label: `${mp.toFixed(2)} MP × ${steps} steps`, approximate: true, row: row.dim }
  }
  return {
    usd: round(row.price * qty),
    label: qtyLabel,
    approximate: true,
    row: row.dim,
    unit,
  }
}

function pickRow(price, dimensions, params) {
  if (!dimensions.length) return price.rows[0]
  let best = null
  for (const row of price.rows) {
    let matched = 0
    let mismatched = false
    for (const dim of dimensions) {
      const want = String(row.dim[dim] ?? '').toLowerCase()
      if (!want) { matched++; continue }
      const actual = lookupDim(params, dim)
      if (actual === undefined) { matched++; continue }
      if (String(actual).toLowerCase() === want) matched++
      else mismatched = true
    }
    if (!mismatched) {
      if (!best || matched > best.matched) best = { row, matched }
    }
  }
  return best?.row ?? price.rows[0]
}

function lookupDim(params, dim) {
  const target = dim.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const [key, value] of Object.entries(params)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalized === target || normalized.includes(target) || target.includes(normalized)) return value
  }
  return undefined
}

function numberParam(params, names, fallback) {
  for (const name of names) {
    const value = Number(params[name])
    if (Number.isFinite(value) && value > 0) return value
  }
  return fallback
}

function megapixels(params) {
  const size = params.image_size ?? params.size ?? params.resolution
  if (typeof size === 'string') {
    const match = size.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/)
    if (match) return (Number(match[1]) * Number(match[2])) / 1_000_000
    const mp = size.match(/([\d.]+)\s*MP/i)
    if (mp) return Number(mp[1])
  }
  return 1
}

function round(value) {
  return Math.round(value * 1000) / 1000
}

export function truncate(text, max) {
  if (!text) return ''
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function clampInt(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}
