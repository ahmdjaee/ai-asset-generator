import { describe, expect, test } from "bun:test";
import {
  ASSET_STATUSES,
  type AssetStatus,
  type LastError,
  RUN_STATES,
  type RunState,
} from "../../shared/asset.ts";
import { BUILD_CAPS } from "../../shared/limits.ts";
import {
  type AssetAction,
  type AssetState,
  buildsLeft,
  INITIAL_STATE,
  type RejectCode,
  transition,
} from "./status.ts";

const BRIEF = {
  summary: "Peti kayu",
  category: "properti",
  style: "stylized",
  dimensionsM: { width: 0.6, depth: 0.4, height: 0.45 },
};
const ERROR: LastError = { code: "TURN_FAILED", message: "gagal", at: 1000 };

function state(patch: Partial<AssetState> = {}): AssetState {
  return { ...INITIAL_STATE, brief: BRIEF, currentVersion: 2, ...patch };
}

/** Hasil yang diharapkan: status baru, atau `!KODE` bila ditolak. */
type Expect<T extends string> = T | `!${RejectCode}`;

function outcome<T extends string>(
  result: ReturnType<typeof transition>,
  pick: (s: AssetState) => T,
): Expect<T> {
  return result.ok ? pick(result.state) : `!${result.code}`;
}

const same = (expected: Expect<AssetStatus>): Record<AssetStatus, Expect<AssetStatus>> =>
  Object.fromEntries(ASSET_STATUSES.map((status) => [status, expected])) as Record<
    AssetStatus,
    Expect<AssetStatus>
  >;
const unchanged = (): Record<AssetStatus, Expect<AssetStatus>> =>
  Object.fromEntries(ASSET_STATUSES.map((status) => [status, status])) as Record<
    AssetStatus,
    Expect<AssetStatus>
  >;

const ACTIONS = {
  record_brief: { type: "record_brief", brief: BRIEF },
  "build_start base": { type: "build_start", stage: "base" },
  "build_start textured": { type: "build_start", stage: "textured" },
  build_done: { type: "build_done", version: 3 },
  "submit base": { type: "submit", version: 3, stage: "base" },
  "submit textured": { type: "submit", version: 3, stage: "textured" },
  message: { type: "message", text: "lanjut" },
  revise: { type: "revise", text: "tutupnya lebih tebal" },
  approve: { type: "approve" },
  finish: { type: "finish" },
  change_shape: { type: "change_shape", text: "kakinya lebih panjang" },
  stop: { type: "stop" },
  retry: { type: "retry" },
  resume: { type: "resume" },
  turn_started: { type: "turn_started" },
  question_opened: { type: "question_opened" },
  question_closed: { type: "question_closed" },
  "turn_ended success": { type: "turn_ended", outcome: "success" },
  "turn_ended interrupted": { type: "turn_ended", outcome: "interrupted" },
  "turn_ended error": { type: "turn_ended", outcome: "error", error: ERROR },
  failed: { type: "failed", error: ERROR },
  interrupted: { type: "interrupted" },
} satisfies Record<string, AssetAction>;
type ActionName = keyof typeof ACTIONS;

/**
 * Tabel lengkap status × aksi (Lampiran C). Aksi Claude diuji saat `running`, aksi pemilik saat `idle`, aksi runner
 * pada `runState` yang membuatnya berlaku (tabel kedua menguji `runState` secara lengkap).
 */
const STATUS_TABLE: Record<
  ActionName,
  { runState: RunState; expect: Record<AssetStatus, Expect<AssetStatus>> }
