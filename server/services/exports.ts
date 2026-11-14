/**
 * Ekspor aset (PLAN Tahap 10).
 * - Satu versi per preset: Web (`web.glb` versi), Unity (GLB tanpa kompresi), dan Sumber (ZIP `.blend` + skrip +
 *   tekstur PNG + README). Hasil Unity dan Sumber di-cache di `derived/vN/`. Versi write-once dan cache Sumber per
 *   nama aset, jadi cache tidak pernah basi. Permintaan bersamaan untuk file yang sama menunggu satu proses pembuatan.
 * - ZIP banyak aset (versi terkini) dari Gudang, di-stream. Semua aset dicek dan file Unity dibuat sebelum stream
 *   dimulai, supaya kesalahan menjadi respons JSON biasa, bukan unduhan yang terputus. Gudang memanggil
 *   `prepareZip` lebih dulu, jadi kesalahan itu tampil sebagai toast.
 */
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  type ExportEstimate,
  type ExportPreset,
  exportFileName,
  PRESET_FILE_SUFFIX,
  type PresetEstimate,
  safeFileStem,
  type ZipPreset,
  type ZipSummary,
} from "../../shared/export.ts";
import type { Db } from "../db/client.ts";
import { type AssetRecord, getAsset } from "../db/repos/assets.ts";
import { getVersionRecord, type VersionRecord } from "../db/repos/versions.ts";
import { readGlb } from "../pipeline/io.ts";
import { toUnityGlb, UnityExportError } from "../pipeline/unity.ts";
import { assetDirFor, checkedFile, type ServedFile } from "./asset-queries.ts";
import { assetNotFound, ServiceError } from "./errors.ts";
import { versionDir, writeDerived } from "./versions.ts";
import { fileChunks, type ZipEntry, zipStream } from "./zip-stream.ts";

/** Nama cache di `derived/vN/`. */
export const UNITY_EXPORT_FILE = "export-unity.glb";

/**
 * Cache ZIP Sumber per nama aset: nama ada di folder akar dan README, jadi setelah ganti nama (atau di duplikat
 * bernama lain) ZIP dibuat ulang. GLB Unity tidak memuat nama aset, jadi cukup satu per versi.
 */
export function sourceExportFile(assetName: string): string {
  return `export-source-${createHash("sha256").update(assetName).digest("hex").slice(0, 16)}.zip`;
}

/** Perkiraan ukuran README di ZIP Sumber. */
const README_BYTES = 2048;

export type ExportErrorContext = Readonly<{ assetId?: string; version?: number; op: string }>;

export type ExportDeps = Readonly<{
  db: Db;
  dataDir: string;
  /** Error yang tidak sampai ke klien apa adanya: pembuatan file Unity/Sumber, dan error di tengah stream ZIP. */
  onError?: (error: unknown, context: ExportErrorContext) => void;
}>;

type VersionTarget = Readonly<{ asset: AssetRecord; record: VersionRecord; assetDir: string }>;

type ZipFile = Readonly<{ name: string; path: string; size: number; mtime: number }>;

/** GLB utama versi: `base.glb` (bentuk dasar) atau `final.glb` (aset final). */
function mainGlb(record: VersionRecord): string {
  return record.stage === "base" ? "base.glb" : "final.glb";
}

/**
 * Error ekspor untuk klien. Hanya pesan `UnityExportError` (berbahasa Indonesia, tanpa path) yang diteruskan; pesan
 * lain (sistem file, sharp, gltf-transform) bisa berbahasa Inggris dan memuat path, jadi hanya dicatat di log.
 */
function exportFailed(error: unknown): ServiceError {
  const detail = error instanceof UnityExportError ? error.message : "Detailnya ada di log server.";
  return new ServiceError("EXPORT_FAILED", `Ekspor gagal dibuat. ${detail}`);
}

export class ExportService {
  readonly #deps: ExportDeps;
  readonly #pending = new Map<string, Promise<string>>();

  constructor(deps: ExportDeps) {
    this.#deps = deps;
  }

  /** File unduhan satu versi; Unity dan Sumber dibuat dulu bila belum ada di cache. */
  async file(assetId: string, version: number, preset: ExportPreset): Promise<ServedFile> {
    const target = this.#target(assetId, version);
    const path =
      preset === "web"
        ? join(versionDir(target.assetDir, version), "web.glb")
        : await this.#cached(target, preset);
    const checked = await checkedFile(target.assetDir, path);
    return {
      ...checked,
      contentType: preset === "source" ? "application/zip" : "model/gltf-binary",
      cache: "revalidate",
      downloadName: exportFileName(target.asset.name, version, preset),
    };
  }

