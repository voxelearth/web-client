function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export async function loadWithConcurrency(items, worker, concurrency = 8) {
  const total = items.length;
  if (!total) return [];

  const width = Math.max(1, Math.min(total, concurrency | 0 || 1));
  const results = new Array(total);
  let cursor = 0;

  async function runLane() {
    while (true) {
      const index = cursor++;
      if (index >= total) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: width }, () => runLane()));
  return results;
}

export async function loadGltfBatch({ urls, loadOne, concurrency = 8, onProgress }) {
  const startedAt = nowMs();
  let loaded = 0;
  let failed = 0;

  const settled = await loadWithConcurrency(urls, async (url, index) => {
    try {
      const gltf = await loadOne(url, index);
      loaded += 1;
      onProgress?.({
        index,
        total: urls.length,
        url,
        loaded,
        failed,
        ok: true,
      });
      return { ok: true, gltf };
    } catch (error) {
      failed += 1;
      onProgress?.({
        index,
        total: urls.length,
        url,
        loaded,
        failed,
        ok: false,
        error,
      });
      return { ok: false, error };
    }
  }, concurrency);

  const gltfs = [];
  for (const entry of settled) {
    if (entry?.ok && entry.gltf) gltfs.push(entry.gltf);
  }

  return {
    gltfs,
    stats: {
      total: urls.length,
      loaded,
      failed,
      concurrency: Math.max(1, Math.min(urls.length, concurrency | 0 || 1)),
      durationMs: nowMs() - startedAt,
    },
  };
}
