import { describe, expect, test } from "bun:test";
import {
  DuplicateJobError,
  HeavyLane,
  JobCancelledError,
  type JobContext,
  type LaneEvent,
} from "./heavy-lane.ts";
import { AbortedWhileWaiting, Semaphore } from "./semaphore.ts";

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Pekerjaan palsu yang selesai saat `gate` di-resolve, atau gagal saat dibatalkan (seperti `runJob`). */
function gatedWork(gate: Deferred<string>, started?: (context: JobContext) => void) {
  return (context: JobContext): Promise<string> => {
    started?.(context);
    context.signal.addEventListener("abort", () => gate.reject(new Error("container di-kill")));
    return gate.promise;
  };
}

function setup() {
  let clock = 0;
  const lane = new HeavyLane({ now: () => clock });
  const events: LaneEvent[] = [];
  lane.on((event) => events.push(event));
  return { lane, events, tick: (ms: number) => (clock += ms) };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("HeavyLane", () => {
  test("job berjalan satu per satu sesuai urutan", async () => {
    const { lane, events, tick } = setup();
    const first = deferred<string>();
    const second = deferred<string>();
    const a = lane.run({ jobId: "a", kind: "build" }, gatedWork(first));
    const b = lane.run({ jobId: "b", kind: "render" }, gatedWork(second));
    await flush();
    expect(lane.running).toEqual(["a"]);
    expect(lane.queued).toEqual(["b"]);

    tick(1500);
    first.resolve("hasil-a");
    expect(await a).toBe("hasil-a");
    await flush();
    expect(lane.running).toEqual(["b"]);
    second.resolve("hasil-b");
    expect(await b).toBe("hasil-b");

    expect(events).toEqual([
      { type: "queued", jobId: "a", kind: "build", ahead: 0 },
      { type: "queued", jobId: "b", kind: "render", ahead: 1 },
      { type: "started", jobId: "a", kind: "build" },
      { type: "finished", jobId: "a", durationMs: 1500 },
      { type: "started", jobId: "b", kind: "render" },
      { type: "finished", jobId: "b", durationMs: 0 },
    ]);
  });

  test("progres diteruskan sebagai event", async () => {
    const { lane, events } = setup();
    await lane.run({ jobId: "p", kind: "build" }, async ({ progress }) => {
      progress("ekspor", 50);
      return 1;
    });
    expect(events).toContainEqual({ type: "progress", jobId: "p", step: "ekspor", pct: 50 });
  });

  test("batal saat antre: job dilepas tanpa pernah berjalan", async () => {
    const { lane, events } = setup();
    const first = deferred<string>();
    let secondStarted = false;
    const a = lane.run({ jobId: "a", kind: "build" }, gatedWork(first));
    const b = lane.run({ jobId: "b", kind: "build" }, async () => {
      secondStarted = true;
      return "b";
    });
    await flush();
    expect(lane.cancel("b")).toBe(true);
    await expect(b).rejects.toBeInstanceOf(JobCancelledError);
    first.resolve("a");
    await a;
    expect(secondStarted).toBe(false);
    expect(events).toContainEqual({ type: "cancelled", jobId: "b", stage: "queued" });
    expect(lane.queued).toEqual([]);
  });

  test("batal saat berjalan: pekerjaan menerima abort dan slot dilepas setelah selesai", async () => {
    const { lane, events } = setup();
    const gate = deferred<string>();
    let seenSignal: AbortSignal | undefined;
    const a = lane.run(
      { jobId: "a", kind: "build" },
      gatedWork(gate, (context) => (seenSignal = context.signal)),
    );
    const b = lane.run({ jobId: "b", kind: "build" }, async () => "b");
    await flush();
    lane.cancel("a");
    expect(seenSignal?.aborted).toBe(true);
    await expect(a).rejects.toBeInstanceOf(JobCancelledError);
    expect(await b).toBe("b");
    expect(events.filter((event) => event.type === "cancelled")).toEqual([
      { type: "cancelled", jobId: "a", stage: "running" },
    ]);
  });

  test("pekerjaan yang tetap selesai setelah dibatalkan tetap dianggap batal", async () => {
    const { lane } = setup();
    const result = lane.run({ jobId: "a", kind: "build" }, async ({ signal }) => {
      await flush();
      expect(signal.aborted).toBe(true);
      return "terlambat";
    });
    lane.cancel("a");
    await expect(result).rejects.toBeInstanceOf(JobCancelledError);
  });

  test("AbortSignal pemanggil membatalkan job, termasuk yang sudah batal sebelum masuk", async () => {
    const { lane } = setup();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      lane.run({ jobId: "x", kind: "build", signal: aborted.signal }, async () => 1),
    ).rejects.toBeInstanceOf(JobCancelledError);

    const controller = new AbortController();
    const gate = deferred<string>();
    const run = lane.run({ jobId: "y", kind: "build", signal: controller.signal }, gatedWork(gate));
    await flush();
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(JobCancelledError);
  });

  test("error pekerjaan diteruskan dan dicatat sebagai failed", async () => {
    const { lane, events } = setup();
    await expect(
      lane.run({ jobId: "e", kind: "build" }, async () => {
        throw new Error("skrip rusak");
      }),
    ).rejects.toThrow("skrip rusak");
    expect(events.at(-1)).toEqual({ type: "failed", jobId: "e", durationMs: 0, message: "skrip rusak" });
    expect(await lane.run({ jobId: "f", kind: "build" }, async () => "lanjut")).toBe("lanjut");
  });

  test("jobId ganda ditolak; cancel job tak dikenal → false", async () => {
    const { lane } = setup();
    const gate = deferred<string>();
    const a = lane.run({ jobId: "a", kind: "build" }, gatedWork(gate));
    await expect(lane.run({ jobId: "a", kind: "build" }, async () => "x")).rejects.toBeInstanceOf(
      DuplicateJobError,
    );
    expect(lane.cancel("tidak-ada")).toBe(false);
    gate.resolve("a");
    await a;
  });
});

describe("Semaphore", () => {
  test("release dua kali tidak menambah slot", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    expect(semaphore.inUse).toBe(0);
    await semaphore.acquire();
    expect(semaphore.inUse).toBe(1);
  });

  test("menunggu yang dibatalkan keluar dari antrean", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const waiting = semaphore.acquire(controller.signal);
    expect(semaphore.waiting).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AbortedWhileWaiting);
    expect(semaphore.waiting).toBe(0);
    release();
    expect(semaphore.inUse).toBe(0);
  });

  test("ukuran tidak valid ditolak", () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
  });
});
