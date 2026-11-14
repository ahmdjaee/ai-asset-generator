/** Repositori pengaturan (kunci → JSON). Nilai divalidasi oleh pemakainya dengan zod. */
import { eq } from "drizzle-orm";
import { settings } from "../schema.ts";
import type { Executor } from "./executor.ts";

export function getSetting(x: Executor, key: string): unknown {
  return x.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(x: Executor, key: string, value: unknown, now: number): void {
  x.insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
    .run();
}