  /** Ukuran per preset untuk dialog ekspor: pasti bila file sudah ada, selain itu perkiraan dari isi versi. */
  async estimate(assetId: string, version: number): Promise<ExportEstimate> {
    const target = this.#target(assetId, version);
    const { record } = target;
    const bytesOf = (name: string) => record.files.find((file) => file.name === name)?.bytes ?? 0;
    const cached = async (name: string) => {
      const info = await lstat(join(target.assetDir, "derived", `v${version}`, name)).catch(() => null);
      return info?.isFile() === true ? info.size : null;
    };
    const [unity, source] = await Promise.all([
      cached(UNITY_EXPORT_FILE),
      cached(sourceExportFile(target.asset.name)),
    ]);
    const sourceGuess =
      bytesOf("scene.blend") +
      bytesOf("script.py") +
      bytesOf("base.py") +
      bytesOf("stats.json") +
      README_BYTES +
      // Tekstur PNG ≈ isi GLB final (geometri kecil dibanding atlas); bentuk dasar tidak bertekstur.
      (record.stage === "textured" ? bytesOf(mainGlb(record)) : 0);
    const entry = (preset: ExportPreset, bytes: number, exact: boolean): PresetEstimate => ({
      preset,
      fileName: exportFileName(target.asset.name, version, preset),
      bytes,
      exact,
    });
    return {
      version,
      presets: [
        entry("web", bytesOf("web.glb"), true),
        entry("unity", unity ?? bytesOf(mainGlb(record)), unity !== null),
        entry("source", source ?? sourceGuess, source !== null),
      ],
    };
  }

