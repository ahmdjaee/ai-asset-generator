import { afterEach, describe, expect, test } from "bun:test";
import type { AssetStats } from "../../../shared/asset-stats.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { INITIAL_STATE } from "../../domain/status.ts";
import { type DatabaseHandle, openDatabase } from "../client.ts";
import { assets, events } from "../schema.ts";
import {
  countAssets,
  getAsset,
  insertAsset,
  likePattern,
  listAssetsByRunState,
  markAssetDeleted,
  renameAsset,
  saveAssetState,
  searchAssets,
  setSessionId,
} from "./assets.ts";
import { copyAttachments, insertAttachment, listAttachments } from "./attachments.ts";
import { appendEvent, lastEventOfType, lastRequest, listEvents } from "./events.ts";
import { transact } from "./executor.ts";
import { cancelUnfinishedJobs, finishJob, getJob, insertJob, listJobs, markJobRunning } from "./jobs.ts";
import {
  cancelOpenQuestions,
  getQuestion,
  insertQuestion,
  listOpenQuestions,
  resolveQuestion,
} from "./questions.ts";
import { getSetting, setSetting } from "./settings.ts";
import { copyVersions, getVersionRecord, insertVersion, listVersionRecords } from "./versions.ts";

const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function open(): DatabaseHandle {
  const handle = openDatabase(":memory:");
  handles.push(handle);
  return handle;
}

function seedAsset(handle: DatabaseHandle, id = "a1", now = 1000) {
  return insertAsset(handle.db, {
    id,
    name: `Aset ${id}`,
    prompt: "peti kayu",
    tierId: "sedang",
    tier: DEFAULT_TIERS.sedang,
    now,
  });
}

const STATS: AssetStats = {
  triangles: 12,
  vertices: 8,
  materials: 0,
  drawCalls: 1,
  textures: [],
  bbox: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1] },
  bytes: 100,
};

