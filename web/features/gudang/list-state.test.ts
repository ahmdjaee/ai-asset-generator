import { describe, expect, test } from "bun:test";
import { clearFilters, dateSince, gudangSearch, listQuery, parseGudangParams } from "./list-state.ts";

const parse = (search: string) => parseGudangParams(new URLSearchParams(search));
const DAY = 24 * 60 * 60 * 1000;

describe("state URL Gudang", () => {
  test("tanpa parameter: bawaan (tanpa filter, terbaru dulu, grid)", () => {
    expect(parse("")).toEqual({
      q: "",
      tier: undefined,
      stage: undefined,
      date: undefined,
      sort: "updated",
      view: "grid",
    });
  });

  test("parameter yang dikenal dibaca; nilai tidak dikenal kembali ke bawaan", () => {
    expect(parse("q=peti&tier=sedang&stage=done&date=week&sort=name&view=list")).toEqual({
      q: "peti",
      tier: "sedang",
      stage: "done",
      date: "week",
      sort: "name",
      view: "list",
    });
    expect(parse("tier=raksasa&stage=x&date=tahun&sort=acak&view=peta")).toEqual(parse(""));
    // Kata kunci yang melebihi batas server tidak dikirim.
    expect(parse(`q=${"a".repeat(101)}`).q).toBe("");
  });

  test("ditulis balik tanpa nilai bawaan dan tanpa kata kunci kosong", () => {
    const params = parse("q=peti&tier=sedang&sort=oldest&view=list");
    expect(gudangSearch(params).toString()).toBe("q=peti&tier=sedang&sort=oldest&view=list");
    expect(gudangSearch(parse("")).toString()).toBe("");
    expect(gudangSearch({ ...parse(""), q: "   " }).toString()).toBe("");
    // Spasi di dalam kata kunci tetap (kolom cari tidak berubah saat URL ditulis ulang).
    expect(gudangSearch({ ...parse(""), q: "peti " }).get("q")).toBe("peti ");
  });

  test("Tanggal → batas bawah waktu dari jam yang disuntikkan", () => {
    const now = 100 * DAY;
    expect(dateSince(undefined, now)).toBeUndefined();
    expect(dateSince("day", now)).toBe(99 * DAY);
    expect(dateSince("week", now)).toBe(93 * DAY);
    expect(dateSince("month", now)).toBe(70 * DAY);
    expect(dateSince("month", DAY)).toBe(0);
  });

  test("query server: kata kunci di-trim, bawaan dibuang", () => {
    expect(listQuery(parse("q=%20peti%20&view=list"), undefined)).toEqual({ q: "peti" });
    expect(listQuery(parse("tier=ringan&stage=base&sort=name"), 5)).toEqual({
      tier: "ringan",
      stage: "base",
      since: 5,
      sort: "name",
    });
    expect(listQuery(parse(""), undefined)).toEqual({});
  });

  test("Hapus filter: kata kunci, tier, tahap, tanggal kosong; urutan dan tampilan tetap", () => {
    expect(clearFilters(parse("q=peti&tier=sedang&stage=done&date=day&sort=name&view=list"))).toEqual({
      ...parse(""),
      sort: "name",
      view: "list",
    });
  });
});
