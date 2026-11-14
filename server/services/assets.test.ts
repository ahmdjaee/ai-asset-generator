/**
 * Skenario FakeQuery ujung-ke-ujung (PLAN Tahap 5): service aset + sesi Claude asli (runner, pagar, tool `forge`
 * lewat MCP) dengan agent berskenario dan builder fixture. Tanpa Docker, tanpa kuota, tanpa sleep.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { StoredEvent } from "../../shared/asset-events.ts";
import { THUMB_FILE, TURNTABLE_FILE } from "../../shared/derived-files.ts";
import { ASSET_NAME_MAX_CHARS, BUILD_CAPS } from "../../shared/limits.ts";
import { createAssetSession } from "../agent/asset-session.ts";
import { FIXTURE_PAIR, FixtureAssetBuilder } from "../agent/forge/fixture-builder.ts";
import { createTestLibrary } from "../agent/forge/test-builder.ts";
import { AgentPool } from "../agent/pool.ts";
import { type Scenario, ScenarioAgentPort } from "../agent/scenario-port.ts";
import { defaultScenario, PARTS_QUESTION, STYLE_QUESTION } from "../agent/scenarios.ts";
import { type DatabaseHandle, openDatabase } from "../db/client.ts";
import { type AssetRecord, getAsset, insertAsset, saveAssetState } from "../db/repos/assets.ts";
import { listAttachments } from "../db/repos/attachments.ts";
import { listEvents } from "../db/repos/events.ts";
import { getJob, insertJob, listJobs } from "../db/repos/jobs.ts";
import { getQuestion, insertQuestion } from "../db/repos/questions.ts";
import { insertVersion, listVersionRecords } from "../db/repos/versions.ts";
import type { MaterialLibrary } from "../library/materials.ts";
import { AssetQueries } from "./asset-queries.ts";
import { AssetService, COPY_SUFFIX, RECOVERY_NOTICE } from "./assets.ts";
import { EventBus, type GlobalEvent } from "./bus.ts";
import { ServiceError } from "./errors.ts";
import { fakeClock } from "./test-support.ts";
import { listVersions } from "./versions.ts";

const KNOWLEDGE_DIR = join(import.meta.dir, "../../runtime/knowledge");
const SLOW = 30_000;

let dataDir = "";
let library: MaterialLibrary;
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "aag-assets-"));
  library = await createTestLibrary(join(dataDir, "pustaka"));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3 }).catch(async () => {
    // Folder versi read-only: buka dulu supaya bisa dihapus.
    await Bun.$`chmod -R u+w ${dataDir}`.quiet();
    await rm(dataDir, { recursive: true, force: true });
  });
});

type Harness = {
  service: AssetService;
  handle: DatabaseHandle;
  bus: EventBus;
  port: ScenarioAgentPort;
  builder: FixtureAssetBuilder;
  errors: unknown[];
  clock: ReturnType<typeof fakeClock>;
  /** Versi baru yang diumumkan lewat `onVersionCreated` (`[assetId, versi]`). */
  created: Array<[string, number]>;
};

function harness(
  options: {
    scenario?: Scenario;
    builder?: FixtureAssetBuilder;
    handle?: DatabaseHandle;
    ids?: string[];
    /** Factory sesi gagal sebanyak ini dulu (sesi Claude tidak bisa disiapkan). */
    failAgents?: number;
    beforeRemoveDir?: (assetId: string) => Promise<void>;
  } = {},
): Harness {
  const handle = options.handle ?? openDatabase(":memory:");
  const bus = new EventBus({
    onError: (error) => {
      throw error;
    },
  });
  const clock = fakeClock();
  const port = new ScenarioAgentPort(options.scenario ?? defaultScenario({ now: clock }));
  const builder = options.builder ?? new FixtureAssetBuilder(FIXTURE_PAIR);
  const pool = new AgentPool();
  const errors: unknown[] = [];
  const created: Array<[string, number]> = [];
  const ids = options.ids ?? ["aset-1", "aset-2", "aset-3"];
  let counter = 0;
  let failAgents = options.failAgents ?? 0;
  const service = new AssetService({
    db: handle.db,
    bus,
    now: clock,
    dataDir,
    newId: () => ids[counter++] ?? `id-${counter}`,
    createAgent: (input) =>
      failAgents-- > 0
        ? Promise.reject(new Error("EACCES: folder kerja tidak bisa dibuat"))
        : createAssetSession({
            asset: input.asset,
            store: input.store,
            port,
            builder,
            library,
            emit: input.emit,
            onError: input.onError,
            knowledgeDir: KNOWLEDGE_DIR,
            pool,
            ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          }),
    onError: (error) => errors.push(error),
    onVersionCreated: (assetId, version) => created.push([assetId, version]),
    ...(options.beforeRemoveDir === undefined ? {} : { beforeRemoveDir: options.beforeRemoveDir }),
  });
  cleanups.push(async () => {
    await service.close();
    if (options.handle === undefined) handle.close();
  });
  return { service, handle, bus, port, builder, errors, clock, created };
}

/** Menunggu sampai aset memenuhi kondisi (dicek setiap ada event untuk aset itu). */
function until(
  h: Harness,
  assetId: string,
  predicate: (record: AssetRecord) => boolean,
): Promise<AssetRecord> {
  return new Promise((resolve) => {
    let done = false;
    const unsubscribe = h.bus.subscribe(assetId, () => check());
    function check() {
      const record = getAsset(h.handle.db, assetId, { includeDeleted: true });
      if (done || record === null || !predicate(record)) return;
      done = true;
      unsubscribe();
      resolve(record);
    }
    check();
  });
}