describe("repositori aset", () => {
  test("membuat aset dengan status awal dan snapshot tier", () => {
    const handle = open();
    const created = seedAsset(handle);
    expect(created).toMatchObject({
      id: "a1",
      tierId: "sedang",
      tier: DEFAULT_TIERS.sedang,
      sessionId: null,
    });
    expect(created.state).toEqual(INITIAL_STATE);
    expect(getAsset(handle.db, "a1")).toEqual(created);
    expect(getAsset(handle.db, "tidak-ada")).toBeNull();
  });

  test("status, session, dan hapus lunak", () => {
    const handle = open();
    seedAsset(handle, "a1", 1000);
    seedAsset(handle, "a2", 2000);
    const state = {
      ...INITIAL_STATE,
      status: "BASE_REVIEW" as const,
      runState: "failed" as const,
      lastError: { code: "USAGE_LIMIT" as const, message: "habis", at: 5, resetsAt: 9 },
      brief: {
        summary: "Peti",
        category: "properti",
        style: "kartun",
        dimensionsM: { width: 1, depth: 1, height: 1 },
      },
      currentVersion: 2,
    };
    saveAssetState(handle.db, "a1", state, 3000);
    setSessionId(handle.db, "a1", "sesi-1", 3500);
    expect(getAsset(handle.db, "a1")).toMatchObject({ state, sessionId: "sesi-1", updatedAt: 3500 });
    expect(searchAssets(handle.db).map((row) => row.asset.id)).toEqual(["a1", "a2"]);
    expect(listAssetsByRunState(handle.db, ["failed"]).map((asset) => asset.id)).toEqual(["a1"]);

    markAssetDeleted(handle.db, "a1", 4000);
    expect(getAsset(handle.db, "a1")).toBeNull();
    expect(getAsset(handle.db, "a1", { includeDeleted: true })?.deletedAt).toBe(4000);
    expect(searchAssets(handle.db).map((row) => row.asset.id)).toEqual(["a2"]);
    expect(countAssets(handle.db)).toBe(1);
  });

  test("daftar Gudang: cari nama/prompt/kategori, filter tier/tahap/tanggal, urut, versi terkini ikut", () => {
    const handle = open();
    const add = (
      id: string,
      name: string,
      prompt: string,
      now: number,
      tierId: "ringan" | "sedang" = "sedang",
    ) => insertAsset(handle.db, { id, name, prompt, tierId, tier: DEFAULT_TIERS[tierId], now });
    add("a", "Peti harta kayu", "peti untuk game", 1000);
    add("b", "lentera besi", "lampu gantung 50% karat", 2000, "ringan");
    add("c", "Batu tebing", "batu_besar", 3000);
    saveAssetState(
      handle.db,
      "c",
      {
        ...INITIAL_STATE,
        status: "DONE",
        currentVersion: 2,
        brief: {
          summary: "Batu",
          category: "lingkungan",
          style: "low-poly",
          dimensionsM: { width: 1, depth: 1, height: 1 },
        },
      },
      3000,
    );
    for (const n of [1, 2]) {
      insertVersion(handle.db, {
        assetId: "c",
        n,
        stage: n === 1 ? "base" : "textured",
        stats: { ...STATS, triangles: n * 100 },
        budget: { ok: true },
        manifest: { files: [{ name: "web.glb", bytes: n * 10, sha256: "x" }] },
        createdAt: 3000,
      });
    }
    const ids = (search: Parameters<typeof searchAssets>[1]) =>
      searchAssets(handle.db, search).map((row) => row.asset.id);

    expect(ids({})).toEqual(["c", "b", "a"]);
    expect(ids({ sort: "oldest" })).toEqual(["a", "b", "c"]);
    // Nama tanpa membedakan huruf besar/kecil: "Batu", "lentera", "Peti".
    expect(ids({ sort: "name" })).toEqual(["c", "b", "a"]);
    expect(ids({ text: "PETI" })).toEqual(["a"]);
    expect(ids({ text: "gantung" })).toEqual(["b"]);
    expect(ids({ text: "lingkungan" })).toEqual(["c"]);
    // `%` dan `_` dicari apa adanya.
    expect(ids({ text: "50%" })).toEqual(["b"]);
    expect(ids({ text: "%" })).toEqual(["b"]);
    expect(ids({ text: "_" })).toEqual(["c"]);
    expect(ids({ tierId: "ringan" })).toEqual(["b"]);
    expect(ids({ statuses: ["DONE"] })).toEqual(["c"]);
    expect(ids({ updatedSince: 2000 })).toEqual(["c", "b"]);
    expect(ids({ text: "peti", tierId: "ringan" })).toEqual([]);
    expect(ids({ limit: 1 })).toEqual(["c"]);

    const rows = searchAssets(handle.db);
    expect(rows[0]?.current).toMatchObject({ n: 2, stage: "textured", stats: { triangles: 200 } });
    expect(rows[1]?.current).toBeNull();
    // Jumlah semua versi (dialog hapus di Gudang), bukan hanya versi terkini.
    expect(rows.map((row) => row.versionCount)).toEqual([2, 0, 0]);

    renameAsset(handle.db, "a", "Aaa", 4000);
    expect(ids({})).toEqual(["a", "c", "b"]);
    expect(countAssets(handle.db)).toBe(3);
  });

  test("urut Nama: urutan bahasa (huruf beraksen di tempatnya, angka sebagai angka), seri lewat id; batas tetap berlaku", () => {
    const handle = open();
    const names = ["Peti 10", "zebra", "Élan", "peti 2", "apel", "Peti 2"];
    for (const [index, name] of names.entries()) {
      insertAsset(handle.db, {
        id: `n${index}`,
        name,
        prompt: name,
        tierId: "sedang",
        tier: DEFAULT_TIERS.sedang,
        now: index,
      });
    }
    const sorted = (limit?: number) =>
      searchAssets(handle.db, { sort: "name", ...(limit === undefined ? {} : { limit }) }).map(
        (row) => row.asset.name,
      );
    expect(sorted()).toEqual(["apel", "Élan", "peti 2", "Peti 2", "Peti 10", "zebra"]);
    expect(sorted(2)).toEqual(["apel", "Élan"]);
  });

  test("pola LIKE: wildcard dan backslash dari pengguna di-escape", () => {
    expect(likePattern("50%_a\\b")).toBe("%50\\%\\_a\\\\b%");
  });

  test("JSON yang rusak di database ditolak saat dibaca", () => {
    const handle = open();
    seedAsset(handle);
    handle.db
      .update(assets)
      .set({ tierSnapshot: { triangles: "banyak" } })
      .run();
    expect(() => getAsset(handle.db, "a1")).toThrow();
  });
});

