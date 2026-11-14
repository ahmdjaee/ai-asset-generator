/** Skenario runner dengan AgentPort palsu (port dari ai-team `scripts/check-runner.ts`). Tanpa model, tanpa kuota. */
import { describe, expect, test } from "bun:test";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../shared/agent-events.ts";
import { AGENT_IDLE_SHUTDOWN_MS } from "../../shared/limits.ts";
import { assistantMessage, initMessage, rateLimitMessage, resultMessage, text } from "./fake-messages.ts";
import { FakeAgentPort, type FakeAgentSession } from "./fake-port.ts";
import type { GuardVerdict } from "./guard.ts";
import { AgentPool } from "./pool.ts";
import {
  AssetRunner,
  QUEUED_NOTICE,
  type RunnerOptions,
  type Schedule,
  SESSION_CRASHED_MESSAGE,
  SESSION_START_FAILED_MESSAGE,
  STOP_GRACE_MS,
  USAGE_LIMIT_MESSAGE,
} from "./runner.ts";

type Timer = { fn: () => void; ms: number };

type Harness = {
  runner: AssetRunner;
  /** Error teknis yang dilaporkan runner (untuk log server), bersama operasinya. */
  errors: Array<{ error: unknown; op: string }>;
  port: FakeAgentPort;
  events: AgentEvent[];
  calls: { ownerMessages: number; stops: number };
  timers: Timer[];
  /** Menjalankan timer yang terjadwal dengan selang `ms` (jam palsu, tanpa sleep). */
  fire: (ms: number) => void;
  /** Menunggu event yang cocok; event yang sudah ada ikut dicari (tanpa sleep). */
  waitFor: (predicate: (event: AgentEvent) => boolean) => Promise<AgentEvent>;
  /** Menunggu sampai `count` pesan benar-benar dikirim ke Claude. */
  delivered: (count: number) => Promise<void>;
};