> = {
  record_brief: {
    runState: "running",
    expect: {
      BRIEFING: "BASE_WORKING",
      BASE_WORKING: "BASE_WORKING",
      BASE_REVIEW: "!IN_REVIEW",
      TEXTURE_WORKING: "!BASE_LOCKED",
      TEXTURE_REVIEW: "!BASE_LOCKED",
      DONE: "!BASE_LOCKED",
    },
  },
  "build_start base": {
    runState: "running",
    expect: {
      BRIEFING: "!BRIEF_REQUIRED",
      BASE_WORKING: "BASE_WORKING",
      BASE_REVIEW: "!IN_REVIEW",
      TEXTURE_WORKING: "!BASE_LOCKED",
      TEXTURE_REVIEW: "!BASE_LOCKED",
      DONE: "!BASE_LOCKED",
    },
  },
  "build_start textured": {
    runState: "running",
    expect: {
      BRIEFING: "!BASE_NOT_APPROVED",
      BASE_WORKING: "!BASE_NOT_APPROVED",
      BASE_REVIEW: "!BASE_NOT_APPROVED",
      TEXTURE_WORKING: "TEXTURE_WORKING",
      TEXTURE_REVIEW: "!IN_REVIEW",
      DONE: "!ASSET_DONE",
    },
  },
  build_done: { runState: "running", expect: unchanged() },
  "submit base": {
    runState: "running",
    expect: {
      BRIEFING: "!BRIEF_REQUIRED",
      BASE_WORKING: "BASE_REVIEW",
      BASE_REVIEW: "!IN_REVIEW",
      TEXTURE_WORKING: "!WRONG_STAGE",
      TEXTURE_REVIEW: "!IN_REVIEW",
      DONE: "!ASSET_DONE",
    },
  },
  "submit textured": {
    runState: "running",
    expect: {
      BRIEFING: "!BRIEF_REQUIRED",
      BASE_WORKING: "!WRONG_STAGE",
      BASE_REVIEW: "!IN_REVIEW",
      TEXTURE_WORKING: "TEXTURE_REVIEW",
      TEXTURE_REVIEW: "!IN_REVIEW",
      DONE: "!ASSET_DONE",
    },
  },
  message: {
    runState: "idle",
    expect: {
      BRIEFING: "BRIEFING",
      BASE_WORKING: "BASE_WORKING",
      BASE_REVIEW: "BASE_WORKING",
      TEXTURE_WORKING: "TEXTURE_WORKING",
      TEXTURE_REVIEW: "TEXTURE_WORKING",
      DONE: "TEXTURE_WORKING",
    },
  },
  revise: {
    runState: "idle",
    expect: {
      ...same("!NOT_IN_REVIEW"),
      BASE_REVIEW: "BASE_WORKING",
      TEXTURE_REVIEW: "TEXTURE_WORKING",
    },
  },
  approve: { runState: "idle", expect: { ...same("!NOT_IN_REVIEW"), BASE_REVIEW: "TEXTURE_WORKING" } },
  finish: { runState: "idle", expect: { ...same("!NOT_IN_REVIEW"), TEXTURE_REVIEW: "DONE" } },
  change_shape: {
    runState: "idle",
    expect: { ...same("!SHAPE_CHANGE_NOT_ALLOWED"), TEXTURE_REVIEW: "BASE_WORKING", DONE: "BASE_WORKING" },
  },
  stop: { runState: "running", expect: unchanged() },
  retry: { runState: "failed", expect: unchanged() },
  resume: { runState: "interrupted", expect: unchanged() },
  turn_started: { runState: "idle", expect: unchanged() },
  question_opened: { runState: "running", expect: unchanged() },
  question_closed: { runState: "waiting_user", expect: unchanged() },
  "turn_ended success": { runState: "running", expect: unchanged() },
  "turn_ended interrupted": { runState: "running", expect: unchanged() },
  "turn_ended error": { runState: "running", expect: unchanged() },
  failed: { runState: "running", expect: unchanged() },
  interrupted: { runState: "running", expect: unchanged() },
};

/** Tabel lengkap `runState` × aksi (status BASE_REVIEW untuk aksi pemilik yang butuh review). */
const RUN_TABLE: Partial<Record<ActionName, Record<RunState, Expect<RunState>>>> = {
  message: {
    idle: "running",
    running: "running",
    waiting_user: "!QUESTION_OPEN",
    failed: "running",
    interrupted: "running",
  },
  revise: {
    idle: "running",
    running: "running",
    waiting_user: "!QUESTION_OPEN",
    failed: "running",
    interrupted: "running",
  },
  approve: {
    idle: "running",
    running: "running",
    waiting_user: "!QUESTION_OPEN",
    failed: "running",
    interrupted: "running",
  },
  stop: { idle: "idle", running: "idle", waiting_user: "idle", failed: "failed", interrupted: "idle" },
  retry: {
    idle: "!NOT_FAILED",
    running: "!NOT_FAILED",
    waiting_user: "!NOT_FAILED",
    failed: "running",
    interrupted: "!NOT_FAILED",
  },
  resume: {
    idle: "!NOT_INTERRUPTED",
    running: "!NOT_INTERRUPTED",
    waiting_user: "!NOT_INTERRUPTED",
    failed: "!NOT_INTERRUPTED",
    interrupted: "running",
  },
  turn_started: {
    idle: "running",
    running: "running",
    waiting_user: "running",
    failed: "running",
    interrupted: "running",
  },
  question_opened: {
    idle: "idle",
    running: "waiting_user",
    waiting_user: "waiting_user",
    failed: "failed",
    interrupted: "interrupted",
  },
  question_closed: {
    idle: "idle",
    running: "running",
    waiting_user: "running",
    failed: "failed",
    interrupted: "interrupted",
  },
  "turn_ended success": {
    idle: "idle",
    running: "idle",
    waiting_user: "idle",
    failed: "failed",
    interrupted: "interrupted",
  },
  "turn_ended interrupted": {
    idle: "idle",
    running: "idle",
    waiting_user: "idle",
    failed: "failed",
    interrupted: "interrupted",
  },
  "turn_ended error": {
    idle: "failed",
    running: "failed",
    waiting_user: "failed",
    failed: "failed",
    interrupted: "interrupted",
  },
  failed: {
    idle: "failed",
    running: "failed",
    waiting_user: "failed",
    failed: "failed",
    interrupted: "failed",
  },
  interrupted: {
    idle: "idle",
    running: "interrupted",
    waiting_user: "interrupted",
    failed: "failed",
    interrupted: "interrupted",
  },
};

