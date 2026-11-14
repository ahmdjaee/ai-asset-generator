/**
 * Pembatas jumlah pekerjaan yang berjalan bersamaan. Di-port dari ai-team `server/agent/semaphore.ts`, dengan dua
 * perubahan: tanpa constructor parameter property (TS `erasableSyntaxOnly`), dan antrean bisa dibatalkan lewat
 * `AbortSignal` supaya job yang dibatalkan saat masih antre tidak menunggu giliran.
 */
export class AbortedWhileWaiting extends Error {
  constructor() {
    super("Dibatalkan saat menunggu giliran");
    this.name = "AbortedWhileWaiting";
  }
}

type Waiter = { grant: () => void };

export class Semaphore {
  private readonly size: number;
  private available: number;
  private readonly waiters: Waiter[] = [];

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError("Ukuran semaphore minimal 1");
    this.size = size;
    this.available = size;
  }

  get inUse(): number {
    return this.size - this.available;
  }

  get waiting(): number {
    return this.waiters.length;
  }

  /** Menunggu giliran. Hasilnya fungsi `release` yang aman dipanggil lebih dari sekali. */
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new AbortedWhileWaiting();
    if (this.available > 0) {
      this.available -= 1;
      return this.releaseOnce();
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
      };
      const onAbort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index !== -1) this.waiters.splice(index, 1);
        reject(new AbortedWhileWaiting());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
    return this.releaseOnce();
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next.grant();
      else this.available += 1;
    };
  }
}
