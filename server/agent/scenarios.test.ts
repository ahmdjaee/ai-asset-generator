/** Logika skenario bawaan `AGENT_DRIVER=fake`, diuji dengan "Claude" tiruan (tanpa sesi dan tanpa forge). */
import { describe, expect, test } from "bun:test";
import type { ForgeReply, ScenarioActions } from "./scenario-port.ts";
import {
  briefSummary,
  defaultScenario,
  HANG_PARTIAL_TEXT,
  PARTS_QUESTION,
  SCENARIO_MARKERS,
  STYLE_QUESTION,
} from "./scenarios.ts";

type Call = Readonly<{ name: string; args?: Record<string, unknown> }>;

function fakeClaude(
  replies: Record<string, ForgeReply>,
  answers: Readonly<Record<string, string>> | null = null,
) {
  const said: string[] = [];
  const streamed: string[] = [];
  const calls: Call[] = [];
  const signals: string[] = [];
  const claude: ScenarioActions = {
    cwd: "/kerja",
    say: (value) => said.push(value),
    think: () => undefined,
    streamText: (value) => streamed.push(value),
    write: async () => true,
    forge: async (name, args) => {
      calls.push(args === undefined ? { name } : { name, args });
      return replies[name] ?? { ok: true, body: {}, images: 0 };
    },
    ask: async () => answers,
    usageLimit: (resetsAt) => {
      signals.push(`batas:${resetsAt}`);
      throw new Error("batas");
    },
    hang: async () => {
      signals.push("macet");
      throw new Error("macet");
    },
    crash: () => {
      signals.push("mati");
      throw new Error("mati");
    },
  };
  return { claude, said, streamed, calls, signals };
}

const status = (value: string): ForgeReply => ({ ok: true, body: { status: value }, images: 0 });

describe("briefSummary", () => {
  test("baris pertama tanpa penanda; kosong → bawaan", () => {
    expect(briefSummary(`Peti kayu ${SCENARIO_MARKERS.ask}\nbaris dua`)).toBe("Peti kayu");
    expect(briefSummary(SCENARIO_MARKERS.usageLimit)).toBe("Peti kayu");
    expect(briefSummary("x".repeat(200))).toHaveLength(120);
  });

  test("pesan [Sistem] memakai permintaan yang dikutip", () => {
    const text =
      "[Sistem] Proses sebelumnya terputus.\nPermintaan terakhir (mungkin belum sempat kamu terima):\nKursi rotan";
    expect(briefSummary(text)).toBe("Kursi rotan");
  });
});

