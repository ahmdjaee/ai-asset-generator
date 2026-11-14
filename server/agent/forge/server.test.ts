import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { BUILD_CAPS, DEFAULT_TIERS } from "../../../shared/limits.ts";
import { listVersionRecords } from "../../db/repos/versions.ts";
import { MaterialLibrary } from "../../library/materials.ts";
import { openTestStore, type TestStore } from "../../services/test-support.ts";
import { listVersions, versionDir } from "../../services/versions.ts";
import { FixtureAssetBuilder, type FixtureBuild } from "./fixture-builder.ts";
import { detailHint, dimensionCheck, Forge, type ForgeEvent, validatorSummary } from "./server.ts";
import { createTestLibrary } from "./test-builder.ts";

const BRIEF = {
  summary: "Peti kayu bergaya kartun",
  category: "properti",
  style: "stylized",
  dimensionsM: { width: 0.6, depth: 0.4, height: 0.45 },
};

const CallResult = z.object({
  content: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }),
    ]),
  ),
  isError: z.boolean().optional(),
});

type Harness = {
  forge: Forge;
  store: TestStore["store"];
  db: TestStore["handle"]["db"];
  builder: FixtureAssetBuilder;
  events: ForgeEvent[];
  call: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ body: Record<string, unknown>; images: number; isError: boolean }>;
  close: () => Promise<void>;
};

let assetDir = "";

beforeEach(async () => {
  assetDir = await mkdtemp(join(tmpdir(), "aag-forge-"));
  await mkdir(join(assetDir, "work"), { recursive: true });
});

afterEach(async () => {
  for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
  await rm(assetDir, { recursive: true, force: true });
});

async function writeScript(
  text = "from assetkit import prim, scene\nscene.reset()\nprim.box((0.6, 0.4, 0.45))\n",
) {
  await writeFile(join(assetDir, "work", "base.py"), text);
}