function harness(
  overrides: Partial<RunnerOptions> = {},
  verdict: GuardVerdict = { allow: false, reason: "tidak diizinkan" },
): Harness {
  const port = new FakeAgentPort();
  const events: AgentEvent[] = [];
  const waiters: Array<{ predicate: (event: AgentEvent) => boolean; resolve: (event: AgentEvent) => void }> =
    [];
  const calls = { ownerMessages: 0, stops: 0 };
  const errors: Array<{ error: unknown; op: string }> = [];
  const deliveries: Array<{ count: number; resolve: () => void }> = [];
  const timers: Timer[] = [];
  const schedule: Schedule = (fn, ms) => {
    const timer = { fn, ms };
    timers.push(timer);
    return {
      cancel: () => {
        const index = timers.indexOf(timer);
        if (index !== -1) timers.splice(index, 1);
      },
    };
  };
  const runner = new AssetRunner({
    port,
    sessionOptions: ({ resume, canUseTool }) => ({ canUseTool, ...(resume === undefined ? {} : { resume }) }),
    checkTool: async () => verdict,
    emit: (event) => {
      events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(event)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    },
    onOwnerMessage: () => {
      calls.ownerMessages += 1;
      for (const waiter of [...deliveries]) {
        if (calls.ownerMessages >= waiter.count) {
          deliveries.splice(deliveries.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    },
    onStop: () => {
      calls.stops += 1;
    },
    onError: (error, op) => errors.push({ error, op }),
    schedule,
    ...overrides,
  });
  return {
    runner,
    errors,
    port,
    events,
    calls,
    timers,
    fire: (ms) => {
      const timer = timers.find((candidate) => candidate.ms === ms);
      if (timer === undefined) throw new Error(`tidak ada timer ${ms} ms`);
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    },
    waitFor: (predicate) => {
      const found = events.find(predicate);
      if (found !== undefined) return Promise.resolve(found);
      return new Promise((resolve) => waiters.push({ predicate, resolve }));
    },
    delivered: (count) =>
      calls.ownerMessages >= count
        ? Promise.resolve()
        : new Promise((resolve) => deliveries.push({ count, resolve })),
  };
}

const isResult = (event: AgentEvent) => event.type === "result";
const ofType = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);

/** Mengirim pesan dan menunggu sampai pesan itu benar-benar dikirim ke Claude (lewat pool bila ada). */
async function startTurn(
  h: Harness,
  message = "buat peti",
): Promise<{ session: FakeAgentSession; uuid: string }> {
  const target = h.calls.ownerMessages + 1;
  h.runner.send(message);
  await h.delivered(target);
  const session = h.port.current;
  const sent = session.sent.at(-1);
  if (sent === undefined) throw new Error("pesan tidak terkirim");
  return { session, uuid: sent.uuid ?? "" };
}

function canUseTool(session: FakeAgentSession) {
  const fn = session.options.canUseTool;
  if (fn === undefined) throw new Error("canUseTool tidak dipasang");
  return (
    name: string,
    input: Record<string, unknown>,
    signal = new AbortController().signal,
  ): Promise<PermissionResult | null> => fn(name, input, { signal, toolUseID: "tu-1", requestId: "rq-1" });
}

describe("AssetRunner", () => {
  test("pesan dikirim dengan uuid; result dengan uuid itu menutup giliran", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.runner.status).toBe("running");
    session.push(initMessage("S1"), assistantMessage("S1", [text("Siap.")]), resultMessage("S1", [uuid]));
    expect(await h.waitFor(isResult)).toMatchObject({
      type: "result",
      subtype: "success",
      interrupted: false,
    });
    expect(h.runner.status).toBe("idle");
    expect(h.runner.sessionId).toBe("S1");
    expect(h.events.map((event) => event.type)).toEqual(["user", "init", "assistant", "result"]);
    expect(h.calls.ownerMessages).toBe(1);
  });

  test("result milik pesan lain (giliran dari CLI) tidak menutup giliran kita", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(
      initMessage("S1"),
      resultMessage("S1", ["uuid-lain"]),
      assistantMessage("S1", [text("lanjut")]),
    );
    await h.waitFor((event) => event.type === "assistant");
    expect(h.runner.status).toBe("running");
    session.push(resultMessage("S1", [uuid]));
    await h.waitFor(isResult);
    expect(ofType(h.events, "result")).toHaveLength(1);
  });

  test("thread menampilkan kata-kata pemilik + chip lampiran; Claude menerima teks lengkap", async () => {
    const h = harness();
    h.runner.send("teks lengkap\n\n[Lampiran pemilik]\n- refs/g1.png", {
      display: "teks lengkap",
      attachments: [{ id: "g1", kind: "image", name: "logo.png" }],
    });
    h.runner.send("tanpa lampiran", { display: "tanpa lampiran", attachments: [] });
    const users = ofType(h.events, "user");
    expect(users[0]).toMatchObject({
      text: "teks lengkap",
      attachments: [{ id: "g1", kind: "image", name: "logo.png" }],
    });
    expect(users[1]?.attachments).toBeUndefined();
    const session = h.port.current;
    expect((await session.lastSent(1)).message.content).toContain("[Lampiran pemilik]");
  });

  test("pesan kedua menunggu sampai giliran pertama selesai, lalu dikirim di sesi yang sama", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h, "pertama");
    h.runner.send("kedua", { origin: "approved" });
    // Event `user` langsung tercatat walau pesan masih antre.
    expect(ofType(h.events, "user").map((event) => [event.text, event.origin])).toEqual([
      ["pertama", undefined],
      ["kedua", "approved"],
    ]);
    expect(session.sent).toHaveLength(1);
    expect(h.calls.ownerMessages).toBe(1);
    session.push(initMessage("S1"), resultMessage("S1", [uuid]));
    const second = await session.lastSent(2);
    expect(second.message.content).toBe("kedua");
    const queuedUuid: string | undefined = ofType(h.events, "user")[1]?.uuid;
    expect(queuedUuid).toBe(second.uuid);
    expect(h.port.sessions).toHaveLength(1);
    expect(h.calls.ownerMessages).toBe(2);
  });

  test("pesan ter-buffer setelah close() diabaikan", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.holdOnClose = true;
    session.push(initMessage("S1"));
    await h.waitFor((event) => event.type === "init");
    h.runner.close();
    const before = h.events.length;
    session.push(assistantMessage("S1", [text("basi")]), resultMessage("S1", [uuid]));
    session.end();
    await session.drained;
    expect(h.events.slice(before)).toEqual([]);
    expect(session.calls.close).toBe(1);
    expect(h.calls.stops).toBe(1);
    expect(() => h.runner.send("lagi")).toThrow();
  });

  test("Stop: build dibatalkan, interrupt dipanggil, result turn ditandai interrupted", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(initMessage("S1"));
    await h.waitFor((event) => event.type === "init");
    await h.runner.interrupt();
    expect(h.calls.stops).toBe(1);
    expect(session.calls.interrupt).toBe(1);
    expect(h.timers.map((timer) => timer.ms)).toEqual([STOP_GRACE_MS]);
    session.push(resultMessage("S1", [uuid], { subtype: "error_during_execution" }));
    expect(await h.waitFor(isResult)).toMatchObject({ interrupted: true });
    // Masa tenggang dibatalkan; yang tersisa hanya timer idle.
    expect(h.timers.map((timer) => timer.ms)).toEqual([AGENT_IDLE_SHUTDOWN_MS]);
  });

  test("Stop saat pesan masih antre di CLI: kuitansi `cancelled` langsung menutup giliran", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    session.receipt = (sent) => ({ cancelled: sent.map((message) => message.uuid ?? "") });
    await h.runner.interrupt();
    expect(ofType(h.events, "result")).toEqual([
      {
        type: "result",
        subtype: "interrupted",
        isError: false,
        interrupted: true,
        durationMs: 0,
        numTurns: 0,
      },
    ]);
    expect(h.runner.status).toBe("idle");
  });

  test("Stop tanpa result: setelah masa tenggang sesi ditutup, pesan berikutnya me-resume sesi", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    session.push(initMessage("S1"));
    await h.waitFor((event) => event.type === "init");
    await h.runner.interrupt();
    h.fire(STOP_GRACE_MS);
    expect(session.calls.close).toBe(1);
    expect(ofType(h.events, "result").at(-1)).toMatchObject({ interrupted: true });
    expect(h.timers).toEqual([]);
    await startTurn(h, "lanjut");
    expect(h.port.sessions).toHaveLength(2);
    expect(h.port.current.options.resume).toBe("S1");
  });

  test("Stop membuang pesan yang belum dikirim", async () => {
    const h = harness();
    await startTurn(h);
    h.runner.send("kedua");
    h.runner.send("ketiga");
    await h.runner.interrupt();
    expect(ofType(h.events, "notice").at(-1)?.text).toContain("2 pesan");
  });

  test("proses Claude mati di tengah giliran → SESSION_FAILED; pesan berikutnya me-resume", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    session.push(initMessage("S1"));
    await h.waitFor((event) => event.type === "init");
    session.fail(new Error("proses keluar dengan kode 1 (/home/x/.local/bin/claude)"));
    // Klien hanya menerima pesan umum berbahasa Indonesia; detail teknis (path, teks Inggris) ke log.
    expect(await h.waitFor((event) => event.type === "error")).toMatchObject({
      code: "SESSION_FAILED",
      message: SESSION_CRASHED_MESSAGE,
    });
    expect(h.errors).toHaveLength(1);
    expect(String(h.errors[0]?.error)).toContain("kode 1");
    expect(await h.waitFor(isResult)).toMatchObject({ isError: true, interrupted: false });
    await startTurn(h, "coba lagi");
    expect(h.port.current.options.resume).toBe("S1");
  });

  test("proses mati saat idle → hanya pemberitahuan, tanpa error giliran", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(initMessage("S1"), resultMessage("S1", [uuid]));
    await h.waitFor(isResult);
    session.fail(new Error("SIGKILL"));
    expect(await h.waitFor((event) => event.type === "notice")).toMatchObject({
      text: SESSION_CRASHED_MESSAGE,
    });
    expect(String(h.errors[0]?.error)).toContain("SIGKILL");
    expect(ofType(h.events, "error")).toEqual([]);
    expect(h.runner.live).toBe(false);
    expect(h.timers).toEqual([]);
  });

  test("proses Claude gagal dimulai → SESSION_FAILED, pesan yang antre dibuang", async () => {
    const h = harness();
    h.port.startError = new Error("claude tidak ditemukan di PATH");
    h.runner.send("buat peti");
    await h.waitFor((event) => event.type === "error");
    expect(ofType(h.events, "error")).toEqual([
      {
        type: "error",
        code: "SESSION_FAILED",
        message: SESSION_START_FAILED_MESSAGE,
      },
    ]);
    expect(h.errors.map((entry) => String(entry.error))).toEqual(["Error: claude tidak ditemukan di PATH"]);
    expect(h.runner.status).toBe("idle");
    await startTurn(h, "coba lagi");
    expect(h.port.sessions).toHaveLength(1);
  });

  test("teks ke Claude selalu valid: surrogate tunggal diganti U+FFFD", async () => {
    const h = harness();
    const { session } = await startTurn(h, "peti \uD83D");
    const content = session.sent.at(-1)?.message.content;
    expect(content).toBe("peti \uFFFD");
  });

  test("runner dibuat dengan session id lama → sesi pertama langsung resume", async () => {
    const h = harness({ sessionId: "S-lama" });
    await startTurn(h);
    expect(h.port.current.options.resume).toBe("S-lama");
  });
});

