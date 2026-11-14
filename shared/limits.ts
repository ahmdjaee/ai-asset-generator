/**
 * Satu-satunya tempat angka batas: server, runtime, budget tier, batas build, toleransi bentuk, renderer.
 */
import { z } from "zod";
import { type AssetStats, TEXTURE_SLOTS, type TextureSlot } from "./asset-stats.ts";

/**
 * Satuan ukuran yang ditampilkan ke pemilik memakai KB/MB desimal (1 KB = 1000 byte), sama dengan `formatBytes`,
 * budget tier, dan desain ("1,5 MB"). Batas teknis yang tidak pernah ditampilkan (buffer, memori job) tetap biner.
 */
const KB = 1000;
const MB = 1000 * KB;

/** Batas diam koneksi HTTP (detik). Bawaan Bun hanya 10 detik; maksimum yang diizinkan Bun 255. */
export const HTTP_IDLE_TIMEOUT_S = 120;

/** Ukuran maksimum satu pesan WebSocket dari klien. */
export const WS_MAX_PAYLOAD_BYTES = 64 * 1024;

/** Body JSON maksimal (jawaban kartu, catatan persetujuan, nama aset). */
export const JSON_BODY_MAX_BYTES = 256 * KB;

/** Langganan maksimal per sambungan WebSocket. */
export const WS_MAX_SUBSCRIPTIONS = 64;

/** Interval pesan `hb` ke browser (browser tidak bisa melihat ping protokol). */
export const WS_HEARTBEAT_MS = 25_000;

/**
 * Di atas antrean kirim ini, event live (delta teks, progres build) dilewati; teks lengkapnya tetap datang lewat
 * event `assistant` dan hasil build.
 */
export const WS_SOFT_BUFFER_BYTES = 4 * 1024 * 1024;

/**
 * Klien selambat ini diputus; ia menyambung ulang dengan `after`, jadi event tersimpan tidak hilang. Di bawah
 * `backpressureLimit` bawaan Bun (16 MB), supaya hub yang memutus, bukan Bun yang diam-diam membuang pesan.
 */
export const WS_HARD_BUFFER_BYTES = 12 * 1024 * 1024;

/** Tertinggal lebih jauh dari ini: klien diminta memuat ulang (`resync`), bukan dibanjiri replay. */
export const WS_REPLAY_MAX_EVENTS = 1_000;

/** Batas baris per halaman thread (API dan replay). */
export const EVENTS_PAGE_MAX = 500;

/** Ukuran halaman thread bila klien tidak meminta. */
export const EVENTS_PAGE_DEFAULT = 200;

/** Lama SQLite menunggu kunci tulis sebelum menyerah (`PRAGMA busy_timeout`). */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Batas sumber daya satu job container. Angka per tahap aset dari PLAN Lampiran (Tahap 1 = bentuk dasar). */
export type JobLimits = Readonly<{
  /** RAM maksimum; swap disamakan supaya tidak ada swap tambahan. */
  memoryBytes: number;
  /** Jumlah CPU (boleh pecahan). Juga dipakai sebagai jumlah thread Cycles. */
  cpus: number;
  /** Batas proses/thread di container (melawan fork bomb). */
  pids: number;
  /** Ukuran tmpfs `/tmp` (satu-satunya lokasi tulis selain `/job`). */
  tmpfsBytes: number;
  /** Batas waktu job sebelum `docker kill`. */
  timeoutMs: number;
}>;

const MIB = 1024 * 1024;

/** Job bentuk dasar (tanpa material): 1,5 GB, 120 dtk. */
export const BASE_JOB_LIMITS: JobLimits = {
  memoryBytes: 1536 * MIB,
  cpus: 4,
  pids: 256,
  tmpfsBytes: 512 * MIB,
  timeoutMs: 120_000,
};

/** Job aset final bertekstur (UV, material, bake): 2,5 GB, 300 dtk. */
export const TEXTURED_JOB_LIMITS: JobLimits = {
  ...BASE_JOB_LIMITS,
  memoryBytes: 2560 * MIB,
  timeoutMs: 300_000,
};

