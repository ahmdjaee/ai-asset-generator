/**
 * Kesehatan app untuk banner dan Pengaturan (PLAN Tahap 11): sesi login Claude (`/api/health/auth`) dan runtime 3D
 * (`/api/health/runtime`). Server menyimpan hasilnya di cache; tombol "Periksa ulang" meminta pemeriksaan baru
 * (`?fresh=1`). Perubahan datang lewat topik `global` (`auth`, `runtime`), tanpa polling.
 */
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n/id.ts";
import { AuthStatus, RuntimeStatus } from "../../shared/health.ts";
import { api, toApiError } from "./api.ts";

export const authKey = ["health", "auth"] as const;
export const runtimeKey = ["health", "runtime"] as const;

async function fetchAuth(fresh: boolean): Promise<AuthStatus> {
  const response = await api.health.auth.$get({ query: fresh ? { fresh: "1" } : {} });
  if (!response.ok) throw await toApiError(response);
  return AuthStatus.parse((await response.json()).auth);
}

async function fetchRuntime(fresh: boolean): Promise<RuntimeStatus> {
  const response = await api.health.runtime.$get({ query: fresh ? { fresh: "1" } : {} });
  if (!response.ok) throw await toApiError(response);
  return RuntimeStatus.parse((await response.json()).runtime);
}

/** Status login Claude. Memeriksa bisa memakan beberapa detik (server menjalankan proses Claude Code tanpa pesan). */
export function useAuthStatus() {
  return useQuery({ queryKey: authKey, queryFn: () => fetchAuth(false) });
}

export function useRuntimeStatus() {
  return useQuery({ queryKey: runtimeKey, queryFn: () => fetchRuntime(false) });
}

/** "Periksa ulang" akun: melewati cache server, hasilnya langsung ditulis ke cache query. */
export function useRecheckAuth() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => fetchAuth(true),
    onSuccess: (auth) => client.setQueryData(authKey, auth),
  });
}

export function useRecheckRuntime() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => fetchRuntime(true),
    onSuccess: (runtime) => client.setQueryData(runtimeKey, runtime),
  });
}

/** "Bangun image": build berjalan di latar; selesainya datang sebagai event `runtime`. */
export function useBuildImage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await api.health.runtime.image.$post();
      if (!response.ok) throw await toApiError(response);
      return RuntimeStatus.parse((await response.json()).runtime);
    },
    onSuccess: (runtime) => client.setQueryData(runtimeKey, runtime),
  });
}

/** Event topik `global` untuk kesehatan: server sudah membuang cache-nya, jadi query cukup diambil ulang. */
export function invalidateHealth(client: QueryClient, which: "auth" | "runtime"): void {
  void client.invalidateQueries({ queryKey: which === "auth" ? authKey : runtimeKey });
}

export type AccountProblem = "logged_out" | "api_key" | "error";

/** Masalah akun yang perlu banner; `null` = login baik atau belum diketahui. */
export function accountProblem(auth: AuthStatus | undefined): AccountProblem | null {
  if (auth === undefined || auth.state === "ok") return null;
  return auth.state;
}

export type RuntimeProblem = "building" | "docker_down" | "build_failed" | "image_missing";

/**
 * Masalah runtime yang perlu banner, dari yang paling menentukan: build yang sedang berjalan, Docker mati (build pun
 * tidak bisa), build terakhir gagal, lalu image belum ada. `null` = siap atau belum diketahui.
 */
export function runtimeProblem(runtime: RuntimeStatus | undefined): RuntimeProblem | null {
  if (runtime === undefined || runtime.driver === "fixture") return null;
  if (runtime.build.state === "building") return "building";
  if (!runtime.docker.ok) return "docker_down";
  if (runtime.build.state === "failed" && !runtime.image.present) return "build_failed";
  if (!runtime.image.present) return "image_missing";
  return null;
}

const PLAN_NAMES: Readonly<Record<string, string>> = {
  max: "Max",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

/** "max" → "Max"; nama lain dari SDK ditulis dengan huruf awal kapital. */
export function planName(subscription: string): string {
  return (
    PLAN_NAMES[subscription.toLowerCase()] ?? subscription.charAt(0).toUpperCase() + subscription.slice(1)
  );
}

export type AccountSummary = Readonly<{ name: string; detail: string }>;

/**
 * Email dan jenis paket akun disembunyikan sementara (permintaan pemilik 2026-11-18, Log keputusan PLAN): akun yang
 * login tampil sebagai "Akun Claude · Login lewat Claude Code". Ubah ke `true` untuk menampilkannya lagi.
 */
export const SHOW_ACCOUNT_IDENTITY = false;

/** Nama dan keterangan akun untuk chip akun (menu Avatar) dan baris akun Pengaturan. */
export function accountSummary(auth: AuthStatus | undefined): AccountSummary {
  if (auth === undefined) return { name: t.account.name, detail: t.account.checking };
  switch (auth.state) {
    case "ok":
      if (!SHOW_ACCOUNT_IDENTITY) return { name: t.account.name, detail: t.account.detail };
      return {
        name: auth.email,
        detail: auth.subscription === null ? t.account.detail : t.account.plan(planName(auth.subscription)),
      };
    case "logged_out":
      return { name: t.account.loggedOut, detail: t.settings.account.loggedOutHint };
    case "api_key":
      return { name: t.account.apiKey, detail: t.settings.account.apiKeyHint };
    case "error":
      return { name: t.account.unavailable, detail: auth.message };
  }
}