describe("AssetRunner — proses idle dan pool", () => {
  async function finishTurn(h: Harness, session: FakeAgentSession, uuid: string) {
    session.push(initMessage("S1"), resultMessage("S1", [uuid]));
    await h.waitFor(isResult);
  }

  test("proses idle ditutup setelah 5 menit; pesan berikutnya me-resume sesi", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    await finishTurn(h, session, uuid);
    expect(h.runner.live).toBe(true);
    h.fire(AGENT_IDLE_SHUTDOWN_MS);
    expect(session.calls.close).toBe(1);
    expect(h.runner.live).toBe(false);
    await startTurn(h, "lanjut");
    expect(h.port.sessions).toHaveLength(2);
    expect(h.port.current.options.resume).toBe("S1");
  });

  test("pesan baru sebelum 5 menit membatalkan timer idle", async () => {
    const h = harness({ idleShutdownMs: 1000 });
    const { session, uuid } = await startTurn(h);
    await finishTurn(h, session, uuid);
    expect(h.timers.map((timer) => timer.ms)).toEqual([1000]);
    await startTurn(h, "kedua");
    expect(h.timers).toEqual([]);
    expect(h.port.sessions).toHaveLength(1);
  });

  test("pool penuh oleh giliran lain → pesan antre dengan pemberitahuan; jalan setelah proses lain idle", async () => {
    const pool = new AgentPool({ size: 1 });
    const a = harness({ pool });
    const b = harness({ pool });
    const first = await startTurn(a);
    expect(pool.live).toBe(1);
    b.runner.send("aset kedua");
    expect(ofType(b.events, "notice")).toEqual([{ type: "notice", text: QUEUED_NOTICE }]);
    expect(b.port.sessions).toHaveLength(0);
    expect(pool.waiting).toBe(1);

    // Giliran A selesai → proses A langsung ditutup karena ada yang antre, slotnya untuk B.
    await finishTurn(a, first.session, first.uuid);
    await b.delivered(1);
    expect(first.session.calls.close).toBe(1);
    expect(a.runner.live).toBe(false);
    expect(b.port.sessions).toHaveLength(1);
    expect(pool.live).toBe(1);
  });

  test("pool penuh oleh proses idle → proses LRU ditutup tanpa antre", async () => {
    const pool = new AgentPool({ size: 1 });
    const a = harness({ pool });
    const b = harness({ pool });
    const first = await startTurn(a);
    await finishTurn(a, first.session, first.uuid);
    await startTurn(b, "aset kedua");
    expect(ofType(b.events, "notice")).toEqual([]);
    expect(first.session.calls.close).toBe(1);
    expect(pool.live).toBe(1);
  });

  test("Stop saat menunggu slot pool → permintaan slot dibatalkan", async () => {
    const pool = new AgentPool({ size: 1 });
    const a = harness({ pool });
    const b = harness({ pool });
    await startTurn(a);
    b.runner.send("aset kedua");
    expect(pool.waiting).toBe(1);
    await b.runner.interrupt();
    expect(pool.waiting).toBe(0);
    expect(ofType(b.events, "notice").at(-1)?.text).toContain("1 pesan");
    expect(b.port.sessions).toHaveLength(0);
  });

  test("close() melepas slot pool", async () => {
    const pool = new AgentPool({ size: 1 });
    const h = harness({ pool });
    await startTurn(h);
    h.runner.close();
    expect(pool.live).toBe(0);
  });
});

