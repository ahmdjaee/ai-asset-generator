import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatLength,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
  UNKNOWN_VALUE,
} from "./format.ts";

describe("formatBytes (id-ID, desimal)", () => {
  test.each([
    [0, "0 B"],
    [512, "512 B"],
    [184_000, "184 KB"],
    [164_400, "164,4 KB"],
    [256_000, "256 KB"],
    [1_500_000, "1,5 MB"],
    [800_000, "800 KB"],
    [20_000_000, "20 MB"],
    [200_000_000, "200 MB"],
    [999_999, "1 MB"],
    [3_000_000_000, "3 GB"],
  ])("%d → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatNumber / formatCompact (id-ID)", () => {
  test("pemisah ribuan titik, desimal koma", () => {
    expect(formatNumber(3388)).toBe("3.388");
    expect(formatNumber(0.65, 2)).toBe("0,65");
    expect(formatNumber(1954)).toBe("1.954");
  });

  test.each([
    [950, "950"],
    [3388, "3,4k"],
    [8000, "8k"],
    [12_000, "12k"],
    [999_960, "1jt"],
    [1_250_000, "1,3jt"],
  ])("ringkas %d → %s", (value, expected) => {
    expect(formatCompact(value)).toBe(expected);
  });
});

describe("formatRelativeTime (jam disuntikkan)", () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);
  const ago = (ms: number) => now - ms;
  const MIN = 60_000;

  test.each([
    [10_000, "baru saja", "baru saja"],
    [12 * MIN, "12 mnt", "12 mnt lalu"],
    [2 * 60 * MIN, "2 jam", "2 jam lalu"],
    [3 * 24 * 60 * MIN, "3 hari", "3 hari lalu"],
  ])("%d ms lalu → %s / %s", (delta, short, long) => {
    expect(formatRelativeTime(ago(delta), now, "short")).toBe(short);
    expect(formatRelativeTime(ago(delta), now)).toBe(long);
  });

  test("lebih dari seminggu → tanggal; tahun lain ikut tahunnya", () => {
    expect(formatRelativeTime(Date.UTC(2026, 9, 1, 12), now, "short", "UTC")).toBe("1 Okt");
    expect(formatRelativeTime(Date.UTC(2025, 9, 1, 12), now, "long", "UTC")).toBe("1 Okt 2025");
  });

  test("waktu di masa depan (jam tidak sinkron) dianggap baru saja", () => {
    expect(formatRelativeTime(now + 5 * MIN, now)).toBe("baru saja");
  });
});

describe("formatDuration", () => {
  test.each([
    [12_000, "12 dtk"],
    [108_000, "1 mnt 48 dtk"],
    [120_000, "2 mnt"],
    [3_720_000, "1 jam 2 mnt"],
    [400, "0 dtk"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("formatLength (keterangan grid viewer)", () => {
  test.each([
    [0.2, "20 cm"],
    [0.05, "5 cm"],
    [0.01, "1 cm"],
    [0.005, "5 mm"],
    [0.0001, "0,1 mm"],
    [1, "1 m"],
    [1.5, "1,5 m"],
    [10, "10 m"],
    [0.9999, "1 m"],
    [0.00999, "1 cm"],
  ])("%p m → %p", (meters, expected) => {
    expect(formatLength(meters)).toBe(expected);
  });

  test("nilai tidak valid atau negatif", () => {
    expect(formatLength(Number.NaN)).toBe(UNKNOWN_VALUE);
    expect(formatLength(-1)).toBe("0 mm");
  });
});

describe("formatPercent", () => {
  test("dibulatkan tanpa desimal", () => {
    expect(formatPercent(0.62)).toBe("62%");
    expect(formatPercent(1)).toBe("100%");
  });
});

describe("nilai di luar jangkauan", () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);

  test("angka tidak valid (NaN, tak hingga) ditulis sebagai tanda tidak diketahui", () => {
    expect(UNKNOWN_VALUE).toBe("—");
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatNumber(value)).toBe(UNKNOWN_VALUE);
      expect(formatCompact(value)).toBe(UNKNOWN_VALUE);
      expect(formatBytes(value)).toBe(UNKNOWN_VALUE);
      expect(formatPercent(value)).toBe(UNKNOWN_VALUE);
      expect(formatDuration(value)).toBe(UNKNOWN_VALUE);
      expect(formatRelativeTime(value, now)).toBe(UNKNOWN_VALUE);
      expect(formatDate(value, now)).toBe(UNKNOWN_VALUE);
      expect(formatTime(value)).toBe(UNKNOWN_VALUE);
      expect(formatDateTime(value)).toBe(UNKNOWN_VALUE);
    }
  });

  test("tanggal dan jam lengkap selalu dengan tahun: 14 Nov 2026, 09.12", () => {
    const jakarta = "Asia/Jakarta";
    expect(formatDateTime(Date.UTC(2026, 10, 14, 2, 12), jakarta)).toBe("14 Nov 2026, 09.12");
    expect(formatDateTime(Date.UTC(2025, 9, 1, 17, 5), jakarta)).toBe("2 Okt 2025, 00.05");
  });

  test("jam 24 jam dengan titik: 14.30, 09.05, 00.00", () => {
    const jakarta = "Asia/Jakarta";
    expect(formatTime(Date.UTC(2026, 10, 14, 7, 30), jakarta)).toBe("14.30");
    expect(formatTime(Date.UTC(2026, 10, 14, 2, 5), jakarta)).toBe("09.05");
    expect(formatTime(Date.UTC(2026, 10, 13, 17, 0), jakarta)).toBe("00.00");
  });

  test("ukuran dan durasi negatif dianggap nol (mis. waktu berjalan sedikit negatif karena jam)", () => {
    expect(formatBytes(-5000)).toBe("0 B");
    expect(formatDuration(-400)).toBe("0 dtk");
  });

  test("angka ringkas dibulatkan sebelum memilih satuan: 999,6 → 1k, bukan 1.000", () => {
    expect(formatCompact(999.6)).toBe("1k");
    expect(formatCompact(999.4)).toBe("999");
  });
});
