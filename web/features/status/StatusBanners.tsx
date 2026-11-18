import { CircleAlert, LoaderCircle, type LucideIcon, TriangleAlert } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import {
  type AccountProblem,
  accountProblem,
  type RuntimeProblem,
  runtimeProblem,
  useAuthStatus,
  useBuildImage,
  useRecheckAuth,
  useRecheckRuntime,
  useRuntimeStatus,
} from "@/lib/health.ts";
import { cn } from "@/lib/utils.ts";

export type NoticeTone = "warning" | "danger" | "progress";

const TONE: Record<NoticeTone, { icon: LucideIcon; background: string; iconClass: string }> = {
  warning: { icon: TriangleAlert, background: "bg-warning-soft", iconClass: "text-warning-text" },
  danger: { icon: CircleAlert, background: "bg-danger-soft", iconClass: "text-danger-text" },
  progress: {
    icon: LoaderCircle,
    background: "bg-warning-soft",
    iconClass: "text-warning-text motion-safe:animate-spin",
  },
};

/**
 * Banner status (FigCraft "Tahap 11 · Pengaturan & state khusus" A–B): gaya banner sambung ulang, selebar konten di
 * bawah topbar. `warning/soft` + `triangle-alert`, `danger/soft` + `circle-alert`, atau membangun (`loader-circle`
 * berputar, tanpa tombol, tinggi minimal 42). Padding 6/8/6/16, jarak 8, teks Small `text/primary`, aksi Ghost sm.
 */
export function StatusNotice({ tone, text, action }: { tone: NoticeTone; text: string; action?: ReactNode }) {
  const notice = useRef<HTMLDivElement>(null);
  // Banner hilang (masalah selesai) saat tombolnya fokus: fokus pindah ke area utama, tidak jatuh ke `<body>`.
  useLayoutEffect(() => {
    const element = notice.current;
    return () => {
      if (element?.contains(document.activeElement)) element.closest<HTMLElement>("main")?.focus();
    };
  }, []);
  const { icon: Glyph, background, iconClass } = TONE[tone];
  return (
    <div
      ref={notice}
      className={cn("flex min-h-10.5 shrink-0 items-center gap-2 py-1.5 pr-2 pl-4", background)}
    >
      <Glyph aria-hidden size={16} className={cn("shrink-0", iconClass)} />
      <p className="min-w-0 flex-1 text-small text-text-primary">{text}</p>
      {action}
    </div>
  );
}

const ACCOUNT_TEXT: Record<AccountProblem, string> = {
  logged_out: t.banners.loggedOut,
  api_key: t.banners.apiKey,
  error: t.banners.unavailable,
};

function AccountBanner({ problem }: { problem: AccountProblem }) {
  const recheck = useRecheckAuth();
  return (
    <StatusNotice
      tone={problem === "logged_out" ? "warning" : "danger"}
      text={ACCOUNT_TEXT[problem]}
      action={
        <Button
          variant="ghost"
          size="sm"
          loading={recheck.isPending}
          onClick={() =>
            recheck.mutate(undefined, {
              onError: (error) => notify.error(t.banners.actionFailed, error.message),
            })
          }
        >
          {t.banners.recheck}
        </Button>
      }
    />
  );
}

function RuntimeBanner({ problem }: { problem: RuntimeProblem }) {
  const recheck = useRecheckRuntime();
  const build = useBuildImage();
  const onError = { onError: (error: Error) => notify.error(t.banners.actionFailed, error.message) };
  switch (problem) {
    case "building":
      return <StatusNotice tone="progress" text={t.banners.building} />;
    case "image_missing":
      return (
        <StatusNotice
          tone="warning"
          text={t.banners.imageMissing}
          action={
            <Button
              variant="ghost"
              size="sm"
              loading={build.isPending}
              onClick={() => build.mutate(undefined, onError)}
            >
              {t.banners.build}
            </Button>
          }
        />
      );
    case "docker_down":
      return (
        <StatusNotice
          tone="danger"
          text={t.banners.dockerDown}
          action={
            <Button
              variant="ghost"
              size="sm"
              loading={recheck.isPending}
              onClick={() => recheck.mutate(undefined, onError)}
            >
              {t.banners.recheck}
            </Button>
          }
        />
      );
    case "build_failed":
      return (
        <StatusNotice
          tone="danger"
          text={t.banners.buildFailed}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/pengaturan">{t.banners.openSettings}</Link>
            </Button>
          }
        />
      );
  }
}

/**
 * Live region banner status. Dipasang kosong sejak awal (lihat `ConnectionStatusRegion`), supaya banner yang muncul
 * diumumkan pembaca layar.
 */
export function StatusBannerRegion({ children }: { children?: ReactNode }) {
  return (
    <div role="status" aria-label={t.banners.status} className="flex shrink-0 flex-col">
      {children}
    </div>
  );
}

/**
 * Banner akun Claude dan runtime 3D di bawah topbar Studio, Gudang, dan Detail (tidak di Pengaturan, yang sudah
 * menampilkan detailnya). Bila keduanya bermasalah, banner akun di atas. Hilang sendiri setelah masalahnya selesai
 * (event `auth`/`runtime` di topik `global`, atau "Periksa ulang").
 */
export function StatusBanners() {
  const account = accountProblem(useAuthStatus().data);
  const runtime = runtimeProblem(useRuntimeStatus().data);
  return (
    <StatusBannerRegion>
      {account === null ? null : <AccountBanner problem={account} />}
      {runtime === null ? null : <RuntimeBanner problem={runtime} />}
    </StatusBannerRegion>
  );
}
