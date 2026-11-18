/**
 * Notifikasi browser (PLAN Tahap 11): izin diminta dari Pengaturan, dan notifikasi hanya muncul saat tab app tidak
 * sedang dilihat (selain itu toast sudah cukup). Izin tidak bisa dibaca lewat event, jadi perubahan dari Pengaturan
 * dikabarkan sendiri, dan perubahan lewat pengaturan situs browser ditangkap Permissions API bila tersedia.
 */
import { useSyncExternalStore } from "react";

export type NotificationPermissionState = NotificationPermission | "unsupported";

const listeners = new Set<() => void>();
let watching = false;

function api(): typeof Notification | undefined {
  return typeof window !== "undefined" && "Notification" in window ? window.Notification : undefined;
}

export function notificationPermission(): NotificationPermissionState {
  return api()?.permission ?? "unsupported";
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** Permissions API: izin yang diubah lewat ikon di sebelah alamat juga terlihat tanpa memuat ulang. */
function watchBrowserSetting(): void {
  if (watching || typeof navigator === "undefined" || navigator.permissions === undefined) return;
  watching = true;
  navigator.permissions
    .query({ name: "notifications" })
    .then((status) => {
      status.addEventListener("change", emit);
    })
    .catch(() => {
      watching = false;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watchBrowserSetting();
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationPermission(): NotificationPermissionState {
  return useSyncExternalStore(subscribe, notificationPermission, () => "unsupported");
}

/** Meminta izin (harus dari klik pengguna). Hasilnya dikabarkan ke semua pemakai `useNotificationPermission`. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  const notification = api();
  if (notification === undefined) return "unsupported";
  const result = await notification.requestPermission();
  emit();
  return result;
}

/**
 * Notifikasi untuk tab yang tidak sedang dilihat. Klik membawa pengguna kembali ke tab ini. `tag` sama = notifikasi
 * lama untuk aset yang sama diganti.
 */
export function showBackgroundNotification(
  title: string,
  options: Readonly<{ body?: string; tag: string; onClick: () => void }>,
): boolean {
  const notification = api();
  if (notification?.permission !== "granted" || document.visibilityState !== "hidden") return false;
  const shown = new notification(title, {
    tag: options.tag,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  shown.addEventListener("click", () => {
    window.focus();
    options.onClick();
    shown.close();
  });
  return true;
}