  /**
   * Pemeriksaan sebelum unduhan ZIP (dipanggil Gudang sebelum mengikuti tautan unduhan): semua aset dicek dan GLB
   * Unity dibuat bila belum ada, jadi kesalahan tampil di app sebagai respons JSON, bukan unduhan yang gagal.
   */
  async prepareZip(ids: readonly string[], preset: ZipPreset): Promise<ZipSummary> {
    const files = await this.#zipFiles(ids, preset);
    return { assets: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) };
  }

  /**
   * ZIP versi terkini beberapa aset (satu GLB per aset, nama unik dan aman). Semua file disiapkan sebelum stream
   * dimulai; error setelah itu (mis. file hilang saat dibaca) memutus stream dan dicatat lewat `onError`.
   */
  async zip(
    ids: readonly string[],
    preset: ZipPreset,
  ): Promise<Readonly<{ stream: ReadableStream<Uint8Array>; downloadName: string }>> {
    const files = await this.#zipFiles(ids, preset);
    const entries = async function* (): AsyncIterable<ZipEntry> {
      for (const file of files) {
        yield { name: file.name, content: fileChunks(file.path), compress: false, mtime: file.mtime };
      }
    };
    return {
      stream: zipStream(entries(), (error) => this.#deps.onError?.(error, { op: "export-zip" })),
      downloadName: `gudang-${files.length}-aset-${preset}.zip`,
    };
  }

  /** File ZIP per aset, berurutan: satu konversi Unity sekaligus, supaya memori tidak menumpuk. */
  async #zipFiles(ids: readonly string[], preset: ZipPreset): Promise<ZipFile[]> {
    const targets = ids.map((id) => {
      const asset = this.#asset(id);
      const version = asset.state.currentVersion;
      if (version === null) throw new ServiceError("NO_VERSION", `Aset "${asset.name}" belum punya versi.`);
      return this.#target(id, version);
    });
    const names = uniqueFileNames(targets, preset);
    const files: ZipFile[] = [];
    for (const [index, target] of targets.entries()) {
      const version = target.record.n;
      const path =
        preset === "web"
          ? join(versionDir(target.assetDir, version), "web.glb")
          : await this.#cached(target, preset);
      const checked = await checkedFile(target.assetDir, path);
      files.push({
        name: names[index] ?? `aset-${index + 1}.glb`,
        path: checked.path,
        size: checked.size,
        mtime: target.record.createdAt,
      });
    }
    return files;
  }

  /** Sebelum folder aset dihapus: pembuatan file Unity/Sumber aset ini yang masih berjalan ditunggu (hasil diabaikan). */
  async settleAsset(assetId: string): Promise<void> {
    const prefix = `${assetId}:`;
    await Promise.all(
      [...this.#pending]
        .filter(([key]) => key.startsWith(prefix))
        .map(([, task]) =>
          task.then(
            () => undefined,
            () => undefined,
          ),
        ),
    );
  }

  #asset(assetId: string): AssetRecord {
    const asset = getAsset(this.#deps.db, assetId);
    if (asset === null) throw assetNotFound(assetId);
    return asset;
  }

  #target(assetId: string, version: number): VersionTarget {
    const asset = this.#asset(assetId);
    const record = getVersionRecord(this.#deps.db, assetId, version);
    if (record === null) throw new ServiceError("VERSION_NOT_FOUND", `Versi v${version} tidak ditemukan.`);
    return { asset, record, assetDir: assetDirFor(this.#deps.dataDir, assetId) };
  }

  /**
   * Path cache Unity/Sumber; dibuat sekali (permintaan bersamaan menunggu pembuatan yang sama). Dicatat di `#pending`
   * seketika (sebelum `await` pertama), supaya `settleAsset` selalu melihatnya.
   */
  #cached(target: VersionTarget, preset: "unity" | "source"): Promise<string> {
    const version = target.record.n;
    const key = `${target.asset.id}:${version}:${cacheName(target, preset)}`;
    const pending = this.#pending.get(key);
    if (pending !== undefined) return pending;
    const created = this.#cachedOrCreate(target, preset)
      .catch((error: unknown) => {
        if (error instanceof ServiceError) throw error;
        this.#deps.onError?.(error, { assetId: target.asset.id, version, op: `export-${preset}` });
        throw exportFailed(error);
      })
      .finally(() => this.#pending.delete(key));
    this.#pending.set(key, created);
    return created;
  }

  async #cachedOrCreate(target: VersionTarget, preset: "unity" | "source"): Promise<string> {
    const path = join(target.assetDir, "derived", `v${target.record.n}`, cacheName(target, preset));
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() === true) return path;
    return preset === "unity" ? this.#createUnity(target) : this.#createSource(target);
  }

  async #createUnity(target: VersionTarget): Promise<string> {
    const version = target.record.n;
    const source = join(versionDir(target.assetDir, version), mainGlb(target.record));
    const unity = await toUnityGlb(
      new Uint8Array(await readFile((await checkedFile(target.assetDir, source)).path)),
    );
    return writeDerived(target.assetDir, version, UNITY_EXPORT_FILE, unity.glb);
  }

  async #createSource(target: VersionTarget): Promise<string> {
    const { asset, record, assetDir } = target;
    const version = record.n;
    const dir = versionDir(assetDir, version);
    const has = (name: string) => record.files.some((file) => file.name === name);
    const fromVersion = async (name: string) => (await checkedFile(assetDir, join(dir, name))).path;
    const root = `${safeFileStem(asset.name)}-v${version}-sumber`;
    const mtime = record.createdAt;
    const textures = await extractTextures(
      new Uint8Array(await readFile(await fromVersion(mainGlb(record)))),
    );
    const scripts = ["script.py", "base.py", "stats.json"].filter(has);
    const entries: ZipEntry[] = [
      {
        name: `${root}/README.md`,
        content: sourceReadme({ asset, record, textures: textures.map((texture) => texture.name), root }),
        compress: true,
        mtime,
      },
      ...(has("scene.blend")
        ? [
            {
              name: `${root}/scene.blend`,
              content: fileChunks(await fromVersion("scene.blend")),
              compress: false,
              mtime,
            },
          ]
        : []),
      ...(await Promise.all(
        scripts.map(async (name) => ({
          name: `${root}/${name}`,
          content: new Uint8Array(await readFile(await fromVersion(name))),
          compress: true,
          mtime,
        })),
      )),
      ...textures.map((texture) => ({
        name: `${root}/textures/${texture.name}`,
        content: texture.png,
        compress: false,
        mtime,
      })),
    ];
    // Error di tengah ZIP menggagalkan `writeDerived` (file sementara dibuang), jadi tidak perlu dicatat di sini.
    const stream = zipStream(listOf(entries), () => undefined);
    return writeDerived(assetDir, version, sourceExportFile(asset.name), stream);
  }
}

function cacheName(target: VersionTarget, preset: "unity" | "source"): string {
  return preset === "unity" ? UNITY_EXPORT_FILE : sourceExportFile(target.asset.name);
}

