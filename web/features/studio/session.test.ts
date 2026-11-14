import { describe, expect, test } from "bun:test";
import type { AssetEvent } from "../../../shared/asset-events.ts";
import { shownVersion, turnStartedAt } from "./session.ts";
import type { ThreadEvent } from "./thread-store.ts";

let seq = 0;
function stored(ts: number, event: AssetEvent): ThreadEvent {
  seq += 1;
  return { assetId: "a", seq, ts, event };
}

describe("halaman sesi", () => {
  test("giliran Claude dimulai dari pesan atau aksi pemilik terakhir", () => {
    const events = [
      stored(1_000, { type: "user", uuid: "u1", text: "Peti kayu" }),
      stored(2_000, { type: "assistant", text: "Baik" }),
      stored(3_000, { type: "action", action: "approve", version: 1 }),
      stored(4_000, { type: "notice", text: "Build dimulai" }),
    ];
    expect(turnStartedAt(events)).toBe(3_000);
    expect(turnStartedAt(events.slice(0, 2))).toBe(1_000);
    expect(turnStartedAt([])).toBeNull();
  });

  test("viewer mengikuti versi terkini; pilihan pemilik berlaku sampai versi terkini berganti", () => {
    expect(shownVersion(null, 2, [1, 2])).toBe(2);
    expect(shownVersion({ version: 1, current: 2 }, 2, [1, 2])).toBe(1);
    // Build baru (v3) mengganti pilihan lama.
    expect(shownVersion({ version: 1, current: 2 }, 3, [1, 2, 3])).toBe(3);
    // Versi pilihan tidak ada lagi di daftar.
    expect(shownVersion({ version: 4, current: 2 }, 2, [1, 2])).toBe(2);
    expect(shownVersion(null, null, [1, 3])).toBe(3);
    expect(shownVersion(null, null, [])).toBeNull();
  });
});
