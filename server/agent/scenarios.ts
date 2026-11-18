/**
 * Skenario bawaan `AGENT_DRIVER=fake`: "Claude" deterministik yang bekerja menurut status aset (dibaca lewat
 * `list_versions`), memakai skrip contoh peti (`runtime/samples/peti.py` dan `textured/peti.py`) sehingga juga valid
 * dengan `RUNTIME_DRIVER=docker`.
 *
 * Penanda di pesan PEMILIK (bukan pesan `[Sistem]`, yang bisa mengutip pesan pemilik) memilih jalur khusus untuk E2E:
 * - `[tanya]` / `[tanya-banyak]`: kartu pertanyaan pilih satu / pilih banyak sebelum brief;
 * - `[macet]`: berpikir, mulai menulis jawaban (hanya delta stream), lalu diam sampai Stop;
 * - `[batas]`: batas pemakaian tercapai (reset 1 jam lagi menurut jam yang disuntikkan);
 * - `[mati]`: proses Claude mati di tengah giliran;
 * - `[keluar]`: Claude Code belum login (`authentication_failed`).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ASSET_STATUSES, type AssetStatus } from "../../shared/asset.ts";
import type { ForgeReply, Scenario, ScenarioActions, ScenarioTurn } from "./scenario-port.ts";

const SAMPLES_DIR = join(import.meta.dir, "../../runtime/samples");

export const SCENARIO_MARKERS = {
  ask: "[tanya]",
  askMany: "[tanya-banyak]",
  hang: "[macet]",
  usageLimit: "[batas]",
  crash: "[mati]",
  loggedOut: "[keluar]",
} as const;

/** Awalan pesan yang disusun app dan judul kutipan permintaan terakhir (`outboundText`). */
const SYSTEM_PREFIX = "[Sistem]";
const QUOTE_HEADER = "Permintaan terakhir";

export const STYLE_QUESTION = "Gaya peti seperti apa?";
/** Teks yang sedang di-stream saat skenario `[macet]` berhenti (belum menjadi pesan utuh). */
export const HANG_PARTIAL_TEXT = "Saya mulai dari kotak dasar, lalu";
export const PARTS_QUESTION = "Bagian tambahan apa saja?";

const Listing = z.object({ status: z.enum(ASSET_STATUSES) });
const Built = z.object({ version: z.number().int().positive() });
const Failure = z.object({ code: z.string().default("ERROR"), message: z.string().default("") });

function failure(reply: ForgeReply): string {
  const parsed = Failure.safeParse(reply.body);
  return parsed.success ? `${parsed.data.code}: ${parsed.data.message}` : "tool gagal";
}

/**
 * Ringkasan brief dari pesan pemilik: baris pertama tanpa penanda, maks. 120 karakter. Pesan `[Sistem]` (lanjutkan,
 * coba lagi) memakai permintaan yang dikutipnya.
 */
export function briefSummary(text: string): string {
  const quoted = text.startsWith(SYSTEM_PREFIX) ? text.split(QUOTE_HEADER)[1]?.split("\n")[1] : undefined;
  let line = quoted ?? text.split("\n")[0] ?? "";
  for (const marker of Object.values(SCENARIO_MARKERS)) line = line.replaceAll(marker, "");
  const trimmed = line.trim().slice(0, 120);
  return trimmed === "" ? "Peti kayu" : trimmed;
}

async function status(claude: ScenarioActions): Promise<AssetStatus | null> {
  const reply = await claude.forge("list_versions");
  const parsed = Listing.safeParse(reply.body);
  return parsed.success ? parsed.data.status : null;
}

/** Kartu pertanyaan sesuai penanda. Hasil: gaya untuk brief, atau `null` bila dibatalkan. */
async function askOwner(turn: ScenarioTurn, claude: ScenarioActions): Promise<string | null> {
  if (turn.text.startsWith(SYSTEM_PREFIX)) return "kartun";
  if (turn.text.includes(SCENARIO_MARKERS.askMany)) {
    const answers = await claude.ask([
      {
        question: PARTS_QUESTION,
        header: "Bagian",
        multiSelect: true,
        options: [
          { label: "Gembok", description: "Kunci kuningan di depan" },
          { label: "Engsel", description: "Dua engsel di belakang" },
          { label: "Pegangan", description: "Pegangan logam di samping" },
        ],
      },
    ]);
    return answers === null ? null : "kartun";
  }
  if (turn.text.includes(SCENARIO_MARKERS.ask)) {
    const answers = await claude.ask([
      {
        question: STYLE_QUESTION,
        header: "Gaya",
        multiSelect: false,
        options: [
          { label: "Kartun", description: "Proporsi besar, tepi membulat" },
          { label: "Realistis", description: "Proporsi nyata, detail halus" },
        ],
      },
    ]);
    if (answers === null) return null;
    return (answers[STYLE_QUESTION] ?? "Kartun").toLowerCase();
  }
  return "kartun";
}