describe("defaultScenario", () => {
  test("menunggu review dan selesai: hanya menjawab, tanpa build", async () => {
    for (const [current, expected] of [
      ["BASE_REVIEW", "menunggu review"],
      ["DONE", "sudah selesai"],
    ] as const) {
      const fake = fakeClaude({ list_versions: status(current) });
      await defaultScenario()({ text: "halo", index: 1 }, fake.claude);
      expect(fake.said.at(-1)).toContain(expected);
      expect(fake.calls.map((call) => call.name)).toEqual(["list_versions"]);
    }
  });

  test("penanda hanya berlaku di pesan pemilik, bukan pesan [Sistem]", async () => {
    const owner = fakeClaude({ list_versions: status("DONE") });
    await defaultScenario({ now: () => 1_800_000_000_000 })(
      { text: `Peti ${SCENARIO_MARKERS.usageLimit}`, index: 1 },
      owner.claude,
    ).catch(() => undefined);
    expect(owner.signals).toEqual(["batas:1800003600"]);

    const system = fakeClaude({ list_versions: status("DONE") });
    await defaultScenario()(
      { text: `[Sistem] Coba lagi.\nPermintaan terakhir:\nPeti ${SCENARIO_MARKERS.crash}`, index: 1 },
      system.claude,
    );
    expect(system.signals).toEqual([]);
  });

  test("brief ditolak / build gagal / submit ditolak dilaporkan apa adanya", async () => {
    const rejected: ForgeReply = { ok: false, body: { code: "X_CODE", message: "alasan" }, images: 0 };
    const brief = fakeClaude({ list_versions: status("BRIEFING"), record_brief: rejected });
    await defaultScenario()({ text: "Peti", index: 1 }, brief.claude);
    expect(brief.said.at(-1)).toContain("Brief ditolak (X_CODE: alasan)");

    const build = fakeClaude({ list_versions: status("BASE_WORKING"), build_base_mesh: rejected });
    await defaultScenario()({ text: "Peti", index: 1 }, build.claude);
    expect(build.said.at(-1)).toContain("Build bentuk dasar gagal (X_CODE: alasan)");

    const submit = fakeClaude({
      list_versions: status("BASE_WORKING"),
      build_base_mesh: { ok: true, body: { version: 3 }, images: 1 },
      submit_for_review: rejected,
    });
    await defaultScenario()({ text: "Peti", index: 1 }, submit.claude);
    expect(submit.said.at(-1)).toContain("Submit v3 ditolak");

    const textured = fakeClaude({ list_versions: status("TEXTURE_WORKING"), build_textured_asset: rejected });
    await defaultScenario()({ text: "Peti", index: 1 }, textured.claude);
    expect(textured.said.at(-1)).toContain("Build bertekstur gagal");

    const odd = fakeClaude({
      list_versions: status("TEXTURE_WORKING"),
      build_textured_asset: { ok: false, body: { code: 42 }, images: 0 },
    });
    await defaultScenario()({ text: "Peti", index: 1 }, odd.claude);
    expect(odd.said.at(-1)).toContain("tool gagal");
  });

  test("pertanyaan dibatalkan: tidak membuat brief", async () => {
    const fake = fakeClaude({ list_versions: status("BRIEFING") });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.ask}`, index: 1 }, fake.claude);
    expect(fake.said.at(-1)).toContain("dibatalkan");
    expect(fake.calls.map((call) => call.name)).toEqual(["list_versions"]);
  });

  test("jalur sukses bentuk dasar dan tekstur", async () => {
    const base = fakeClaude({
      list_versions: status("BRIEFING"),
      build_base_mesh: { ok: true, body: { version: 1 }, images: 1 },
      submit_for_review: { ok: true, body: {}, images: 0 },
    });
    await defaultScenario()({ text: "Peti", index: 1 }, base.claude);
    expect(base.said.at(-1)).toContain("Bentuk dasar v1 siap direview");
    expect(base.calls.map((call) => call.name)).toEqual([
      "list_versions",
      "record_brief",
      "build_base_mesh",
      "submit_for_review",
    ]);

    const textured = fakeClaude({
      list_versions: status("TEXTURE_WORKING"),
      build_textured_asset: { ok: true, body: { version: 2 }, images: 1 },
      submit_for_review: { ok: true, body: {}, images: 0 },
    });
    await defaultScenario()({ text: "Lanjut", index: 1 }, textured.claude);
    expect(textured.said.at(-1)).toContain("Aset final v2 siap direview");
    expect(textured.calls.map((call) => call.name)).toEqual([
      "list_versions",
      "list_materials",
      "build_textured_asset",
      "submit_for_review",
    ]);
  });

  test("jawaban pertanyaan menentukan gaya brief; pilih banyak yang dibatalkan tidak membuat brief", async () => {
    const style = fakeClaude({ list_versions: status("BRIEFING") }, { [STYLE_QUESTION]: "Realistis" });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.ask}`, index: 1 }, style.claude);
    expect(style.calls.find((call) => call.name === "record_brief")?.args).toMatchObject({
      style: "realistis",
    });

    const many = fakeClaude({ list_versions: status("BRIEFING") }, { [PARTS_QUESTION]: "Gembok, Engsel" });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.askMany}`, index: 1 }, many.claude);
    expect(many.calls.find((call) => call.name === "record_brief")?.args).toMatchObject({ style: "kartun" });

    const cancelled = fakeClaude({ list_versions: status("BRIEFING") });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.askMany}`, index: 1 }, cancelled.claude);
    expect(cancelled.calls.map((call) => call.name)).toEqual(["list_versions"]);
  });

  test("penanda macet dan mati", async () => {
    const hang = fakeClaude({ list_versions: status("BRIEFING") });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.hang}`, index: 1 }, hang.claude).catch(
      () => undefined,
    );
    expect(hang.signals).toEqual(["macet"]);
    // Macet di tengah teks: hanya delta (belum ada pesan utuh), supaya E2E bisa memuat ulang saat stream berjalan.
    expect(hang.streamed).toEqual([HANG_PARTIAL_TEXT]);
    expect(hang.said).toEqual([]);

    const crash = fakeClaude({ list_versions: status("BRIEFING") });
    await defaultScenario()({ text: `Peti ${SCENARIO_MARKERS.crash}`, index: 1 }, crash.claude).catch(
      () => undefined,
    );
    expect(crash.signals).toEqual(["mati"]);
  });
});
