#!/usr/bin/env node
/**
 * Generate a plugin market index (format 1) for this bundle.
 *
 *   node scripts/build-index.mjs --name dsh-bizyair --source npm
 *   node scripts/build-index.mjs --name dsh-bizyair --source git \
 *     --git https://github.com/you/dsh-bizyair --repository https://github.com/you/dsh-bizyair
 *
 * Publish the resulting JSON at an HTTPS URL without redirects, next to icon.svg,
 * and add that URL to the DSH Discover tab.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function gitHead() {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: ROOT })
    return stdout.trim()
  } catch {
    return null
  }
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const name = arg('name', pkg.name)
const source = arg('source', 'npm')
const out = arg('out', join(ROOT, 'market', 'index.json'))
const timestamp = Number(arg('timestamp', Math.floor(Date.now() / 1000)))
const author = arg('author', null)
const repositoryUrl = arg('repository', null)
const homepage = arg('homepage', null)

const meta = JSON.parse(await readFile(join(ROOT, 'locale', 'en.json'), 'utf8'))
const metaZh = JSON.parse(await readFile(join(ROOT, 'locale', 'zh.json'), 'utf8'))
const title = { en: meta.meta.title, zh: metaZh.meta.title }
const description = { en: meta.meta.description, zh: metaZh.meta.description }

let versionSource
if (source === 'git') {
  const url = arg('git', null)
  if (!url) throw new Error('--git <https://host/owner/repo> is required for --source git')
  const commit = arg('commit', null) ?? await gitHead()
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('a committed 40-hex git HEAD is required; run git commit first')
  versionSource = { type: 'git', url, commit }
  const packagePath = arg('path', '')
  if (packagePath) versionSource.path = packagePath
} else {
  versionSource = { type: 'npm' }
}

const index = {
  format: 1,
  title,
  description,
  metadata: {
    categories: { media: { title: { en: 'Media generation', zh: '媒体生成' } } },
  },
  plugins: [
    {
      name,
      title,
      description,
      icon: 'icon.svg',
      ...(author ? { author } : {}),
      ...(homepage ? { homepage } : {}),
      ...(repositoryUrl ? { repository: { url: repositoryUrl } } : {}),
      metadata: {
        category: 'media',
        keywords: ['bizyair', 'image-generation', 'video-generation', 'text-to-speech', 'media'],
        labels: [],
        sortKeys: {},
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: timestamp,
          source: versionSource,
          engines: pkg.engines?.dsh ? { dsh: pkg.engines.dsh } : {},
        },
      ],
    },
  ],
}

await mkdir(dirname(out), { recursive: true })
await writeFile(out, `${JSON.stringify(index, null, 2)}\n`)
console.log(`wrote ${out}`)
console.log(`name=${name} version=${pkg.version} source=${source}`)
