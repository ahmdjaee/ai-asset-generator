import { describe, expect, test } from "bun:test";
import { ExportZipBody, ExportZipQuery, exportFileName, safeFileStem } from "./export.ts";
import { EXPORT_NAME_MAX_CHARS, EXPORT_ZIP_MAX_ASSETS } from "./limits.ts";
import { codePointLength } from "./text.ts";

describe("safeFileStem", () => {
  test("hanya huruf dan angka, dipisah tanda hubung", () => {
    expect(safeFileStem("Peti Kayu (Kartun) v2!")).toBe("peti-kayu-kartun-v2");
    expect(safeFileStem("Pedang Ōkami 刀")).toBe("pedang-ōkami-刀");
    expect(safeFileStem("ＡＢＣ１２")).toBe("abc12");
  });

  test("path traversal, path absolut, dan karakter kendali tidak lolos (zip-slip)", () => {
    for (const hostile of [
      "../../etc/passwd",
      "..\\..\\windows\\system32",
      "/root/.ssh/id_rsa",
      "C:\\Users\\x",
      "a/../../b",
      "nama\u0000null",
      "baris\nbaru",
      "....",
      ".tersembunyi",
    ]) {
      const stem = safeFileStem(hostile);
      expect(stem).toMatch(/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u);
      expect(stem).not.toContain("..");
    }
    expect(safeFileStem("../../etc/passwd")).toBe("etc-passwd");
  });

  test("kosong setelah dibersihkan → cadangan; panjang dibatasi tanpa membelah emoji", () => {
    expect(safeFileStem("🙂🙂")).toBe("aset");
    expect(safeFileStem("///", "gudang")).toBe("gudang");
    const long = safeFileStem(`${"a".repeat(EXPORT_NAME_MAX_CHARS - 1)} b c d`);
    expect(codePointLength(long)).toBeLessThanOrEqual(EXPORT_NAME_MAX_CHARS);
    expect(long.endsWith("-")).toBe(false);
  });

  test("nama file per preset", () => {
    expect(exportFileName("Peti Kayu", 2, "unity")).toBe("peti-kayu-v2-unity.glb");
    expect(exportFileName("Peti Kayu", 2, "web")).toBe("peti-kayu-v2-web.glb");
    expect(exportFileName("Peti Kayu", 3, "source")).toBe("peti-kayu-v3-sumber.zip");
  });
});

describe("ExportZipQuery", () => {
  test("id dipisah koma, duplikat dibuang, urutan tetap", () => {
    expect(ExportZipQuery.parse({ ids: "b,a,b", preset: "web" })).toEqual({ ids: ["b", "a"], preset: "web" });
  });

  test("id tidak valid, kosong, terlalu banyak, atau preset Sumber ditolak", () => {
    for (const query of [
      { ids: "", preset: "web" },
      { ids: "a,,b", preset: "web" },
      { ids: "../x", preset: "web" },
      { ids: "a", preset: "source" },
      {
        ids: Array.from({ length: EXPORT_ZIP_MAX_ASSETS + 1 }, (_, index) => `a${index}`).join(","),
        preset: "web",
      },
    ]) {
      expect(ExportZipQuery.safeParse(query).success).toBe(false);
    }
  });
});

describe("ExportZipBody", () => {
  test("daftar id: duplikat dibuang, urutan tetap; jumlah dan bentuk id dibatasi", () => {
    expect(ExportZipBody.parse({ ids: ["b", "a", "b"], preset: "unity" })).toEqual({
      ids: ["b", "a"],
      preset: "unity",
    });
    expect(ExportZipBody.safeParse({ ids: [], preset: "web" }).success).toBe(false);
    expect(ExportZipBody.safeParse({ ids: ["../x"], preset: "web" }).success).toBe(false);
    expect(ExportZipBody.safeParse({ ids: ["a"], preset: "source" }).success).toBe(false);
    const many = Array.from({ length: EXPORT_ZIP_MAX_ASSETS + 1 }, (_, index) => `a${index}`);
    expect(ExportZipBody.safeParse({ ids: many, preset: "web" }).success).toBe(false);
    // Duplikat dibuang sebelum batas dihitung.
    expect(
      ExportZipBody.safeParse({ ids: [...many.slice(0, 2), ...many.slice(0, 2)], preset: "web" }).success,
    ).toBe(true);
  });
});
