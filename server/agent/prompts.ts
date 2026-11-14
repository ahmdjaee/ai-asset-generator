/** System prompt sesi aset: persona dan aturan (`prompts/system.md`) + konteks aset ini. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AttachmentRef, SystemMessageOrigin } from "../../shared/agent-events.ts";
import { BUILD_CAPS, DETAIL_USAGE, type TierBudget, type TierId } from "../../shared/limits.ts";
import { ellipsize } from "../../shared/text.ts";
import type { AssetState, LastRequest, Outbound, OutboundContext } from "../domain/status.ts";

const SYSTEM_PROMPT = readFileSync(join(import.meta.dir, "prompts", "system.md"), "utf8");

const TIER_LABEL: Record<TierId, string> = { ringan: "Ringan", sedang: "Sedang", maksimal: "Maksimal" };

/** Arahan detail per tier: tier yang lebih tinggi harus terlihat lebih kaya, bukan hanya lebih banyak segitiga. */
const TIER_DETAIL: Record<TierId, string> = {
  ringan: "siluet dan bagian besar; detail kecil cukup dari warna/tekstur",
  sedang:
    "bagian besar + detail sekunder yang terlihat (mata, hidung, telapak/cakar, paku, engsel, panel, gagang); material bervariasi, bukan warna rata",
  maksimal:
    "detail sekunder + tersier (bevel halus di tepi, ukiran, jahitan, sekrup, lapisan); tekstur pustaka dan keausan di sebagian besar material",
};

export type PromptContext = Readonly<{
  tierId: TierId;
  tier: TierBudget;
  knowledgeDir: string;
  refsDir: string;
}>;

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1000)} KB`;
}

function textureLine(tier: TierBudget): string {
  const slots = Object.entries(tier.textures).map(([slot, size]) => `${slot} ${size} px`);
  return `${slots.join(", ")}; semua material di-bake ke 1 material atlas`;
}

export function systemPromptAppend(context: PromptContext): string {
  const { tier } = context;
  return `${SYSTEM_PROMPT}
# Aset ini
- Tier: **${TIER_LABEL[context.tierId]}**. Segitiga: target ${tier.triangles.target}, maksimal ${tier.triangles.max}.
- Detail tier ini: ${TIER_DETAIL[context.tierId]}. Pakai ±${pct(DETAIL_USAGE.floor)}–${pct(DETAIL_USAGE.ceiling)} target segitiga untuk itu.
- Tekstur tier ini: ${textureLine(tier)}. Ukuran \`web.glb\`: target ${kb(tier.webBytes.target)}, maksimal ${kb(tier.webBytes.max)}.
- Batas build per pesan pemilik: ${BUILD_CAPS.base} bentuk dasar, ${BUILD_CAPS.textured} bertekstur.
- Folder knowledge (hanya baca): \`${context.knowledgeDir}\` — mulai dari \`API.md\`.
- Lampiran pemilik (hanya baca): \`${context.refsDir}\`.
- Skrip bentuk dasar: \`work/base.py\`; skrip tahap tekstur: \`work/material.py\` (folder kerja saat ini).
`;
}

/** Batas panjang kutipan permintaan terakhir di pesan lanjutkan / coba lagi. */
export const QUOTE_MAX_CHARS = 4000;

function joinLines(...lines: ReadonlyArray<string | null>): string {
  return lines.filter((line): line is string => line !== null).join("\n");
}

/** Kutipan permintaan terakhir + catatan lampirannya (path disusun ulang dari folder `refs/` aset). */
function quoteRequest(request: LastRequest | undefined, refsDir: string): string | null {
  if (request === undefined) return null;
  const text = request.text.trim() === "" ? null : ellipsize(request.text, QUOTE_MAX_CHARS);
  const note = attachmentNote(request.attachments, refsDir);
  if (text === null && note === null) return null;
  return joinLines(
    "\nPermintaan terakhir (mungkin belum sempat kamu terima):",
    text,
    note === null ? null : `\n${note}`,
  );
}

/**
 * Catatan lampiran di pesan pemilik. Path gambar absolut (tool Read mewajibkan path absolut, dan folder kerja Claude
 * adalah `work/`); model disebut dengan path container `/refs/<file>`.
 */
export function attachmentNote(
  attachments: readonly AttachmentRef[] | undefined,
  refsDir: string,
): string | null {
  if (attachments === undefined || attachments.length === 0) return null;
  const lines = attachments.map((attachment) =>
    attachment.kind === "image"
      ? `- ${join(refsDir, attachment.file)} — gambar referensi "${attachment.name}". Lihat dengan Read sebelum merencanakan.${attachment.decal === null ? "" : ` Untuk ditempel di permukaan: decal.from_image("${attachment.decal}", …).`}`
      : `- ${join(refsDir, attachment.file)} — model 3D referensi "${attachment.name}" (tidak bisa dibaca dengan Read). Di container: /refs/${attachment.file}; impor di skrip Blender bila perlu (lihat CONVENTIONS.md).`,
  );
  return ["[Lampiran pemilik]", ...lines].join("\n");
}