async function* listOf<T>(items: readonly T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

/** Nama file ZIP banyak aset: unik walau nama aset sama (`peti-v1-web.glb`, `peti-2-v1-web.glb`). */
function uniqueFileNames(targets: readonly VersionTarget[], preset: ZipPreset): string[] {
  const used = new Set<string>();
  return targets.map(({ asset, record }) => {
    const stem = safeFileStem(asset.name);
    for (let copy = 1; ; copy++) {
      const name = `${copy === 1 ? stem : `${stem}-${copy}`}-v${record.n}-${PRESET_FILE_SUFFIX[preset]}`;
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
    }
  });
}

type ExtractedTexture = Readonly<{ name: string; png: Uint8Array }>;

/** Tekstur GLB → PNG bernama aman (`atlas-warna.png`, `tekstur-2.png`), urut nama; format lain di-encode ke PNG. */
async function extractTextures(glb: Uint8Array): Promise<ExtractedTexture[]> {
  const document = await readGlb(glb);
  const used = new Set<string>();
  const textures: ExtractedTexture[] = [];
  for (const [index, texture] of document.getRoot().listTextures().entries()) {
    const image = texture.getImage();
    if (image === null) continue;
    const fallback = `tekstur-${index + 1}`;
    const base = safeFileStem(texture.getName() || texture.getURI() || fallback, fallback);
    let stem = base;
    for (let copy = 2; used.has(stem); copy++) stem = `${base}-${copy}`;
    used.add(stem);
    const png =
      texture.getMimeType() === "image/png" ? image : new Uint8Array(await sharp(image).png().toBuffer());
    textures.push({ name: `${stem}.png`, png });
  }
  return textures.sort((a, b) => a.name.localeCompare(b.name));
}

const STAGE_LABEL = { base: "bentuk dasar (tanpa material)", textured: "aset final bertekstur" } as const;

/** README ZIP Sumber (bahasa Indonesia): isi folder dan cara menjalankan ulang skrip. */
export function sourceReadme(input: {
  asset: AssetRecord;
  record: VersionRecord;
  textures: readonly string[];
  root: string;
}): string {
  const { asset, record, textures, root } = input;
  const has = (name: string) => record.files.some((file) => file.name === name);
  const textured = record.stage === "textured";
  const rows = [
    has("scene.blend")
      ? "| `scene.blend` | Adegan Blender 5.2 setelah build. Gambar dikemas di dalam file, jadi bisa dibuka tanpa folder lain |"
      : null,
    textured
      ? "| `script.py` | Skrip material tahap tekstur. Memanggil `scene.run_base()` untuk membangun ulang bentuk dari `base.py` |"
      : "| `script.py` | Skrip bentuk dasar |",
    has("base.py") ? "| `base.py` | Skrip bentuk dasar yang disetujui |" : null,
    textures.length > 0 ? "| `textures/*.png` | Tekstur hasil bake (atlas) dari GLB versi ini |" : null,
    "| `stats.json` | Statistik, budget, dan hasil validator versi ini |",
  ].filter((row) => row !== null);
  const command = textured
    ? `bun scripts/runtime.ts probe ${root}/script.py --textured ${asset.tierId} --base-script ${root}/base.py --out .tmp/ulang`
    : `bun scripts/runtime.ts probe ${root}/script.py --base --out .tmp/ulang`;
  return [
    `# ${asset.name} — sumber v${record.n}`,
    "",
    `Versi ${record.n}: ${STAGE_LABEL[record.stage]}, tier ${asset.tierId}, ${record.stats.triangles} segitiga.`,
    `Dibuat ${new Date(record.createdAt).toISOString().slice(0, 10)} oleh AI Asset Generate.`,
    "",
    "## Isi",
    "",
    "| File | Isi |",
    "|---|---|",
    ...rows,
    ...(has("scene.blend")
      ? [
          "",
          "Saat membuka `scene.blend`, jangan izinkan Blender menjalankan skrip Python di dalam file (*Allow Execution*",
          "atau *Auto Run Python Scripts*). Adegan ini tidak membutuhkannya.",
        ]
      : [
          "",
          "File `.blend` tidak tersedia untuk versi ini (dibuat sebelum fitur ini ada, atau gagal disimpan saat build).",
          "Jalankan ulang skrip di bawah untuk membuatnya.",
        ]),
    "",
    "## Menjalankan ulang skrip",
    "",
    "Skrip memakai pustaka `assetkit` dan berjalan di image Docker `asset-forge` (Blender 5.2 sebagai modul `bpy`).",
    "Salin folder ini ke dalam repo AI Asset Generate, lalu jalankan dari folder repo:",
    "",
    "```sh",
    command,
    "```",
    "",
    `Hasil \`${mainGlb(record)}\`, \`stats.json\`, dan \`scene.blend\` disimpan di \`.tmp/ulang\`. Setelah melewati`,
    "pipeline optimasi tier yang sama, jumlah segitiganya sama dengan `stats.json` versi ini.",
    "",
    "## Prompt",
    "",
    ...asset.prompt.split("\n").map((line) => `> ${line}`),
    "",
  ].join("\n");
}
