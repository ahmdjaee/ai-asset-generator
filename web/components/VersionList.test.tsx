import { describe, expect, mock, test } from "bun:test";
import { screen, waitFor } from "@testing-library/react";
import { renderUi } from "@/test-utils.tsx";
import { VersionList } from "./VersionList.tsx";

const VERSIONS = [
  { version: 1, title: "v1 · Bentuk dasar", meta: "2 mnt lalu · 3.388 segitiga" },
  { version: 2, title: "v2 · Bentuk dasar", meta: "baru saja · 3.512 segitiga" },
];

describe("VersionList", () => {
  test("grup radio Versi; versi aktif tercentang; panah bawah memilih versi berikutnya", async () => {
    const onChange = mock();
    const { user } = renderUi(<VersionList versions={VERSIONS} value={1} onValueChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Versi" })).toBeDefined();
    const first = screen.getByRole("radio", { name: /v1 · Bentuk dasar/ });
    expect(first.getAttribute("aria-checked")).toBe("true");
    expect(first.getAttribute("data-state")).toBe("checked");
    await user.tab();
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(2));
    await user.keyboard("{/ArrowDown}");
  });
});
