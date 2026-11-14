import { describe, expect, test } from "bun:test";
import { DEFAULT_TIERS } from "../../shared/limits.ts";
import { INITIAL_STATE } from "../domain/status.ts";
import {
  outboundOrigin,
  outboundText,
  QUOTE_MAX_CHARS,
  sessionPreamble,
  systemPromptAppend,
} from "./prompts.ts";

describe("systemPromptAppend", () => {
  const prompt = systemPromptAppend({
    tierId: "sedang",
    tier: DEFAULT_TIERS.sedang,
    knowledgeDir: "/k",
    refsDir: "/r",
  });

  test("memuat persona, aturan dua tahap, dan alur build → lihat → perbaiki", () => {
    for (const phrase of [
      "technical 3D artist",
      "bahasa Indonesia",
      "AskUserQuestion",
      "record_brief",
      "build_base_mesh",
      "submit_for_review",
      "contact sheet",
      "build_textured_asset",
      "list_materials",
      "scene.run_base()",
      "SHAPE_DRIFT",
      "BASE_LOCKED",
      "arah bagian",
      "detailHint",
      "material.wear",
      "decal.paint",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  test("memuat budget tier aset dan path knowledge", () => {
    expect(prompt).toContain("Tier: **Sedang**. Segitiga: target 8000, maksimal 12000.");
    expect(prompt).toContain("Detail tier ini: bagian besar + detail sekunder");
    expect(prompt).toContain("Pakai ±40%–90% target segitiga");
    expect(prompt).toContain("Tekstur tier ini: baseColor 1024 px, normal 1024 px, orm 512 px");
    expect(prompt).toContain("target 800 KB, maksimal 1500 KB");
    expect(prompt).toContain("`/k`");
    expect(prompt).toContain("`/r`");
  });

  test("tidak memuat data pribadi atau path home", () => {
    expect(prompt).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(prompt).not.toContain("/home/");
  });
});

describe("outboundText", () => {
  test("pesan pemilik dikirim apa adanya, tanpa origin", () => {
    expect(outboundText({ kind: "owner", text: "tutupnya lebih tebal" })).toBe("tutupnya lebih tebal");
    expect(outboundOrigin({ kind: "owner", text: "x" })).toBeUndefined();
  });

  test("lampiran: path absolut untuk Read, nama decal, dan path model di container", () => {
    const text = outboundText(
      {
        kind: "owner",
        text: "seperti foto ini",
        attachments: [
          { id: "g1", kind: "image", name: "logo toko.png", file: "g1.png", decal: "g1-decal.png" },
          { id: "m1", kind: "model", name: "kursi.glb", file: "m1.glb", decal: null },
        ],
      },
      {},
      "/data/assets/a1/refs",
    );
    expect(text.startsWith("seperti foto ini\n\n[Lampiran pemilik]")).toBe(true);
    expect(text).toContain(
      '/data/assets/a1/refs/g1.png — gambar referensi "logo toko.png". Lihat dengan Read',
    );
    expect(text).toContain('decal.from_image("g1-decal.png", …)');
    expect(text).toContain("Di container: /refs/m1.glb");
    expect(outboundText({ kind: "owner", text: "x", attachments: [] })).toBe("x");
  });

  test("persetujuan: versi, frasa tahap tekstur, dan catatan pemilik", () => {
    const text = outboundText({ kind: "approved", version: 3, note: "kayunya gelap" });
    expect(text).toStartWith("[Sistem] Pemilik menyetujui bentuk dasar v3");
    expect(text).toContain("tahap tekstur");
    expect(text).toContain("build_textured_asset");
    expect(text).toEndWith("Catatan pemilik: kayunya gelap");
    expect(outboundText({ kind: "approved", version: 1 })).not.toContain("Catatan pemilik");
    expect(outboundOrigin({ kind: "approved", version: 1 })).toBe("approved");
  });

  test("ubah bentuk: bentuk dasar dibuka lagi + permintaan pemilik", () => {
    const text = outboundText({ kind: "change_shape", text: "kakinya lebih panjang" });
    expect(text).toContain("Bentuk dasar dibuka lagi");
    expect(text).toContain("build_base_mesh");
    expect(text).toEndWith("Permintaan pemilik: kakinya lebih panjang");
  });

  test("lanjutkan: proses terputus + kutipan permintaan terakhir", () => {
    const text = outboundText({ kind: "resume" }, { lastRequest: { text: "buat peti" } });
    expect(text).toContain("terputus");
    expect(text).toContain("list_versions");
    expect(text).toEndWith("buat peti");
    expect(outboundText({ kind: "resume" })).not.toContain("Permintaan terakhir");
    expect(outboundText({ kind: "resume" }, { lastRequest: { text: "  " } })).not.toContain(
      "Permintaan terakhir",
    );
  });

  test("lanjutkan/coba lagi: lampiran permintaan terakhir ikut dikutip dengan path absolut", () => {
    const attachments = [
      { id: "g1", kind: "image", name: "foto.png", file: "g1.png", decal: "g1-decal.png" },
    ] as const;
    const refs = "/data/assets/a1/refs";
    const text = outboundText(
      { kind: "retry" },
      { lastRequest: { text: "seperti foto ini", attachments } },
      refs,
    );
    expect(text).toContain("seperti foto ini");
    expect(text).toContain("[Lampiran pemilik]");
    expect(text).toContain("/data/assets/a1/refs/g1.png — gambar referensi");
    // Pesan hanya berisi lampiran (tanpa kata-kata) tetap dikutip.
    const onlyFiles = outboundText({ kind: "resume" }, { lastRequest: { text: "", attachments } }, refs);
    expect(onlyFiles).toContain("Permintaan terakhir");
    expect(onlyFiles).toContain("g1.png");
  });

  test("kutipan dipotong per code point (emoji tidak terbelah)", () => {
    const text = outboundText(
      { kind: "resume" },
      { lastRequest: { text: `${"x".repeat(QUOTE_MAX_CHARS - 1)}😀😀` } },
    );
    expect(text.isWellFormed()).toBe(true);
    expect(text).toEndWith("😀…");
  });

  test("coba lagi: error sebelumnya ikut disebut; kutipan panjang dipotong", () => {
    const error = { code: "USAGE_LIMIT" as const, message: "Batas pemakaian Claude tercapai.", at: 1 };
    const text = outboundText(
      { kind: "retry" },
      { lastError: error, lastRequest: { text: "x".repeat(QUOTE_MAX_CHARS + 50) } },
    );
    expect(text).toStartWith(
      "[Sistem] Giliran sebelumnya gagal (USAGE_LIMIT: Batas pemakaian Claude tercapai.)",
    );
    expect(text).toEndWith(`${"x".repeat(QUOTE_MAX_CHARS)}…`);
    expect(outboundText({ kind: "retry" }, { lastError: null })).toStartWith(
      "[Sistem] Giliran sebelumnya gagal. Pemilik menekan Coba lagi.",
    );
  });
});

describe("sessionPreamble", () => {
  test("aset baru (BRIEFING) tidak butuh pembuka", () => {
    expect(sessionPreamble(INITIAL_STATE)).toBeNull();
  });

  test("aset berjalan: status, versi, versi disetujui, dan brief diringkas", () => {
    const text = sessionPreamble({
      ...INITIAL_STATE,
      status: "TEXTURE_WORKING",
      currentVersion: 4,
      approvedBaseVersion: 3,
    });
    expect(text).toContain("sesi baru");
    expect(text).toContain("tahap tekstur (bentuk dasar sudah disetujui)");
    expect(text).toContain("Versi terkini: v4.");
    expect(text).toContain("Bentuk dasar yang disetujui: v3.");
    expect(text).not.toContain("Brief:");
  });
});