describe("repositori event", () => {
  test("seq berurutan per aset; replay after, halaman before, limit", () => {
    const handle = open();
    seedAsset(handle, "a1");
    seedAsset(handle, "a2");
    for (let i = 1; i <= 5; i++) appendEvent(handle.db, "a1", { type: "notice", text: `n${i}` }, 100 + i);
    expect(appendEvent(handle.db, "a2", { type: "notice", text: "lain" }, 200).seq).toBe(1);

    const all = listEvents(handle.db, "a1");
    expect(all.events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.events[0]).toEqual({ assetId: "a1", seq: 1, ts: 101, event: { type: "notice", text: "n1" } });
    expect(listEvents(handle.db, "a1", { after: 3 }).events.map((event) => event.seq)).toEqual([4, 5]);
    expect(listEvents(handle.db, "a1", { before: 5, limit: 2 }).events.map((event) => event.seq)).toEqual([
      3, 4,
    ]);
    expect(listEvents(handle.db, "a1", { after: 1, before: 5, limit: 2 }).events.map((e) => e.seq)).toEqual([
      2, 3,
    ]);
  });

  test("event live tidak bisa disimpan", () => {
    const handle = open();
    seedAsset(handle);
    expect(() => appendEvent(handle.db, "a1", { type: "delta", kind: "text", text: "x" }, 1)).toThrow();
  });

  test("baris yang tidak lolos skema dilewati dan dihitung", () => {
    const handle = open();
    seedAsset(handle);
    appendEvent(handle.db, "a1", { type: "notice", text: "baik" }, 1);
    handle.db
      .insert(events)
      .values({ assetId: "a1", seq: 2, type: "aneh", payload: { type: "aneh" }, ts: 2 })
      .run();
    const page = listEvents(handle.db, "a1");
    expect(page.skipped).toBe(1);
    expect(page.events).toHaveLength(1);
  });

  test("event terakhir per tipe", () => {
    const handle = open();
    seedAsset(handle);
    appendEvent(handle.db, "a1", { type: "user", uuid: "u1", text: "pertama" }, 1);
    appendEvent(handle.db, "a1", { type: "notice", text: "x" }, 2);
    appendEvent(handle.db, "a1", { type: "user", uuid: "u2", text: "kedua" }, 3);
    expect(lastEventOfType(handle.db, "a1", "user")).toEqual({ type: "user", uuid: "u2", text: "kedua" });
    expect(lastEventOfType(handle.db, "a1", "brief")).toBeNull();
  });

  test("permintaan terakhir melewati pesan lanjutkan/coba lagi", () => {
    const handle = open();
    seedAsset(handle);
    expect(lastRequest(handle.db, "a1")).toBeNull();
    appendEvent(handle.db, "a1", { type: "user", uuid: "u1", text: "buat peti" }, 1);
    appendEvent(
      handle.db,
      "a1",
      { type: "user", uuid: "u2", text: "[Sistem] setuju", origin: "approved" },
      2,
    );
    appendEvent(handle.db, "a1", { type: "user", uuid: "u3", text: "[Sistem] lanjut", origin: "resume" }, 3);
    appendEvent(handle.db, "a1", { type: "user", uuid: "u4", text: "[Sistem] coba", origin: "retry" }, 4);
    expect(lastRequest(handle.db, "a1")).toEqual({ text: "[Sistem] setuju", attachments: [] });
    const chips = [{ id: "g1", kind: "image", name: "foto.png" }] as const;
    appendEvent(handle.db, "a1", { type: "user", uuid: "u5", text: "seperti foto", attachments: chips }, 5);
    expect(lastRequest(handle.db, "a1")).toEqual({ text: "seperti foto", attachments: chips });
  });

  test("transaksi gagal membatalkan semua tulisan", () => {
    const handle = open();
    seedAsset(handle);
    expect(() =>
      transact(handle.db, (tx) => {
        appendEvent(tx, "a1", { type: "notice", text: "batal" }, 1);
        saveAssetState(tx, "a1", { ...INITIAL_STATE, status: "DONE" }, 2);
        throw new Error("gagal di tengah");
      }),
    ).toThrow("gagal di tengah");
    expect(listEvents(handle.db, "a1").events).toEqual([]);
    expect(getAsset(handle.db, "a1")?.state.status).toBe("BRIEFING");
  });
});

