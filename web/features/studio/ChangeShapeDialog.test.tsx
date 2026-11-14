import { describe, expect, mock, test } from "bun:test";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { t } from "@/i18n/id.ts";
import { RealtimeProvider } from "@/lib/realtime-context.tsx";
import { FakeRealtime } from "@/test-realtime.ts";
import { renderUi } from "@/test-utils.tsx";
import { ChangeShapeDialog } from "./ChangeShapeDialog.tsx";
import { ReconnectBanner } from "./ReconnectBanner.tsx";

function Harness({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "terbuka" : "tertutup"}</p>
      <ChangeShapeDialog open={open} onOpenChange={setOpen} version={2} onSubmit={onSubmit} />
    </>
  );
}

const field = () => screen.getByRole("textbox", { name: t.changeShape.label });
const confirm = () => screen.getByRole("button", { name: t.changeShape.confirm });

describe("ChangeShapeDialog", () => {
  test("teks kosong ditolak dengan pesan di isian; terisi → dikirim (dipangkas), lalu dialog tertutup", async () => {
    const onSubmit = mock(async (_text: string) => undefined);
    const { user } = renderUi(<Harness onSubmit={onSubmit} />);
    const dialog = screen.getByRole("dialog", { name: t.changeShape.title });
    expect(dialog.textContent).toContain(t.changeShape.description("v2"));

    await user.click(confirm());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(t.changeShape.empty)).toBeDefined();
    expect(field().getAttribute("aria-invalid")).toBe("true");

    await user.type(field(), "  Tutup lebih rendah  ");
    expect(screen.queryByText(t.changeShape.empty)).toBeNull();
    await user.click(confirm());
    expect(onSubmit).toHaveBeenCalledWith("Tutup lebih rendah");
    expect(await screen.findByText("tertutup")).toBeDefined();
  });

  test("pengiriman gagal: dialog tetap terbuka dengan teksnya; Batal menutup dan mengosongkan", async () => {
    const onSubmit = mock(async (_text: string) => {
      throw new Error("gagal");
    });
    const { user } = renderUi(<Harness onSubmit={onSubmit} />);
    await user.type(field(), "Engsel lebih besar");
    await user.click(confirm());
    await waitFor(() => expect(confirm().getAttribute("aria-busy")).toBeNull());
    expect(screen.getByText("terbuka")).toBeDefined();
    expect((field() as HTMLTextAreaElement).value).toBe("Engsel lebih besar");

    await user.click(screen.getByRole("button", { name: t.changeShape.cancel }));
    expect(await screen.findByText("tertutup")).toBeDefined();
  });
});

describe("ReconnectBanner", () => {
  test("tampil hanya saat menunggu sambung ulang (live region tetap terpasang); tombolnya langsung mencoba lagi", async () => {
    const realtime = new FakeRealtime();
    const { user } = renderUi(
      <RealtimeProvider client={realtime}>
        <ReconnectBanner />
      </RealtimeProvider>,
    );
    const region = screen.getByRole("status", { name: t.connection.status });
    expect(region.textContent).toBe("");
    act(() => realtime.setState("reconnecting"));
    expect(region.textContent).toContain(t.connection.lost);
    await user.click(within(region).getByRole("button", { name: t.connection.reconnect }));
    expect(realtime.reconnects).toBe(1);
    act(() => realtime.setState("open"));
    // Region yang sama tetap ada (diumumkan saat terisi lagi); isinya hilang.
    expect(screen.getByRole("status", { name: t.connection.status })).toBe(region);
    expect(region.textContent).toBe("");
    expect(screen.queryByRole("button", { name: t.connection.reconnect })).toBeNull();
  });
});
