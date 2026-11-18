import { describe, expect, test } from "bun:test";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import {
  budgetForm,
  budgetSignature,
  parseCount,
  parseSize,
  readField,
  tidyField,
  validateBudget,
  writeField,
  writeTexture,
} from "./budget-form.ts";

describe("isian budget", () => {
  test("bawaan tampil seperti di desain dan lolos validasi tanpa berubah", () => {
    const form = budgetForm(DEFAULT_TIERS);
    expect(form.ringan.triangles).toEqual({ target: "2.000", max: "3.000" });
    expect(form.sedang.webBytes).toEqual({ target: "800 KB", max: "1,5 MB" });
    expect(form.ringan.textures).toEqual({ baseColor: 512, normal: null, orm: null, emissive: null });
    const result = validateBudget(form);
    expect(result.errors.size).toBe(0);
    expect(result.tiers).toEqual(DEFAULT_TIERS);
  });

  test("angka dengan atau tanpa pemisah ribuan; ukuran KB/MB desimal dengan koma atau titik", () => {
    expect(parseCount("8.000")).toBe(8000);
    expect(parseCount(" 8 000 ")).toBe(8000);
    expect(parseCount("8,5")).toBeNull();
    expect(parseCount("")).toBeNull();
    expect(parseSize("1,5 MB")).toBe(1_500_000);
    expect(parseSize("1.5mb")).toBe(1_500_000);
    expect(parseSize("1.500 KB")).toBe(1_500_000);
    expect(parseSize("150 kb")).toBe(150_000);
    expect(parseSize("150")).toBeNull();
    expect(parseSize("1,5,5 MB")).toBeNull();
  });

  test("target > maks, di luar batas, dan isian rusak ditandai per isian; budget tidak dikirim", () => {
    let form = budgetForm(DEFAULT_TIERS);
    form = writeField(form, "sedang.triangles.target", "14.000");
    form = writeField(form, "ringan.materials", "9");
    form = writeField(form, "maksimal.webBytes.max", "lima MB");
    form = writeField(form, "ringan.triangles.max", "60.000");
    const result = validateBudget(form);
    expect(result.tiers).toBeNull();
    expect(Object.fromEntries(result.errors)).toEqual({
      "sedang.triangles.target": "Target harus ≤ maks.",
      "ringan.materials": "Maksimal 3.",
      "maksimal.webBytes.max": "Tulis dalam KB atau MB.",
      "ringan.triangles.max": "Maksimal 50.000.",
    });
    expect(validateBudget(writeField(form, "ringan.materials", "0")).errors.get("ringan.materials")).toBe(
      "Minimal 1.",
    );
  });

  test("slot tekstur opsional bisa dihapus; atlas warna tidak", () => {
    let form = writeTexture(budgetForm(DEFAULT_TIERS), "sedang", "normal", null);
    form = writeTexture(form, "ringan", "emissive", 256);
    expect(writeTexture(form, "ringan", "baseColor", null)).toBe(form);
    const tiers = validateBudget(form).tiers;
    expect(tiers?.sedang.textures).toEqual({ baseColor: 1024, orm: 512 });
    expect(tiers?.ringan.textures).toEqual({ baseColor: 512, emissive: 256 });
  });

  test("dirapikan setelah fokus pindah; perubahan dibandingkan sebagai angka", () => {
    expect(tidyField("sedang.triangles.target", "9000")).toBe("9.000");
    expect(tidyField("sedang.webBytes.max", "1.5 mb")).toBe("1,5 MB");
    expect(tidyField("sedang.webBytes.max", "salah")).toBe("salah");
    const form = budgetForm(DEFAULT_TIERS);
    const same = writeField(form, "ringan.triangles.target", "2000");
    expect(readField(same, "ringan.triangles.target")).toBe("2000");
    expect(budgetSignature(same)).toBe(budgetSignature(form));
    expect(budgetSignature(writeField(form, "ringan.triangles.target", "2100"))).not.toBe(
      budgetSignature(form),
    );
  });
});