const idleIn = (status: AssetRecord["state"]["status"]) => (record: AssetRecord) =>
  record.state.status === status && record.state.runState === "idle";

/** Menunggu event thread tertentu (event live ikut). */
function nextEvent(
  h: Harness,
  assetId: string,
  predicate: (event: StoredEvent) => boolean,
): Promise<StoredEvent> {
  return new Promise((resolve) => {
    const unsubscribe = h.bus.subscribe(assetId, (event) => {
      if (!predicate(event)) return;
      unsubscribe();
      resolve(event);
    });
  });
}

function thread(h: Harness, assetId: string) {
  return listEvents(h.handle.db, assetId).events.map((stored) => stored.event);
}

function types(h: Harness, assetId: string, wanted: readonly string[]): string[] {
  return thread(h, assetId)
    .map((event) => event.type)
    .filter((type) => wanted.includes(type));
}

async function rejected(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ServiceError)) throw new Error(`bukan ServiceError: ${String(error)}`);
  return error.code;
}

describe("AssetService — skenario FakeQuery", () => {
  test(
    "jalur bahagia: prompt → bentuk dasar → setujui → tekstur → selesai",
    async () => {
      const h = harness();
      const created = await h.service.create({
        prompt: "Peti kayu kartun dengan sabuk logam",
        tierId: "sedang",
      });
      expect(created).toMatchObject({ id: "aset-1", name: "Peti kayu kartun dengan sabuk logam" });

      const review = await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(review.state).toMatchObject({ currentVersion: 1, approvedBaseVersion: null, lastError: null });
      expect(review.sessionId).not.toBeNull();
      expect(review.state.brief?.summary).toBe("Peti kayu kartun dengan sabuk logam");

      await h.service.approve("aset-1", "kayunya agak gelap");
      const final = await until(h, "aset-1", idleIn("TEXTURE_REVIEW"));
      expect(final.state).toMatchObject({ currentVersion: 2, approvedBaseVersion: 1 });
      // Persetujuan dikirim sebagai pesan sistem dalam sesi yang sama (resume tidak perlu: proses masih hidup).
      const approved = thread(h, "aset-1").find(
        (event) => event.type === "user" && event.origin === "approved",
      );
      expect(approved?.type === "user" ? approved.text : "").toContain("Catatan pemilik: kayunya agak gelap");
      expect(h.port.sessions).toHaveLength(1);

      await h.service.finish("aset-1");
      expect(h.service.get("aset-1").state.status).toBe("DONE");

      expect(listVersionRecords(h.handle.db, "aset-1").map((version) => [version.n, version.stage])).toEqual([
        [1, "base"],
        [2, "textured"],
      ]);
      // Ringkasan build ikut tercatat di manifest versi (dibaca Studio).
      for (const version of listVersionRecords(h.handle.db, "aset-1")) {
        expect(version.validation).toEqual({ errors: 0, warnings: expect.any(Number) });
        expect(version.optimize?.steps.length).toBeGreaterThan(0);
        // Pasangan fixture membawa `.blend` (preset ekspor Sumber), seperti output harness sungguhan.
        expect(version.files.map((file) => file.name)).toContain("scene.blend");
        // Thumbnail dan turntable Gudang disalin ke `derived/` seperti setelah build asli.
        for (const name of [THUMB_FILE, TURNTABLE_FILE]) {
          const path = join(dataDir, "assets", "aset-1", "derived", `v${version.n}`, name);
          expect((await stat(path)).size).toBeGreaterThan(1000);
        }
      }
      expect(h.created).toEqual([
        ["aset-1", 1],
        ["aset-1", 2],
      ]);
      expect(listJobs(h.handle.db, "aset-1").map((job) => [job.kind, job.status])).toEqual([
        ["build_base", "succeeded"],
        ["build_textured", "succeeded"],
      ]);
      expect(
        types(h, "aset-1", ["user", "brief", "build_started", "build_finished", "submitted", "action"]),
      ).toEqual([
        "user",
        "brief",
        "build_started",
        "build_finished",
        "submitted",
        "action",
        "user",
        "build_started",
        "build_finished",
        "submitted",
        "action",
      ]);
      const actions = thread(h, "aset-1").filter((event) => event.type === "action");
      expect(actions).toEqual([
        { type: "action", action: "approve", version: 1 },
        { type: "action", action: "finish", version: 2 },
      ]);
      // Delta hanya live: tidak tersimpan di thread.
      expect(types(h, "aset-1", ["delta", "build_progress"])).toEqual([]);
      expect(h.errors).toEqual([]);
    },
    SLOW,
  );

  test(
    "loop revisi: pesan saat review membuka bentuk dasar lagi, jatah build direset, versi baru",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti kayu", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      await h.service.revise("aset-1", "Tutupnya lebih melengkung.");
      const second = await until(
        h,
        "aset-1",
        (record) => idleIn("BASE_REVIEW")(record) && record.state.currentVersion === 2,
      );
      expect(second.state.buildsThisMessage).toBe(1);
      await h.service.sendMessage("aset-1", "Sabuknya lebih lebar.");
      await until(
        h,
        "aset-1",
        (record) => idleIn("BASE_REVIEW")(record) && record.state.currentVersion === 3,
      );
      expect(listVersionRecords(h.handle.db, "aset-1")).toHaveLength(3);
      // Brief dicatat sekali saja (revisi tidak mengulang brief).
      expect(types(h, "aset-1", ["brief"])).toEqual(["brief"]);
      expect(await rejected(h.service.revise("aset-1", ""))).toBe("EMPTY_MESSAGE");
    },
    SLOW,
  );

  test(
    `build ke-${BUILD_CAPS.base + 1} dalam satu pesan ditolak (BUILD_CAP_REACHED)`,
    async () => {
      const results: unknown[] = [];
      const scenario: Scenario = async (_turn, claude) => {
        await claude.forge("record_brief", {
          summary: "Peti",
          category: "properti",
          style: "kartun",
          dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
        });
        await claude.write(join(claude.cwd, "base.py"), "from assetkit import scene\nscene.reset()\n");
        for (let i = 0; i <= BUILD_CAPS.base; i++) results.push((await claude.forge("build_base_mesh")).body);
      };
      const failures = Array.from({ length: BUILD_CAPS.base }, () => ({
        kind: "fail" as const,
        code: "SCRIPT_ERROR" as const,
        message: "Skrip gagal (kode 1)",
      }));
      const h = harness({ scenario, builder: new FixtureAssetBuilder({ script: failures }) });
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_WORKING"));
      expect(results.at(-1)).toMatchObject({ ok: false, code: "BUILD_CAP_REACHED", buildsLeft: 0 });
      expect(results.slice(0, -1).every((body) => JSON.stringify(body).includes("SCRIPT_ERROR"))).toBe(true);
      expect(h.builder.requests).toHaveLength(BUILD_CAPS.base);
      expect(listJobs(h.handle.db, "aset-1").map((job) => job.status)).toEqual(
        Array.from({ length: BUILD_CAPS.base }, () => "failed"),
      );
      // Pesan berikutnya membuka jatah baru.
      expect(h.service.get("aset-1").state.buildsThisMessage).toBe(BUILD_CAPS.base);
    },
    SLOW,
  );

  test(
    "build bertekstur sebelum bentuk dasar disetujui ditolak (BASE_NOT_APPROVED), tanpa job",
    async () => {
      let reply: unknown;
      const scenario: Scenario = async (_turn, claude) => {
        await claude.write(join(claude.cwd, "material.py"), "from assetkit import scene\nscene.run_base()\n");
        reply = (await claude.forge("build_textured_asset")).body;
      };
      const h = harness({ scenario });
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BRIEFING"));
      expect(reply).toMatchObject({ ok: false, code: "BASE_NOT_APPROVED" });
      expect(listJobs(h.handle.db, "aset-1")).toEqual([]);
      expect(h.builder.requests).toEqual([]);
    },
    SLOW,
  );

  test(
    "bentuk menyimpang dari bentuk dasar yang disetujui ditolak (SHAPE_DRIFT), versi tidak dibuat",
    async () => {
      const builder = new FixtureAssetBuilder({ ...FIXTURE_PAIR });
      const h = harness({ builder });
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      builder.script.push({ kind: "fixture", name: "kursi" });
      await h.service.approve("aset-1");
      await until(h, "aset-1", idleIn("TEXTURE_WORKING"));
      const said = thread(h, "aset-1").filter((event) => event.type === "assistant");
      expect(said.at(-1)).toMatchObject({ text: expect.stringContaining("SHAPE_DRIFT") });
      expect(await listVersions(h.service.assetDir("aset-1"))).toEqual([1]);
      expect(listJobs(h.handle.db, "aset-1").at(-1)?.status).toBe("failed");
    },
    SLOW,
  );

  test(
    "Stop di tengah build: interrupt + build dibatalkan, job cancelled, aset idle",
    async () => {
      const builder = new FixtureAssetBuilder({ ...FIXTURE_PAIR, script: [{ kind: "hang" }] });
      const h = harness({ builder });
      const started = nextEvent(h, "aset-1", (stored) => stored.event.type === "build_started");
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await started;
      await h.service.stop("aset-1");
      const stopped = await until(h, "aset-1", (record) => record.state.runState === "idle");
      expect(stopped.state.status).toBe("BASE_WORKING");
      await until(h, "aset-1", () =>
        thread(h, "aset-1").some((event) => event.type === "result" && event.interrupted),
      );
      expect(listJobs(h.handle.db, "aset-1").map((job) => job.status)).toEqual(["cancelled"]);
      expect(builder.requests[0]?.signal.aborted).toBe(true);
      expect(thread(h, "aset-1").filter((event) => event.type === "action")).toEqual([
        { type: "action", action: "stop" },
      ]);
      // Setelah Stop, pemilik bisa langsung mengirim pesan lagi.
      await h.service.sendMessage("aset-1", "Lanjutkan saja.");
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
    },
    SLOW,
  );

  test(
    "restart di tengah job: job dibatalkan, aset interrupted; Lanjutkan me-resume sesi lama",
    async () => {
      const handle = openDatabase(":memory:");
      cleanups.push(() => handle.close());
      const first = harness({
        handle,
        builder: new FixtureAssetBuilder({ ...FIXTURE_PAIR, script: [{ kind: "hang" }] }),
      });
      const started = nextEvent(first, "aset-1", (stored) => stored.event.type === "build_started");
      await first.service.create({ prompt: "Peti kayu", tierId: "sedang" });
      const build = await started;
      const sessionId = first.service.get("aset-1").sessionId;
      expect(sessionId).not.toBeNull();

      // Server "mati": proses lama ditinggalkan tanpa membereskan database.
      const second = harness({ handle });
      second.service.recover();
      const recovered = second.service.get("aset-1");
      expect(recovered.state.runState).toBe("interrupted");
      const jobId = build.event.type === "build_started" ? build.event.jobId : "";
      expect(getJob(handle.db, jobId)?.status).toBe("cancelled");
      expect(thread(second, "aset-1").slice(-3)).toMatchObject([
        { type: "build_finished", jobId, ok: false, code: "CANCELLED" },
        { type: "notice", text: RECOVERY_NOTICE },
        { type: "state", runState: "interrupted" },
      ]);

      await second.service.resume("aset-1");
      const resumed = await until(second, "aset-1", idleIn("BASE_REVIEW"));
      expect(second.port.current.options.resume).toBe(sessionId ?? "");
      expect(resumed.state.currentVersion).toBe(1);
      const resume = thread(second, "aset-1").find(
        (event) => event.type === "user" && event.origin === "resume",
      );
      expect(resume?.type === "user" ? resume.text : "").toContain("Permintaan terakhir");
      expect(resume?.type === "user" ? resume.text : "").toEndWith("Peti kayu");
      expect(await rejected(second.service.resume("aset-1"))).toBe("NOT_INTERRUPTED");
    },
    SLOW,
  );

  test(
    "batas pemakaian: runState failed + USAGE_LIMIT + waktu reset; Coba lagi melanjutkan",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti kayu [batas]", tierId: "sedang" });
      const failed = await until(h, "aset-1", (record) => record.state.runState === "failed");
      expect(failed.state.lastError).toMatchObject({
        code: "USAGE_LIMIT",
        // Jam palsu + 1 jam, dibulatkan ke detik seperti SDK, lalu dinormalkan ke ms.
        resetsAt: Math.floor((h.clock() + 3_600_000) / 1000) * 1000,
      });
      // Giliran yang gagal tetap tercatat; status tidak berubah menjadi idle oleh result.
      await until(h, "aset-1", () => thread(h, "aset-1").some((event) => event.type === "result"));
      expect(h.service.get("aset-1").state.runState).toBe("failed");
      expect(await rejected(h.service.resume("aset-1"))).toBe("NOT_INTERRUPTED");

      await h.service.retry("aset-1");
      const done = await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(done.state.lastError).toBeNull();
      const retry = thread(h, "aset-1").find((event) => event.type === "user" && event.origin === "retry");
      expect(retry?.type === "user" ? retry.text : "").toContain("USAGE_LIMIT");
      expect(await rejected(h.service.retry("aset-1"))).toBe("NOT_FAILED");
    },
    SLOW,
  );

  test(
    "pilih banyak + Lainnya: kartu pertanyaan → waiting_user → jawaban diteruskan → lanjut",
    async () => {
      const h = harness();
      const asked = nextEvent(h, "aset-1", (stored) => stored.event.type === "question");
      await h.service.create({ prompt: "Peti kayu [tanya-banyak]", tierId: "sedang" });
      const question = (await asked).event;
      if (question.type !== "question") throw new Error("bukan pertanyaan");
      await until(h, "aset-1", (record) => record.state.runState === "waiting_user");
      expect(question.questions[0]).toMatchObject({ question: PARTS_QUESTION, multiSelect: true });
      expect(await rejected(h.service.sendMessage("aset-1", "halo"))).toBe("QUESTION_OPEN");
      expect(
        await rejected(
          h.service.answer("aset-1", question.questionId, { [PARTS_QUESTION]: { selected: ["Tidak ada"] } }),
        ),
      ).toBe("INVALID_ANSWER");

      await h.service.answer("aset-1", question.questionId, {
        [PARTS_QUESTION]: { selected: ["Pegangan", "Gembok"], other: "paku keling" },
      });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(getQuestion(h.handle.db, question.questionId)).toMatchObject({
        status: "answered",
        answer: { [PARTS_QUESTION]: "Gembok, Pegangan, paku keling" },
      });
      expect(
        await rejected(
          h.service.answer("aset-1", question.questionId, { [PARTS_QUESTION]: { selected: ["Engsel"] } }),
        ),
      ).toBe("QUESTION_NOT_FOUND");
    },
    SLOW,
  );

  test(
    "pilih satu: jawaban menentukan gaya di brief",
    async () => {
      const h = harness();
      const asked = nextEvent(h, "aset-1", (stored) => stored.event.type === "question");
      await h.service.create({ prompt: "Peti [tanya]", tierId: "ringan" });
      const question = (await asked).event;
      if (question.type !== "question") throw new Error("bukan pertanyaan");
      await h.service.answer("aset-1", question.questionId, {
        [STYLE_QUESTION]: { selected: ["Realistis"] },
      });
      const review = await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(review.state.brief?.style).toBe("realistis");
    },
    SLOW,
  );

  test(
    "Stop saat menunggu jawaban: kartu dibatalkan, aset idle",
    async () => {
      const h = harness();
      const asked = nextEvent(h, "aset-1", (stored) => stored.event.type === "question");
      await h.service.create({ prompt: "Peti [tanya]", tierId: "sedang" });
      const question = (await asked).event;
      await until(h, "aset-1", (record) => record.state.runState === "waiting_user");
      await h.service.stop("aset-1");
      await until(h, "aset-1", (record) => record.state.runState === "idle");
      const id = question.type === "question" ? question.questionId : "";
      await until(h, "aset-1", () => getQuestion(h.handle.db, id)?.status === "cancelled");
      expect(h.service.get("aset-1").state.status).toBe("BRIEFING");
    },
    SLOW,
  );

  test(
    "proses Claude mati → SESSION_FAILED; Coba lagi me-resume sesi yang sama",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti [mati]", tierId: "sedang" });
      const failed = await until(h, "aset-1", (record) => record.state.runState === "failed");
      expect(failed.state.lastError?.code).toBe("SESSION_FAILED");
      const sessionId = failed.sessionId;
      await h.service.retry("aset-1");
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(h.port.sessions).toHaveLength(2);
      expect(h.port.current.options.resume).toBe(sessionId ?? "");
    },
    SLOW,
  );

  test(
    "Stop saat Claude berpikir lama: giliran interrupted, aset idle",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti [macet]", tierId: "sedang" });
      await until(h, "aset-1", () => thread(h, "aset-1").some((event) => event.type === "thinking"));
      await h.service.stop("aset-1");
      await until(h, "aset-1", () =>
        thread(h, "aset-1").some((event) => event.type === "result" && event.interrupted),
      );
      expect(h.service.get("aset-1").state).toMatchObject({ status: "BRIEFING", runState: "idle" });
      // Stop saat idle tidak melakukan apa-apa, tapi tetap sah.
      await h.service.stop("aset-1");
    },
    SLOW,
  );
});