async function harness(
  script: FixtureBuild[] = [],
  tierId: "ringan" | "sedang" = "sedang",
  options: { library?: boolean } = {},
): Promise<Harness> {
  const builder = new FixtureAssetBuilder({ script });
  const library =
    options.library === false
      ? new MaterialLibrary(join(assetDir, "tanpa-pustaka"))
      : await createTestLibrary(join(assetDir, "library"));
  const events: ForgeEvent[] = [];
  let counter = 0;
  const test = openTestStore({ tierId });
  const forge = new Forge({
    asset: { id: "a1", assetDir, tierId, tier: DEFAULT_TIERS[tierId] },
    store: test.store,
    builder,
    library,
    emit: (event) => events.push(event),
    newJobId: () => `base-${++counter}`,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = forge.mcpServer();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: "tes", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    forge,
    store: test.store,
    db: test.handle.db,
    builder,
    events,
    call: async (name, args = {}) => {
      const result = CallResult.parse(await client.callTool({ name, arguments: args }));
      const text = result.content.find((part) => part.type === "text");
      const raw = text?.type === "text" ? text.text : "";
      // Error validasi skema dari SDK MCP berupa teks biasa, bukan JSON forge.
      const body = raw.startsWith("{") ? z.record(z.string(), z.unknown()).parse(JSON.parse(raw)) : { raw };
      return {
        body,
        images: result.content.filter((part) => part.type === "image").length,
        isError: result.isError === true,
      };
    },
    close: async () => {
      await client.close();
      await server.instance.close();
      test.handle.close();
    },
  };
}

describe("tool forge lewat MCP", () => {
  test("daftar tool forge", async () => {
    const h = await harness();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = h.forge.mcpServer();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "tes", version: "1.0.0" });
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((item) => item.name).sort();
    expect(names).toEqual([
      "build_base_mesh",
      "build_textured_asset",
      "inspect_version",
      "list_materials",
      "list_versions",
      "record_brief",
      "submit_for_review",
    ]);
    await client.close();
    await h.close();
  });

  test("build sebelum brief → BRIEF_REQUIRED, jatah build tidak berkurang", async () => {
    const h = await harness();
    await writeScript();
    const result = await h.call("build_base_mesh");
    expect(result).toMatchObject({ isError: true, body: { ok: false, code: "BRIEF_REQUIRED" } });
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.base);
    expect(h.builder.requests).toHaveLength(0);
    await h.close();
  });

  test("brief tidak valid ditolak oleh skema", async () => {
    const h = await harness();
    const result = await h.call("record_brief", {
      ...BRIEF,
      dimensionsM: { width: -1, depth: 1, height: 1 },
    });
    expect(result.isError).toBe(true);
    expect(h.store.read().status).toBe("BRIEFING");
    await h.close();
  });

  test("tanpa work/base.py → SCRIPT_MISSING", async () => {
    const h = await harness();
    await h.call("record_brief", BRIEF);
    expect(await h.call("build_base_mesh")).toMatchObject({ body: { code: "SCRIPT_MISSING" } });
    await h.close();
  });

  test("alur sukses: brief → build → JSON ringkas + tepat 1 gambar → list → submit → terkunci", async () => {
    const h = await harness();
    await writeScript();
    const brief = await h.call("record_brief", BRIEF);
    expect(brief.body).toMatchObject({ ok: true, status: "BASE_WORKING", tier: "sedang" });

    const build = await h.call("build_base_mesh", { note: "versi pertama" });
    expect(build.isError).toBe(false);
    expect(build.images).toBe(1);
    expect(build.body).toMatchObject({
      ok: true,
      version: 1,
      budgetOk: true,
      validator: { errors: 0 },
      buildsLeft: BUILD_CAPS.base - 1,
    });
    expect(build.body).toHaveProperty("dimensions.height.targetM", 0.45);
    // Fixture peti jauh di bawah target Sedang → petunjuk ruang detail.
    expect(String(build.body.detailHint)).toContain("dari target tier (8000)");
    // Hasil tool tidak membawa GLB, base64 selain gambar, atau log panjang.
    expect(JSON.stringify(build.body).length).toBeLessThan(2500);

    const list = await h.call("list_versions");
    expect(list.body).toMatchObject({ versions: [{ version: 1, budgetOk: true, validatorErrors: 0 }] });
    // Versi tercatat di indeks database dan menjadi versi terkini aset.
    expect(listVersionRecords(h.db, "a1")).toMatchObject([{ n: 1, stage: "base", budgetOk: true }]);
    expect(h.store.read()).toMatchObject({ currentVersion: 1, buildsThisMessage: 1 });

    const submit = await h.call("submit_for_review", { version: 1, summary: "Peti siap direview" });
    expect(submit.body).toMatchObject({ ok: true, status: "BASE_REVIEW" });
    expect(await h.call("build_base_mesh")).toMatchObject({ body: { code: "IN_REVIEW" } });
    expect(await h.call("record_brief", BRIEF)).toMatchObject({ body: { code: "IN_REVIEW" } });
    expect(await h.call("submit_for_review", { version: 1, summary: "lagi" })).toMatchObject({
      body: { code: "IN_REVIEW" },
    });

    expect(h.events.map((event) => event.type)).toEqual([
      "brief",
      "build_started",
      "build_progress",
      "build_progress",
      "build_finished",
      "submitted",
    ]);
    await h.close();
  });

  test("pesan pemilik saat review = revisi: build dibuka lagi dan jatah direset", async () => {
    const h = await harness();
    await writeScript();
    await h.call("record_brief", BRIEF);
    await h.call("build_base_mesh");
    await h.call("submit_for_review", { version: 1, summary: "siap" });
    expect(h.store.apply({ type: "message", text: "tutupnya lebih tebal" }).ok).toBe(true);
    h.store.apply({ type: "turn_started" });
    expect(h.store.read().status).toBe("BASE_WORKING");
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.base);
    expect((await h.call("build_base_mesh")).body).toMatchObject({ ok: true, version: 2 });
    await h.close();
  });

  test(`batas ${BUILD_CAPS.base} build per pesan; build gagal ikut dihitung`, async () => {
    const failures: FixtureBuild[] = Array.from({ length: BUILD_CAPS.base }, () => ({
      kind: "fail",
      code: "SCRIPT_ERROR",
      message: "Skrip gagal (kode 1)",
      detail: "ValueError: x",
    }));
    const h = await harness(failures);
    await writeScript();
    await h.call("record_brief", BRIEF);
    for (let i = 1; i <= BUILD_CAPS.base; i++) {
      const result = await h.call("build_base_mesh");
      expect(result.body).toMatchObject({
        code: "SCRIPT_ERROR",
        detail: "ValueError: x",
        buildsLeft: BUILD_CAPS.base - i,
      });
      expect(result.images).toBe(0);
    }
    expect(await h.call("build_base_mesh")).toMatchObject({
      body: { code: "BUILD_CAP_REACHED", buildsLeft: 0 },
    });
    expect(h.builder.requests).toHaveLength(BUILD_CAPS.base);
    h.store.apply({ type: "turn_started" });
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.base);
    await h.close();
  });

  test.each([
    ["TIMEOUT", "Skrip melewati batas 120 dtk"],
    ["OOM", "Skrip kehabisan memori"],
  ] as const)("kegagalan runtime %s diteruskan dengan kode stabil", async (code, message) => {
    const h = await harness([{ kind: "fail", code, message }]);
    await writeScript();
    await h.call("record_brief", BRIEF);
    expect(await h.call("build_base_mesh")).toMatchObject({ isError: true, body: { code, message } });
    await h.close();
  });

  test("submit ditolak bila versi melewati batas maksimal tier (BUDGET_EXCEEDED)", async () => {
    // Grid 50 × 50 = 5000 segitiga: > 1,25 × maks Ringan (3000), jadi tidak di-simplify dan tetap over_max.
    const h = await harness([{ kind: "grid", cells: 50 }], "ringan");
    await writeScript();
    await h.call("record_brief", BRIEF);
    expect((await h.call("build_base_mesh")).body).toMatchObject({ ok: true, budgetOk: false });
    expect(await h.call("submit_for_review", { version: 1, summary: "x" })).toMatchObject({
      body: { code: "BUDGET_EXCEEDED" },
    });
    expect(h.store.read().status).toBe("BASE_WORKING");
    await h.close();
  });

  test("submit / inspect versi yang tidak ada → VERSION_NOT_FOUND", async () => {
    const h = await harness();
    await h.call("record_brief", BRIEF);
    expect(await h.call("submit_for_review", { version: 3, summary: "x" })).toMatchObject({
      body: { code: "VERSION_NOT_FOUND" },
    });
    expect(await h.call("inspect_version", { version: 3 })).toMatchObject({
      body: { code: "VERSION_NOT_FOUND" },
    });
    await h.close();
  });

  test("inspect_version merender ulang tanpa build dan tanpa memakai jatah", async () => {
    const h = await harness();
    await writeScript();
    await h.call("record_brief", BRIEF);
    await h.call("build_base_mesh");
    const left = h.forge.buildsLeft;
    const result = await h.call("inspect_version", {
      version: 1,
      mode: "wireframe",
      views: ["front", "top"],
    });
    expect(result).toMatchObject({
      images: 1,
      body: { ok: true, mode: "wireframe", views: ["front", "top"] },
    });
    expect(h.builder.inspections[0]).toMatchObject({
      version: 1,
      mode: "wireframe",
      views: ["front", "top"],
    });
    expect(h.forge.buildsLeft).toBe(left);
    await h.close();
  });

  test("Stop di tengah build → CANCELLED, signal builder dibatalkan", async () => {
    const h = await harness([{ kind: "hang" }]);
    await writeScript();
    await h.call("record_brief", BRIEF);
    const started = h.builder.nextRequest();
    const pending = h.call("build_base_mesh");
    await started;
    h.forge.cancelActive();
    expect(await pending).toMatchObject({ isError: true, body: { code: "CANCELLED" } });
    expect(h.builder.requests[0]?.signal.aborted).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ type: "build_finished", ok: false, code: "CANCELLED" });
    await h.close();
  });
});