describe("AssetRunner — batas pemakaian", () => {
  test("rate_limit_event ditolak + giliran gagal → USAGE_LIMIT dengan waktu reset (ms); antrean dibuang", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    h.runner.send("pesan kedua");
    session.push(
      initMessage("S1"),
      rateLimitMessage("S1", "rejected", 1_800_000_000),
      resultMessage("S1", [uuid], { subtype: "error_during_execution" }),
    );
    await h.waitFor(isResult);
    expect(ofType(h.events, "error")).toEqual([
      { type: "error", code: "USAGE_LIMIT", message: USAGE_LIMIT_MESSAGE, resetsAt: 1_800_000_000_000 },
    ]);
    expect(ofType(h.events, "notice").at(-1)?.text).toContain("1 pesan yang antre dibatalkan");
    expect(session.sent).toHaveLength(1);
    expect(h.runner.status).toBe("idle");
  });

  test("rate_limit_event ditolak tetapi giliran berhasil (mis. overage) → bukan kegagalan", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(
      initMessage("S1"),
      rateLimitMessage("S1", "rejected", 1_800_000_000),
      resultMessage("S1", [uuid]),
    );
    await h.waitFor(isResult);
    expect(ofType(h.events, "error")).toEqual([]);
  });

  test("teks assistant berawalan USAGE_LIMIT_ERROR_PREFIXES → USAGE_LIMIT, teks asli ikut dicatat", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(
      initMessage("S1"),
      assistantMessage("S1", [text("You've hit your limit · resets 5pm")]),
      resultMessage("S1", [uuid]),
    );
    await h.waitFor(isResult);
    expect(ofType(h.events, "error")).toEqual([
      {
        type: "error",
        code: "USAGE_LIMIT",
        message: `${USAGE_LIMIT_MESSAGE} Claude Code: "You've hit your limit · resets 5pm"`,
      },
    ]);
    expect(ofType(h.events, "assistant")).toEqual([]);
  });

  test("sesi berakhir setelah rate_limit_event ditolak → USAGE_LIMIT, bukan SESSION_FAILED", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    session.push(initMessage("S1"), rateLimitMessage("S1", "rejected", 1_800_000_000_000));
    session.fail(new Error("proses keluar dengan kode 1"));
    await h.waitFor(isResult);
    expect(ofType(h.events, "error")).toEqual([
      { type: "error", code: "USAGE_LIMIT", message: USAGE_LIMIT_MESSAGE, resetsAt: 1_800_000_000_000 },
    ]);
  });

  test("Stop setelah rate_limit_event ditolak → giliran interrupted tanpa error", async () => {
    const h = harness();
    const { session, uuid } = await startTurn(h);
    session.push(initMessage("S1"), rateLimitMessage("S1", "rejected"));
    await h.waitFor((event) => event.type === "init");
    await h.runner.interrupt();
    session.push(resultMessage("S1", [uuid], { subtype: "error_during_execution" }));
    expect(await h.waitFor(isResult)).toMatchObject({ interrupted: true });
    expect(ofType(h.events, "error")).toEqual([]);
  });
});

