/**
 * Rute aset (PLAN Lampiran F). Handler tipis: validasi zod di batas, lalu `AssetService` (aksi) atau `AssetQueries`
 * (baca). Gerbang status ditegakkan di service/domain, bukan di sini dan bukan di tombol UI.
 */
import { Hono } from "hono";
import { z } from "zod";
import { AssetListQuery } from "../../../shared/asset-list.ts";
import { ExportEstimateQuery, ExportQuery, ExportZipBody, ExportZipQuery } from "../../../shared/export.ts";
import { EVENTS_PAGE_MAX, TIER_IDS } from "../../../shared/limits.ts";
import { type AssetQueries, assetView } from "../../services/asset-queries.ts";
import type { AssetService } from "../../services/assets.ts";
import type { UploadFile } from "../../services/attachments.ts";
import type { ExportService } from "../../services/exports.ts";
import { contentDisposition, fileResponse } from "../files.ts";
import { jsonLimit, uploadLimit, validate } from "../validate.ts";

export type AssetRouteDeps = Readonly<{
  assets: AssetService;
  queries: AssetQueries;
  exports: ExportService;
}>;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const IdParam = z.object({ id: Id });
const QuestionParam = z.object({ id: Id, questionId: Id });
const VersionFileParam = z.object({
  id: Id,
  version: z.coerce.number().int().min(1),
  file: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
});
const AttachmentParam = z.object({ id: Id, attachmentId: Id });

/**
 * Panjang teks, nama, dan jawaban dicek service/domain (dengan pesan yang spesifik); ukuran body sudah dibatasi
 * `jsonLimit`/`uploadLimit`. Di sini hanya bentuk datanya.
 */
const Text = z.string();
const Files = z.array(z.instanceof(File)).optional();

const CreateForm = z.object({
  prompt: Text,
  tierId: z.enum(TIER_IDS),
  name: Text.optional(),
  "files[]": Files,
});
const MessageForm = z.object({ text: Text, "files[]": Files });
const RenameBody = z.object({ name: Text });
const ApproveBody = z.object({ note: Text.optional() });
const TextBody = z.object({ text: Text });
const AnswerBody = z.object({
  answers: z.record(Text, z.object({ selected: z.array(Text), other: Text.optional() })),
});
const EventsQuery = z.object({
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(EVENTS_PAGE_MAX).optional(),
});

async function uploads(files: readonly File[] | undefined): Promise<UploadFile[]> {
  return Promise.all(
    (files ?? []).map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
  );
}