describe("AssetService — progres build untuk Gudang", () => {
  test("build_started → 0%, progres naik lewat topik global; build selesai → progres hilang + aset berubah", async () => {
    const h = harness();
    const queries = new AssetQueries({
      db: h.handle.db,
      dataDir,
      progress: (assetId) => h.service.buildProgress(assetId),
    });
    const global: GlobalEvent[] = [];
    // Daftar dibaca tepat saat event progres disiarkan (database dan progres dibaca sinkron saat dipanggil), jadi
    // terbaca selagi build masih berjalan.
    const lists: Array<ReturnType<AssetQueries["list"]>> = [];
    h.bus.subscribeGlobal((event) => {
      global.push(event);
      if (event.type === "progress") lists.push(queries.list());
    });
    await h.service.create({ prompt: "Peti kayu", tierId: "sedang" });
    await until(h, "aset-1", idleIn("BASE_REVIEW"));

    const listed = (await Promise.all(lists)).map((list) => list.assets[0]?.progress);
    expect(listed[0]).toEqual({ stage: "base", pct: 0 });
    expect(listed.at(-1)).toEqual({ stage: "base", pct: 100 });
    expect(h.service.buildProgress("aset-1")).toBeNull();
    expect((await queries.list()).assets[0]).toMatchObject({
      progress: null,
      current: { n: 1, stage: "base" },
    });
    // Setelah build selesai ada pengumuman perubahan aset, supaya kartu tidak tertahan di persen terakhir.
    expect(h.created).toEqual([["aset-1", 1]]);
    const lastProgress = global.findLastIndex((event) => event.type === "progress");
    expect(global.slice(lastProgress + 1)).toContainEqual({
      type: "asset",
      assetId: "aset-1",
      change: "updated",
    });
  });
});

