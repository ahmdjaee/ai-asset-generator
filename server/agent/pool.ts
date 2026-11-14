/**
 * Pool proses Claude (PLAN Lampiran G): paling banyak `AGENT_POOL_SIZE` proses Claude Code hidup sekaligus, termasuk
 * cek kesehatan. RAM mesin terbatas, dan setiap proses memakan ratusan MB.
 * - Runner meminta slot sebelum memulai proses. Bila penuh, proses idle yang paling lama tidak dipakai (LRU)
 *   ditutup; sesinya tetap bisa di-resume.
 * - Proses yang sedang bekerja atau menunggu jawaban pemilik tidak pernah ditutup. Bila semua slot dipakai proses
 *   seperti itu, permintaan antre (FIFO) sampai ada slot.
 */
import { AGENT_POOL_SIZE } from "../../shared/limits.ts";

/** Pemegang slot yang prosesnya boleh ditutup pool saat idle. */
export interface PoolMember {
  /** `true` bila prosesnya boleh ditutup sekarang (tanpa giliran, antrean pesan, atau pertanyaan terbuka). */
  readonly evictable: boolean;
  /** Menutup proses dan melepas slot (session id tetap disimpan untuk resume). */
  evict(): void;
}

export type Lease = Readonly<{
  /** Aman dipanggil lebih dari sekali. */
  release(): void;
  /** Menandai slot baru dipakai (urutan LRU). */
  touch(): void;
}>;

export class PoolAbortedError extends Error {
  readonly code = "POOL_ABORTED";

  constructor() {
    super("Permintaan slot proses Claude dibatalkan");
    this.name = "PoolAbortedError";
  }
}

type Slot = { member: PoolMember | null; lastUsed: number };
type Waiter = { member: PoolMember | null; grant: (lease: Lease) => void };

export class AgentPool {
  readonly size: number;
  readonly #slots = new Set<Slot>();
  readonly #waiters: Waiter[] = [];
  /** Penanda urutan LRU yang selalu naik (tanpa jam, jadi tes tetap deterministik). */
  #tick = 0;

  constructor(options: { size?: number } = {}) {
    const size = options.size ?? AGENT_POOL_SIZE;
    if (!Number.isInteger(size) || size < 1) throw new RangeError("Ukuran pool minimal 1");
    this.size = size;
  }

  get live(): number {
    return this.#slots.size;
  }

  get waiting(): number {
    return this.#waiters.length;
  }

  /** `true` bila permintaan slot saat ini harus antre (penuh dan tidak ada proses idle yang bisa ditutup). */
  wouldWait(): boolean {
    return this.#slots.size >= this.size && this.#evictionCandidate() === undefined;
  }

  /** Meminta slot. `member` null untuk pemakaian singkat yang tidak bisa ditutup pool (cek kesehatan). */
  async acquire(member: PoolMember | null, signal?: AbortSignal): Promise<Lease> {
    if (signal?.aborted) throw new PoolAbortedError();
    if (this.#slots.size >= this.size) this.#evictOne();
    if (this.#slots.size < this.size) return this.#grant(member);
    return new Promise<Lease>((resolve, reject) => {
      const waiter: Waiter = {
        member,
        grant: (lease) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(lease);
        },
      };
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index !== -1) this.#waiters.splice(index, 1);
        reject(new PoolAbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  /** Menjalankan pekerjaan singkat (mis. `accountInfo()` untuk cek kesehatan) di dalam satu slot. */
  async withSlot<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const lease = await this.acquire(null, signal);
    try {
      return await work();
    } finally {
      lease.release();
    }
  }

  /** Runner baru saja idle: bila ada yang antre, prosesnya langsung ditutup supaya slotnya dipakai. */
  notifyIdle(member: PoolMember): void {
    if (this.#waiters.length > 0 && member.evictable) member.evict();
  }

  #grant(member: PoolMember | null): Lease {
    const slot: Slot = { member, lastUsed: this.#stamp() };
    this.#slots.add(slot);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#slots.delete(slot);
        this.#drain();
      },
      touch: () => {
        slot.lastUsed = this.#stamp();
      },
    };
  }

  #stamp(): number {
    this.#tick += 1;
    return this.#tick;
  }

  #evictionCandidate(): Slot | undefined {
    let oldest: Slot | undefined;
    for (const slot of this.#slots) {
      if (slot.member === null || !slot.member.evictable) continue;
      if (oldest === undefined || slot.lastUsed < oldest.lastUsed) oldest = slot;
    }
    return oldest;
  }

  #evictOne(): void {
    // `evict()` wajib melepas slot-nya; bila tidak, slot tetap dihitung dan permintaan antre.
    this.#evictionCandidate()?.member?.evict();
  }

  #drain(): void {
    while (this.#waiters.length > 0) {
      if (this.#slots.size >= this.size) this.#evictOne();
      if (this.#slots.size >= this.size) return;
      const waiter = this.#waiters.shift();
      if (waiter === undefined) return;
      waiter.grant(this.#grant(waiter.member));
    }
  }
}
