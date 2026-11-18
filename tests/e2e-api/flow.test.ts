/**
 * `bun run e2e:api` (PLAN Tahap 6): alur penuh lewat HTTP + WebSocket terhadap proses server sungguhan
 * (`bun server/main.ts`, port 4342) dalam mode palsu: `AGENT_DRIVER=fake`, `RUNTIME_DRIVER=fixture`. Tanpa Docker,
 * tanpa kuota, tanpa jaringan luar. Client HTTP memakai `hc<AppType>`, jadi kontrak bertipe web ikut teruji.
 *
 * Alur: buat aset berlampiran → kartu pertanyaan → jawab → review bentuk dasar → revisi → setujui → tekstur → selesai
 * → unduh `web.glb`. Status diikuti dari event WebSocket + snapshot HTTP setelah `ready` (seperti klien web).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { hc } from "hono/client";
import sharp from "sharp";
import { z } from "zod";
import { createTestLibrary } from "../../server/agent/forge/test-builder.ts";
import { STYLE_QUESTION } from "../../server/agent/scenarios.ts";
import type { AppType } from "../../server/app.ts";
import type { StoredEvent } from "../../shared/asset-events.ts";
import { E2E_PORT } from "../../shared/ports.ts";
import { removeTree } from "../support/api.ts";
import { TestSocket } from "../support/ws.ts";

const ROOT = join(import.meta.dir, "../..");
const BASE = `http://127.0.0.1:${E2E_PORT}`;
const FLOW_TIMEOUT = 60_000;
/**
 * Batas puncak memori proses server (RSS) selama satu alur penuh mode palsu (Tahap 12). Terukur 220 MB (2026-11-18); batas
 * memberi ruang tanpa membiarkan kebocoran besar lolos. Chromium renderer adalah proses terpisah (tidak dihitung).
 */
const SERVER_PEAK_RSS_BUDGET_KB = 400 * 1024;

const LogLine = z.object({ level: z.number(), msg: z.string() }).loose();

let server: Subprocess<"ignore", "pipe", "pipe"> | undefined;
let dataDir = "";
const logLines: Array<z.infer<typeof LogLine>> = [];

/** Port 4342 harus bebas; bila tidak, berhenti dengan pesan jelas (bukan diam-diam menguji proses lain). */
async function ensurePortFree(): Promise<void> {
  let probe: ReturnType<typeof Bun.serve>;
  try {
    probe = Bun.serve({ hostname: "127.0.0.1", port: E2E_PORT, fetch: () => new Response() });
  } catch {
    throw new Error(
      `Port ${E2E_PORT} sudah dipakai proses lain; hentikan dulu (mis. server E2E Playwright).`,
    );
  }
  await probe.stop(true);
}

/**
 * Membaca log JSON server baris demi baris (tanpa sleep). Selesai saat `server berjalan` tercatat; gagal bila proses
 * keluar lebih dulu. Pembacaan berlanjut sampai proses selesai, supaya semua baris log ikut dicek di akhir.
 */
function readLogs(proc: Subprocess<"ignore", "pipe", "pipe">): {
  started: Promise<void>;
  done: Promise<void>;
} {
  let markStarted: () => void = () => undefined;
  let failStart: (error: Error) => void = () => undefined;
  let started = false;
  const startedPromise = new Promise<void>((resolve, reject) => {
    markStarted = resolve;
    failStart = reject;
  });
  const done = (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const parsed = LogLine.safeParse(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        if (parsed.success) {
          logLines.push(parsed.data);
          if (parsed.data.msg === "server berjalan" && !started) {
            started = true;
            markStarted();
          }
        }
        newline = buffer.indexOf("\n");
      }
    }
    if (!started) {
      failStart(new Error(`server keluar sebelum siap: ${await new Response(proc.stderr).text()}`));
    }
  })();
  return { started: startedPromise, done };
}

let logsDone: Promise<void> = Promise.resolve();

