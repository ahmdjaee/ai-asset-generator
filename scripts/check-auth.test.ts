import { describe, expect, test } from "bun:test";
import { usesApiKey } from "./check-auth.ts";

describe("usesApiKey", () => {
  test("sesi login (tanpa sumber API key) dianggap aman", () => {
    expect(usesApiKey({ email: "pemilik@contoh.id" })).toBe(false);
    expect(usesApiKey({ apiKeySource: "none" })).toBe(false);
  });

  test("sumber API key apa pun ditolak", () => {
    expect(usesApiKey({ apiKeySource: "ANTHROPIC_API_KEY" })).toBe(true);
    expect(usesApiKey({ apiKeySource: "apiKeyHelper" })).toBe(true);
  });
});
