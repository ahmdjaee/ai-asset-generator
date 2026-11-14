/**
 * Matematika viewer (murni, tanpa three): sudut cepat, bingkai, batas zoom, lantai, gizmo, dan ukuran sel grid.
 *
 * Konvensi sudut sama dengan `Spherical` three dan camera-controls:
 * - azimuth θ diukur dari sumbu +Z ke arah +X (θ = 0: kamera di depan model, θ = π/2: di kanan);
 * - polar φ diukur dari sumbu +Y (0: tepat di atas, π: tepat di bawah).
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const PRESET_IDS = ["iso", "front", "back", "left", "right", "top", "bottom"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type CameraAngles = Readonly<{ azimuth: number; polar: number }>;

/** Arah 3/4 sama dengan prototipe `viewer-360.html` dan desain: dari kanan-depan, sedikit di atas. */
const ISO_DIRECTION = [0.9, 0.62, 1.2] as const;

/**
 * Atas dan Bawah berhenti sedikit sebelum kutub: arah pandang yang tepat sejajar sumbu up membuat orientasi layar
 * tidak terdefinisi.
 */
export const POLE_MARGIN = 1e-4;

export const PRESETS: Readonly<Record<PresetId, CameraAngles>> = {
  iso: {
    azimuth: Math.atan2(ISO_DIRECTION[0], ISO_DIRECTION[2]),
    polar: Math.acos(ISO_DIRECTION[1] / Math.hypot(...ISO_DIRECTION)),
  },
  front: { azimuth: 0, polar: Math.PI / 2 },
  back: { azimuth: Math.PI, polar: Math.PI / 2 },
  left: { azimuth: -Math.PI / 2, polar: Math.PI / 2 },
  right: { azimuth: Math.PI / 2, polar: Math.PI / 2 },
  top: { azimuth: 0, polar: POLE_MARGIN },
  bottom: { azimuth: 0, polar: Math.PI - POLE_MARGIN },
};