describe("AssetService — duplikat, hapus, gerbang, pemulihan", () => {
  test(
    "duplikat penuh: status, versi (file + indeks), brief; sesi baru dengan ringkasan keadaan",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti kayu", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      const copy = await h.service.duplicate("aset-1");
      expect(copy).toMatchObject({ id: "aset-2", name: `Peti kayu${COPY_SUFFIX}`, sessionId: null });
      expect(copy.state).toMatchObject({ status: "BASE_REVIEW", runState: "idle", currentVersion: 1 });
      expect(listVersionRecords(h.handle.db, "aset-2").map((version) => version.n)).toEqual([1]);
      const copiedDir = join(h.service.assetDir("aset-2"), "versions", "v1");
      expect(((await stat(copiedDir)).mode & 0o777).toString(8)).toBe("555");
      expect((await readdir(copiedDir)).sort()).toEqual(
        (await readdir(join(h.service.assetDir("aset-1"), "versions", "v1"))).sort(),
      );
      expect(thread(h, "aset-2")).toMatchObject([
        { type: "notice", text: expect.stringContaining("Disalin dari") },
      ]);

      await h.service.approve("aset-2");
      await until(h, "aset-2", idleIn("TEXTURE_REVIEW"));
      const first = thread(h, "aset-2").find((event) => event.type === "user");
      expect(first?.type === "user" ? first.text : "").toStartWith("[Sistem] Ini sesi baru");
      // Aset asal tidak berubah.
      expect(h.service.get("aset-1").state.status).toBe("BASE_REVIEW");
    },
    SLOW,
  );

  test(
    "duplikat saat build menulis versi: baris versi tanpa folder, staging, dan file sementara tidak ikut",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti kayu", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      const sourceDir = h.service.assetDir("aset-1");
      // Keadaan sesaat saat build lain sedang selesai: folder staging v2 belum di-rename, file turunan masih
      // ditulis, dan baris v2 sudah ada di database (folder v2 belum tersalin).
      await mkdir(join(sourceDir, "versions", ".staging-uji"));
      await writeFile(join(sourceDir, "versions", ".staging-uji", "base.glb"), "setengah");
      await mkdir(join(sourceDir, "derived", "v1"), { recursive: true });
      await writeFile(join(sourceDir, "derived", "v1", ".thumb.webp.1234.tmp"), "setengah");
      const v1 = listVersionRecords(h.handle.db, "aset-1")[0];
      if (v1 === undefined) throw new Error("v1 tidak ada");
      insertVersion(h.handle.db, {
        assetId: "aset-1",
        n: 2,
        stage: "base",
        stats: v1.stats,
        budget: { ok: true },
        manifest: { version: 2, createdAt: "2026-11-14T00:00:00.000Z", files: [], meta: { stage: "base" } },
        createdAt: 5,
      });

      const copy = await h.service.duplicate("aset-1");
      const copyDir = h.service.assetDir(copy.id);
      expect(listVersionRecords(h.handle.db, copy.id).map((version) => version.n)).toEqual([1]);
      expect(await readdir(join(copyDir, "versions"))).toEqual(["v1"]);
      expect(await readdir(join(copyDir, "derived", "v1")).catch(() => [])).not.toContain(
        ".thumb.webp.1234.tmp",
      );
      expect(copy.state.currentVersion).toBe(1);
    },
    SLOW,
  );

  test(
    "hapus: soft delete, sesi ditutup, folder aset (termasuk versi read-only) dibersihkan",
    async () => {
      const h = harness();
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      const assetDir = h.service.assetDir("aset-1");
      await h.service.delete("aset-1");
      expect(getAsset(h.handle.db, "aset-1")).toBeNull();
      expect(getAsset(h.handle.db, "aset-1", { includeDeleted: true })?.deletedAt).not.toBeNull();
      expect(await stat(assetDir).catch(() => null)).toBeNull();
      expect(await rejected(h.service.sendMessage("aset-1", "halo"))).toBe("ASSET_NOT_FOUND");
      expect(h.errors).toEqual([]);
    },
    SLOW,
  );

  test(
    "hapus menunggu pekerjaan turunan aset (thumbnail, ekspor) sebelum foldernya dihapus",
    async () => {
      let release: () => void = () => undefined;
      let entered: () => void = () => undefined;
      const hookEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const seen: string[] = [];
      const h = harness({
        beforeRemoveDir: (assetId) => {
          seen.push(assetId);
          entered();
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      });
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      const assetDir = h.service.assetDir("aset-1");
      const deleting = h.service.delete("aset-1");
      await hookEntered;
      // Aset sudah terhapus untuk permintaan baru, foldernya menunggu pekerjaan yang masih berjalan.
      expect(getAsset(h.handle.db, "aset-1")).toBeNull();
      expect(await stat(assetDir).catch(() => null)).not.toBeNull();
      release();
      await deleting;
      expect(seen).toEqual(["aset-1"]);
      expect(await stat(assetDir).catch(() => null)).toBeNull();
    },
    SLOW,
  );

  test(
    "hapus saat build berjalan: build dibatalkan (container tidak dibiarkan jalan)",
    async () => {
      const builder = new FixtureAssetBuilder({ ...FIXTURE_PAIR, script: [{ kind: "hang" }] });
      const h = harness({ builder });
      const started = nextEvent(h, "aset-1", (stored) => stored.event.type === "build_started");
      await h.service.create({ prompt: "Peti", tierId: "sedang" });
      await started;
      await h.service.delete("aset-1");
      expect(builder.requests[0]?.signal.aborted).toBe(true);
      expect(listJobs(h.handle.db, "aset-1").map((job) => job.status)).toEqual(["cancelled"]);
    },
    SLOW,
  );

  test(
    "sesi Claude gagal disiapkan: aset tetap dibuat dengan SESSION_FAILED; Coba lagi menyiapkan sesi baru",
    async () => {
      const h = harness({ failAgents: 1 });
      const created = await h.service.create({ prompt: "Peti", tierId: "sedang" });
      expect(created.state).toMatchObject({ runState: "failed", lastError: { code: "SESSION_FAILED" } });
      // Detail teknis hanya ke log, bukan ke pemilik.
      expect(created.state.lastError?.message).not.toContain("EACCES");
      expect(h.errors).toHaveLength(1);
      await h.service.stop("aset-1");
      await h.service.retry("aset-1");
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
    },
    SLOW,
  );

  test("gerbang aksi pemilik ditegakkan di service", async () => {
    const h = harness();
    insertAsset(h.handle.db, {
      id: "b1",
      name: "Diam",
      prompt: "x",
      tierId: "ringan",
      tier: { triangles: { target: 1, max: 2 }, materials: 1, textures: {}, webBytes: { target: 1, max: 2 } },
      now: 1,
    });
    expect(await rejected(h.service.approve("b1"))).toBe("NOT_IN_REVIEW");
    expect(await rejected(h.service.finish("b1"))).toBe("NOT_IN_REVIEW");
    expect(await rejected(h.service.changeShape("b1", "lebih tinggi"))).toBe("SHAPE_CHANGE_NOT_ALLOWED");
    expect(await rejected(h.service.retry("b1"))).toBe("NOT_FAILED");
    expect(await rejected(h.service.sendMessage("b1", "   "))).toBe("EMPTY_MESSAGE");
    expect(await rejected(h.service.sendMessage("b1", "x".repeat(8001)))).toBe("MESSAGE_TOO_LONG");
    expect(await rejected(h.service.create({ prompt: "", tierId: "ringan" }))).toBe("EMPTY_MESSAGE");
    expect(await rejected(h.service.answer("b1", "q-x", {}))).toBe("QUESTION_NOT_FOUND");
    expect(await rejected(h.service.stop("tidak-ada"))).toBe("ASSET_NOT_FOUND");
    expect(() => h.service.assetDir("../luar")).toThrow(ServiceError);
    expect(() => h.service.assetDir("a/b")).toThrow(ServiceError);
  });

  test("pemulihan: kartu terbuka ditutup, aset menunggu jawaban menjadi interrupted", async () => {
    const h = harness();
    insertAsset(h.handle.db, {
      id: "c1",
      name: "Menunggu",
      prompt: "x",
      tierId: "ringan",
      tier: { triangles: { target: 1, max: 2 }, materials: 1, textures: {}, webBytes: { target: 1, max: 2 } },
      now: 1,
      state: {
        status: "BRIEFING",
        runState: "waiting_user",
        lastError: null,
        brief: null,
        approvedBaseVersion: null,
        currentVersion: null,
        buildsThisMessage: 0,
      },
    });
    insertQuestion(h.handle.db, { id: "q1", assetId: "c1", questions: [], now: 1 });
    insertJob(h.handle.db, { id: "j1", assetId: "c1", kind: "build_base", now: 1 });
    h.service.jobStarted("j1");
    expect(getJob(h.handle.db, "j1")?.status).toBe("running");
    h.service.recover();
    expect(h.service.get("c1").state.runState).toBe("interrupted");
    expect(getQuestion(h.handle.db, "q1")?.status).toBe("cancelled");
    expect(thread(h, "c1").map((event) => event.type)).toEqual([
      "build_finished",
      "question_resolved",
      "notice",
      "state",
    ]);
  });

  test("nama dari prompt dipotong rapi", async () => {
    const { nameFromPrompt } = await import("./assets.ts");
    expect(nameFromPrompt("Peti\nbaris kedua")).toBe("Peti");
    expect(nameFromPrompt("a".repeat(100))).toHaveLength(80);
    expect(nameFromPrompt("a".repeat(100)).endsWith("…")).toBe(true);
  });
});

