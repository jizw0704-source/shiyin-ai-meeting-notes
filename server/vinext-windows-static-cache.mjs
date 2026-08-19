const compatibilityInstalled = Symbol.for("shiyin.vinextWindowsStaticCacheCompatibility");

export function normalizeWindowsStaticCache(cache, platform = process.platform) {
  if (platform !== "win32" || !(cache?.entries instanceof Map)) return cache;
  for (const [key, entry] of [...cache.entries]) {
    const normalizedKey = key.replaceAll("\\", "/");
    if (normalizedKey === key) continue;
    cache.entries.delete(key);
    if (!cache.entries.has(normalizedKey)) cache.entries.set(normalizedKey, entry);
  }
  return cache;
}

export async function installVinextWindowsStaticCacheCompatibility(platform = process.platform) {
  if (platform !== "win32") return false;

  // vinext 0.0.50 builds cache keys with path.relative(). On Windows those
  // keys contain backslashes, while browser asset URLs always use slashes.
  const moduleUrl = new URL("../node_modules/vinext/dist/server/static-file-cache.js", import.meta.url);
  const { StaticFileCache } = await import(moduleUrl.href);
  if (StaticFileCache[compatibilityInstalled]) return true;

  const createStaticCache = StaticFileCache.create.bind(StaticFileCache);
  StaticFileCache.create = async (...args) => (
    normalizeWindowsStaticCache(await createStaticCache(...args), platform)
  );
  Object.defineProperty(StaticFileCache, compatibilityInstalled, { value: true });
  return true;
}
