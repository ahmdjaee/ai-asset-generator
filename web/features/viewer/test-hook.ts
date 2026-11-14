import type { ShadingMode } from "./materials.ts";
import type { PresetId } from "./math.ts";

/**
 * Keadaan viewer untuk E2E (`window.__viewer`), hanya di build mode test. Tes menunggu sinyal ini (siap, kamera
 * berhenti) alih-alih sleep. Di build produksi `PROBE_ENABLED` bernilai `false` saat build, jadi kodenya terbuang.
 */
export type ViewerProbeSnapshot = Readonly<{
  /** Model dimuat, kamera ditempatkan, dan minimal satu frame sudah digambar. */
  ready: boolean;
  /** Jumlah frame yang digambar sejak viewer dipasang (frameloop "demand": diam = tidak bertambah). */
  frames: number;
  /** Kamera masih bergerak (transisi, seret, putar otomatis), atau permintaan gerak belum diproses. */
  moving: boolean;
  azimuth: number;
  polar: number;
  distance: number;
  /** Jarak bingkai (F) untuk ukuran viewer sekarang. */
  fitDistance: number;
  target: readonly [number, number, number];
  center: readonly [number, number, number];
  radius: number;
  preset: PresetId | null;
  mode: ShadingMode;
  wireframe: boolean;
  grid: boolean;
  gridVisible: boolean;
  lightFollowsCamera: boolean;
  autoRotate: boolean;
  /** Lantai (bayangan dan grid) masih terlihat; 0..1 = tingkat pudarnya. */
  floorVisible: boolean;
  floorOpacity: number;
  keyLight: readonly [number, number, number];
  triangles: number;
  /** Pusat model di kanvas (px CSS dari kiri atas kanvas). */
  centerOnScreen: readonly [number, number];
  /** Objek GPU renderer ini (`renderer.info`): membuktikan W dan ganti mode tidak menimbun geometri atau tekstur. */
  memory: Readonly<{ geometries: number; textures: number; programs: number }>;
}>;

export type ViewerProbe = Readonly<{ snapshot: () => ViewerProbeSnapshot }>;

declare global {
  interface Window {
    __viewer?: ViewerProbe;
  }
}

export const PROBE_ENABLED = import.meta.env.MODE === "test";

/** Memasang `window.__viewer` (mode test saja). Mengembalikan fungsi pelepas. */
export function installProbe(snapshot: () => ViewerProbeSnapshot): () => void {
  if (!PROBE_ENABLED) return () => undefined;
  const probe: ViewerProbe = { snapshot };
  window.__viewer = probe;
  return () => {
    if (window.__viewer === probe) delete window.__viewer;
  };
}
