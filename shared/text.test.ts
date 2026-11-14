import { describe, expect, test } from "bun:test";
import { codePointLength, ellipsize, truncate } from "./text.ts";

const SMILE = "😀"; // dua unit UTF-16, satu code point

describe("teks per code point", () => {
  test("emoji dihitung satu karakter", () => {
    expect(codePointLength(`ab${SMILE}`)).toBe(3);
    expect(`ab${SMILE}`.length).toBe(4);
  });

  test("potongan tidak membelah pasangan surrogate", () => {
    const text = `${"a".repeat(4)}${SMILE}b`;
    expect(truncate(text, 5)).toBe(`aaaa${SMILE}`);
    expect(truncate(text, 4)).toBe("aaaa");
    expect(truncate(text, 99)).toBe(text);
    expect(truncate(text, 5).isWellFormed()).toBe(true);
  });

  test("surrogate tunggal yang sudah ada diganti U+FFFD", () => {
    const broken = `peti\uD83D`;
    expect(truncate(broken, 10)).toBe("peti�");
    expect(ellipsize(broken, 10)).toBe("peti�");
  });

  test("elipsis hanya bila terpotong", () => {
    expect(ellipsize(`abc${SMILE}${SMILE}`, 4)).toBe(`abc${SMILE}…`);
    expect(ellipsize("abc", 3)).toBe("abc");
  });
});
