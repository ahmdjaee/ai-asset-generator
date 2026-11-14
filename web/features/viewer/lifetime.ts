/**
 * Umur objek three yang dibuat saat render (material, GLTF dari cache `useGLTF`).
 *
 * StrictMode (dev, juga build E2E) menjalankan cleanup effect lalu effect yang sama sekali lagi, sinkron, dalam commit
 * yang sama. Bila cleanup langsung membuang objek, objek yang masih tampil rusak. Bila cleanup mengosongkan cache
 * `useGLTF`, render berikutnya memuat ulang GLB: model baru lahir, cleanup-nya mengosongkan cache lagi, dan seterusnya.
 * Karena itu pemakai dihitung, dan pembuangan ditunda ke microtask: batal bila objek dipegang lagi sebelum itu.
 */
const holders = new Map<object, number>();

/**
 * Menandai `value` sedang dipakai. Fungsi yang dikembalikan melepasnya (aman dipanggil lebih dari sekali);
 * `dispose` berjalan sekali, setelah pemakai terakhir lepas dan tidak ada yang memegangnya lagi di tick yang sama.
 */
export function hold(value: object, dispose: () => void): () => void {
  holders.set(value, (holders.get(value) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holders.get(value) ?? 1) - 1;
    holders.set(value, left);
    if (left > 0) return;
    queueMicrotask(() => {
      // `undefined` = sudah dibuang oleh microtask lain (lepas → pegang → lepas dalam satu tick).
      if (holders.get(value) !== 0) return;
      holders.delete(value);
      dispose();
    });
  };
}

/** Isi cache terakhir per kunci yang sedang dipegang viewer. */
const latest = new Map<string, object>();

/**
 * `hold` untuk isi cache berkunci (GLTF per URL). Saat dibuang, cache untuk `key` hanya dikosongkan bila masih berisi
 * `value`: viewer lain yang sudah memuat ulang URL yang sama tidak kehilangan modelnya.
 */
export function holdCached(
  key: string,
  value: object,
  dispose: () => void,
  evict: (key: string) => void,
): () => void {
  latest.set(key, value);
  return hold(value, () => {
    dispose();
    if (latest.get(key) !== value) return;
    latest.delete(key);
    evict(key);
  });
}
