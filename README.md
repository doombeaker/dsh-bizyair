# BizyAir model plaza for DeepSeek Harness

**$1 ≈ 200 images, fast results.**

Every frontier image, video and audio model — open and closed source — in one AIGC creation platform inside DeepSeek Harness. A new account's credit is worth about 200 images, 3 short videos or 100 minutes of speech.

[中文说明 →](README.zh.md)

![dsh-bizyair panel](https://cdn.jsdelivr.net/gh/doombeaker/dsh-bizyair@main/assets/screenshots/01-models.png)

**Install in one command**: `plugin_manager install_bundle  target=dsh-bizyair`
**Cost**: a new BizyAir account includes $1, ≈ 200 images ($0.005 each), 3 five-second 720P videos, or 100 minutes of speech. Calls estimated at ≥ 20 USD ask for confirmation; use `bizyair_price` to check first. BizyAir billing is authoritative.

> Maintenance and release notes: [docs/PUBLISHING.md](docs/PUBLISHING.md)

## Install

Hand this to any DSH agent:

> Install the DSH plugin `dsh-bizyair` with `plugin_manager` → `install_bundle`, target `dsh-bizyair` (the npm package name). Confirm it is active and tell me how to configure the BizyAir API key.

Equivalent command:

```
plugin_manager install_bundle  target=dsh-bizyair
```

No plugin market needed — this installs straight from npm. Then:

1. Open **Settings → Model plaza · BizyAir → API Key**, paste `sk-...`, click **Save and verify**
2. Or write the file directly: `printf '%s\n' 'sk-...' > ~/.dsh/bizyair.key` (mode 600)
3. Reload the page; a **BizyAir** tab also appears in the conversation view

The published bundle contains no absolute paths: the key defaults to `$DSH_HOME/bizyair.key`, and tasks/artifacts land in your first registered workspace.

### Install through the plugin market (optional)

```
plugin_manager set_bundle target=@deepseek-ai/dsh-experimental-plugin-market-bundle enabled=true
```

Then add this index in Plugins → Discover:

```
https://doombeaker.github.io/dsh-bizyair/index.json
```

## Configuration

- **API key**: read from `$DSH_HOME/bizyair.key` (mode 600), falling back to `BIZYAIR_API_KEY`. Update with `printf '%s\n' 'sk-...' > ~/.dsh/bizyair.key`
- **Cost guard**: calls estimated at ≥ `approvalThresholdUsd` (default 20 USD) ask for confirmation through `ctx.approval`; `confirm_cost: true` skips it once the user has agreed
- **Artifacts**: `<workspace>/bizyair/<YYYYMMDD>/<request_id>/`; an audit trail is written to `bizyair/calls.jsonl`

## Tools (in chat)

| Tool | What it does |
|---|---|
| `bizyair_models` | Search by keyword, output kind, edition (self-hosted, economy, official) or max price |
| `bizyair_model` | Full parameter spec (enums, defaults, ranges, upload limits), example payload, price table, docs link |
| `bizyair_generate` | Validate → estimate → approval above threshold → submit; short jobs return results, long jobs return `request_id` + `job_id` |
| `bizyair_task` | Query and download artifacts for a `request_id` (idempotent) |
| `bizyair_upload` | Local file → three-step upload (token → OSS STS → commit) → public URL |
| `bizyair_price` | Estimate one call from the published price table (per call / second / 1000 chars / megapixel) |

Background jobs can also be read with the built-in `job_output <job_id>`.

## Web panel

After a reload, the conversation view switcher gains a **BizyAir** view (`conversation.view`, id `bizyair`, order 20):

- Positioning: a funnel into BizyAir, a subset of the website; prices, more models and account actions link back to bizyair.ai
- English and Chinese, default English, switchable and remembered
- Empty-state shortcuts for affordable models (self-hosted / economy first), with unit prices
- **Runs**: every generation (panel or chat) is recorded; running and finished runs survive model switches, reloads and restarts, grouped by today/yesterday/earlier, searchable, with reuse, save, delete and raw JSON
- **Result preview**: images/videos/audio open in a lightbox; images zoom with the wheel, pan by dragging, double-click to reset, swipe to switch; videos use the CDN first frame as a poster
- Left: model list with search, kind and edition filters, starting price and edition color
- Right: title, edition badge, description, price table, cost estimate, docs and plaza links
- Parameters are generated from the catalog schema: enums → select, booleans → checkbox, numbers → input with min/max/step, text → textarea, `*_urls` → upload with progress + URL list; two columns on wide screens
- Generate is disabled while required fields are missing, with a list of what is missing
- Run state: color + spinner + elapsed time; **Result / Status JSON** views
- Results can be previewed, link-copied, opened in a new window, or saved to the workspace
- **API Key page**: paste and save, a free connection probe (no upload, no charge), red/green state, masked display and last-check time
- Browser confirmation above 20 USD; request JSON can be copied in one click

Panel routes (same-origin, Host side):

```
GET  /bizyair/api/catalog     catalog + schema
GET  /bizyair/api/task?id=    task state and artifact URLs
POST /bizyair/post/quote      cost estimate
POST /bizyair/post/generate   submit
POST /bizyair/post/upload     upload (raw bytes)
GET  /bizyair/api/key         key status (never the key itself)
POST /bizyair/post/key        save and verify
POST /bizyair/post/key-check  verify only
POST /bizyair/post/save       save artifacts into the workspace
```

## Data and refresh

`data/catalog.json` (~740 KB) is generated by `scripts/build-catalog.mjs` from:

- `https://www.bizyair.ai/sitemap-model-api-1.xml` → endpoint list
- `<plaza URL>/llms.txt` → parameter tables, constraints, output kinds
- model page HTML → title, description, edition badge, `og:image` cover
- `https://www.bizyair.ai/llms/price` → price tables

Refresh:

```bash
cd dsh-bizyair && node scripts/build-catalog.mjs --refresh
```

Cache lives in `.cache/` and can be deleted safely.

## Architecture

```
index.js          loader entry (cache-busting dynamic import for hot reload)
lib/impl.js       tool registration, background jobs, approvals, audit, web routes
lib/api.js        BizyAir HTTP client, OSS direct upload, downloads
lib/catalog.js    catalog decoration, search, schema projection, validation, cost estimates
client.js         web panel (conversation.view)
data/catalog.json catalog snapshot
scripts/build-catalog.mjs
```

## Known limits

- The panel plays CDN links without saving them; use `bizyair_task` to download into the workspace
- No cancellation: BizyAir has no cancel API, background jobs can only stop polling
- The panel reuses the `conversation.view` slot; it could move to `sidebar.right` or become its own page
- Text/vision models are not exposed by default (`allowedOutputs: [images, videos, audios]`); set it to an empty list to expose everything
- Cost estimates are approximate for multi-dimension price tables; the authoritative bill is in BizyAir's call history

## License

MIT. The BizyAir logo in `icon.svg` / `assets/icon-180.png` belongs to BizyAir.
