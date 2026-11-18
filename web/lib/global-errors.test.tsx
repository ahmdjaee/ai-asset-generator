import { afterEach, describe, expect, test } from "bun:test";
import { act, render, screen, within } from "@testing-library/react";
import { Toaster } from "@/components/ui/toast.tsx";
import { TooltipProvider } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { installGlobalErrorToast } from "./global-errors.ts";

let uninstall: () => void = () => undefined;

afterEach(() => uninstall());

const toasts = () => screen.getByRole("region", { name: /Notifikasi/ });

function renderToaster() {
  render(
    <TooltipProvider>
      <Toaster />
    </TooltipProvider>,
  );
}

function rejection(reason: unknown): Event {
  const event = new Event("unhandledrejection");
  Object.defineProperty(event, "reason", { value: reason });
  return event;
}

describe("toast error global", () => {
  test("error tak tertangani dan promise ditolak tanpa penanganan → satu toast (tidak bertumpuk)", async () => {
    renderToaster();
    uninstall = installGlobalErrorToast(window);
    act(() => {
      window.dispatchEvent(new ErrorEvent("error", { error: new Error("x"), message: "x" }));
      window.dispatchEvent(rejection(new Error("y")));
    });
    expect(await within(toasts()).findByText(t.globalError.title)).toBeDefined();
    expect(within(toasts()).getByText(t.globalError.description)).toBeDefined();
    expect(within(toasts()).getAllByText(t.globalError.title)).toHaveLength(1);
  });

  test("dibatalkan sengaja (AbortError) tidak dianggap error; setelah dilepas tidak ada toast", async () => {
    renderToaster();
    uninstall = installGlobalErrorToast(window);
    act(() => void window.dispatchEvent(rejection(new DOMException("batal", "AbortError"))));
    uninstall();
    act(() => void window.dispatchEvent(new ErrorEvent("error", { error: new Error("x"), message: "x" })));
    await act(async () => {
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    });
    expect(within(toasts()).queryByText(t.globalError.title)).toBeNull();
  });
});
