/** Pengaturan (PLAN Lampiran F): `GET` nilai sekarang, `PUT` pengaturan lengkap (divalidasi zod + daftar model). */
import { Hono } from "hono";
import { SettingsBody } from "../../../shared/settings.ts";
import type { SettingsService } from "../../services/settings.ts";
import { jsonLimit, validate } from "../validate.ts";

export function settingsRoutes(settings: SettingsService) {
  return new Hono()
    .get("/", (c) => c.json({ settings: settings.get() }))
    .put("/", jsonLimit, validate("json", SettingsBody), (c) =>
      c.json({ settings: settings.update(c.req.valid("json")) }),
    );
}