async function writeMaterialScript() {
  await writeFile(
    join(assetDir, "work", "material.py"),
    "from assetkit import material, scene\nscene.run_base()\nmaterial.assign(scene.get('badan'), material.pbr('kayu'))\n",
  );
}

/** Brief → build bentuk dasar (fixture `base`) → submit → pemilik menyetujui. */
async function approvedHarness(
  base: FixtureBuild = { kind: "fixture", name: "textured/peti-base" },
  rest: FixtureBuild[] = [],
) {
  const h = await harness([base, ...rest]);
  await writeScript();
  await h.call("record_brief", BRIEF);
  await h.call("build_base_mesh");
  await h.call("submit_for_review", { version: 1, summary: "peti" });
  expect(h.store.apply({ type: "approve" }).ok).toBe(true);
  await writeMaterialScript();
  return h;
}

describe("tahap tekstur", () => {
  test("build_textured_asset sebelum bentuk dasar disetujui → BASE_NOT_APPROVED", async () => {
    const h = await harness();
    await writeScript();
    await writeMaterialScript();
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "BASE_NOT_APPROVED" });
    await h.call("record_brief", BRIEF);
    await h.call("build_base_mesh");
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "BASE_NOT_APPROVED" });
    await h.call("submit_for_review", { version: 1, summary: "peti" });
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "BASE_NOT_APPROVED" });
    expect(h.builder.requests).toHaveLength(1);
    await h.close();
  });

  test("persetujuan bentuk dasar hanya saat review bentuk dasar", async () => {
    const h = await harness();
    expect(h.store.apply({ type: "approve" })).toMatchObject({ ok: false, code: "NOT_IN_REVIEW" });
    await h.close();
  });

  test("alur sukses: disetujui → build bertekstur → 1 gambar → submit aset final → terkunci", async () => {
    const h = await approvedHarness();
    expect(h.store.read()).toMatchObject({ status: "TEXTURE_WORKING", approvedBaseVersion: 1 });
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.textured);
    const built = await h.call("build_textured_asset", { note: "kayu + logam" });
    expect(built).toMatchObject({
      isError: false,
      images: 1,
      body: { ok: true, version: 2, budgetOk: true },
    });
    expect(built.body.stats).toMatchObject({ materials: 1 });
    expect(built.body).not.toHaveProperty("detailHint");
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.textured - 1);

    const wrong = await h.call("submit_for_review", { version: 1, summary: "x" });
    expect(wrong.body).toMatchObject({ code: "VERSION_NOT_FOUND" });
    const listed = await h.call("list_versions");
    expect(listed.body.versions).toMatchObject([
      { version: 1, stage: "base" },
      { version: 2, stage: "textured" },
    ]);
    const submitted = await h.call("submit_for_review", { version: 2, summary: "peti bertekstur" });
    expect(submitted.body).toMatchObject({ ok: true, status: "TEXTURE_REVIEW" });
    expect(h.events.at(-1)).toMatchObject({ type: "submitted", version: 2, stage: "textured" });
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "IN_REVIEW" });

    h.store.apply({ type: "message", text: "kayunya lebih gelap" });
    h.store.apply({ type: "turn_started" });
    expect(h.store.read().status).toBe("TEXTURE_WORKING");
    expect(h.forge.buildsLeft).toBe(BUILD_CAPS.textured);
    await h.close();
  });

  test("bentuk menyimpang dari bentuk dasar → SHAPE_DRIFT, versi tidak dibuat", async () => {
    const h = await approvedHarness({ kind: "fixture", name: "kursi" });
    const result = await h.call("build_textured_asset");
    expect(result).toMatchObject({ isError: true, images: 0, body: { ok: false, code: "SHAPE_DRIFT" } });
    expect(Array.isArray(result.body.shape)).toBe(true);
    expect(await listVersions(assetDir)).toEqual([1]);
    await h.close();
  });

  test(`batas ${BUILD_CAPS.textured} build bertekstur per pesan`, async () => {
    const h = await approvedHarness();
    for (let i = 0; i < BUILD_CAPS.textured; i++) {
      h.builder.script.push({ kind: "fail", code: "SCRIPT_ERROR", message: "x" });
      await h.call("build_textured_asset");
    }
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "BUILD_CAP_REACHED" });
    await h.close();
  });

  test("bentuk dasar terkunci di tahap tekstur: build_base_mesh dan record_brief → BASE_LOCKED", async () => {
    const h = await approvedHarness();
    expect((await h.call("build_base_mesh")).body).toMatchObject({ code: "BASE_LOCKED" });
    expect((await h.call("record_brief", BRIEF)).body).toMatchObject({ code: "BASE_LOCKED" });
    await h.close();
  });

  test("tanpa work/material.py → SCRIPT_MISSING", async () => {
    const h = await approvedHarness();
    await rm(join(assetDir, "work", "material.py"));
    expect((await h.call("build_textured_asset")).body).toMatchObject({ code: "SCRIPT_MISSING" });
    await h.close();
  });

  test("inspect_version mode texture", async () => {
    const h = await approvedHarness();
    await h.call("build_textured_asset");
    const result = await h.call("inspect_version", { version: 2, mode: "texture" });
    expect(result).toMatchObject({ isError: false, images: 1, body: { mode: "texture" } });
    await h.close();
  });
});

