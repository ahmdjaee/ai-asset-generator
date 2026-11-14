import { describe, expect, test } from "bun:test";
import { InputQueue } from "./input-queue.ts";

describe("InputQueue", () => {
  test("item dibaca berurutan; iterator selesai setelah end()", async () => {
    const queue = new InputQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.end();
    const read: number[] = [];
    for await (const item of queue) read.push(item);
    expect(read).toEqual([1, 2]);
    expect(queue.ended).toBe(true);
    expect(() => queue.push(3)).toThrow("antrean input sudah ditutup");
  });

  test("drained() menunggu sampai pembaca selesai memproses item terakhir dan meminta item berikutnya", async () => {
    const queue = new InputQueue<string>();
    const log: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = (async () => {
      for await (const item of queue) {
        log.push(`mulai ${item}`);
        if (item === "b") await gate;
        log.push(`selesai ${item}`);
      }
    })();

    queue.push("a");
    queue.push("b");
    let drained = false;
    const done = queue.drained().then(() => {
      drained = true;
    });
    // Pembaca masih tertahan di "b": belum terkuras.
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await done;
    expect(log).toEqual(["mulai a", "selesai a", "mulai b", "selesai b"]);

    // Sudah terkuras dan pembaca menunggu: langsung selesai.
    await queue.drained();
    queue.end();
    await reader;
  });

  test("drained() selesai saat antrean ditutup walau tidak ada pembaca", async () => {
    const queue = new InputQueue<number>();
    queue.push(1);
    const waiting = queue.drained();
    queue.end();
    await waiting;
    expect(await queue.drained()).toBeUndefined();
  });
});