beforeAll(async () => {
  await ensurePortFree();
  dataDir = await mkdtemp(join(tmpdir(), "aag-e2e-api-"));
  await createTestLibrary(join(dataDir, "library", "materials"));
  server = Bun.spawn(["bun", "server/main.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(E2E_PORT),
      DATA_DIR: dataDir,
      AGENT_DRIVER: "fake",
      RUNTIME_DRIVER: "fixture",
      NODE_ENV: "test",
      LOG_LEVEL: "info",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const logs = readLogs(server);
  logsDone = logs.done;
  await logs.started;
}, 30_000);

/** Puncak RSS proses (`VmHWM`, kB) dari `/proc`; null bila tidak tersedia (bukan Linux). */
async function peakRssKb(pid: number): Promise<number | null> {
  const status = await Bun.file(`/proc/${pid}/status`)
    .text()
    .catch(() => "");
  const match = /^VmHWM:\s+(\d+) kB$/m.exec(status);
  return match?.[1] === undefined ? null : Number(match[1]);
}

afterAll(async () => {
  if (server !== undefined) {
    const peak = await peakRssKb(server.pid);
    if (peak !== null) {
      console.log(`puncak RSS server selama alur: ${Math.round(peak / 1024)} MB`);
      expect(peak).toBeLessThan(SERVER_PEAK_RSS_BUDGET_KB);
    }
    server.kill("SIGTERM");
    expect(await server.exited).toBe(0);
    await logsDone;
  }
  await removeTree(dataDir);
  // Definisi selesai: tidak ada error/warning di log server (pino: 40 = warn, 50 = error).
  expect(logLines.filter((line) => line.level >= 40)).toEqual([]);
});

/** Thread aset di klien: snapshot HTTP + event WebSocket, digabung per seq (seperti klien web). */
class ThreadView {
  readonly #events = new Map<number, StoredEvent>();

  merge(events: readonly StoredEvent[]): void {
    for (const stored of events) if (stored.seq !== null) this.#events.set(stored.seq, stored);
  }

  get events(): StoredEvent[] {
    return [...this.#events.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  latestState() {
    const states = this.events.flatMap((stored) => (stored.event.type === "state" ? [stored.event] : []));
    return states.at(-1);
  }
}

describe("e2e:api — mode palsu", () => {
  test(
    "buat → tanya → jawab → review → revisi → setujui → tekstur → selesai → unduh web.glb",
    async () => {
      const client = hc<AppType>(BASE);
      const ws = new TestSocket(`ws://127.0.0.1:${E2E_PORT}/api/ws`);
      expect(await ws.opened).toEqual({ kind: "open" });
      ws.send({ op: "sub", sid: 1, topic: "global" });
      await ws.ready(1);

      const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#8a5a2b" } })
        .png()
        .toBuffer();
      const created = await client.api.assets.$post({
        form: {
          prompt: "Peti kayu kartun dengan sabuk logam [tanya]",
          tierId: "ringan",
          "files[]": [new File([new Uint8Array(photo)], "referensi.png")],
        },
      });
      expect(created.status).toBe(201);
      if (!created.ok) throw new Error(await created.text());
      const { asset } = await created.json();
      const id = asset.id;

      // Langganan aset, lalu snapshot HTTP setelah `ready` (tidak ada event yang terlewat di antaranya).
      const view = new ThreadView();
      ws.send({ op: "sub", sid: 2, topic: `asset:${id}` });
      await ws.ready(2);
      const snapshot = await client.api.assets[":id"].events.$get({ param: { id }, query: { limit: "500" } });
      if (!snapshot.ok) throw new Error(await snapshot.text());
      view.merge((await snapshot.json()).events);

      const until = async (predicate: (view: ThreadView) => boolean): Promise<void> => {
        view.merge(ws.thread(2));
        if (predicate(view)) return;
        await ws.until(() => {
          view.merge(ws.thread(2));
          return predicate(view);
        });
      };
      const idleIn = (status: string) => (current: ThreadView) => {
        const state = current.latestState();
        return state?.status === status && state.runState === "idle";
      };

      // 1. Kartu pertanyaan → jawab.
      await until((current) => current.latestState()?.runState === "waiting_user");
      const question = view.events.find((stored) => stored.event.type === "question")?.event;
      if (question?.type !== "question") throw new Error("kartu pertanyaan tidak ada di thread");
      const answered = await client.api.assets[":id"].answers[":questionId"].$post({
        param: { id, questionId: question.questionId },
        json: { answers: { [STYLE_QUESTION]: { selected: ["Kartun"] } } },
      });
      expect(answered.status).toBe(200);

      // 2. Review bentuk dasar → revisi → review lagi.
      await until(idleIn("BASE_REVIEW"));
      const firstBase = view.latestState()?.currentVersion;
      const revised = await client.api.assets[":id"].revise.$post({
        param: { id },
        form: { text: "Tutupnya sedikit lebih tinggi" },
      });
      expect(revised.status).toBe(200);
      await until(
        (current) => idleIn("BASE_REVIEW")(current) && current.latestState()?.currentVersion !== firstBase,
      );

      // 3. Setujui → tekstur → selesai.
      const approved = await client.api.assets[":id"].approve.$post({
        param: { id },
        json: { note: "kayu gelap" },
      });
      expect(approved.status).toBe(200);
      await until(idleIn("TEXTURE_REVIEW"));
      const finished = await client.api.assets[":id"].finish.$post({ param: { id } });
      if (!finished.ok) throw new Error(await finished.text());
      expect((await finished.json()).asset.status).toBe("DONE");

      // 4. Unduh web.glb versi final.
      const detail = await client.api.assets[":id"].$get({ param: { id } });
      if (!detail.ok) throw new Error(await detail.text());
      const body = await detail.json();
      const final = body.versions.at(-1);
      expect(final?.stage).toBe("textured");
      expect(body.attachments.map((attachment) => attachment.name)).toEqual(["referensi.png"]);
      const glb = await client.api.assets[":id"].versions[":version"][":file"].$get({
        param: { id, version: String(final?.n), file: "web.glb" },
      });
      expect(glb.status).toBe(200);
      expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
      const bytes = new Uint8Array(await glb.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");

      // Thread: urutan aksi pemilik (event `finish` datang lewat WebSocket setelah respons HTTP); topik global
      // memberi tahu aset dibuat dan berubah.
      const isFinish = (stored: StoredEvent) =>
        stored.event.type === "action" && stored.event.action === "finish";
      await until((current) => current.events.some(isFinish));
      const actions = view.events.flatMap((stored) =>
        stored.event.type === "action" ? [stored.event.action] : [],
      );
      expect(actions).toEqual(["approve", "finish"]);
      const changes = ws.received.flatMap((message) =>
        "sid" in message && message.sid === 1 && "event" in message && message.event.type === "asset"
          ? [message.event.change]
          : [],
      );
      expect(changes[0]).toBe("created");
      expect(changes).toContain("updated");
      ws.socket.close();
    },
    FLOW_TIMEOUT,
  );
});
