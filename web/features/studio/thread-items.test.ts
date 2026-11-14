import { describe, expect, test } from "bun:test";
import type { AssetEvent } from "../../../shared/asset-events.ts";
import { type ClaudeBlock, type ThreadItem, threadItems } from "./thread-items.ts";
import type { ThreadEvent } from "./thread-store.ts";

let seq = 0;
function ev(ts: number, event: AssetEvent): ThreadEvent {
  seq += 1;
  return { assetId: "a1", seq, ts, event };
}

const NO_STREAM = { text: "", thinking: "" };

function build(events: ThreadEvent[], options: { running?: boolean; streaming?: typeof NO_STREAM } = {}) {
  return threadItems({
    events,
    streaming: options.streaming ?? NO_STREAM,
    running: options.running ?? false,
  });
}

function claude(item: ThreadItem | undefined): { header: boolean; blocks: readonly ClaudeBlock[] } {
  if (item?.kind !== "claude") throw new Error(`bukan grup Claude: ${item?.kind}`);
  return item;
}

const BRIEF = {
  summary: "Peti harta kayu",
  category: "Props",
  style: "stylized",
  dimensionsM: { width: 0.65, depth: 0.44, height: 0.53 },
};

describe("threadItems", () => {
  test("pesan pemilik lalu satu giliran Claude berkepala; lama berpikir dari event sebelumnya", () => {
    seq = 0;
    const items = build([
      ev(1_000, {
        type: "user",
        uuid: "u1",
        text: "Peti kayu",
        attachments: [{ id: "f1", kind: "image", name: "a.png" }],
      }),
      ev(1_100, { type: "init", sessionId: "s", model: "m" }),
      ev(13_100, { type: "thinking", text: "Rencana" }),
      ev(14_000, { type: "assistant", text: "Saya buat bentuk dasarnya dulu." }),
      ev(14_100, { type: "assistant", text: "   " }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["user", "claude"]);
    expect(items[0]).toEqual({
      kind: "user",
      key: "e1",
      text: "Peti kayu",
      attachments: [{ id: "f1", kind: "image", name: "a.png" }],
    });
    const group = claude(items[1]);
    expect(group.header).toBe(true);
    expect(group.blocks).toEqual([
      { kind: "thinking", key: "e3", text: "Rencana", durationMs: 12_000, live: false },
      { kind: "text", key: "e4", text: "Saya buat bentuk dasarnya dulu.", live: false },
    ]);
  });

  test("pertanyaan dijawab: jawaban ikut kartu, lanjutan giliran jadi grup baru tanpa kepala", () => {
    seq = 0;
    const questions = [{ question: "Gaya?", header: "Gaya", multiSelect: false, options: [] }];
    const items = build([
      ev(1, { type: "user", uuid: "u1", text: "Peti" }),
      ev(2, { type: "question", questionId: "q1", questions }),
      ev(3, {
        type: "question_resolved",
        questionId: "q1",
        answers: { "Gaya?": "Kartun" },
        cancelled: false,
      }),
      ev(4, { type: "brief", brief: BRIEF }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["user", "claude", "claude"]);
    expect(claude(items[1])).toMatchObject({
      header: true,
      blocks: [
        {
          kind: "question",
          questionId: "q1",
          resolution: { answers: { "Gaya?": "Kartun" }, cancelled: false },
        },
      ],
    });
    expect(claude(items[2])).toMatchObject({ header: false, blocks: [{ kind: "brief", brief: BRIEF }] });
  });

  test("pesan susunan app disembunyikan; aksi pemilik tampil dan memulai giliran baru", () => {
    seq = 0;
    const items = build([
      ev(1, { type: "assistant", text: "Siap direview." }),
      ev(2, { type: "action", action: "approve", version: 1 }),
      ev(3, { type: "user", uuid: "u2", text: "[Sistem] disetujui", origin: "approved" }),
      ev(4, { type: "assistant", text: "Lanjut tekstur." }),
      ev(5, { type: "action", action: "stop" }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["claude", "action", "claude", "action"]);
    expect(items[1]).toEqual({ kind: "action", key: "e2", action: "approve", version: 1 });
    expect(items[3]).toEqual({ kind: "action", key: "e5", action: "stop", version: null });
    expect(claude(items[0]).header).toBe(true);
    expect(claude(items[2]).header).toBe(true);
  });

  test("build: mulai menulis skrip, selesai dengan versi", () => {
    seq = 0;
    const items = build([
      ev(1, { type: "user", uuid: "u1", text: "Peti" }),
      ev(10, { type: "tool", toolUseId: "t0", name: "Read", input: { file_path: "/w/knowledge/API.md" } }),
      ev(20, { type: "tool", toolUseId: "t1", name: "Write", input: { file_path: "/w/work/base.py" } }),
      ev(25, { type: "tool", toolUseId: "t2", name: "Edit", input: { file_path: "/w/work/base.py" } }),
      ev(32, { type: "build_started", jobId: "j1", stage: "base", buildNumber: 1 }),
      ev(140, { type: "build_finished", jobId: "j1", ok: true, version: 1 }),
      ev(150, { type: "build_started", jobId: "j2", stage: "base", buildNumber: 2 }),
      ev(160, { type: "build_finished", jobId: "j2", ok: false, code: "SCRIPT_ERROR" }),
    ]);
    expect(claude(items[1]).blocks).toEqual([
      {
        kind: "build",
        key: "e5",
        jobId: "j1",
        stage: "base",
        status: "done",
        version: 1,
        code: null,
        startedAt: 32,
        endedAt: 140,
        scriptStartedAt: 20,
      },
      {
        kind: "build",
        key: "e7",
        jobId: "j2",
        stage: "base",
        status: "failed",
        version: null,
        code: "SCRIPT_ERROR",
        startedAt: 150,
        endedAt: 160,
        scriptStartedAt: null,
      },
    ]);
  });

  test("build dibatalkan atau tidak selesai saat giliran berakhir → berhenti", () => {
    seq = 0;
    const events = [
      ev(1, { type: "build_started", jobId: "j1", stage: "base", buildNumber: 1 }),
      ev(5, { type: "build_finished", jobId: "j1", ok: false, code: "CANCELLED" }),
      ev(6, { type: "build_started", jobId: "j2", stage: "textured", buildNumber: 1 }),
      ev(9, {
        type: "result",
        subtype: "error_during_execution",
        isError: true,
        interrupted: true,
        durationMs: 9,
        numTurns: 1,
      }),
    ];
    const blocks = claude(build(events)[0]).blocks;
    expect(blocks.map((block) => [block.kind, block.kind === "build" ? block.status : null])).toEqual([
      ["build", "stopped"],
      ["build", "stopped"],
      ["stopped", null],
    ]);
    expect(blocks[1]).toMatchObject({ endedAt: 9 });
  });

  test("build berjalan tetap berjalan selama proses hidup; tanpa proses dianggap berhenti", () => {
    seq = 0;
    const events = [ev(1, { type: "build_started", jobId: "j1", stage: "base", buildNumber: 1 })];
    expect(claude(build(events, { running: true })[0]).blocks[0]).toMatchObject({
      status: "running",
      endedAt: null,
    });
    expect(claude(build(events, { running: false })[0]).blocks[0]).toMatchObject({
      status: "stopped",
      endedAt: 1,
    });
  });

  test("error agen tidak digandakan oleh result gagal; result gagal tanpa error → TURN_FAILED", () => {
    seq = 0;
    const failed = {
      type: "result" as const,
      subtype: "error",
      isError: true,
      interrupted: false,
      durationMs: 1,
      numTurns: 1,
    };
    const items = build([
      ev(1, { type: "error", code: "USAGE_LIMIT", message: "Batas tercapai", resetsAt: 99 }),
      ev(2, failed),
      ev(3, { type: "user", uuid: "u", text: "Coba" }),
      ev(4, failed),
      ev(5, { type: "notice", text: "Sesi dimulai ulang" }),
    ]);
    expect(claude(items[0]).blocks).toEqual([
      { kind: "error", key: "e1", code: "USAGE_LIMIT", message: "Batas tercapai", resetsAt: 99 },
    ]);
    expect(claude(items[2]).blocks).toEqual([
      { kind: "error", key: "e4", code: "TURN_FAILED", message: "", resetsAt: null },
      { kind: "notice", key: "e5", text: "Sesi dimulai ulang" },
    ]);
  });

  test("stream ditempel di grup yang terbuka, atau grup baru berkepala setelah pesan pemilik", () => {
    seq = 0;
    const streaming = { text: "Saya mul", thinking: "Menimbang" };
    const open = build([ev(1, { type: "assistant", text: "Halo" })], { running: true, streaming });
    expect(claude(open[0]).blocks.map((block) => block.key)).toEqual(["e1", "live-thinking", "live-text"]);

    const afterOwner = build([ev(2, { type: "user", uuid: "u", text: "Lanjut" })], {
      running: true,
      streaming,
    });
    expect(afterOwner.map((item) => item.kind)).toEqual(["user", "claude"]);
    expect(claude(afterOwner[1])).toMatchObject({
      header: true,
      blocks: [
        { kind: "thinking", text: "Menimbang", live: true, durationMs: null },
        { kind: "text", text: "Saya mul", live: true },
      ],
    });
  });

  test("thread kosong tanpa stream → tanpa item", () => {
    expect(build([])).toEqual([]);
  });
});