describe("AssetService — lampiran dan nama", () => {
  const idleState = {
    status: "BRIEFING",
    runState: "idle",
    lastError: null,
    brief: null,
    approvedBaseVersion: null,
    currentVersion: null,
    buildsThisMessage: 0,
  } as const;

  async function png(): Promise<Uint8Array> {
    const buffer = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#204080" } })
      .png()
      .toBuffer();
    return new Uint8Array(buffer);
  }

  function stl(): Uint8Array {
    const bytes = new Uint8Array(84 + 50);
    new DataView(bytes.buffer).setUint32(80, 1, true);
    return bytes;
  }

  function seedIdle(h: Harness, id: string) {
    insertAsset(h.handle.db, {
      id,
      name: "Diam",
      prompt: "x",
      tierId: "ringan",
      tier: { triangles: { target: 1, max: 2 }, materials: 1, textures: {}, webBytes: { target: 1, max: 2 } },
      now: 1,
      state: idleState,
    });
  }

  async function refs(id: string): Promise<string[]> {
    return (await readdir(join(dataDir, "assets", id, "refs")).catch(() => [])).sort();
  }

  test(
    "lampiran pesan pertama: file di refs/, baris lampiran, chip di thread, catatan hanya untuk Claude",
    async () => {
      const seen: string[] = [];
      const base = defaultScenario({ now: fakeClock() });
      const h = harness({
        ids: ["aset-1", "g1", "m1"],
        scenario: async (turn, claude) => {
          seen.push(turn.text);
          await base(turn, claude);
        },
      });
      await h.service.create({
        prompt: "Peti kayu seperti foto",
        tierId: "ringan",
        files: [
          { name: "foto peti.png", bytes: await png() },
          { name: "ukuran.stl", bytes: stl() },
        ],
      });
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(await refs("aset-1")).toEqual(["g1-decal.png", "g1.png", "m1.stl"]);
      expect(
        listAttachments(h.handle.db, "aset-1").map((row) => [row.id, row.kind, row.name, row.path]),
      ).toEqual([
        ["g1", "image", "foto peti.png", "g1.png"],
        ["m1", "model", "ukuran.stl", "m1.stl"],
      ]);
      const first = thread(h, "aset-1").find((event) => event.type === "user");
      expect(first).toMatchObject({
        text: "Peti kayu seperti foto",
        attachments: [
          { id: "g1", kind: "image", name: "foto peti.png" },
          { id: "m1", kind: "model", name: "ukuran.stl" },
        ],
      });
      expect(seen[0]).toContain("[Lampiran pemilik]");
      expect(seen[0]).toContain(`${join(dataDir, "assets", "aset-1", "refs", "g1.png")} — gambar referensi`);
      expect(seen[0]).toContain("Di container: /refs/m1.stl");
      expect(h.service.get("aset-1").state.brief?.summary).toBe("Peti kayu seperti foto");
    },
    SLOW,
  );

  test("unggahan ditolak saat membuat aset: tidak ada aset, folder, atau baris", async () => {
    const h = harness();
    const files = [{ name: "virus.png", bytes: new TextEncoder().encode("MZ bukan gambar") }];
    expect(await rejected(h.service.create({ prompt: "peti", tierId: "ringan", files }))).toBe(
      "UNSUPPORTED_FILE",
    );
    expect(getAsset(h.handle.db, "aset-1", { includeDeleted: true })).toBeNull();
    expect(await readdir(join(dataDir, "assets")).catch(() => [])).toEqual([]);
  });

  test("gerbang dicek sebelum lampiran diproses: tidak ada file atau baris tertinggal", async () => {
    const h = harness({ ids: ["g1", "g2"] });
    seedIdle(h, "b1");
    const files = [{ name: "a.png", bytes: await png() }];
    expect(await rejected(h.service.revise("b1", "lebih tinggi", files))).toBe("NOT_IN_REVIEW");
    expect(await refs("b1")).toEqual([]);
    expect(listAttachments(h.handle.db, "b1")).toEqual([]);
  });

  test("status berubah saat lampiran diproses → aksi ditolak, lampiran dibatalkan", async () => {
    const h = harness({ ids: ["g1"] });
    seedIdle(h, "b1");
    const pending = h.service.sendMessage("b1", "tambahkan logo", [{ name: "logo.png", bytes: await png() }]);
    // Bagian sinkron (gerbang) sudah lewat; kartu pertanyaan terbuka sebelum lampiran selesai diproses.
    saveAssetState(h.handle.db, "b1", { ...idleState, runState: "waiting_user" }, 2);
    expect(await rejected(pending)).toBe("QUESTION_OPEN");
    expect(await refs("b1")).toEqual([]);
    expect(listAttachments(h.handle.db, "b1")).toEqual([]);
    expect(thread(h, "b1")).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  test("aset dihapus saat lampiran diproses: folder aset tidak dibuat lagi, baris tidak tertinggal", async () => {
    const h = harness({ ids: ["g1"] });
    seedIdle(h, "b1");
    // Gambar besar supaya pemrosesan sharp jelas lebih lama daripada penghapusan.
    const big = new Uint8Array(
      await sharp({ create: { width: 1600, height: 1600, channels: 3, background: "#204080" } })
        .png()
        .toBuffer(),
    );
    const pending = h.service.sendMessage("b1", "tambahkan logo", [{ name: "logo.png", bytes: big }]);
    await h.service.delete("b1");
    expect(await rejected(pending)).toBe("ASSET_NOT_FOUND");
    expect(await readdir(join(dataDir, "assets")).catch(() => [])).not.toContain("b1");
    expect(listAttachments(h.handle.db, "b1")).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  test(
    "Coba lagi setelah pesan berlampiran tidak sampai ke Claude: lampiran ikut dikirim lagi",
    async () => {
      const seen: string[] = [];
      const base = defaultScenario({ now: fakeClock() });
      const h = harness({
        ids: ["aset-1", "g1"],
        failAgents: 1,
        scenario: async (turn, claude) => {
          seen.push(turn.text);
          await base(turn, claude);
        },
      });
      const created = await h.service.create({
        prompt: "Peti seperti foto",
        tierId: "ringan",
        files: [{ name: "foto.png", bytes: await png() }],
      });
      expect(created.state).toMatchObject({ runState: "failed", lastError: { code: "SESSION_FAILED" } });
      // Pesan pemilik tetap terlihat di thread walau belum sempat sampai ke Claude.
      expect(thread(h, "aset-1").find((event) => event.type === "user")).toMatchObject({
        text: "Peti seperti foto",
        attachments: [{ id: "g1", kind: "image", name: "foto.png" }],
      });
      await h.service.stop("aset-1");
      await h.service.retry("aset-1");
      await until(h, "aset-1", idleIn("BASE_REVIEW"));
      expect(seen[0]).toContain("Pemilik menekan Coba lagi");
      expect(seen[0]).toContain("Peti seperti foto");
      expect(seen[0]).toContain(`${join(dataDir, "assets", "aset-1", "refs", "g1.png")} — gambar referensi`);
    },
    SLOW,
  );

  test("ganti nama: dirapikan, disiarkan, dan divalidasi", async () => {
    const h = harness();
    seedIdle(h, "b1");
    const changes: string[] = [];
    h.bus.subscribeGlobal((event) => {
      if (event.type === "asset") changes.push(`${event.assetId}:${event.change}`);
    });
    h.clock.advance(5);
    const renamed = await h.service.rename("b1", "  Peti\u0000 harta\n karun  ");
    expect(renamed).toMatchObject({ name: "Peti harta karun", updatedAt: h.clock() });
    expect(changes).toEqual(["b1:updated"]);
    expect(await rejected(h.service.rename("b1", " ​ "))).toBe("INVALID_NAME");
    expect(await rejected(h.service.rename("b1", "a".repeat(ASSET_NAME_MAX_CHARS + 1)))).toBe("INVALID_NAME");
    // Panjang dihitung per code point (sama dengan nama dari prompt), bukan unit UTF-16; surrogate tunggal dibuang.
    const emoji = "\u{1F4E6}";
    expect((await h.service.rename("b1", emoji.repeat(ASSET_NAME_MAX_CHARS))).name).toBe(
      emoji.repeat(ASSET_NAME_MAX_CHARS),
    );
    expect(await rejected(h.service.rename("b1", emoji.repeat(ASSET_NAME_MAX_CHARS + 1)))).toBe(
      "INVALID_NAME",
    );
    expect((await h.service.rename("b1", "Peti \ud83d emas")).name).toBe("Peti emas");
    expect(await rejected(h.service.rename("tidak-ada", "x"))).toBe("ASSET_NOT_FOUND");
    expect(await rejected(h.service.create({ prompt: "x", tierId: "ringan", name: "\u0007" }))).toBe(
      "INVALID_NAME",
    );
  });
});