describe("list_materials", () => {
  test("kueri → daftar id + 1 lembar contoh", async () => {
    const h = await harness();
    const result = await h.call("list_materials", { query: "rusty metal" });
    expect(result).toMatchObject({ isError: false, images: 1, body: { ok: true, total: 3 } });
    expect(result.body.materials).toMatchObject([{ id: "Metal063", category: "metal" }]);
    await h.close();
  });

  test("tanpa kecocokan → daftar kosong tanpa gambar", async () => {
    const h = await harness();
    const result = await h.call("list_materials", { query: "marmer" });
    expect(result).toMatchObject({ images: 0, body: { ok: true, materials: [] } });
    await h.close();
  });

  test("pustaka belum disinkronkan → LIBRARY_MISSING (juga untuk build bertekstur)", async () => {
    const h = await harness([], "sedang", { library: false });
    expect((await h.call("list_materials", { query: "kayu" })).body).toMatchObject({
      code: "LIBRARY_MISSING",
    });
    await h.close();
  });
});

describe("detailHint", () => {
  test("di bawah 40% target tier → petunjuk berisi persentase dan arahan", () => {
    expect(detailHint(1774, DEFAULT_TIERS.sedang)).toContain(
      "Segitiga baru 22% dari target tier (8000); arahan 40–90%",
    );
    expect(detailHint(3200, DEFAULT_TIERS.sedang)).toBeNull();
    expect(detailHint(1774, DEFAULT_TIERS.ringan)).toBeNull();
  });
});