/**
 * Teks pesan ke Claude dari efek `deliver` (PLAN Lampiran C). Pesan sistem diawali `[Sistem]` supaya Claude
 * membedakannya dari ketikan pemilik. Frasa "tahap tekstur", "terputus", dan "gagal" dijaga tes: skenario agent
 * palsu (`AGENT_DRIVER=fake`) memakainya untuk memilih alur.
 */
export function outboundText(
  message: Outbound,
  context: OutboundContext = {},
  /** Folder lampiran aset (absolut); dipakai pesan berlampiran dan kutipan lampiran di lanjutkan/coba lagi. */
  refsDir = "refs",
): string {
  switch (message.kind) {
    case "owner": {
      const note = attachmentNote(message.attachments, refsDir);
      return note === null ? message.text : `${message.text}\n\n${note}`;
    }
    case "approved":
      return joinLines(
        `[Sistem] Pemilik menyetujui bentuk dasar v${message.version}; bentuk dasar sekarang dikunci.`,
        "Lanjut ke tahap tekstur: tulis work/material.py (scene.run_base() lalu material), panggil build_textured_asset, periksa contact sheet, lalu submit_for_review.",
        message.note === undefined ? null : `Catatan pemilik: ${message.note}`,
      );
    case "change_shape":
      return joinLines(
        "[Sistem] Pemilik meminta perubahan bentuk. Bentuk dasar dibuka lagi; versi bertekstur sebelumnya tidak dipakai.",
        "Perbarui work/base.py, panggil build_base_mesh, lalu submit_for_review. Tahap tekstur diulang setelah bentuk baru disetujui.",
        `Permintaan pemilik: ${message.text}`,
      );
    case "resume":
      return joinLines(
        "[Sistem] Proses sebelumnya terputus (server berhenti atau proses Claude mati) sebelum giliran selesai. Pemilik menekan Lanjutkan.",
        "Lanjutkan dari keadaan terakhir. Cek list_versions dan isi work/ dulu supaya build yang sudah ada tidak diulang.",
        quoteRequest(context.lastRequest, refsDir),
      );
    case "retry": {
      const error = context.lastError;
      return joinLines(
        `[Sistem] Giliran sebelumnya gagal${error === null || error === undefined ? "" : ` (${error.code}: ${error.message})`}. Pemilik menekan Coba lagi.`,
        "Lanjutkan dari keadaan sekarang. Cek list_versions dulu supaya build yang sudah ada tidak diulang.",
        quoteRequest(context.lastRequest, refsDir),
      );
    }
  }
}

/** Asal pesan untuk event `user`; `undefined` untuk ketikan pemilik. */
export function outboundOrigin(message: Outbound): SystemMessageOrigin | undefined {
  return message.kind === "owner" ? undefined : message.kind;
}

const STATUS_LABEL: Record<AssetState["status"], string> = {
  BRIEFING: "brief belum dicatat",
  BASE_WORKING: "mengerjakan bentuk dasar",
  BASE_REVIEW: "bentuk dasar menunggu review pemilik",
  TEXTURE_WORKING: "tahap tekstur (bentuk dasar sudah disetujui)",
  TEXTURE_REVIEW: "aset final menunggu review pemilik",
  DONE: "aset selesai",
};

/**
 * Pembuka untuk sesi Claude baru pada aset yang sudah berjalan (mis. aset hasil duplikat, atau sesi lama hilang):
 * Claude belum punya riwayat percakapan, jadi keadaan aset diringkas di pesan pertama.
 */
export function sessionPreamble(state: AssetState): string | null {
  if (state.status === "BRIEFING") return null;
  return joinLines(
    "[Sistem] Ini sesi baru untuk aset yang sudah berjalan; riwayat percakapan sebelumnya tidak tersedia.",
    `Keadaan aset: ${STATUS_LABEL[state.status]}.`,
    state.currentVersion === null ? null : `Versi terkini: v${state.currentVersion}.`,
    state.approvedBaseVersion === null ? null : `Bentuk dasar yang disetujui: v${state.approvedBaseVersion}.`,
    state.brief === null ? null : `Brief: ${JSON.stringify(state.brief)}`,
    "Skrip ada di work/. Cek list_versions dulu sebelum mengerjakan pesan berikut.",
  );
}
