/**
 * Antrean pesan sebagai async iterable: prompt SDK (pesan pengguna) dan aliran pesan agent palsu.
 * Iterator tidak pernah selesai sebelum `end()`: bila prompt stream berakhir, Claude Code menutup sesi.
 */
export class InputQueue<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #drainWaiters: Array<() => void> = [];
  #wake: (() => void) | undefined;
  #ended = false;

  push(item: T): void {
    if (this.#ended) throw new Error("antrean input sudah ditutup");
    this.#items.push(item);
    this.#notify();
  }

  end(): void {
    this.#ended = true;
    this.#notify();
    this.#releaseDrainWaiters();
  }

  get ended(): boolean {
    return this.#ended;
  }

  /**
   * Selesai saat semua item sudah diambil dan pembaca sedang menunggu item berikutnya, artinya pembaca `for await`
   * sudah selesai memproses item terakhir. Juga selesai bila antrean ditutup.
   */
  drained(): Promise<void> {
    if (this.#ended || (this.#items.length === 0 && this.#wake !== undefined)) return Promise.resolve();
    return new Promise((resolve) => {
      this.#drainWaiters.push(resolve);
    });
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }

  #releaseDrainWaiters(): void {
    for (const resolve of this.#drainWaiters.splice(0)) resolve();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    for (;;) {
      const item = this.#items.shift();
      if (item !== undefined) {
        yield item;
        continue;
      }
      if (this.#ended) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
        this.#releaseDrainWaiters();
      });
    }
  }
}
