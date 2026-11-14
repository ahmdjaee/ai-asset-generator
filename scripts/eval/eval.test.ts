import { describe, expect, test } from "bun:test";
import type { AgentEvent, AskQuestion } from "../../shared/agent-events.ts";
import { parseBaseTranscript } from "./base-run.ts";
import { BASE_CASES, pickAnswers } from "./cases.ts";
import { EVAL_MAX_DURATION_MS, summarizeRun, summaryTable, TEXTURE_LIMITS } from "./report.ts";

const question = (text: string, header: string, labels: string[], multiSelect = false): AskQuestion => ({
  question: text,
  header,
  options: labels.map((label) => ({ label, description: "" })),
  multiSelect,
});

describe("kasus eval:base", () => {
  test("5 kasus sesuai PLAN", () => {
    expect(BASE_CASES.map((item) => item.id)).toEqual(["peti", "pistol-scifi", "kursi", "pohon", "rubah"]);
  });

  test("pickAnswers: aturan kasus, aturan umum, lalu pilihan pertama", () => {
    const peti = BASE_CASES[0]?.answers ?? [];
    expect(
      pickAnswers(
        [
          question("Bentuk tutup peti?", "Tutup", ["Datar", "Melengkung"]),
          question("Gaya visual?", "Gaya", ["Realistis", "Stylized kartun"]),
          question("Berapa engsel?", "Engsel", ["Dua", "Tiga"]),
        ],
        peti,
      ),
    ).toEqual({
      "Bentuk tutup peti?": "Melengkung",
      "Gaya visual?": "Stylized kartun",
      "Berapa engsel?": "Dua",
    });
  });
});

describe("summarizeRun", () => {
  const events: AgentEvent[] = [
    { type: "user", uuid: "u", text: "buat" },
    { type: "thinking", text: "Rencana: badan dulu." },
    { type: "build_finished", jobId: "b1", ok: false, code: "SCRIPT_ERROR" },
    { type: "build_finished", jobId: "b2", ok: true, version: 1 },
    { type: "assistant", text: "Di sudut Kiri, sandaran terlalu tipis." },
    { type: "build_finished", jobId: "b3", ok: true, version: 2 },
    { type: "submitted", version: 2, summary: "siap", stage: "base" },
    {
      type: "result",
      subtype: "success",
      isError: false,
      interrupted: false,
      durationMs: 1,
      numTurns: 3,
      costUsd: 1.25,
    },
  ];

  test("kasus yang lolos semua syarat", () => {
    const summary = summarizeRun({
      id: "kursi",
      events,
      durationMs: 300_000,
      version: { triangles: 900, validatorErrors: 0, budgetOk: true },
    });
    expect(summary).toMatchObject({
      submitted: true,
      submittedVersion: 2,
      builds: 3,
      failedBuilds: 1,
      thinkingBlocks: 1,
      referencesSheet: true,
      costUsd: 1.25,
      pass: true,
      failures: [],
    });
  });

  test("gagal: tanpa submit, terlalu lama, validator error", () => {
    const summary = summarizeRun({
      id: "x",
      events: events.filter((event) => event.type !== "submitted"),
      durationMs: EVAL_MAX_DURATION_MS + 1,
      version: { triangles: 1, validatorErrors: 2, budgetOk: true },
    });
    expect(summary.failures).toEqual([
      "tidak sampai submit_for_review",
      "ada error validator",
      "lebih dari 10 menit",
    ]);
    expect(summary.pass).toBe(false);
  });

  test("rujukan contact sheet hanya dihitung setelah build pertama", () => {
    const summary = summarizeRun({
      id: "x",
      events: [
        { type: "assistant", text: "Saya akan cek sudut Depan nanti." },
        { type: "build_finished", jobId: "b", ok: true, version: 1 },
      ],
      durationMs: 1,
      version: null,
    });
    expect(summary.referencesSheet).toBe(false);
  });

  test("tabel ringkasan menghitung yang lolos", () => {
    const ok = summarizeRun({
      id: "a",
      events,
      durationMs: 1,
      version: { triangles: 1, validatorErrors: 0, budgetOk: true },
    });
    expect(summaryTable([ok])).toContain("**Lolos syarat otomatis: 1 dari 1**");
  });
});

describe("deteksi rujukan contact sheet", () => {
  const afterBuild = (text: string): AgentEvent[] => [
    { type: "build_finished", jobId: "j1", ok: true, version: 1 },
    { type: "thinking", text },
  ];
  const detect = (text: string) =>
    summarizeRun({ id: "x", events: afterBuild(text), durationMs: 1, version: null }).referencesSheet;

  test("ringkasan berpikir berbahasa Inggris juga terdeteksi", () => {
    expect(detect("I'm reviewing the render: the front-facing eyes look right")).toBe(true);
    expect(detect("I'm checking the side view: the tail looks flat")).toBe(true);
    expect(detect("Dari sudut Kiri ekornya terlalu tipis")).toBe(true);
  });

  test("teks tanpa rujukan visual tidak terdeteksi; kata yang hanya memuat 'side' juga tidak", () => {
    expect(detect("I'll submit v3 now")).toBe(false);
    expect(detect("The cutter sits inside the box")).toBe(false);
  });
});

describe("summarizeRun tahap tekstur", () => {
  test("submit bentuk dasar tidak dihitung; build > 4 gagal", () => {
    const events: AgentEvent[] = [
      { type: "submitted", version: 1, summary: "dasar", stage: "base" },
      ...Array.from(
        { length: 5 },
        (_, index): AgentEvent => ({
          type: "build_finished",
          jobId: `j${index}`,
          ok: true,
          version: index + 2,
        }),
      ),
    ];
    const summary = summarizeRun({
      id: "x",
      events,
      durationMs: 1000,
      version: null,
      limits: TEXTURE_LIMITS,
    });
    expect(summary.submitted).toBe(false);
    expect(summary.failures).toEqual(["tidak sampai submit_for_review", "build > 4"]);
  });
});

describe("parseBaseTranscript", () => {
  const brief = {
    summary: "peti",
    category: "prop",
    style: "kartun",
    dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
  };
  const lines = [
    { type: "user", uuid: "u1", text: "buat peti" },
    { type: "init", sessionId: "s-1", model: "m" },
    { type: "brief", brief },
    { type: "submitted", version: 1, summary: "awal" },
    { type: "init", sessionId: "s-2", model: "m" },
    { type: "submitted", version: 2, summary: "revisi" },
  ];

  test("session id pertama, submit dan brief terakhir", () => {
    const text = lines.map((line) => JSON.stringify(line)).join("\n");
    expect(parseBaseTranscript(text)).toMatchObject({ sessionId: "s-1", version: 2, summary: "revisi" });
  });

  test("tanpa submit → null", () => {
    expect(parseBaseTranscript(JSON.stringify(lines[1]))).toBeNull();
  });
});
