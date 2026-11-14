import { describe, expect, test } from "bun:test";
import { AgentPool, type Lease, PoolAbortedError, type PoolMember } from "./pool.ts";

class Member implements PoolMember {
  evictable = false;
  evicted = 0;
  lease: Lease | undefined;

  evict(): void {
    this.evicted += 1;
    this.lease?.release();
    this.lease = undefined;
  }
}

async function hold(pool: AgentPool, member: Member): Promise<Member> {
  member.lease = await pool.acquire(member);
  return member;
}

describe("AgentPool", () => {
  test("memberi slot sampai penuh tanpa menunggu", async () => {
    const pool = new AgentPool({ size: 2 });
    await hold(pool, new Member());
    expect(pool.wouldWait()).toBe(false);
    await hold(pool, new Member());
    expect(pool.live).toBe(2);
    expect(pool.wouldWait()).toBe(true);
  });

  test("penuh → proses idle yang paling lama tidak dipakai (LRU) ditutup", async () => {
    const pool = new AgentPool({ size: 2 });
    const a = await hold(pool, new Member());
    const b = await hold(pool, new Member());
    a.evictable = true;
    b.evictable = true;
    a.lease?.touch();
    expect(pool.wouldWait()).toBe(false);
    const c = await hold(pool, new Member());
    expect([a.evicted, b.evicted]).toEqual([0, 1]);
    expect(c.lease).toBeDefined();
    expect(pool.live).toBe(2);
  });

  test("semua sibuk → antre FIFO; slot dilepas → antrean pertama dilayani", async () => {
    const pool = new AgentPool({ size: 1 });
    const busy = await hold(pool, new Member());
    const order: string[] = [];
    const first = pool.acquire(new Member()).then((lease) => {
      order.push("pertama");
      return lease;
    });
    const second = pool.acquire(new Member()).then((lease) => {
      order.push("kedua");
      return lease;
    });
    expect(pool.waiting).toBe(2);
    busy.lease?.release();
    const lease = await first;
    expect(order).toEqual(["pertama"]);
    lease.release();
    lease.release();
    (await second).release();
    expect(order).toEqual(["pertama", "kedua"]);
    expect(pool.live).toBe(0);
  });

  test("proses yang baru idle langsung ditutup bila ada yang antre", async () => {
    const pool = new AgentPool({ size: 1 });
    const runner = await hold(pool, new Member());
    const waiting = pool.acquire(null);
    pool.notifyIdle(runner);
    expect(runner.evicted).toBe(0);
    runner.evictable = true;
    pool.notifyIdle(runner);
    expect(runner.evicted).toBe(1);
    (await waiting).release();
    // Tanpa antrean, proses idle dibiarkan hidup.
    const other = await hold(pool, new Member());
    other.evictable = true;
    pool.notifyIdle(other);
    expect(other.evicted).toBe(0);
  });

  test("permintaan antre bisa dibatalkan", async () => {
    const pool = new AgentPool({ size: 1 });
    await hold(pool, new Member());
    const controller = new AbortController();
    const pending = pool.acquire(new Member(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(PoolAbortedError);
    expect(pool.waiting).toBe(0);
    await expect(pool.acquire(null, controller.signal)).rejects.toBeInstanceOf(PoolAbortedError);
  });

  test("cek kesehatan memakai satu slot dan melepasnya, juga saat gagal", async () => {
    const pool = new AgentPool({ size: 1 });
    expect(await pool.withSlot(async () => pool.live)).toBe(1);
    await expect(
      pool.withSlot(async () => {
        throw new Error("gagal");
      }),
    ).rejects.toThrow("gagal");
    expect(pool.live).toBe(0);
  });

  test("ukuran tidak valid ditolak", () => {
    expect(() => new AgentPool({ size: 0 })).toThrow(RangeError);
  });
});
