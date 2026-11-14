import type { Clock } from "@/lib/clock.tsx";

type Timer = { ms: number; due: number; repeat: boolean; run: () => void };

/** Jam palsu untuk tes: waktu hanya maju lewat `advance`, yang juga menjalankan timer yang jatuh tempo, urut waktunya. */
export class FakeClock implements Clock {
  #now: number;
  readonly #timers = new Set<Timer>();

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  every(ms: number, tick: () => void): () => void {
    return this.#add({ ms, due: this.#now + ms, repeat: true, run: tick });
  }

  after(ms: number, run: () => void): () => void {
    return this.#add({ ms, due: this.#now + ms, repeat: false, run });
  }

  get pending(): number {
    return this.#timers.size;
  }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      let next: Timer | null = null;
      for (const timer of this.#timers)
        if (timer.due <= target && (next === null || timer.due < next.due)) next = timer;
      if (next === null) break;
      this.#now = next.due;
      if (next.repeat) next.due += next.ms;
      else this.#timers.delete(next);
      next.run();
    }
    this.#now = target;
  }

  #add(timer: Timer): () => void {
    this.#timers.add(timer);
    return () => {
      this.#timers.delete(timer);
    };
  }
}