/** Sudut dalam rentang [0, 2π). */
export function normalizeAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Selisih dua sudut terkecil (0..π), tanpa memedulikan putaran penuh. */
export function angleDistance(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * Azimuth tujuan yang dicapai lewat putaran terpendek. Azimuth kamera tidak dibatasi (putar kiri-kanan tanpa batas),
 * jadi tujuan dihitung relatif terhadap azimuth sekarang.
 */
export function shortestAzimuth(current: number, target: number): number {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

/** Toleransi untuk menganggap kamera berada di sudut cepat (tanda centang di menu Sudut). */
export const PRESET_TOLERANCE = 2 * DEG;

/** Sudut cepat yang sedang dilihat, atau `null` bila kamera di sudut bebas. */
export function nearestPreset(angles: CameraAngles): PresetId | null {
  if (angles.polar < PRESET_TOLERANCE) return "top";
  if (angles.polar > Math.PI - PRESET_TOLERANCE) return "bottom";
  for (const id of PRESET_IDS) {
    if (id === "top" || id === "bottom") continue;
    const preset = PRESETS[id];
    if (
      Math.abs(angles.polar - preset.polar) < PRESET_TOLERANCE &&
      angleDistance(angles.azimuth, preset.azimuth) < PRESET_TOLERANCE
    ) {
      return id;
    }
  }
  return null;
}

/** Ruang di sekeliling model saat dibingkai (bola batas × 1,2). */
export const FIT_MARGIN = 1.2;

/**
 * Jarak kamera supaya bola batas model (dengan margin) muat di sisi pandang tersempit. `aspect` = lebar/tinggi area
 * yang tidak tertutup panel.
 */
export function fitDistance(radius: number, verticalFovDeg: number, aspect: number): number {
  const vertical = verticalFovDeg * DEG;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return (radius * FIT_MARGIN) / Math.sin(Math.min(vertical, horizontal) / 2);
}

/** Batas zoom sesuai ukuran model: tidak masuk ke dalam model, tidak menjauh sampai model hilang. */
export function distanceLimits(radius: number, fit: number): Readonly<{ min: number; max: number }> {
  return { min: radius * 1.05, max: Math.max(fit * 3, radius * 6) };
}

type Vec3 = readonly [number, number, number];

export type CameraView = Readonly<{ azimuth: number; polar: number; distance: number; target: Vec3 }>;

/**
 * Sudut pandang yang dibawa saat pemilik berganti versi: sudut apa adanya, jarak relatif terhadap jarak bingkai, dan
 * geser pusat pandang relatif terhadap jari-jari model. Versi baru bisa sedikit berbeda ukurannya.
 */
export type CarriedView = Readonly<{ azimuth: number; polar: number; distanceRatio: number; offset: Vec3 }>;

type ModelFrame = Readonly<{ center: Vec3; radius: number }>;

/** `null` bila ada nilai yang tidak terhingga (kamera belum siap atau model kosong): versi berikutnya mulai dari 3/4. */
export function carryView(view: CameraView, model: ModelFrame, fit: number): CarriedView | null {
  const carried: CarriedView = {
    azimuth: view.azimuth,
    polar: view.polar,
    distanceRatio: view.distance / fit,
    offset: [
      (view.target[0] - model.center[0]) / model.radius,
      (view.target[1] - model.center[1]) / model.radius,
      (view.target[2] - model.center[2]) / model.radius,
    ],
  };
  const values = [carried.azimuth, carried.polar, carried.distanceRatio, ...carried.offset];
  return values.every(Number.isFinite) ? carried : null;
}

/** Penempatan kamera untuk model yang baru dimuat: sudut pandang yang dibawa, atau sudut 3/4 dengan model dibingkai. */
export function placeView(
  carried: CarriedView | null,
  model: ModelFrame,
  fit: number,
  limits: Readonly<{ min: number; max: number }>,
): CameraView {
  if (carried === null) return { ...PRESETS.iso, distance: fit, target: model.center };
  const { center, radius } = model;
  return {
    azimuth: carried.azimuth,
    polar: carried.polar,
    distance: Math.min(Math.max(carried.distanceRatio * fit, limits.min), limits.max),
    target: [
      center[0] + carried.offset[0] * radius,
      center[1] + carried.offset[1] * radius,
      center[2] + carried.offset[2] * radius,
    ],
  };
}

/**
 * Seberapa terlihat lantai (0..1) dari tinggi kamera di atas lantai (rumus prototipe). Lantai dan grid memudar saat
 * kamera turun mendekati lantai dan hilang di bawahnya, supaya sisi bawah model terlihat jelas.
 */
export function floorVisibility(heightAboveFloor: number, radius: number): number {
  const band = Math.max(radius * 0.25, 1e-4);
  return Math.min(1, Math.max(0, heightAboveFloor / band));
}

/** Intensitas maksimum lampu bawah, yang menyala saat lantai memudar. */
export const UNDER_LIGHT_INTENSITY = 1.4;

export function underLightIntensity(floor: number): number {
  return (1 - floor) * UNDER_LIGHT_INTENSITY;
}

/**
 * Ukuran sel grid lantai: deret 1-2-5 yang paling dekat (skala log) dengan sepertiga dimensi terbesar model.
 * Peti 0,65 m → 20 cm (sama dengan desain), pohon 5 m → 2 m, cincin 10 cm → 5 cm.
 */
export function gridCellSize(maxDimension: number): number {
  const target = Math.log10(Math.max(maxDimension, 1e-3) / 3);
  const decade = Math.floor(target);
  let best = 10 ** decade;
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * 10 ** decade;
    if (Math.abs(Math.log10(candidate) - target) < Math.abs(Math.log10(best) - target)) best = candidate;
  }
  // Pembulatan biner (mis. 0,30000000000000004) dibuang supaya label stabil.
  return Number(best.toPrecision(6));
}

export type AxisId = "px" | "nx" | "py" | "ny" | "pz" | "nz";

export type GizmoAxis = Readonly<{
  id: AxisId;
  /** Posisi bulatan dari pusat gizmo (px), y ke bawah. */
  x: number;
  y: number;
  /** Komponen ke arah kamera: positif = mendekat. Dipakai untuk urutan tumpuk. */
  depth: number;
}>;

/** Jari-jari gizmo (px) dari pusat ke bulatan sumbu, sama dengan desain (bingkai 96 px). */
export const GIZMO_RADIUS = 34;

const AXIS_COLUMNS: ReadonlyArray<readonly [AxisId, number, 1 | -1]> = [
  ["px", 0, 1],
  ["nx", 0, -1],
  ["py", 4, 1],
  ["ny", 4, -1],
  ["pz", 8, 1],
  ["nz", 8, -1],
];

/**
 * Proyeksi enam arah sumbu dunia ke bidang gizmo. `view` = elemen `camera.matrixWorldInverse` (column-major):
 * arah sumbu dunia di ruang kamera adalah kolom rotasinya.
 */
export function projectAxes(view: ArrayLike<number>, radius = GIZMO_RADIUS): GizmoAxis[] {
  return AXIS_COLUMNS.map(([id, column, sign]) => {
    const x = (view[column] ?? 0) * sign;
    const y = (view[column + 1] ?? 0) * sign;
    const depth = (view[column + 2] ?? 0) * sign;
    return { id, x: x * radius, y: -y * radius, depth };
  });
}

/** Sudut cepat yang dibuka saat bulatan sumbu diklik. */
export const AXIS_PRESET: Readonly<Record<AxisId, PresetId>> = {
  px: "right",
  nx: "left",
  py: "top",
  ny: "bottom",
  pz: "front",
  nz: "back",
};

/** Kecepatan putar otomatis: satu putaran ±20 detik. */
export const AUTO_ROTATE_SPEED = TAU / 20;

/** Langkah putar, geser (bagian dari jarak kamera), dan zoom dari keyboard. */
export const KEYBOARD_ROTATE_STEP = 15 * DEG;
export const KEYBOARD_TRUCK_FACTOR = 0.1;
export const KEYBOARD_DOLLY_FACTOR = 0.2;
