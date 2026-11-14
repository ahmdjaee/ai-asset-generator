import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fileStem, REVOKE_DELAY_MS, saveBlob } from "./download.ts";

describe("fileStem", () => {
  test.each([
    ["Peti harta kayu", "peti-harta-kayu"],
    ["Kursi Café №2", "kursi-cafe-no2"],
    ["  ../../etc/passwd  ", "etc-passwd"],
    ["Makhluk 🦊 kartun", "makhluk-kartun"],
    ["***", "aset"],
    ["", "aset"],
  ])("%p → %p", (name, expected) => {
    expect(fileStem(name)).toBe(expected);
  });

  test("dipotong 60 karakter tanpa tanda hubung di ujung", () => {
    const stem = fileStem(`${"a".repeat(59)} b`);
    expect(stem.length).toBeLessThanOrEqual(60);
    expect(stem.endsWith("-")).toBe(false);
  });
});

describe("saveBlob", () => {
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  test("mengunduh lewat tautan sementara; URL baru dibebaskan setelah jeda, bukan langsung", () => {
    const create = spyOn(URL, "createObjectURL").mockImplementation(() => "blob:uji");
    const revoke = spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download, attached: this.isConnected });
    });
    spies.push(create, revoke, click);
    const schedule = mock((_run: () => void, _delayMs: number) => undefined);

    saveBlob(new Blob(["png"]), "peti.png", schedule);

    expect(clicked).toEqual([{ href: "blob:uji", download: "peti.png", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
    const [run, delay] = schedule.mock.calls[0] ?? [];
    // Firefox dan Safari masih membaca URL beberapa saat setelah klik; 0 ms bisa membatalkan unduhan.
    expect(delay).toBe(REVOKE_DELAY_MS);
    expect(REVOKE_DELAY_MS).toBeGreaterThanOrEqual(10_000);
    run?.();
    expect(revoke).toHaveBeenCalledWith("blob:uji");
  });
});
