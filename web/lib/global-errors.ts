import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";

/** Satu id: error beruntun mengganti toast yang sama, tidak menumpuk. */
const TOAST_ID = "global-error";

/** Pembatalan yang disengaja (Stop, pindah halaman) bukan kesalahan. */
function isAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

/**
 * Toast untuk error yang lolos dari semua penanganan: exception tak tertangkap dan promise ditolak tanpa `catch`.
 * Browser sudah mencatatnya di console, jadi di sini hanya toast. Hasilnya fungsi untuk melepas pendengarnya.
 */
export function installGlobalErrorToast(target: Window): () => void {
  const show = () => notify.error(t.globalError.title, t.globalError.description, { id: TOAST_ID });
  const onError = () => show();
  const onRejection = (event: Event) => {
    if (!isAbort(Reflect.get(event, "reason"))) show();
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
