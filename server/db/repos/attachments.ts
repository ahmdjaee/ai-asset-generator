/** Repositori lampiran (gambar referensi, model 3D). File-nya ada di `refs/`; unggahan menyusul di Tahap 6. */
import { and, eq, inArray } from "drizzle-orm";
import { attachments } from "../schema.ts";
import type { Executor } from "./executor.ts";

export type AttachmentRecord = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

export function insertAttachment(x: Executor, input: NewAttachment): void {
  x.insert(attachments).values(input).run();
}

/** Duplikat aset: baris lampiran disalin dengan id baru (`path` relatif terhadap `refs/`, jadi tetap berlaku). */
export function copyAttachments(
  x: Executor,
  fromAssetId: string,
  toAssetId: string,
  newId: () => string,
): void {
  for (const row of listAttachments(x, fromAssetId)) {
    x.insert(attachments)
      .values({ ...row, id: newId(), assetId: toAssetId })
      .run();
  }
}

/** Membatalkan lampiran yang sudah dicatat (aksi pemilik ditolak setelah file ditulis). */
export function deleteAttachments(x: Executor, assetId: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  x.delete(attachments)
    .where(and(eq(attachments.assetId, assetId), inArray(attachments.id, [...ids])))
    .run();
}

export function getAttachment(x: Executor, assetId: string, id: string): AttachmentRecord | null {
  return (
    x
      .select()
      .from(attachments)
      .where(and(eq(attachments.assetId, assetId), eq(attachments.id, id)))
      .get() ?? null
  );
}

export function listAttachments(x: Executor, assetId: string): AttachmentRecord[] {
  return x
    .select()
    .from(attachments)
    .where(eq(attachments.assetId, assetId))
    .orderBy(attachments.createdAt)
    .all();
}
