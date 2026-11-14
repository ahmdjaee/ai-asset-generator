import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { listFixture, listItemFixture } from "@/test-assets.ts";
import { type AssetListData, assetListKey, listSearchParams, mergeBuildProgress } from "./assets.ts";

describe("daftar aset", () => {
  test("parameter query: kata kunci di-trim, nilai kosong dan urutan bawaan dibuang", () => {
    expect(listSearchParams({})).toEqual({});
    expect(listSearchParams({ q: "   ", sort: "updated" })).toEqual({});
    expect(
      listSearchParams({ q: " peti ", tier: "ringan", stage: "done", since: 1000, sort: "name" }),
    ).toEqual({
      q: "peti",
      tier: "ringan",
      stage: "done",
      since: "1000",
      sort: "name",
    });
    // Query yang setara memakai satu entri cache.
    expect(assetListKey({ q: " ", sort: "updated" })).toEqual(assetListKey({}));
  });

  test("progres build digabung ke semua daftar yang memuat aset itu; daftar lain tidak disentuh", () => {
    const client = new QueryClient();
    const all = listFixture([
      listItemFixture({ id: "peti", runState: "running" }),
      listItemFixture({ id: "batu" }),
    ]);
    const filtered = listFixture([listItemFixture({ id: "batu" })], 2);
    client.setQueryData(assetListKey({}), all);
    client.setQueryData(assetListKey({ q: "batu" }), filtered);

    mergeBuildProgress(client, "peti", { stage: "textured", pct: 62 });

    const merged = client.getQueryData<AssetListData>(assetListKey({}));
    expect(merged?.assets.map((asset) => [asset.id, asset.progress])).toEqual([
      ["peti", { stage: "textured", pct: 62 }],
      ["batu", null],
    ]);
    expect(merged?.total).toBe(2);
    // Daftar tanpa aset itu tetap objek yang sama (pemakainya tidak dirender ulang).
    expect(client.getQueryData(assetListKey({ q: "batu" }))).toBe(filtered);
  });
});
