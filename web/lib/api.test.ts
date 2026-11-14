import { describe, expect, test } from "bun:test";
import { jsonResponse } from "@/test-utils.tsx";
import { ApiError, toApiError } from "./api.ts";

describe("toApiError", () => {
  test("body { code, message } dari server dipakai apa adanya", async () => {
    const error = await toApiError(jsonResponse({ code: "FORBIDDEN", message: "Permintaan ditolak." }, 403));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "FORBIDDEN", message: "Permintaan ditolak.", status: 403 });
  });

  test("body lain diberi kode HTTP_<status>", async () => {
    const error = await toApiError(new Response("Bad Gateway", { status: 502 }));
    expect(error).toMatchObject({ code: "HTTP_502", status: 502 });
    expect(error.message).toContain("502");
  });
});