describe("repositori job, pertanyaan, versi, lampiran, pengaturan", () => {
  test("siklus job dan pembatalan saat start", () => {
    const handle = open();
    seedAsset(handle);
    insertJob(handle.db, { id: "j1", assetId: "a1", kind: "build_base", now: 1 });
    insertJob(handle.db, { id: "j2", assetId: "a1", kind: "build_base", now: 2 });
    insertJob(handle.db, { id: "j3", assetId: "a1", kind: "build_textured", now: 3 });
    markJobRunning(handle.db, "j1", 4);
    finishJob(handle.db, "j1", { status: "succeeded", now: 5 });
    finishJob(handle.db, "j1", { status: "failed", error: "terlambat", now: 6 });
    expect(getJob(handle.db, "j1")).toMatchObject({
      status: "succeeded",
      startedAt: 4,
      endedAt: 5,
      error: null,
    });
    markJobRunning(handle.db, "j2", 7);
    insertAsset(handle.db, {
      id: "a2",
      name: "Lain",
      prompt: "x",
      tierId: "ringan",
      tier: DEFAULT_TIERS.ringan,
      now: 1,
    });
    insertJob(handle.db, { id: "j4", assetId: "a2", kind: "build_base", now: 7 });
    expect(cancelUnfinishedJobs(handle.db, 8, "aset dihapus", "a2")).toEqual([{ id: "j4", assetId: "a2" }]);
    expect(
      cancelUnfinishedJobs(handle.db, 8, "server restart")
        .map((job) => job.id)
        .sort(),
    ).toEqual(["j2", "j3"]);
    expect(listJobs(handle.db, "a1").map((job) => job.status)).toEqual([
      "succeeded",
      "cancelled",
      "cancelled",
    ]);
    expect(getJob(handle.db, "tidak-ada")).toBeNull();
  });

  test("siklus kartu pertanyaan", () => {
    const handle = open();
    seedAsset(handle);
    const questions = [
      {
        question: "Warna?",
        header: "Warna",
        options: [{ label: "Merah", description: "" }],
        multiSelect: false,
      },
    ];
    insertQuestion(handle.db, { id: "q1", assetId: "a1", questions, now: 1 });
    insertQuestion(handle.db, { id: "q2", assetId: "a1", questions, now: 2 });
    expect(listOpenQuestions(handle.db, "a1").map((question) => question.id)).toEqual(["q1", "q2"]);
    expect(
      resolveQuestion(handle.db, "q1", { status: "answered", answer: { "Warna?": "Merah" }, now: 3 }),
    ).toBe(true);
    expect(resolveQuestion(handle.db, "q1", { status: "cancelled", now: 4 })).toBe(false);
    expect(getQuestion(handle.db, "q1")).toMatchObject({ status: "answered", answer: { "Warna?": "Merah" } });
    expect(cancelOpenQuestions(handle.db, 5)).toEqual([{ id: "q2", assetId: "a1" }]);
    expect(getQuestion(handle.db, "q2")?.status).toBe("cancelled");
    expect(getQuestion(handle.db, "q3")).toBeNull();
  });

  test("versi write-once; lampiran; pengaturan upsert", () => {
    const handle = open();
    seedAsset(handle);
    const version = {
      assetId: "a1",
      n: 1,
      stage: "base" as const,
      stats: STATS,
      budget: { ok: true, items: [] },
      manifest: { version: 1, files: [{ name: "base.glb", bytes: 10, sha256: "ab" }] },
      createdAt: 10,
    };
    insertVersion(handle.db, version);
    insertVersion(handle.db, { ...version, stage: "textured", createdAt: 99 });
    expect(listVersionRecords(handle.db, "a1")).toEqual([
      {
        assetId: "a1",
        n: 1,
        stage: "base",
        stats: STATS,
        budgetOk: true,
        files: [{ name: "base.glb", bytes: 10 }],
        validation: null,
        timings: null,
        optimize: null,
        createdAt: 10,
      },
    ]);
    expect(getVersionRecord(handle.db, "a1", 2)).toBeNull();

    // Ringkasan build di `meta` manifest (versi sejak Tahap 9); meta yang rusak dibaca sebagai tidak ada.
    insertVersion(handle.db, {
      ...version,
      n: 2,
      manifest: {
        ...version.manifest,
        meta: {
          validation: { errors: 0, warnings: 2 },
          timings: { runtimeMs: 900, pipelineMs: 300, renderMs: 450, totalMs: 1700 },
          optimize: { steps: ["dedup", "weld"], simplified: { from: 9000, to: 7900 } },
        },
      },
    });
    insertVersion(handle.db, {
      ...version,
      n: 3,
      manifest: { ...version.manifest, meta: { timings: "rusak" } },
    });
    expect(getVersionRecord(handle.db, "a1", 2)).toMatchObject({
      validation: { errors: 0, warnings: 2 },
      timings: { runtimeMs: 900, pipelineMs: 300, renderMs: 450, totalMs: 1700 },
      optimize: { steps: ["dedup", "weld"], simplified: { from: 9000, to: 7900 } },
    });
    expect(getVersionRecord(handle.db, "a1", 3)).toMatchObject({
      validation: null,
      timings: null,
      optimize: null,
    });

    insertAttachment(handle.db, {
      id: "f1",
      assetId: "a1",
      kind: "image",
      path: "ref.png",
      mime: "image/png",
      size: 3,
      sha256: "cd",
      createdAt: 1,
    });
    expect(listAttachments(handle.db, "a1").map((file) => file.path)).toEqual(["ref.png"]);

    // Duplikat: indeks versi dan lampiran ikut ke aset baru.
    seedAsset(handle, "a2");
    expect(copyVersions(handle.db, "a1", "a2")).toBe(3);
    expect(listVersionRecords(handle.db, "a2")).toMatchObject([
      { assetId: "a2", n: 1, stage: "base" },
      { assetId: "a2", n: 2, validation: { errors: 0, warnings: 2 } },
      { assetId: "a2", n: 3 },
    ]);
    copyAttachments(handle.db, "a1", "a2", () => "f2");
    expect(listAttachments(handle.db, "a2")).toMatchObject([{ id: "f2", assetId: "a2", path: "ref.png" }]);

    expect(getSetting(handle.db, "tiers")).toBeUndefined();
    setSetting(handle.db, "tiers", { a: 1 }, 1);
    setSetting(handle.db, "tiers", { a: 2 }, 2);
    expect(getSetting(handle.db, "tiers")).toEqual({ a: 2 });
  });
});