async function baseFlow(turn: ScenarioTurn, claude: ScenarioActions, current: AssetStatus): Promise<void> {
  claude.think("Merencanakan bentuk dasar peti: badan, tutup, sabuk logam, paku, engsel, dan kunci.");
  if (current === "BRIEFING") {
    const style = await askOwner(turn, claude);
    if (style === null) {
      claude.say("Pertanyaannya dibatalkan. Saya tunggu arahan berikutnya.");
      return;
    }
    const brief = await claude.forge("record_brief", {
      summary: briefSummary(turn.text),
      category: "properti",
      style,
      dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
    });
    if (!brief.ok) {
      claude.say(`Brief ditolak (${failure(brief)}).`);
      return;
    }
  }
  await claude.write(join(claude.cwd, "base.py"), await readFile(join(SAMPLES_DIR, "peti.py"), "utf8"));
  const build = await claude.forge("build_base_mesh", { note: "peti kayu: badan, tutup, sabuk, kunci" });
  const built = Built.safeParse(build.body);
  if (!build.ok || !built.success) {
    claude.say(`Build bentuk dasar gagal (${failure(build)}).`);
    return;
  }
  const version = built.data.version;
  claude.think(
    `Contact sheet v${version}: siluet depan dan 3/4 sesuai brief, tutup dan sabuk terbaca jelas.`,
  );
  const submit = await claude.forge("submit_for_review", {
    version,
    summary: "Bentuk dasar peti: badan, tutup melengkung, dua sabuk logam, dan kunci di depan.",
  });
  claude.say(
    submit.ok
      ? `Bentuk dasar v${version} siap direview. Siluet, proporsi, dan bagian utama sudah lengkap.`
      : `Submit v${version} ditolak (${failure(submit)}).`,
  );
}

async function textureFlow(claude: ScenarioActions): Promise<void> {
  claude.think(
    "Material: kayu tua untuk badan dan tutup, logam aus untuk sabuk dan paku, kuningan untuk kunci.",
  );
  await claude.forge("list_materials", { query: "wood" });
  await claude.write(
    join(claude.cwd, "material.py"),
    await readFile(join(SAMPLES_DIR, "textured", "peti.py"), "utf8"),
  );
  const build = await claude.forge("build_textured_asset", { note: "kayu + logam + kuningan" });
  const built = Built.safeParse(build.body);
  if (!build.ok || !built.success) {
    claude.say(`Build bertekstur gagal (${failure(build)}).`);
    return;
  }
  const version = built.data.version;
  const submit = await claude.forge("submit_for_review", {
    version,
    summary: "Peti bertekstur: kayu tua, sabuk logam aus, dan kunci kuningan.",
  });
  claude.say(
    submit.ok
      ? `Aset final v${version} siap direview: kayu tua, logam aus, dan kunci kuningan.`
      : `Submit v${version} ditolak (${failure(submit)}).`,
  );
}

export type DefaultScenarioOptions = Readonly<{ now?: () => number }>;

export function defaultScenario(options: DefaultScenarioOptions = {}): Scenario {
  const now = options.now ?? Date.now;
  return async (turn, claude) => {
    const owner = !turn.text.startsWith(SYSTEM_PREFIX);
    if (owner && turn.text.includes(SCENARIO_MARKERS.usageLimit)) {
      // Seperti SDK: waktu reset dalam detik epoch.
      claude.usageLimit(Math.floor((now() + 3_600_000) / 1000));
    }
    if (owner && turn.text.includes(SCENARIO_MARKERS.crash)) claude.crash();
    if (owner && turn.text.includes(SCENARIO_MARKERS.loggedOut)) claude.loggedOut();
    if (owner && turn.text.includes(SCENARIO_MARKERS.hang)) {
      claude.think("Menimbang beberapa pilihan bentuk…");
      claude.streamText(HANG_PARTIAL_TEXT);
      await claude.hang();
    }
    const current = await status(claude);
    if (current === "BRIEFING" || current === "BASE_WORKING") return baseFlow(turn, claude, current);
    if (current === "TEXTURE_WORKING") return textureFlow(claude);
    claude.say(
      current === "DONE"
        ? "Aset ini sudah selesai. Kirim pesan bila ingin mengubahnya."
        : "Versi terakhir sedang menunggu review pemilik.",
    );
  };
}