describe("validatorSummary", () => {
  test("error dan peringatan ditampilkan (maks 3, error dulu); info dan hint tidak", () => {
    const message = (code: string, severity: number) => ({ code, message: `pesan ${code}`, severity });
    const summary = validatorSummary({
      ok: false,
      errors: 1,
      warnings: 3,
      infos: 1,
      hints: 0,
      messages: [message("E1", 0), message("W1", 1), message("W2", 1), message("W3", 1), message("I1", 2)],
    });
    expect(summary).toEqual({
      errors: 1,
      warnings: 3,
      messages: ["E1: pesan E1", "W1: pesan W1", "W2: pesan W2"],
    });
  });

  test("tanpa masalah → tanpa field messages", () => {
    expect(validatorSummary({ ok: true, errors: 0, warnings: 0, infos: 2, hints: 0, messages: [] })).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
});

describe("dimensionCheck", () => {
  test("bbox glTF (x, y=tinggi, z=kedalaman) dibandingkan dengan brief", () => {
    expect(dimensionCheck({ ...BRIEF }, [0.66, 0.45, 0.4])).toEqual({
      width: { targetM: 0.6, actualM: 0.66, diffPct: 10 },
      depth: { targetM: 0.4, actualM: 0.4, diffPct: 0 },
      height: { targetM: 0.45, actualM: 0.45, diffPct: 0 },
    });
  });

  test("tanpa brief → null", () => {
    expect(dimensionCheck(null, [1, 1, 1])).toBeNull();
  });
});
