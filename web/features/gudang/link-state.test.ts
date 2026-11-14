import { describe, expect, test } from "bun:test";
import { gudangHref, gudangLinkState } from "./link-state.ts";

describe("tautan kembali ke Gudang", () => {
  test("filter dibawa lewat state navigasi", () => {
    expect(gudangHref(gudangLinkState("?q=peti&view=list"))).toBe("/gudang?q=peti&view=list");
    expect(gudangHref(gudangLinkState(""))).toBe("/gudang");
  });

  test("state lain atau rusak → Gudang tanpa filter", () => {
    expect(gudangHref(null)).toBe("/gudang");
    expect(gudangHref({ gudangSearch: "//situs-lain.example" })).toBe("/gudang");
    expect(gudangHref({ gudangSearch: 5 })).toBe("/gudang");
  });
});
