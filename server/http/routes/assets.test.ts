import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import { z } from "zod";
import {
  ASSET_SEARCH_MAX_CHARS,
  ATTACHMENT_IMAGE_MAX_BYTES,
  ATTACHMENT_MAX_FILES,
  JSON_BODY_MAX_BYTES,
} from "../../../shared/limits.ts";
import { idleIn, openTestApi, type TestApi, untilAsset } from "../../../tests/support/api.ts";
import { saveAssetState } from "../../db/repos/assets.ts";

const SLOW = 30_000;
let api: TestApi;

beforeEach(async () => {
  api = await openTestApi();
});

afterEach(async () => {
  await api.close();
});

const ErrorBody = z.object({ code: z.string(), message: z.string() });
const AssetBody = z.object({
  asset: z.object({ id: z.string(), name: z.string(), status: z.string() }).loose(),
});

async function errorCode(response: Response): Promise<string> {
  return ErrorBody.parse(await response.json()).code;
}

function post(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(api.app.request(path, { method: "POST", ...init }));
}

function json(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function form(fields: Record<string, string>, files: ReadonlyArray<File> = []): RequestInit {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  for (const file of files) data.append("files[]", file);
  return { method: "POST", body: data };
}

async function png(): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({ create: { width: 30, height: 30, channels: 3, background: "#336699" } })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

function stl(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(84 + 50);
  new DataView(bytes.buffer).setUint32(80, 1, true);
  return bytes;
}

async function create(prompt: string, files: ReadonlyArray<File> = []): Promise<string> {
  const response = await post("/api/assets", form({ prompt, tierId: "ringan" }, files));
  expect(response.status).toBe(201);
  return AssetBody.parse(await response.json()).asset.id;
}

describe("rute aset — alur dan file", () => {
  test(
    "buat dengan lampiran → detail, thread, file versi, unduh lampiran",
    async () => {
      const id = await create("Peti kayu kartun", [
        new File([await png()], "foto peti.png", { type: "text/plain" }),
        new File([stl()], "../../ukuran.stl"),
      ]);
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));

      const list = z.object({ assets: z.array(z.object({ id: z.string() }).loose()) });
      expect(list.parse(await (await api.app.request("/api/assets")).json()).assets.map((a) => a.id)).toEqual(
        [id],
      );

      const detail = await (await api.app.request(`/api/assets/${id}`)).json();
      expect(detail).toMatchObject({
        asset: { id, status: "BASE_REVIEW", currentVersion: 1 },
        versions: [{ n: 1, stage: "base" }],
        attachments: [
          { kind: "image", name: "foto peti.png", mime: "image/png" },
          { kind: "model", name: "ukuran.stl", mime: "model/stl" },
        ],
      });
      expect(JSON.stringify(detail)).not.toContain("sessionId");

      const page = await (await api.app.request(`/api/assets/${id}/events?limit=500`)).json();
      expect(page).toMatchObject({ hasMore: false });
      expect(JSON.stringify(page)).toContain('"attachments":[{"id"');

      const glb = await api.app.request(`/api/assets/${id}/versions/1/base.glb`);
      expect(glb.status).toBe(200);
      expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
      expect(glb.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(glb.headers.get("x-content-type-options")).toBe("nosniff");
      expect(new TextDecoder().decode((await glb.arrayBuffer()).slice(0, 4))).toBe("glTF");
      const sheet = await api.app.request(`/api/assets/${id}/versions/1/contact-sheet.png`);
      expect([sheet.status, sheet.headers.get("cache-control")]).toEqual([200, "no-cache"]);
      expect((await api.app.request(`/api/assets/${id}/versions/1/web.glb`)).status).toBe(200);

      const missing = await api.app.request(`/api/assets/${id}/versions/1/rahasia.glb`);
      expect([missing.status, await errorCode(missing)]).toEqual([404, "FILE_NOT_FOUND"]);
      const badName = await api.app.request(`/api/assets/${id}/versions/1/..%2Fapp.db`);
      expect([badName.status, await errorCode(badName)]).toEqual([400, "VALIDATION_FAILED"]);
      expect(await errorCode(await api.app.request(`/api/assets/${id}/versions/9/base.glb`))).toBe(
        "VERSION_NOT_FOUND",
      );

      const attachments = z
        .object({ attachments: z.array(z.object({ id: z.string() }).loose()) })
        .parse(detail);
      const [image, model] = attachments.attachments;
      const imageFile = await api.app.request(`/api/assets/${id}/attachments/${image?.id}`);
      expect([imageFile.headers.get("content-type"), imageFile.headers.get("content-disposition")]).toEqual([
        "image/png",
        null,
      ]);
      const modelFile = await api.app.request(`/api/assets/${id}/attachments/${model?.id}`);
      expect(modelFile.headers.get("content-disposition")).toBe(
        "attachment; filename=\"ukuran.stl\"; filename*=UTF-8''ukuran.stl",
      );
    },
    SLOW,
  );

  test(
    "review → revisi berlampiran → setujui → tekstur → selesai",
    async () => {
      const id = await create("Peti kayu");
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
      const revise = await post(
        `/api/assets/${id}/revise`,
        form({ text: "lebih tinggi" }, [new File([await png()], "sketsa.png")]),
      );
      expect(revise.status).toBe(200);
      expect(AssetBody.parse(await revise.json()).asset.status).toBe("BASE_WORKING");
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));

      const approve = await post(`/api/assets/${id}/approve`, json({ note: "kayu gelap" }));
      expect(approve.status).toBe(200);
      await untilAsset(api.services, id, idleIn("TEXTURE_REVIEW"));
      const finish = await post(`/api/assets/${id}/finish`);
      expect(AssetBody.parse(await finish.json()).asset.status).toBe("DONE");
    },
    SLOW,
  );

  test(
    "kartu pertanyaan dijawab lewat HTTP",
    async () => {
      const id = await create("Peti kayu [tanya]");
      await untilAsset(api.services, id, (record) => record.state.runState === "waiting_user");
      // Klien menemukan kartu dari event `question` di thread.
      const Page = z.object({
        events: z.array(
          z.object({ event: z.object({ type: z.string(), questionId: z.string().optional() }) }),
        ),
      });
      const page = Page.parse(await (await api.app.request(`/api/assets/${id}/events`)).json());
      const opened = {
        id: page.events.find((item) => item.event.type === "question")?.event.questionId ?? "",
      };
      expect(opened.id).not.toBe("");
      const wrong = await post(`/api/assets/${id}/answers/q-tidak-ada`, json({ answers: {} }));
      expect([wrong.status, await errorCode(wrong)]).toEqual([404, "QUESTION_NOT_FOUND"]);
      const invalid = await post(`/api/assets/${id}/answers/${opened.id}`, json({ answers: {} }));
      expect([invalid.status, await errorCode(invalid)]).toEqual([400, "INVALID_ANSWER"]);
      const answered = await post(
        `/api/assets/${id}/answers/${opened.id}`,
        json({ answers: { "Gaya peti seperti apa?": { selected: ["Kartun"] } } }),
      );
      expect(answered.status).toBe(200);
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
    },
    SLOW,
  );

  test(
    "ganti nama, duplikat, hapus",
    async () => {
      const id = await create("Peti kayu");
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
      const renamed = await api.app.request(`/api/assets/${id}`, json({ name: "Peti harta" }, "PATCH"));
      expect(AssetBody.parse(await renamed.json()).asset.name).toBe("Peti harta");
      const empty = await api.app.request(`/api/assets/${id}`, json({ name: "  " }, "PATCH"));
      expect([empty.status, await errorCode(empty)]).toEqual([400, "INVALID_NAME"]);

      const copy = await post(`/api/assets/${id}/duplicate`);
      expect(copy.status).toBe(201);
      expect(AssetBody.parse(await copy.json()).asset.name).toBe("Peti harta (salinan)");

      const removed = await api.app.request(`/api/assets/${id}`, { method: "DELETE" });
      expect(removed.status).toBe(204);
      const gone = await api.app.request(`/api/assets/${id}`);
      expect([gone.status, await errorCode(gone)]).toEqual([404, "ASSET_NOT_FOUND"]);
    },
    SLOW,
  );
});

