/**
 * WebSocket `/api/ws` lewat server Bun sungguhan (port acak di 127.0.0.1): pagar sebelum upgrade, batas ukuran pesan,
 * protokol sub/ready/replay, dan penutupan saat server berhenti. Protokol rinci (backpressure, resync, detak) diuji
 * di `hub.test.ts` dengan soket palsu.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { websocket } from "@hono/bun";
import { WS_MAX_PAYLOAD_BYTES } from "../../shared/limits.ts";
import { idleIn, openTestApi, type TestApi, untilAsset } from "../../tests/support/api.ts";
import { TestSocket } from "../../tests/support/ws.ts";
import { CLOSE_GOING_AWAY } from "./hub.ts";

const SLOW = 30_000;

let server: ReturnType<typeof Bun.serve> | undefined;
let api: TestApi | undefined;
let url = "";
let origin = "";
const clients: TestSocket[] = [];

function connect(from = origin): TestSocket {
  const client = new TestSocket(url, { origin: from });
  clients.push(client);
  return client;
}

function testApi(): TestApi {
  if (api === undefined) throw new Error("API belum siap");
  return api;
}

beforeAll(async () => {
  // Port 0 = port bebas acak. App dibuat setelah port diketahui, supaya Origin halaman app sah di pagar.
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request, srv) => api?.app.fetch(request, srv) ?? new Response("belum siap", { status: 503 }),
    websocket: {
      ...websocket,
      maxPayloadLength: WS_MAX_PAYLOAD_BYTES,
      drain: (ws) => api?.services.hub.drain(ws),
    },
  });
  api = await openTestApi({ allowedPorts: [server.port ?? 0] });
  url = `ws://127.0.0.1:${server.port}/api/ws`;
  origin = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  for (const client of clients) client.socket.close();
  await api?.close();
  await server?.stop(true);
});

describe("WebSocket /api/ws", () => {
  test(
    "global + aset: event datang setelah ready; sambung ulang dengan after me-replay tanpa celah",
    async () => {
      const live = connect();
      expect(await live.opened).toEqual({ kind: "open" });
      live.send({ op: "sub", sid: 1, topic: "global" });
      await live.ready(1);

      const created = await testApi().services.assets.create({ prompt: "Peti kayu", tierId: "ringan" });
      await live.until((received) =>
        received.some((m) => "event" in m && m.event.type === "asset" && m.event.change === "created"),
      );
      live.send({ op: "sub", sid: 2, topic: `asset:${created.id}` });
      await untilAsset(testApi().services, created.id, idleIn("BASE_REVIEW"));
      const last = testApi().services.queries.events(created.id).events.at(-1)?.seq ?? 0;
      await live.until(() => live.timeline(2).includes(last));

      // Klien yang tertinggal sejak seq 3 menerima sisanya sebelum ready, berurutan.
      const late = connect();
      await late.opened;
      late.send({ op: "sub", sid: 9, topic: `asset:${created.id}`, after: 3 });
      await late.ready(9);
      const expected = Array.from({ length: last - 3 }, (_, index) => index + 4);
      expect(late.timeline(9)).toEqual([...expected, "ready"]);
    },
    SLOW,
  );

  test("handshake dari Origin asing ditolak sebelum upgrade", async () => {
    const outcome = await connect("http://evil.example").opened;
    expect(outcome.kind).not.toBe("open");
  });

  test(`pesan di atas ${WS_MAX_PAYLOAD_BYTES} byte → sambungan ditutup`, async () => {
    const client = connect();
    await client.opened;
    client.socket.send("x".repeat(WS_MAX_PAYLOAD_BYTES + 1));
    expect(await client.closed).toBe(1009);
  });

  test("server berhenti → klien menerima kode 1001 dan bisa menyambung ulang nanti", async () => {
    const client = connect();
    await client.opened;
    client.send({ op: "sub", sid: 1, topic: "global" });
    await client.ready(1);
    testApi().services.hub.stop();
    expect(await client.closed).toBe(CLOSE_GOING_AWAY);
  });
});
