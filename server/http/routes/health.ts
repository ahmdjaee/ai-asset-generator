/**
 * Kesehatan server (PLAN Lampiran F): `/` server hidup, `/auth` sesi login Claude, `/runtime` runtime 3D.
 * `?fresh=1` melewati cache (tombol "Periksa ulang").
 */
import { Hono } from "hono";
import { z } from "zod";
import type { AccountProbe } from "../../agent/account.ts";
import type { RuntimeStatusService } from "../../services/runtime-status.ts";
import { APP_VERSION } from "../../version.ts";
import { validate } from "../validate.ts";

export type HealthRouteDeps = Readonly<{ account: AccountProbe; runtime: RuntimeStatusService }>;

const FreshQuery = z.object({ fresh: z.enum(["1"]).optional() });

export function healthRoutes({ account, runtime }: HealthRouteDeps) {
  return new Hono()
    .get("/", (c) => c.json({ ok: true as const, version: APP_VERSION }))
    .get("/auth", validate("query", FreshQuery), async (c) =>
      c.json({ auth: await account.status({ fresh: c.req.valid("query").fresh === "1" }) }),
    )
    .get("/runtime", validate("query", FreshQuery), async (c) =>
      c.json({ runtime: await runtime.status({ fresh: c.req.valid("query").fresh === "1" }) }),
    )
    .post("/runtime/image", async (c) => c.json({ runtime: await runtime.buildImage() }, 202));
}
