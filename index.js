/**
 * BizyAir model-plaza tools for DeepSeek Harness.
 *
 * Loader entry point. The implementation lives in lib/impl.js and is imported
 * with a cache-busting query so re-activating the plugin picks up edits without
 * restarting the Host.
 */
export const name = 'bizyair'
export const inject = ['tools']

export async function apply(ctx, config) {
  const url = new URL(`./lib/impl.js?v=${Date.now()}`, import.meta.url).href
  const impl = await import(url)
  return impl.apply(ctx, config)
}