describe("transition: tabel status × aksi", () => {
  for (const [name, row] of Object.entries(STATUS_TABLE)) {
    test(name, () => {
      const action = ACTIONS[name as ActionName];
      const actual = Object.fromEntries(
        ASSET_STATUSES.map((status) => [
          status,
          outcome(transition(state({ status, runState: row.runState }), action), (s) => s.status),
        ]),
      );
      expect(actual).toEqual(row.expect);
    });
  }

  test("tabel mencakup semua aksi", () => {
    expect(Object.keys(STATUS_TABLE).sort()).toEqual(Object.keys(ACTIONS).sort());
  });
});

describe("transition: tabel runState × aksi", () => {
  for (const [name, row] of Object.entries(RUN_TABLE)) {
    test(name, () => {
      const action = ACTIONS[name as ActionName];
      const actual = Object.fromEntries(
        RUN_STATES.map((runState) => [
          runState,
          outcome(
            transition(
              state({ status: "BASE_REVIEW", runState, lastError: runState === "failed" ? ERROR : null }),
              action,
            ),
            (s) => s.runState,
          ),
        ]),
      );
      expect(actual).toEqual(row);
    });
  }

  test("aksi Claude tidak mengubah runState", () => {
    for (const name of ["record_brief", "build_start base", "build_done", "submit base"] as const) {
      for (const runState of RUN_STATES) {
        const result = transition(state({ status: "BASE_WORKING", runState }), ACTIONS[name]);
        expect(result.ok && result.state.runState).toBe(runState);
      }
    }
  });
});

describe("transition: lampiran pesan pemilik", () => {
  const image = { id: "g1", kind: "image" as const, name: "logo.png", file: "g1.png", decal: "g1-decal.png" };

  test("message/revise membawa lampiran ke efek deliver; daftar kosong tidak ikut", () => {
    const message = transition(state({ status: "BRIEFING" }), {
      type: "message",
      text: "x",
      attachments: [image],
    });
    expect(message.ok && message.effects).toEqual([
      { type: "deliver", message: { kind: "owner", text: "x", attachments: [image] } },
    ]);
    const revise = transition(state({ status: "BASE_REVIEW" }), {
      type: "revise",
      text: "y",
      attachments: [],
    });
    expect(revise.ok && revise.effects).toEqual([{ type: "deliver", message: { kind: "owner", text: "y" } }]);
  });
});

