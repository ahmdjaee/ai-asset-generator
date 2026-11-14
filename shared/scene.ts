/**
 * Tampilan model 3D yang sama untuk contact sheet (dilihat Claude, `server/render/page/`) dan viewer (dilihat
 * pemilik, `web/features/viewer/`): lampu, intensitas lingkungan, dan material Clay/wireframe. Hanya angka dan warna
 * material adegan, bukan warna UI (warna UI tetap dari token desain).
 */

type Vec3 = readonly [number, number, number];

export const SCENE_LIGHTING = {
  /** Intensitas lingkungan (RoomEnvironment three, PMREM sigma 0,04): mode Tekstur lebih terang dari Clay. */
  environment: { texture: 0.8, plain: 0.35, pmremSigma: 0.04 },
  /** Lampu utama dari kiri-atas-depan. Posisi = pusat + arah × radius bola batas × `distanceFactor`. */
  key: { color: "#ffffff", intensity: 1.6, direction: [-1.2, 2, 1.4] as Vec3 },
  /** Pengisi lemah dari kanan-belakang: tiap sisi objek punya terang berbeda. */
  fill: { color: "#ffffff", intensity: 0.45, direction: [1.5, 0.6, -1] as Vec3 },
  hemisphere: { sky: "#ffffff", ground: "#3a3a40", intensity: 0.35 },
  distanceFactor: 4,
} as const;

export const SCENE_MATERIALS = {
  clay: { color: "#a9a9b0", roughness: 0.8, metalness: 0 },
  wire: { color: "#2a2a30", opacity: 0.7 },
  /** Pola kotak mode UV (viewer): dua nada netral yang tetap terbaca di bawah cahaya Clay. */
  checker: { light: "#d4d4d8", dark: "#71717a", cells: 8, repeat: 2 },
} as const;

/**
 * Thumbnail dan turntable Gudang, sama dengan gambar kartu di desain (`design/tools/render/scene.js`, `shot`): latar
 * transparan (kartu memberi warna `bg/viewport` di kedua tema), kamera 3/4 dari kanan-depan-atas, dan bayangan lembut
 * dari lampu utama di bidang lantai. Lampu memakai `SCENE_LIGHTING` seperti viewer.
 */
export const THUMBNAIL_VIEW = {
  direction: [0.9, 0.62, 1.2] as Vec3,
  fovDeg: 30,
  /** Jarak kamera = radius bola batas × margin / sin(fov/2); bola tidak berubah saat objek diputar. */
  margin: 1.3,
  /** Opasitas bayangan di lantai (desain: 0,42 untuk latar gelap; terbaca juga di latar terang). */
  shadowOpacity: 0.42,
  /** Bayangan lembut (VSM): ukuran peta bayangan dan jari-jari blur dalam texel. */
  shadowMapPx: 512,
  shadowRadius: 5,
  shadowBlurSamples: 16,
} as const;

/** Posisi lampu berarah: pusat + arah × (radius × faktor jarak). */
export function lightPosition(center: Vec3, radius: number, direction: Vec3): Vec3 {
  const scale = radius * SCENE_LIGHTING.distanceFactor;
  return [
    center[0] + direction[0] * scale,
    center[1] + direction[1] * scale,
    center[2] + direction[2] * scale,
  ];
}
