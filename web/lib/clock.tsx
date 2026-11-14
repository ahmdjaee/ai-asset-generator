import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

/**
 * Jam yang disuntikkan (AGENTS §10): komponen membaca waktu lewat `useNow`, bukan `Date.now()` langsung, sehingga tes
 * memakai jam palsu tanpa timer sungguhan.
 */
export interface Clock {
  now(): number;
  /** Memanggil `tick` tiap `ms`; mengembalikan pembatal. */
  every(ms: number, tick: () => void): () => void;
  /** Memanggil `run` sekali setelah `ms`; mengembalikan pembatal. */
  after(ms: number, run: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  every: (ms, tick) => {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  },
  after: (ms, run) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

const ClockContext = createContext<Clock>(systemClock);

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): Clock {
  return useContext(ClockContext);
}

/** Waktu sekarang; diperbarui tiap `intervalMs` selama `live` (mis. lama proses yang sedang berjalan). */
export function useNow(live: boolean, intervalMs = 1_000): number {
  const clock = useClock();
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => {
    if (!live) return;
    setNow(clock.now());
    return clock.every(intervalMs, () => setNow(clock.now()));
  }, [clock, live, intervalMs]);
  return live ? now : clock.now();
}
