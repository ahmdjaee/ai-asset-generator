import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import {
  notificationPermission,
  requestNotificationPermission,
  showBackgroundNotification,
  useNotificationPermission,
} from "./notifications.ts";

type Shown = { title: string; options: NotificationOptions; close: () => void; click: () => void };

/** Notification API tiruan: izin bisa diatur, notifikasi yang dibuat dicatat dan bisa "diklik". */
function installNotification(initial: NotificationPermission, answer: NotificationPermission = "granted") {
  const shown: Shown[] = [];
  class FakeNotification extends EventTarget {
    static permission: NotificationPermission = initial;
    static requestPermission = mock(async () => {
      FakeNotification.permission = answer;
      return answer;
    });
    readonly close = mock(() => undefined);
    constructor(title: string, options: NotificationOptions = {}) {
      super();
      shown.push({ title, options, close: this.close, click: () => this.dispatchEvent(new Event("click")) });
    }
  }
  Object.defineProperty(window, "Notification", { value: FakeNotification, configurable: true });
  return { shown, api: FakeNotification };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => setVisibility("visible"));

afterEach(() => {
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("notifikasi browser", () => {
  test("tanpa Notification API → tidak didukung, tidak ada yang ditampilkan", async () => {
    Reflect.deleteProperty(window, "Notification");
    expect(notificationPermission()).toBe("unsupported");
    expect(await requestNotificationPermission()).toBe("unsupported");
    setVisibility("hidden");
    expect(showBackgroundNotification("Peti selesai", { tag: "a", onClick: () => undefined })).toBe(false);
  });

  test("hanya saat diizinkan dan tab tidak sedang dilihat; klik membuka aset dan menutup notifikasi", () => {
    const { shown } = installNotification("granted");
    const onClick = mock(() => undefined);
    expect(showBackgroundNotification("Peti selesai", { tag: "a", onClick })).toBe(false);
    setVisibility("hidden");
    expect(showBackgroundNotification("Peti selesai", { tag: "aset-status:a", body: "Buka", onClick })).toBe(
      true,
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]?.title).toBe("Peti selesai");
    expect(shown[0]?.options).toEqual({ tag: "aset-status:a", body: "Buka" });
    shown[0]?.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(shown[0]?.close).toHaveBeenCalledTimes(1);
  });

  test("izin belum ditanya atau ditolak → tidak ada notifikasi", () => {
    setVisibility("hidden");
    installNotification("default");
    expect(showBackgroundNotification("x", { tag: "a", onClick: () => undefined })).toBe(false);
    installNotification("denied");
    expect(showBackgroundNotification("x", { tag: "a", onClick: () => undefined })).toBe(false);
  });

  test("meminta izin memperbarui semua pemakai hook", async () => {
    const { api } = installNotification("default", "denied");
    const { result } = renderHook(() => useNotificationPermission());
    expect(result.current).toBe("default");
    await act(async () => {
      expect(await requestNotificationPermission()).toBe("denied");
    });
    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current).toBe("denied");
  });
});
