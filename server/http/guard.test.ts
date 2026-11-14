import { describe, expect, test } from "bun:test";
import { allowedHost, allowedOrigin, hostnameOf, rejectReason } from "./guard.ts";

const PORTS: ReadonlySet<string> = new Set(["4340", "4341"]);

describe("hostnameOf", () => {
  test.each([
    ["localhost:4340", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]:4340", "::1"],
    ["LOCALHOST:4341", "localhost"],
  ])("%s → %s", (host, expected) => {
    expect(hostnameOf(host)).toBe(expected);
  });
});

describe("allowedHost", () => {
  test.each(["127.0.0.1:4340", "localhost", "localhost:4341", "[::1]:4340", "LOCALHOST:4340"])(
    "menerima %s",
    (host) => {
      expect(allowedHost(host)).toBe(true);
    },
  );

  test.each(["evil.example", "127.0.0.1.evil.example", "192.168.1.10:4340", "0.0.0.0:4340"])(
    "menolak %s (DNS rebinding / jaringan)",
    (host) => {
      expect(allowedHost(host)).toBe(false);
    },
  );

  test("tanpa Host (alat lokal) lolos", () => {
    expect(allowedHost(undefined)).toBe(true);
  });
});

describe("allowedOrigin", () => {
  test.each([
    "http://127.0.0.1:4340",
    "http://localhost:4341",
    "http://[::1]:4340",
    "HTTP://LOCALHOST:4340/",
  ])("menerima %s", (origin) => {
    expect(allowedOrigin(origin, PORTS)).toBe(true);
  });

  test.each([
    "http://evil.example:4340",
    "http://127.0.0.1:9999",
    "http://127.0.0.1",
    "https://127.0.0.1:4340",
    "null",
    "file://",
    "tidak valid",
  ])("menolak %s", (origin) => {
    expect(allowedOrigin(origin, PORTS)).toBe(false);
  });

  test("tanpa Origin (curl, skrip) lolos", () => {
    expect(allowedOrigin(undefined, PORTS)).toBe(true);
  });
});

describe("rejectReason", () => {
  const headers = (entries: Record<string, string>) => new Headers(entries);

  test("permintaan dari halaman app sendiri lolos", () => {
    const sameOrigin = headers({ host: "127.0.0.1:4340", origin: "http://127.0.0.1:4341" });
    expect(rejectReason(sameOrigin, "POST", PORTS)).toBeUndefined();
  });

  test("POST lintas situs ditolak walau Origin tidak ada", () => {
    const crossSite = headers({ host: "127.0.0.1:4340", "sec-fetch-site": "cross-site" });
    expect(rejectReason(crossSite, "POST", PORTS)).toBeString();
    expect(rejectReason(crossSite, "GET", PORTS)).toBeUndefined();
  });

  test("Host asing ditolak lebih dulu", () => {
    expect(rejectReason(headers({ host: "evil.example" }), "GET", PORTS)).toContain("host");
  });

  test("Origin asing ditolak", () => {
    const foreign = headers({ host: "127.0.0.1:4340", origin: "http://evil.example" });
    expect(rejectReason(foreign, "GET", PORTS)).toContain("situs lain");
  });
});