describe("rute aset — validasi, gerbang, unggahan", () => {
  test("validasi zod → 400 VALIDATION_FAILED tanpa menggemakan nilai", async () => {
    const noPrompt = await post("/api/assets", form({ tierId: "ringan" }));
    expect([noPrompt.status, await errorCode(noPrompt)]).toEqual([400, "VALIDATION_FAILED"]);
    const badTier = await post("/api/assets", form({ prompt: "x", tierId: "<script>" }));
    const body = ErrorBody.parse(await badTier.json());
    expect(body).toEqual({ code: "VALIDATION_FAILED", message: "Isi permintaan tidak valid: tierId." });
    const badJson = await post("/api/assets/a1/approve", {
      headers: { "content-type": "application/json" },
      body: "{rusak",
    });
    expect(badJson.status).toBe(400);
    const badId = await api.app.request("/api/assets/..%2F..%2Fetc");
    expect(badId.status).toBe(400);
    for (const query of [
      "tier=emas",
      "stage=x",
      "sort=acak",
      "since=-1",
      `q=${"a".repeat(ASSET_SEARCH_MAX_CHARS + 1)}`,
    ]) {
      const badList = await api.app.request(`/api/assets?${query}`);
      expect([query, badList.status, await errorCode(badList)]).toEqual([query, 400, "VALIDATION_FAILED"]);
    }
  });

  test(
    "ekspor satu versi: Web/Unity/Sumber sebagai unduhan, perkiraan ukuran, query salah → 400",
    async () => {
      const id = await create("Peti kayu kartun");
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
      const expected = [
        ["web", "model/gltf-binary", "peti-kayu-kartun-v1-web.glb"],
        ["unity", "model/gltf-binary", "peti-kayu-kartun-v1-unity.glb"],
        ["source", "application/zip", "peti-kayu-kartun-v1-sumber.zip"],
      ] as const;
      for (const [preset, type, name] of expected) {
        const response = await api.app.request(`/api/assets/${id}/export?version=1&preset=${preset}`);
        expect([response.status, response.headers.get("content-type")]).toEqual([200, type]);
        expect(response.headers.get("content-disposition")).toContain(`filename="${name}"`);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      }
      const source = unzipSync(
        new Uint8Array(
          await (await api.app.request(`/api/assets/${id}/export?version=1&preset=source`)).arrayBuffer(),
        ),
      );
      // Pasangan fixture membawa `.blend`, seperti build sungguhan.
      expect(Object.keys(source)).toContain("peti-kayu-kartun-v1-sumber/scene.blend");

      const estimate = await api.app.request(`/api/assets/${id}/export/estimate?version=1`);
      const body = z
        .object({
          version: z.number(),
          presets: z.array(z.object({ preset: z.string(), exact: z.boolean() }).loose()),
        })
        .parse(await estimate.json());
      expect(body.presets.map((preset) => [preset.preset, preset.exact])).toEqual([
        ["web", true],
        ["unity", true],
        ["source", true],
      ]);

      for (const query of ["version=0&preset=web", "version=1&preset=zip", "preset=web", "version=1"]) {
        const bad = await api.app.request(`/api/assets/${id}/export?${query}`);
        expect([query, bad.status, await errorCode(bad)]).toEqual([query, 400, "VALIDATION_FAILED"]);
      }
      const missing = await api.app.request(`/api/assets/${id}/export?version=9&preset=web`);
      expect([missing.status, await errorCode(missing)]).toEqual([404, "VERSION_NOT_FOUND"]);
    },
    SLOW,
  );

  test(
    "ZIP Gudang: di-stream sebagai unduhan; aset tanpa versi → 409; query salah → 400 (bukan rute /:id)",
    async () => {
      const first = await create("Peti kayu kartun");
      const second = await create("Peti kayu kartun");
      await untilAsset(api.services, first, idleIn("BASE_REVIEW"));
      await untilAsset(api.services, second, idleIn("BASE_REVIEW"));
      const response = await api.app.request(`/api/assets/export-zip?ids=${first},${second}&preset=web`);
      expect([response.status, response.headers.get("content-type")]).toEqual([200, "application/zip"]);
      expect(response.headers.get("content-disposition")).toContain('filename="gudang-2-aset-web.zip"');
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      expect(Object.keys(files)).toEqual(["peti-kayu-kartun-v1-web.glb", "peti-kayu-kartun-2-v1-web.glb"]);

      const empty = await api.services.assets.create({
        prompt: "[tanya] kursi",
        tierId: "ringan",
        files: [],
      });
      const noVersion = await api.app.request(`/api/assets/export-zip?ids=${first},${empty.id}&preset=web`);
      expect([noVersion.status, await errorCode(noVersion)]).toEqual([409, "NO_VERSION"]);
      for (const query of ["", "ids=&preset=web", `ids=${first}&preset=source`, "ids=../x&preset=web"]) {
        const bad = await api.app.request(`/api/assets/export-zip?${query}`);
        expect([query, bad.status, await errorCode(bad)]).toEqual([query, 400, "VALIDATION_FAILED"]);
      }

      // Pemeriksaan sebelum unduhan: GLB Unity dibuat lebih dulu; kesalahan menjadi JSON yang bisa ditampilkan app.
      const prepared = await post(
        "/api/assets/export-zip/prepare",
        json({ ids: [first, second], preset: "unity" }),
      );
      expect(prepared.status).toBe(200);
      const summary = z.object({ assets: z.number(), bytes: z.number() }).parse(await prepared.json());
      expect(summary.assets).toBe(2);
      expect(summary.bytes).toBeGreaterThan(0);
      const notReady = await post(
        "/api/assets/export-zip/prepare",
        json({ ids: [first, empty.id], preset: "unity" }),
      );
      expect([notReady.status, await errorCode(notReady)]).toEqual([409, "NO_VERSION"]);
      for (const body of [{}, { ids: [], preset: "web" }, { ids: [first], preset: "source" }]) {
        const bad = await post("/api/assets/export-zip/prepare", json(body));
        expect([body, bad.status, await errorCode(bad)]).toEqual([body, 400, "VALIDATION_FAILED"]);
      }
    },
    SLOW,
  );

  test(
    "thumbnail dan turntable versi dilayani sebagai WebP; versi tanpa thumbnail → 404",
    async () => {
      const id = await create("Peti kayu kartun");
      await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
      for (const file of ["thumb.webp", "turntable.webp"]) {
        const response = await api.app.request(`/api/assets/${id}/versions/1/${file}`);
        expect([file, response.status, response.headers.get("content-type")]).toEqual([
          file,
          200,
          "image/webp",
        ]);
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      }
      const missing = await api.app.request(`/api/assets/${id}/versions/2/thumb.webp`);
      expect([missing.status, await errorCode(missing)]).toEqual([404, "VERSION_NOT_FOUND"]);
      const unknown = await api.app.request("/api/assets/tidak-ada/versions/1/thumb.webp");
      expect(unknown.status).toBe(404);

      // Daftar dan detail menandai versi yang thumbnail-nya sudah ada.
      const ThumbFlags = z.object({
        assets: z.array(
          z.object({ id: z.string(), current: z.object({ thumbnail: z.boolean() }).nullable() }),
        ),
      });
      const listed = async () =>
        ThumbFlags.parse(await (await api.app.request("/api/assets")).json()).assets.find(
          (item) => item.id === id,
        )?.current?.thumbnail;
      const detailed = async () =>
        z
          .object({ versions: z.array(z.object({ thumbnail: z.boolean() })) })
          .parse(await (await api.app.request(`/api/assets/${id}`)).json())
          .versions.map((version) => version.thumbnail);
      expect([await listed(), await detailed()]).toEqual([true, [true]]);
      // Thumbnail hilang (mis. versi dari sebelum Tahap 10): ditandai belum ada, gambarnya 404 tanpa render di request.
      await rm(join(api.dataDir, "assets", id, "derived", "v1", "thumb.webp"));
      expect([await listed(), await detailed()]).toEqual([false, [false]]);
      const gone = await api.app.request(`/api/assets/${id}/versions/1/thumb.webp`);
      expect([gone.status, await errorCode(gone)]).toEqual([404, "FILE_NOT_FOUND"]);
    },
    SLOW,
  );

  test(
    "daftar Gudang: cari, filter, dan urut lewat query; total tanpa filter",
    async () => {
      const peti = await create("Peti kayu kartun");
      const lentera = await create("Lentera besi 50% karat");
      await untilAsset(api.services, peti, idleIn("BASE_REVIEW"));
      await untilAsset(api.services, lentera, idleIn("BASE_REVIEW"));
      // Kedua aset diproses bersamaan dengan jam nyata: waktu ubah diisi tetap supaya urutannya deterministik.
      for (const [id, at] of [
        [peti, 1000],
        [lentera, 2000],
      ] as const) {
        saveAssetState(api.handle.db, id, api.services.assets.get(id).state, at);
      }
      const ListBody = z.object({
        assets: z.array(
          z.object({
            id: z.string(),
            current: z.object({ n: z.number(), stage: z.string(), triangles: z.number() }).loose().nullable(),
            versionCount: z.number(),
            progress: z.unknown(),
          }),
        ),
        total: z.number(),
      });
      const ids = async (query: string) => {
        const body = ListBody.parse(await (await api.app.request(`/api/assets?${query}`)).json());
        return { ids: body.assets.map((asset) => asset.id), total: body.total };
      };
      expect(await ids("")).toEqual({ ids: [lentera, peti], total: 2 });
      expect(await ids("sort=oldest")).toEqual({ ids: [peti, lentera], total: 2 });
      expect(await ids("sort=name")).toEqual({ ids: [lentera, peti], total: 2 });
      expect(await ids(`q=${encodeURIComponent("50%")}`)).toEqual({ ids: [lentera], total: 2 });
      // Kata kunci hanya spasi = tanpa pencarian.
      expect(await ids("q=%20%20")).toEqual({ ids: [lentera, peti], total: 2 });
      expect(await ids("stage=done")).toEqual({ ids: [], total: 2 });
      expect(await ids("stage=base&tier=ringan&sort=oldest")).toEqual({ ids: [peti, lentera], total: 2 });
      expect(await ids("tier=maksimal")).toEqual({ ids: [], total: 2 });
      expect(await ids("since=1500")).toEqual({ ids: [lentera], total: 2 });
      const first = ListBody.parse(await (await api.app.request("/api/assets")).json()).assets[0];
      expect(first?.current).toMatchObject({ n: 1, stage: "base" });
      expect(first?.versionCount).toBe(1);
      expect(first?.progress).toBeNull();
    },
    SLOW,
  );

  test("gerbang di server: 404 aset tidak ada, 409 aksi di status yang salah", async () => {
    const unknown = await post("/api/assets/tidak-ada/stop");
    expect([unknown.status, await errorCode(unknown)]).toEqual([404, "ASSET_NOT_FOUND"]);
    const id = await create("Peti kayu");
    await untilAsset(api.services, id, idleIn("BASE_REVIEW"));
    const finish = await post(`/api/assets/${id}/finish`);
    expect([finish.status, await errorCode(finish)]).toEqual([409, "NOT_IN_REVIEW"]);
    const retry = await post(`/api/assets/${id}/retry`);
    expect([retry.status, await errorCode(retry)]).toEqual([409, "NOT_FAILED"]);
    const emptyMessage = await post(`/api/assets/${id}/messages`, form({ text: "   " }));
    expect([emptyMessage.status, await errorCode(emptyMessage)]).toEqual([400, "EMPTY_MESSAGE"]);
  });

  test("unggahan: tipe palsu 415, terlalu besar 413, terlalu banyak 400; tidak ada aset dibuat", async () => {
    const fake = await post(
      "/api/assets",
      form({ prompt: "x", tierId: "ringan" }, [new File(["<html>bukan gambar</html>"], "foto.png")]),
    );
    expect([fake.status, await errorCode(fake)]).toEqual([415, "UNSUPPORTED_FILE"]);

    const big = new Uint8Array(ATTACHMENT_IMAGE_MAX_BYTES + 1);
    big.set(await png());
    const large = await post(
      "/api/assets",
      form({ prompt: "x", tierId: "ringan" }, [new File([big], "a.png")]),
    );
    expect([large.status, await errorCode(large)]).toEqual([413, "FILE_TOO_LARGE"]);

    const many = Array.from(
      { length: ATTACHMENT_MAX_FILES + 1 },
      (_, index) => new File([stl()], `${index}.stl`),
    );
    const tooMany = await post("/api/assets", form({ prompt: "x", tierId: "ringan" }, many));
    expect([tooMany.status, await errorCode(tooMany)]).toEqual([400, "TOO_MANY_FILES"]);

    expect(await api.services.queries.list()).toEqual({ assets: [], total: 0 });
  });

  test("body JSON di atas batas → 413 PAYLOAD_TOO_LARGE", async () => {
    const response = await post(
      "/api/assets/a1/change-shape",
      json({ text: "x".repeat(JSON_BODY_MAX_BYTES) }),
    );
    expect(response.status).toBe(413);
    expect(ErrorBody.parse(await response.json())).toEqual({
      code: "PAYLOAD_TOO_LARGE",
      message: "Permintaan terlalu besar (maksimal 256 KB).",
    });
  });

  test("pagar: Origin asing ditolak 403 untuk aksi dan untuk upgrade WebSocket", async () => {
    const action = await post("/api/assets", {
      ...form({ prompt: "x", tierId: "ringan" }),
      headers: { origin: "http://evil.example" },
    });
    expect([action.status, await errorCode(action)]).toEqual([403, "FORBIDDEN"]);
    const upgrade = await api.app.request("/api/ws", {
      headers: { origin: "http://evil.example", upgrade: "websocket", connection: "Upgrade" },
    });
    expect(upgrade.status).toBe(403);
    const rebinding = await api.app.request("/api/ws", {
      headers: { host: "evil.example", upgrade: "websocket", connection: "Upgrade" },
    });
    expect(rebinding.status).toBe(403);
    expect(await api.services.queries.list()).toEqual({ assets: [], total: 0 });
  });
});
