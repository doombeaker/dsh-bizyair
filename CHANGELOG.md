# Changelog

## 0.9.3 — 2026-11-06

- The published market index now carries author, repository, and homepage.

## 0.9.2 — 2026-11-06

- CI publishes through npm trusted publishing (OIDC) with provenance; no long-lived token.
- Repository moved to github.com/doombeaker/dsh-bizyair; market index hosted on GitHub Pages.

## 0.9.1 — 2026-11-06

- Recommended models are no longer hardcoded: newest per category (text-to-image / text-to-video / text-to-speech)
  derived from the plaza ordering plus the sitemap's oldest→newest order.
- Video covers use the model page's example video first frame (OSS `video/snapshot`).

## 0.9.0 — 2026-11-06

- `GET /bizyair/api/featured` groups the newest three models per category with live covers.
- Live cover resolution (`GET /bizyair/api/cover`) with a 6-hour cache.

## 0.8.1 — 2026-11-06

- Strip `⟨bz_enum_json⟩`, default/range/step/upload hints from parameter descriptions; catalog shrinks to ~429 KB.

## 0.8.0 — 2026-11-06

- Cover images resolved at runtime from the model page (input example → output example → background → icon).

## 0.7.4 — 2026-11-06

- Per-model background image as cover fallback; browse-all link moved to its own row; `← Recommended` restores the empty state.

## 0.7.0 — 2026-11-06

- Curated quick-start set; inline price tables replaced by a link to bizyair.ai/price.

## 0.6.5 — 2026-11-06

- Key errors use a warning tone and render the key URL as a clickable link.

## 0.6.2 — 2026-11-06

- Fix: „Test connection" tested the stored key instead of the typed one; saving an invalid key no longer overwrites the working key.

## 0.6.0 — 2026-11-06

- Settings page entry, task registry, lightbox with zoom/pan, two-column parameters, day-grouped runs with search.

## 0.5.0 — 2026-11-06

- Header split into a work segmented control (Models / Runs) and a settings cluster (API Key · language).

## 0.4.0 — 2026-11-06

- Panel state survives view unmounts; run registry shared with chat tools.

## 0.3.0 — 2026-11-06

- Durable run list: every generation becomes a record with outputs, reusable parameters and workspace saving.

## 0.2.0 — 2026-11-06

- Bidirectional i18n, API-key management with free connection probe, task JSON view, upload spinners, save to workspace.

## 0.1.0 — 2026-11-06

- First working version: 6 model-facing tools, catalog built from BizyAir's LLM docs and price page,
  asynchronous task handling with background polling, artifact downloads, approval gate.
