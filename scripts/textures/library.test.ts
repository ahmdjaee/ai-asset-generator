import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";
import {
  catalogEntry,
  cleanTags,
  extractMaps,
  LibraryError,
  type MaterialsLock,
  parseAssetResponse,
  parseMaterialList,
  pickDownload,
  sha256,
  verifyArchive,
} from "./library.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "Planks040",
    title: "Planks 040",
    tags: ["040", "planks", "Boards", "planks040", "floor"],
    maps: ["color", "normal"],
    downloads: [
      { attributes: "1K-JPG", url: "https://ambientcg.com/get?file=Planks040_1K-JPG.zip", size: 100 },
      { attributes: "2K-JPG", url: "https://ambientcg.com/get?file=Planks040_2K-JPG.zip", size: 200 },
    ],
    ...overrides,
  };
}

describe("parseMaterialList", () => {
  test("membaca id + kategori, melewati komentar dan baris kosong", () => {
    expect(parseMaterialList("# judul\n\nPlanks040 wood\nMetal048A metal # emas\n")).toEqual([
      { id: "Planks040", category: "wood" },
      { id: "Metal048A", category: "metal" },
    ]);
  });

  test.each([
    ["kategori tidak dikenal", "Planks040 kayu"],
    ["kolom kurang", "Planks040"],
    ["kolom lebih", "Planks040 wood extra"],
    ["id dengan path", "../etc wood"],
    ["id ganda (beda huruf)", "Planks040 wood\nplanks040 wood"],
  ])("ditolak: %s", (_label, text) => {
    expect(() => parseMaterialList(text)).toThrow(LibraryError);
  });
});

describe("respons API", () => {
  test("aset dicocokkan dengan id persis", () => {
    const json = { assets: [asset({ id: "Planks040B" }), asset()] };
    expect(parseAssetResponse(json, "Planks040").id).toBe("Planks040");
  });

  test("respons tanpa aset atau rusak ditolak", () => {
    expect(() => parseAssetResponse({ assets: [] }, "Planks040")).toThrow(LibraryError);
    expect(() => parseAssetResponse({ nope: 1 }, "Planks040")).toThrow(LibraryError);
  });

  test("unduhan dari host lain ditolak", () => {
    const evil = parseAssetResponse(
      {
        assets: [
          asset({ downloads: [{ attributes: "1K-JPG", url: "https://evil.example/x.zip", size: 1 }] }),
        ],
      },
      "Planks040",
    );
    expect(() => pickDownload(evil, "1k")).toThrow(/Host tidak diizinkan/);
  });

  test("unduhan http (bukan https) ditolak", () => {
    const plain = parseAssetResponse(
      {
        assets: [
          asset({ downloads: [{ attributes: "1K-JPG", url: "http://ambientcg.com/x.zip", size: 1 }] }),
        ],
      },
      "Planks040",
    );
    expect(() => pickDownload(plain, "1k")).toThrow(LibraryError);
  });
});

describe("extractMaps", () => {
  const name = (suffix: string) => `Planks040_1K-JPG_${suffix}.jpg`;

  test("hanya map yang dikenal; NormalDX, Displacement, .blend, dan path aneh diabaikan", () => {
    const zip = zipSync({
      [name("Color")]: JPEG,
      [name("NormalGL")]: JPEG,
      [name("NormalDX")]: JPEG,
      [name("Roughness")]: JPEG,
      [name("Displacement")]: JPEG,
      "Planks040_1K-JPG.blend": new Uint8Array([1, 2]),
      [`../${name("Metalness")}`]: JPEG,
    });
    const maps = extractMaps(zip, "Planks040", "1k");
    expect([...maps.keys()].sort()).toEqual(["color", "normal", "roughness"]);
  });

  test("file bukan JPEG ditolak", () => {
    const zip = zipSync({
      [name("Color")]: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      [name("NormalGL")]: JPEG,
    });
    expect(() => extractMaps(zip, "Planks040", "1k")).toThrow(LibraryError);
  });

  test("tanpa normal ditolak", () => {
    expect(() => extractMaps(zipSync({ [name("Color")]: JPEG }), "Planks040", "1k")).toThrow(/normal/);
  });

  test("ZIP rusak ditolak", () => {
    expect(() => extractMaps(new Uint8Array([1, 2, 3]), "Planks040", "1k")).toThrow(LibraryError);
  });
});

describe("verifyArchive", () => {
  const empty: MaterialsLock = { version: 1, materials: {} };
  const zip = new Uint8Array([1, 2, 3, 4]);

  test("unduhan pertama dicatat ke lock", () => {
    const lock = verifyArchive(empty, "Planks040", "1k", 4, zip);
    expect(lock.materials.Planks040?.["1k"]).toEqual({ size: 4, sha256: sha256(zip) });
  });

  test("ukuran beda dari API ditolak", () => {
    expect(() => verifyArchive(empty, "Planks040", "1k", 5, zip)).toThrow(/ukuran/);
  });

  test("sha256 beda dari lock ditolak", () => {
    const lock = verifyArchive(empty, "Planks040", "1k", 4, zip);
    expect(() => verifyArchive(lock, "Planks040", "1k", 4, new Uint8Array([4, 3, 2, 1]))).toThrow(/sha256/);
  });
});

describe("katalog", () => {
  test("tag dibersihkan dan entri lengkap", () => {
    const parsed = parseAssetResponse({ assets: [asset()] }, "Planks040");
    expect(cleanTags(parsed)).toEqual(["boards", "floor", "planks"]);
    expect(
      catalogEntry({ id: "Planks040", category: "wood" }, parsed, ["color", "normal"], ["1k", "2k"]),
    ).toEqual({
      id: "Planks040",
      name: "Planks 040",
      category: "wood",
      tags: ["boards", "floor", "planks"],
      maps: ["color", "normal"],
      resolutions: ["1k", "2k"],
      license: "CC0-1.0",
      sourceUrl: "https://ambientcg.com/view?id=Planks040",
    });
  });
});

test("materials.txt di repo valid: 60 material, semua kategori terpakai", async () => {
  const entries = parseMaterialList(await Bun.file(`${import.meta.dir}/../../runtime/materials.txt`).text());
  expect(entries).toHaveLength(60);
  expect(new Set(entries.map((entry) => entry.category)).size).toBe(8);
});