describe("transition: detail", () => {
  test("brief disimpan; BRIEFING → BASE_WORKING", () => {
    const result = transition(state({ brief: null }), ACTIONS.record_brief);
    expect(result).toMatchObject({ ok: true, state: { status: "BASE_WORKING", brief: BRIEF }, effects: [] });
  });

  test("turn_started (pesan antre terkirim setelah giliran gagal) membersihkan error lama", () => {
    const error = { code: "TURN_FAILED" as const, message: "gagal", at: 1 };
    const result = transition(state({ runState: "failed", lastError: error }), ACTIONS.turn_started);
    expect(result).toMatchObject({ ok: true, state: { runState: "running", lastError: null } });
  });

  test("batas build: 8 bentuk dasar, 4 aset final; turn_started mereset", () => {
    let current = state({ status: "BASE_WORKING", runState: "running" });
    for (let i = 0; i < BUILD_CAPS.base; i++) {
      const result = transition(current, ACTIONS["build_start base"]);
      if (!result.ok) throw new Error(result.code);
      current = result.state;
    }
    expect(buildsLeft(current)).toBe(0);
    const ninth = transition(current, ACTIONS["build_start base"]);
    expect(ninth).toMatchObject({ ok: false, code: "BUILD_CAP_REACHED" });
    expect(ninth.ok ? "" : ninth.message).toContain("Batas 8 build");

    const reset = transition(current, ACTIONS.turn_started);
    expect(reset.ok && reset.state.buildsThisMessage).toBe(0);

    const textured = state({
      status: "TEXTURE_WORKING",
      runState: "running",
      buildsThisMessage: BUILD_CAPS.textured,
    });
    expect(buildsLeft(textured)).toBe(0);
    expect(transition(textured, ACTIONS["build_start textured"])).toMatchObject({
      ok: false,
      code: "BUILD_CAP_REACHED",
    });
  });

  test("build_done hanya mengganti versi saat sedang bekerja", () => {
    const working = transition(state({ status: "BASE_WORKING", currentVersion: 1 }), ACTIONS.build_done);
    expect(working.ok && working.state.currentVersion).toBe(3);
    const review = transition(state({ status: "BASE_REVIEW", currentVersion: 1 }), ACTIONS.build_done);
    expect(review.ok && review.state.currentVersion).toBe(1);
  });

  test("submit menetapkan versi yang direview", () => {
    const result = transition(state({ status: "BASE_WORKING", currentVersion: 5 }), ACTIONS["submit base"]);
    expect(result).toMatchObject({ ok: true, state: { status: "BASE_REVIEW", currentVersion: 3 } });
  });

  test("setujui: versi yang direview jadi dasar tekstur, jatah build direset, Claude diberi tahu", () => {
    const result = transition(state({ status: "BASE_REVIEW", currentVersion: 4, buildsThisMessage: 3 }), {
      type: "approve",
      note: "warna kayu gelap",
    });
    expect(result).toEqual({
      ok: true,
      state: state({
        status: "TEXTURE_WORKING",
        runState: "running",
        currentVersion: 4,
        approvedBaseVersion: 4,
        buildsThisMessage: 0,
      }),
      effects: [{ type: "deliver", message: { kind: "approved", version: 4, note: "warna kayu gelap" } }],
    });
  });

  test("setujui tanpa versi → NO_VERSION", () => {
    expect(transition(state({ status: "BASE_REVIEW", currentVersion: null }), ACTIONS.approve)).toMatchObject(
      {
        ok: false,
        code: "NO_VERSION",
      },
    );
  });

  test("ubah bentuk: persetujuan bentuk dasar dicabut", () => {
    const result = transition(
      state({ status: "DONE", approvedBaseVersion: 2, currentVersion: 5 }),
      ACTIONS.change_shape,
    );
    expect(result).toMatchObject({
      ok: true,
      state: { status: "BASE_WORKING", approvedBaseVersion: null, runState: "running", currentVersion: 5 },
      effects: [{ type: "deliver", message: { kind: "change_shape", text: "kakinya lebih panjang" } }],
    });
  });

  test("pesan pemilik: error terakhir dibersihkan, pesan dikirim ke Claude", () => {
    const result = transition(
      state({ status: "TEXTURE_REVIEW", runState: "failed", lastError: ERROR }),
      ACTIONS.message,
    );
    expect(result).toEqual({
      ok: true,
      state: state({ status: "TEXTURE_WORKING", runState: "running", lastError: null }),
      effects: [{ type: "deliver", message: { kind: "owner", text: "lanjut" } }],
    });
  });

  test("efek: stop saat berjalan = interrupt; coba lagi dan lanjutkan mengirim pesan", () => {
    const stop = transition(state({ runState: "waiting_user" }), ACTIONS.stop);
    expect(stop.ok && stop.effects).toEqual([{ type: "interrupt" }]);
    const idleStop = transition(state({ runState: "idle" }), ACTIONS.stop);
    expect(idleStop.ok && idleStop.effects).toEqual([]);
    const retry = transition(state({ runState: "failed", lastError: ERROR }), ACTIONS.retry);
    expect(retry).toMatchObject({
      ok: true,
      state: { runState: "running", lastError: null },
      effects: [{ type: "deliver", message: { kind: "retry" } }],
    });
    const resume = transition(state({ runState: "interrupted" }), ACTIONS.resume);
    expect(resume.ok && resume.effects).toEqual([{ type: "deliver", message: { kind: "resume" } }]);
  });

  test("gagal menyimpan lastError; giliran berikutnya yang sukses tidak menghapusnya", () => {
    const failed = transition(state({ runState: "running" }), ACTIONS.failed);
    if (!failed.ok) throw new Error(failed.code);
    expect(failed.state.lastError).toEqual(ERROR);
    const ended = transition(failed.state, ACTIONS["turn_ended success"]);
    expect(ended.ok && ended.state).toMatchObject({ runState: "failed", lastError: ERROR });
  });

  test("aksi yang ditolak membawa pesan", () => {
    const result = transition(state({ status: "BASE_REVIEW" }), ACTIONS["build_start base"]);
    expect(result).toMatchObject({ ok: false, code: "IN_REVIEW" });
    expect(result.ok ? "" : result.message).toContain("review");
  });
});
