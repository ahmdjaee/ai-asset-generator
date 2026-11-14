/**
 * ZIP yang di-stream (fflate `Zip`). Entri ditulis satu per satu, dan isi file dibaca per potongan dari disk. Selama
 * antrean ke klien penuh, pembacaan berhenti (backpressure lewat `pull`), jadi ZIP besar tidak pernah dimuat utuh ke
 * memori. Klien memutus unduhan → pembacaan berhenti.
 */
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";

/** Isi entri: teks/bytes di memori, atau potongan yang dibaca saat entri ditulis (mis. file di disk). */
export type ZipContent = string | Uint8Array | (() => AsyncIterable<Uint8Array>);

export type ZipEntry = Readonly<{
  /** Path di dalam ZIP, dengan `/` sebagai pemisah folder. */
  name: string;
  content: ZipContent;
  /** Deflate untuk teks; file yang sudah terkompresi (GLB, PNG, `.blend` zstd) disimpan apa adanya. */
  compress: boolean;
  /** Waktu ubah (ms epoch). Format DOS hanya menerima 1980–2099; di luar itu dipakai batas terdekat. */
  mtime: number;
}>;

/** Antrean ke klien sebelum pembacaan berhenti. */
const QUEUE_BYTES = 1024 * 1024;
const DOS_MIN = Date.UTC(1980, 0, 2);
const DOS_MAX = Date.UTC(2099, 11, 30);

export class ZipPathError extends Error {
  constructor(name: string) {
    super(`Path ZIP tidak aman: ${JSON.stringify(name)}`);
    this.name = "ZipPathError";
  }
}

/**
 * Pengaman terakhir zip-slip: path relatif, pemisah `/`, tanpa segmen kosong, `.`, atau `..`, tanpa `\`, `:`, atau
 * karakter kendali. Nama entri dibuat dari nama tetap + `safeFileStem`, jadi seharusnya selalu lolos.
 */
export function assertZipPath(name: string): void {
  const segments = name.split("/");
  const bad =
    name.length === 0 ||
    name.length > 255 ||
    /[\\:\p{Cc}]/u.test(name) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..");
  if (bad) throw new ZipPathError(name);
}

function dosTime(ms: number): number {
  return Math.min(Math.max(ms, DOS_MIN), DOS_MAX);
}

async function* chunksOf(content: ZipContent): AsyncIterable<Uint8Array> {
  if (typeof content === "string") yield strToU8(content);
  else if (content instanceof Uint8Array) yield content;
  else yield* content();
}

/** Potongan file di disk (path sudah dicek pemanggil). */
export function fileChunks(path: string): () => AsyncIterable<Uint8Array> {
  return () => Bun.file(path).stream();
}

/**
 * Stream ZIP dari entri yang dihasilkan satu per satu (boleh async, mis. GLB Unity dibuat saat gilirannya). Error di
 * tengah jalan memutus stream (unduhan gagal di browser) dan dilaporkan ke `onError`.
 */
export function zipStream(
  entries: AsyncIterable<ZipEntry>,
  onError: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  let done = false;
  let resume: (() => void) | null = null;
  const wake = () => {
    resume?.();
    resume = null;
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const zip = new Zip((error, chunk, final) => {
          if (done) return;
          if (error !== null) {
            done = true;
            controller.error(error);
            return;
          }
          controller.enqueue(chunk);
          if (final) {
            done = true;
            controller.close();
          }
        });
        const demand = async () => {
          while (!done && (controller.desiredSize ?? 0) <= 0) {
            await new Promise<void>((resolve) => {
              resume = resolve;
            });
          }
        };
        const write = async () => {
          for await (const entry of entries) {
            assertZipPath(entry.name);
            const file = entry.compress
              ? new ZipDeflate(entry.name, { level: 6 })
              : new ZipPassThrough(entry.name);
            file.mtime = dosTime(entry.mtime);
            zip.add(file);
            for await (const chunk of chunksOf(entry.content)) {
              if (done) return;
              file.push(chunk);
              await demand();
            }
            if (done) return;
            file.push(new Uint8Array(0), true);
          }
          zip.end();
        };
        void write().catch((error: unknown) => {
          if (!done) {
            done = true;
            zip.terminate();
            controller.error(error);
          }
          onError(error);
        });
      },
      pull: wake,
      cancel() {
        done = true;
        wake();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: QUEUE_BYTES }),
  );
}
