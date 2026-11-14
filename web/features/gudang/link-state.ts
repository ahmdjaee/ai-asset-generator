/**
 * Filter Gudang dibawa ke Detail aset lewat `state` navigasi, supaya tautan "Gudang" di breadcrumb Detail kembali ke
 * daftar yang sama (kata kunci, filter, urutan, tampilan). `state` riwayat tidak dipercaya: dicek dengan zod.
 */
import { z } from "zod";

const GudangLinkState = z.object({ gudangSearch: z.string().regex(/^(\?.*)?$/) });

export function gudangLinkState(search: string): { gudangSearch: string } {
  return { gudangSearch: search };
}

/** Tautan kembali ke Gudang dari `state` navigasi; tanpa state yang sah → Gudang tanpa filter. */
export function gudangHref(state: unknown): string {
  const parsed = GudangLinkState.safeParse(state);
  return parsed.success ? `/gudang${parsed.data.gudangSearch}` : "/gudang";
}