describe("AssetRunner — izin dan pertanyaan", () => {
  const QUESTION = {
    questions: [
      {
        question: "Gaya peti?",
        header: "Gaya",
        options: [
          { label: "Kartun", description: "Proporsi besar" },
          { label: "Realistis", description: "Proporsi nyata" },
        ],
        multiSelect: false,
      },
    ],
  };

  const TWO_QUESTIONS = {
    questions: [
      ...QUESTION.questions,
      {
        question: "Bagian tambahan?",
        header: "Bagian",
        options: [
          { label: "Gembok", description: "Di depan" },
          { label: "Engsel", description: "Di belakang" },
          { label: "Pegangan", description: "Di samping" },
        ],
        multiSelect: true,
      },
    ],
  };

  async function openQuestion(h: Harness, input: Record<string, unknown>) {
    const { session } = await startTurn(h);
    const decision = canUseTool(session)("AskUserQuestion", input);
    const question = await h.waitFor((event) => event.type === "question");
    if (question.type !== "question") throw new Error("bukan pertanyaan");
    return { decision, questionId: question.questionId };
  }

  test("AskUserQuestion → event question; jawaban pemilik diteruskan ke Claude", async () => {
    const h = harness();
    const { decision, questionId } = await openQuestion(h, QUESTION);
    expect(h.runner.status).toBe("waiting_user");
    expect(h.runner.openQuestions).toEqual([questionId]);
    expect(h.runner.answer(questionId, { "Gaya peti?": { selected: ["Kartun"] } })).toEqual({ ok: true });
    expect(await decision).toEqual({
      behavior: "allow",
      updatedInput: { questions: QUESTION.questions, answers: { "Gaya peti?": "Kartun" } },
    });
    expect(h.runner.status).toBe("running");
    expect(ofType(h.events, "question_resolved")).toEqual([
      { type: "question_resolved", questionId, answers: { "Gaya peti?": "Kartun" }, cancelled: false },
    ]);
    expect(h.runner.answer(questionId, { "Gaya peti?": { selected: ["Kartun"] } })).toMatchObject({
      ok: false,
      code: "QUESTION_NOT_FOUND",
    });
  });

  test("pilih banyak + Lainnya: label diurutkan sesuai opsi, teks bebas di akhir", async () => {
    const h = harness();
    const { decision, questionId } = await openQuestion(h, TWO_QUESTIONS);
    const result = h.runner.answer(questionId, {
      "Gaya peti?": { selected: [], other: "  Semi-realistis  " },
      "Bagian tambahan?": { selected: ["Pegangan", "Gembok"], other: "paku keling" },
    });
    expect(result).toEqual({ ok: true });
    expect(await decision).toMatchObject({
      behavior: "allow",
      updatedInput: {
        answers: { "Gaya peti?": "Semi-realistis", "Bagian tambahan?": "Gembok, Pegangan, paku keling" },
      },
    });
  });

  test("teks Lainnya dengan surrogate tunggal diganti U+FFFD sebelum sampai ke Claude", async () => {
    const h = harness();
    const { decision, questionId } = await openQuestion(h, QUESTION);
    expect(h.runner.answer(questionId, { "Gaya peti?": { selected: [], other: "logo \uD83D" } })).toEqual({
      ok: true,
    });
    expect(await decision).toMatchObject({ updatedInput: { answers: { "Gaya peti?": "logo \uFFFD" } } });
  });

  test("jawaban tidak valid ditolak dan kartu tetap terbuka", async () => {
    const h = harness();
    const { questionId } = await openQuestion(h, TWO_QUESTIONS);
    const twoForSingle = h.runner.answer(questionId, {
      "Gaya peti?": { selected: ["Kartun", "Realistis"] },
      "Bagian tambahan?": { selected: ["Engsel"] },
    });
    expect(twoForSingle).toMatchObject({ ok: false, code: "INVALID_ANSWER" });
    const missing = h.runner.answer(questionId, { "Gaya peti?": { selected: ["Kartun"] } });
    expect(missing).toMatchObject({ ok: false, code: "INVALID_ANSWER" });
    expect(h.runner.openQuestions).toEqual([questionId]);
    expect(h.runner.status).toBe("waiting_user");
  });

  test("Stop: interrupt dulu, baru kartu pertanyaan dibatalkan", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    const order: string[] = [];
    session.receipt = () => {
      order.push(`interrupt:${h.runner.openQuestions.length}`);
      return { stillQueued: [] };
    };
    const decision = canUseTool(session)("AskUserQuestion", QUESTION);
    await h.waitFor((event) => event.type === "question");
    await h.runner.interrupt();
    expect(order).toEqual(["interrupt:1"]);
    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(ofType(h.events, "question_resolved").at(-1)).toMatchObject({ cancelled: true });
  });

  test("permintaan dicabut CLI (signal) → kartu ditutup", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    const controller = new AbortController();
    const decision = canUseTool(session)("AskUserQuestion", QUESTION, controller.signal);
    await h.waitFor((event) => event.type === "question");
    controller.abort();
    expect(await decision).toMatchObject({ behavior: "deny" });
    expect(h.runner.openQuestions).toEqual([]);
  });

  test("pertanyaan berformat salah ditolak", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    expect(await canUseTool(session)("AskUserQuestion", { questions: "x" })).toMatchObject({
      behavior: "deny",
    });
  });

  test("tool lain: keputusan pagar menolak secara bawaan", async () => {
    const h = harness();
    const { session } = await startTurn(h);
    expect(await canUseTool(session)("Bash", { command: "ls" })).toEqual({
      behavior: "deny",
      message: "Ditolak pagar: tidak diizinkan",
    });
  });

  test("tool lain: lolos pagar → diizinkan dengan input yang sama", async () => {
    const h = harness({}, { allow: true });
    const { session } = await startTurn(h);
    expect(await canUseTool(session)("Read", { file_path: "/x" })).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "/x" },
    });
  });
});