/** Job bertekstur tier Maksimal: bake 2K butuh waktu lebih lama (600 dtk). */
export const TEXTURED_MAX_JOB_LIMITS: JobLimits = { ...TEXTURED_JOB_LIMITS, timeoutMs: 600_000 };

/** Job uji `assetkit` (pytest di dalam image). */
export const TEST_JOB_LIMITS: JobLimits = { ...BASE_JOB_LIMITS, timeoutMs: 300_000 };

/** Ekor stdout/stderr job yang disimpan untuk log dan untuk Claude (byte). */
export const JOB_OUTPUT_TAIL_BYTES = 8 * 1024;

/** Batas waktu perintah docker pendek (`inspect`, `rm`, `kill`, `ps`). */
export const DOCKER_CLI_TIMEOUT_MS = 30_000;

/** Batas waktu `docker build` image runtime (unduhan wheel bpy ±400 MB bisa lambat). */
export const IMAGE_BUILD_TIMEOUT_MS = 45 * 60_000;

/** Ukuran maksimum file output job bentuk dasar yang diterima dari container. `scene.blend`: preset ekspor Sumber. */
export const BASE_OUTPUT_MAX_BYTES = {
  "base.glb": 50 * MIB,
  "stats.json": 256 * 1024,
  "scene.blend": 64 * MIB,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Budget tier (PLAN Lampiran D). KB/MB desimal, sama seperti angka di dokumen rencana.

export const TIER_IDS = ["ringan", "sedang", "maksimal"] as const;
export type TierId = (typeof TIER_IDS)[number];

export type Range = Readonly<{ target: number; max: number }>;

export type TierBudget = Readonly<{
  /** Segitiga total. */
  triangles: Range;
  /** Material yang dipakai (= draw call per mesh). */
  materials: number;
  /** Sisi terpanjang tekstur per slot (px). Slot yang tidak ada di sini tidak diizinkan. */
  textures: Readonly<Partial<Record<TextureSlot, number>>>;
  /** Ukuran `web.glb` (meshopt + WebP). */
  webBytes: Range;
}>;

const RangeSchema = z
  .object({ target: z.number().int().positive(), max: z.number().int().positive() })
  .refine((range) => range.target <= range.max, "target harus ≤ maks");

/** Validasi snapshot tier yang dibaca dari database atau Pengaturan. */
export const TierBudgetSchema: z.ZodType<TierBudget> = z.object({
  triangles: RangeSchema,
  materials: z.number().int().positive(),
  textures: z.partialRecord(z.enum(TEXTURE_SLOTS), z.number().int().positive()),
  webBytes: RangeSchema,
});

export const DEFAULT_TIERS: Readonly<Record<TierId, TierBudget>> = {
  ringan: {
    triangles: { target: 2000, max: 3000 },
    materials: 1,
    textures: { baseColor: 512 },
    webBytes: { target: 150 * KB, max: 300 * KB },
  },
  sedang: {
    triangles: { target: 8000, max: 12_000 },
    materials: 2,
    textures: { baseColor: 1024, normal: 1024, orm: 512 },
    webBytes: { target: 800 * KB, max: 1500 * KB },
  },
  maksimal: {
    triangles: { target: 30_000, max: 50_000 },
    materials: 3,
    textures: { baseColor: 2048, normal: 2048, orm: 1024, emissive: 1024 },
    webBytes: { target: 3 * MB, max: 5 * MB },
  },
};

/** Panjang maksimal pesan pemilik (prompt, revisi, catatan persetujuan). */
export const MESSAGE_MAX_CHARS = 8000;

/** Batas panjang teks "Lainnya" di kartu pertanyaan. */
export const OTHER_ANSWER_MAX_CHARS = 2000;
/** Panjang maksimal nama aset. */
export const ASSET_NAME_MAX_CHARS = 80;

/** Gudang (PLAN Tahap 10): panjang maksimal kata kunci pencarian. */
export const ASSET_SEARCH_MAX_CHARS = 100;
/** Gudang: aset maksimal dalam satu daftar. Tanpa paginasi, karena app ini dipakai satu pengguna. */
export const ASSET_LIST_MAX = 500;
/** Unduh ZIP dari Gudang: aset maksimal per ZIP (daftar id dikirim di URL, supaya unduhan di-stream browser). */
export const EXPORT_ZIP_MAX_ASSETS = 100;
/** Panjang maksimal bagian nama aset di nama file ekspor (code point). */
export const EXPORT_NAME_MAX_CHARS = 60;

/** Lampiran per pesan (PLAN Tahap 6). */
export const ATTACHMENT_MAX_FILES = 8;
/** Gambar referensi: ukuran unggahan maksimal. */
export const ATTACHMENT_IMAGE_MAX_BYTES = 20 * MB;
/** Model 3D referensi (glb/gltf/obj/fbx/stl): ukuran unggahan maksimal. */
export const ATTACHMENT_MODEL_MAX_BYTES = 50 * MB;
/** Total satu permintaan unggah (file + field). Juga `maxRequestBodySize` Bun (bawaannya 128 MB). */
export const UPLOAD_MAX_REQUEST_BYTES = 200 * MB;
/** Gambar yang mengembang di atas jumlah piksel ini ditolak (bom dekompresi). */
export const ATTACHMENT_IMAGE_MAX_PIXELS = 100_000_000;
/** Sisi terpanjang gambar untuk Claude (batas efektif gambar Claude). */
export const ATTACHMENT_CLAUDE_MAX_PX = 1568;
/** Sisi terpanjang gambar untuk decal di Blender. */
export const ATTACHMENT_DECAL_MAX_PX = 2048;
/** Panjang maksimal nama asli lampiran yang disimpan untuk tampilan. */
export const ATTACHMENT_NAME_MAX_CHARS = 120;
/** Awal file yang dibaca untuk mengenali format teks (glTF, OBJ, STL ASCII, FBX ASCII). */
export const ATTACHMENT_TEXT_SNIFF_BYTES = 64 * 1024;

/** Proses Claude yang boleh hidup bersamaan, termasuk cek kesehatan (Lampiran G). */
export const AGENT_POOL_SIZE = 2;
/** Proses Claude yang idle selama ini ditutup (sesi tetap bisa di-resume). */
export const AGENT_IDLE_SHUTDOWN_MS = 5 * 60_000;

/** Batas build per pesan pengguna (Lampiran B). */
export const BUILD_CAPS = { base: 8, textured: 4 } as const;

/** Potongan balasan Claude yang diumumkan pembaca layar (code point); isi lengkapnya dibaca di thread. */
export const ANNOUNCE_EXCERPT_CHARS = 280;

/**
 * Arahan kepadatan detail bentuk dasar: bagian dari target segitiga tier yang sebaiknya dipakai. Di bawah `floor`,
 * hasil `build_base_mesh` memberi petunjuk ruang detail (bukan gerbang). Eval Tahap 3 memakai 20–50% target Sedang,
 * dan pemilik menilai hasilnya setara Ringan.
 */
export const DETAIL_USAGE = { floor: 0.4, ceiling: 0.9 } as const;

/** Simplify otomatis hanya bila segitiga lewat batas sedikit (≤ maks × faktor ini), dan hanya untuk bentuk dasar. */
export const SIMPLIFY_MAX_OVERSHOOT = 1.25;
/** Batas error simplify, sebagai pecahan radius mesh. */
export const SIMPLIFY_MAX_ERROR = 0.01;

/** Toleransi cek bentuk aset final terhadap bentuk dasar yang disetujui. */
export const SHAPE_TOLERANCE = {
  /** Selisih relatif tiap sisi bbox. */
  bboxRelative: 0.05,
  /** Selisih absolut yang selalu dianggap sama (m), untuk sisi yang sangat tipis. */
  bboxAbsoluteM: 0.01,
  /** Selisih relatif jumlah segitiga (UV seam dan bake tidak menambah segitiga; simplify bisa mengurangi). */
  trianglesRelative: 0.25,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Renderer

/** Batas waktu satu render (contact sheet) sebelum halaman dianggap macet. */
export const RENDER_TIMEOUT_MS = 30_000;
/** Contact sheet untuk Claude: sisi terpanjang maksimal 1024 px. */
export const CONTACT_SHEET_MAX_PX = 1024;
/** Ukuran satu tile sudut di contact sheet (3 × 2 tile + jarak 8 px = 1016 × 680). */
export const RENDER_TILE_PX = 328;
export const CONTACT_SHEET_GAP_PX = 8;
/** Ukuran maksimum GLB yang boleh dimuat renderer. */
export const RENDER_MAX_GLB_BYTES = 50 * MIB;

/** Turntable Gudang (PLAN Tahap 10): jumlah frame satu putaran penuh (15° per frame). */
export const TURNTABLE_FRAMES = 24;
/** Ukuran satu frame turntable/thumbnail: 2× thumbnail kartu aset (252 × 189, FigCraft AssetCard). */
export const TURNTABLE_FRAME_PX = { width: 504, height: 378 } as const;
/** Lebar maksimal gambar WebP; strip turntable (frame berjajar) tidak boleh melewatinya. */
export const WEBP_MAX_SIDE_PX = 16383;
/** Batas waktu render turntable (24 frame + bayangan, SwiftShader). */
export const TURNTABLE_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------------------------------------------
// Pemeriksaan budget

export type BudgetStatus = "ok" | "over_target" | "over_max";
export type BudgetItem = Readonly<{
  /** `triangles`, `materials`, `webBytes`, atau `texture.<slot>`. */
  key: string;
  value: number;
  target: number | null;
  max: number;
  status: BudgetStatus;
  /** Kelebihan terhadap maks (0 bila tidak lewat). */
  overMax: number;
}>;
export type BudgetCheck = Readonly<{ ok: boolean; items: readonly BudgetItem[] }>;

function item(key: string, value: number, max: number, target: number | null = null): BudgetItem {
  const status: BudgetStatus =
    value > max ? "over_max" : target !== null && value > target ? "over_target" : "ok";
  return { key, value, target, max, status, overMax: Math.max(0, value - max) };
}

/**
 * Membandingkan statistik dengan budget tier. `webBytes` hanya diperiksa bila ada (aset bentuk dasar belum punya
 * `web.glb` final). Tekstur di slot yang tidak diizinkan tier dihitung lewat dengan batas 0.
 */
export function checkBudget(stats: AssetStats, tier: TierBudget, webBytes?: number): BudgetCheck {
  const items: BudgetItem[] = [
    item("triangles", stats.triangles, tier.triangles.max, tier.triangles.target),
    item("materials", stats.materials, tier.materials),
  ];
  for (const texture of stats.textures) {
    const longest = Math.max(texture.width, texture.height);
    items.push(item(`texture.${texture.slot}`, longest, tier.textures[texture.slot] ?? 0));
  }
  if (webBytes !== undefined) items.push(item("webBytes", webBytes, tier.webBytes.max, tier.webBytes.target));
  return { ok: items.every((entry) => entry.status !== "over_max"), items };
}

// ---------------------------------------------------------------------------------------------------------------
// Aset bertekstur

/**
 * Ukuran maksimum file output job bertekstur yang diterima dari container (PNG belum dikompresi). `scene.blend`
 * memuat atlas yang sama (dikemas), jadi batasnya di atas `final.glb`.
 */
export const TEXTURED_OUTPUT_MAX_BYTES = {
  "final.glb": 120 * MIB,
  "stats.json": 256 * 1024,
  "scene.blend": 160 * MIB,
} as const;

/** Ukuran bake atlas per tier = batas slot tekstur budget; pustaka 2K hanya untuk atlas ≥ 2048. */
export function bakeSizes(tier: TierBudget): {
  baseColor: number;
  normal?: number;
  orm?: number;
  library: "1k" | "2k";
} {
  const baseColor = tier.textures.baseColor ?? 512;
  return {
    baseColor,
    ...(tier.textures.normal === undefined ? {} : { normal: tier.textures.normal }),
    ...(tier.textures.orm === undefined ? {} : { orm: tier.textures.orm }),
    library: baseColor >= 2048 ? "2k" : "1k",
  };
}

/** Batas job bertekstur untuk tier: Maksimal mendapat 600 dtk. */
export function texturedJobLimits(tierId: TierId): JobLimits {
  return tierId === "maksimal" ? TEXTURED_MAX_JOB_LIMITS : TEXTURED_JOB_LIMITS;
}
