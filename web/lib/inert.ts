/** Live region (wilayah toast sonner, status) tetap terbaca dan bisa dipakai walau di luar elemen yang dibuka. */
const KEEP_LIVE = "[aria-live]";

/**
 * Membuat seluruh halaman di luar `element` tidak bisa difokus dan tidak terbaca pembaca layar (`inert`): semua saudara
 * `element` dan saudara setiap leluhurnya sampai `<body>`. Dipakai saat `element` menutupi seluruh layar (mis. viewer
 * layar penuh lewat CSS), supaya Tab tidak masuk ke kontrol yang tertutup. Elemen yang ditambahkan ke `<body>` setelah
 * ini (portal menu dan tooltip dari dalam `element`) tetap aktif. Mengembalikan fungsi pemulih yang hanya mengubah
 * elemen yang dibuat inert di sini.
 */
export function inertOutside(element: HTMLElement): () => void {
  const changed: Element[] = [];
  for (let node: Element = element; node.parentElement !== null && node !== document.body; ) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of parent.children) {
      if (sibling === node || sibling.hasAttribute("inert") || sibling.matches(KEEP_LIVE)) continue;
      sibling.setAttribute("inert", "");
      changed.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const sibling of changed) sibling.removeAttribute("inert");
  };
}
