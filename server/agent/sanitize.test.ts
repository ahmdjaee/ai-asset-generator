import { describe, expect, test } from "bun:test";
import { IMAGE_PLACEHOLDER, REDACTED, sanitize } from "./sanitize.ts";

const context = { homeDir: "/home/budi", extraSecrets: ["Organisasi Budi"] };

describe("sanitize", () => {
  test("email di teks diganti", () => {
    expect(sanitize("hubungi budi.santoso@contoh.co.id ya", context)).toBe(
      "hubungi pemilik@contoh.invalid ya",
    );
  });

  test("path home diganti", () => {
    expect(sanitize({ cwd: "/home/budi/.claude/x", other: "/home/budiman" }, context)).toEqual({
      cwd: "/home/pemilik/.claude/x",
      other: "/home/pemilikman",
    });
  });

  test("kunci akun/organisasi/email disamarkan", () => {
    expect(
      sanitize({ account_uuid: "1234-5678", organization: "PT X", email: "a@b.cd", userEmail: "x" }, context),
    ).toEqual({
      account_uuid: REDACTED,
      organization: REDACTED,
      email: REDACTED,
      userEmail: REDACTED,
    });
  });

  test("data gambar base64 dibuang, teks pendek tidak", () => {
    const image = {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo".repeat(40) },
    };
    expect(sanitize(image, context)).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: IMAGE_PLACEHOLDER },
    });
    expect(sanitize("abc123", context)).toBe("abc123");
  });

  test("rahasia tambahan dan struktur bersarang", () => {
    expect(sanitize([{ text: "Organisasi Budi punya 3 aset" }, 5, null, true], context)).toEqual([
      { text: `${REDACTED} punya 3 aset` },
      5,
      null,
      true,
    ]);
  });
});