export function assetRoutes({ assets, queries, exports }: AssetRouteDeps) {
  const current = (id: string) => ({ asset: assetView(assets.get(id)) });

  return (
    new Hono()
      .get("/", validate("query", AssetListQuery), async (c) =>
        c.json(await queries.list(c.req.valid("query"))),
      )
      .post("/", uploadLimit, validate("form", CreateForm), async (c) => {
        const form = c.req.valid("form");
        const record = await assets.create({
          prompt: form.prompt,
          tierId: form.tierId,
          ...(form.name === undefined ? {} : { name: form.name }),
          files: await uploads(form["files[]"]),
        });
        return c.json({ asset: assetView(record) }, 201);
      })
      // Sebelum `/:id`: "export-zip" juga cocok dengan pola id.
      .post("/export-zip/prepare", jsonLimit, validate("json", ExportZipBody), async (c) => {
        const { ids, preset } = c.req.valid("json");
        return c.json(await exports.prepareZip(ids, preset));
      })
      .get("/export-zip", validate("query", ExportZipQuery), async (c) => {
        const { ids, preset } = c.req.valid("query");
        const zip = await exports.zip(ids, preset);
        return new Response(zip.stream, {
          headers: {
            "Content-Type": "application/zip",
            "Content-Disposition": contentDisposition(zip.downloadName),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      })
      .get("/:id", validate("param", IdParam), async (c) =>
        c.json(await queries.detail(c.req.valid("param").id)),
      )
      .patch("/:id", validate("param", IdParam), jsonLimit, validate("json", RenameBody), async (c) => {
        const record = await assets.rename(c.req.valid("param").id, c.req.valid("json").name);
        return c.json({ asset: assetView(record) });
      })
      .delete("/:id", validate("param", IdParam), async (c) => {
        await assets.delete(c.req.valid("param").id);
        return c.body(null, 204);
      })
      .get("/:id/events", validate("param", IdParam), validate("query", EventsQuery), (c) => {
        const query = c.req.valid("query");
        return c.json(
          queries.events(c.req.valid("param").id, {
            ...(query.before === undefined ? {} : { before: query.before }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          }),
        );
      })
      .post(
        "/:id/messages",
        validate("param", IdParam),
        uploadLimit,
        validate("form", MessageForm),
        async (c) => {
          const { id } = c.req.valid("param");
          const form = c.req.valid("form");
          await assets.sendMessage(id, form.text, await uploads(form["files[]"]));
          return c.json(current(id));
        },
      )
      .post(
        "/:id/revise",
        validate("param", IdParam),
        uploadLimit,
        validate("form", MessageForm),
        async (c) => {
          const { id } = c.req.valid("param");
          const form = c.req.valid("form");
          await assets.revise(id, form.text, await uploads(form["files[]"]));
          return c.json(current(id));
        },
      )
      .post(
        "/:id/answers/:questionId",
        validate("param", QuestionParam),
        jsonLimit,
        validate("json", AnswerBody),
        async (c) => {
          const { id, questionId } = c.req.valid("param");
          await assets.answer(id, questionId, c.req.valid("json").answers);
          return c.json(current(id));
        },
      )
      .post(
        "/:id/approve",
        validate("param", IdParam),
        jsonLimit,
        validate("json", ApproveBody),
        async (c) => {
          const { id } = c.req.valid("param");
          const { note } = c.req.valid("json");
          await assets.approve(id, note);
          return c.json(current(id));
        },
      )
      .post("/:id/finish", validate("param", IdParam), async (c) => {
        const { id } = c.req.valid("param");
        await assets.finish(id);
        return c.json(current(id));
      })
      .post(
        "/:id/change-shape",
        validate("param", IdParam),
        jsonLimit,
        validate("json", TextBody),
        async (c) => {
          const { id } = c.req.valid("param");
          await assets.changeShape(id, c.req.valid("json").text);
          return c.json(current(id));
        },
      )
      .post("/:id/stop", validate("param", IdParam), async (c) => {
        const { id } = c.req.valid("param");
        await assets.stop(id);
        return c.json(current(id));
      })
      .post("/:id/retry", validate("param", IdParam), async (c) => {
        const { id } = c.req.valid("param");
        await assets.retry(id);
        return c.json(current(id));
      })
      .post("/:id/resume", validate("param", IdParam), async (c) => {
        const { id } = c.req.valid("param");
        await assets.resume(id);
        return c.json(current(id));
      })
      .post("/:id/duplicate", validate("param", IdParam), async (c) => {
        const record = await assets.duplicate(c.req.valid("param").id);
        return c.json({ asset: assetView(record) }, 201);
      })
      .get("/:id/versions/:version/:file", validate("param", VersionFileParam), async (c) => {
        const { id, version, file } = c.req.valid("param");
        return fileResponse(await queries.versionFile(id, version, file));
      })
      .get("/:id/export", validate("param", IdParam), validate("query", ExportQuery), async (c) => {
        const { version, preset } = c.req.valid("query");
        return fileResponse(await exports.file(c.req.valid("param").id, version, preset));
      })
      .get(
        "/:id/export/estimate",
        validate("param", IdParam),
        validate("query", ExportEstimateQuery),
        async (c) => c.json(await exports.estimate(c.req.valid("param").id, c.req.valid("query").version)),
      )
      .get("/:id/attachments/:attachmentId", validate("param", AttachmentParam), async (c) => {
        const { id, attachmentId } = c.req.valid("param");
        return fileResponse(await queries.attachmentFile(id, attachmentId));
      })
  );
}
