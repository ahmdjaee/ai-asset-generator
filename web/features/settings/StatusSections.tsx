import { CircleAlert, CircleCheck, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/AccountChip.tsx";
import { Badge, type BadgeTone } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { notify } from "@/components/ui/toast.tsx";
import { t } from "@/i18n/id.ts";
import {
  accountSummary,
  useAuthStatus,
  useBuildImage,
  useRecheckAuth,
  useRecheckRuntime,
  useRuntimeStatus,
} from "@/lib/health.ts";
import { cn } from "@/lib/utils.ts";
import { formatNumber, formatTime } from "../../../shared/format.ts";
import type { AuthStatus, RuntimeStatus } from "../../../shared/health.ts";
import { SettingsSection } from "./section.tsx";

const copy = t.settings;

type BadgeView = Readonly<{ tone: BadgeTone; label: string }>;

function accountBadge(auth: AuthStatus): BadgeView {
  switch (auth.state) {
    case "ok":
      return { tone: "success", label: copy.account.connected };
    case "logged_out":
      return { tone: "danger", label: copy.account.loggedOut };
    case "api_key":
      return { tone: "danger", label: copy.account.apiKey };
    case "error":
      return { tone: "danger", label: copy.account.unavailable };
  }
}

function RecheckButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" icon={RotateCcw} loading={pending} onClick={onClick}>
      {copy.recheck}
    </Button>
  );
}

/** Baris ringkasan (FigCraft "Baris akun", "Ringkasan"): teks Label + Caption, Badge, lalu tombol; jarak 12. */
function SummaryRow({
  name,
  detail,
  badge,
  avatar = false,
  children,
}: {
  name: string;
  detail: string;
  badge: BadgeView | null;
  avatar?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {avatar ? <Avatar /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="break-words text-label text-text-primary">{name}</p>
        <p className="break-words text-caption text-text-secondary">{detail}</p>
      </div>
      {badge === null ? null : <Badge tone={badge.tone}>{badge.label}</Badge>}
      {children}
    </div>
  );
}

/** Akun Claude (FigCraft layar 05 "Bagian · Akun Claude"; belum login di frame Tahap 11 D). */
export function AccountSection() {
  const auth = useAuthStatus();
  const recheck = useRecheckAuth();
  const failed = auth.data === undefined && auth.isError;
  const summary = failed
    ? { name: copy.account.title, detail: copy.account.checkFailed }
    : accountSummary(auth.data);
  return (
    <SettingsSection title={copy.account.title} description={copy.account.description}>
      <SummaryRow
        avatar
        name={summary.name}
        detail={summary.detail}
        badge={auth.data === undefined ? null : accountBadge(auth.data)}
      >
        <RecheckButton
          pending={recheck.isPending || (auth.isFetching && auth.data === undefined)}
          onClick={() =>
            recheck.mutate(undefined, {
              onError: (error) => notify.error(copy.runtime.recheckFailed, error.message),
            })
          }
        />
      </SummaryRow>
    </SettingsSection>
  );
}

type CheckView = Readonly<{ label: string; ok: boolean; detail: string }>;

function runtimeChecks(runtime: RuntimeStatus): CheckView[] {
  const fixture = runtime.driver === "fixture";
  const r = copy.runtime;
  return [
    {
      label: r.docker,
      ok: runtime.docker.ok,
      detail: fixture
        ? r.fixture
        : runtime.docker.ok && runtime.docker.detail !== null
          ? r.dockerVersion(runtime.docker.detail)
          : r.dockerUnreachable,
    },
    {
      label: r.image,
      ok: runtime.image.present,
      detail: fixture
        ? r.fixture
        : runtime.image.present
          ? runtime.image.tag
          : r.imageAbsent(runtime.image.tag),
    },
    {
      label: r.blender,
      ok: runtime.blender !== null,
      detail: runtime.blender === null ? r.unknown : r.blenderVersion(runtime.blender),
    },
    {
      label: r.renderer,
      ok: runtime.renderer.ok,
      detail: !runtime.renderer.ok ? r.rendererFailed : (runtime.renderer.detail ?? r.fixture),
    },
    {
      label: r.materials,
      ok: runtime.materials.count > 0,
      detail:
        runtime.materials.count > 0
          ? r.materialCount(formatNumber(runtime.materials.count))
          : r.materialsMissing,
    },
  ];
}

/**
 * Daftar pemeriksaan (FigCraft "Pemeriksaan"): `bg/sunken`, radius 6, padding 4/12; baris padding 8, jarak 10, garis
 * atas `border/default` mulai baris kedua. Ikon 16 `circle-check` (success) atau `circle-alert` (danger), nama 140 px
 * Small `text/primary`, detail Small `text/secondary` (danger saat bermasalah).
 */
function CheckList({ checks }: { checks: readonly CheckView[] }) {
  return (
    <ul aria-label={copy.runtime.checks} className="flex flex-col rounded-md bg-bg-sunken px-3 py-1">
      {checks.map((check) => {
        const Glyph = check.ok ? CircleCheck : CircleAlert;
        return (
          <li
            key={check.label}
            className="flex items-center gap-2.5 border-border-default py-2 not-first:border-t"
          >
            <Glyph
              aria-hidden
              size={16}
              className={cn("shrink-0", check.ok ? "text-success-text" : "text-danger-text")}
            />
            <span className="w-35 shrink-0 text-small text-text-primary">
              {check.label}
              <span className="sr-only"> ({check.ok ? copy.runtime.okLabel : copy.runtime.failedLabel})</span>
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 break-words text-small",
                check.ok ? "text-text-secondary" : "text-danger-text",
              )}
            >
              {check.detail}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Baris terakhir log build yang gagal; pesan dari server sudah dipotong ke ekornya. */
export const BUILD_LOG_LINES = 5;

function buildLogTail(error: string): string {
  return error
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .slice(-BUILD_LOG_LINES)
    .join("\n");
}

function runtimeSummary(
  runtime: RuntimeStatus,
): Readonly<{ name: string; detail: string; badge: BadgeView }> {
  const r = copy.runtime;
  if (runtime.build.state === "building") {
    return {
      name: r.notReady,
      detail: r.buildingSince(formatTime(runtime.build.startedAt ?? runtime.checkedAt)),
      badge: { tone: "warning", label: r.badgeBuilding },
    };
  }
  if (runtime.ready) {
    return {
      name: r.ready,
      detail: r.checkedAt(formatTime(runtime.checkedAt)),
      badge: { tone: "success", label: r.badgeReady },
    };
  }
  const notReady: BadgeView = { tone: "danger", label: r.badgeNotReady };
  if (!runtime.docker.ok) return { name: r.notReady, detail: r.dockerDown, badge: notReady };
  if (runtime.build.state === "failed")
    return {
      name: r.notReady,
      detail: r.buildFailedAt(formatTime(runtime.build.endedAt ?? runtime.checkedAt)),
      badge: notReady,
    };
  return { name: r.notReady, detail: r.imageMissing, badge: notReady };
}

/** Runtime 3D (FigCraft layar 05 "Bagian · Runtime 3D"; build gagal di frame Tahap 11 D). */
export function RuntimeSection() {
  const runtime = useRuntimeStatus();
  const recheck = useRecheckRuntime();
  const build = useBuildImage();
  const data = runtime.data;
  const onError = (title: string) => ({ onError: (error: Error) => notify.error(title, error.message) });
  const canBuild =
    data !== undefined &&
    data.driver === "docker" &&
    data.docker.ok &&
    !data.image.present &&
    data.build.state !== "building";
  const summary =
    data === undefined
      ? {
          name: runtime.isError ? copy.runtime.notReady : copy.runtime.checking,
          detail: runtime.isError ? copy.runtime.checkFailed : "",
          badge: null,
        }
      : runtimeSummary(data);
  return (
    <SettingsSection title={copy.runtime.title} description={copy.runtime.description}>
      <SummaryRow name={summary.name} detail={summary.detail} badge={summary.badge}>
        <RecheckButton
          pending={recheck.isPending || (runtime.isFetching && data === undefined)}
          onClick={() => recheck.mutate(undefined, onError(copy.runtime.recheckFailed))}
        />
        {canBuild ? (
          <Button
            variant="primary"
            size="sm"
            loading={build.isPending}
            onClick={() => build.mutate(undefined, onError(copy.runtime.buildFailed))}
          >
            {data.build.state === "failed" ? copy.runtime.rebuild : copy.runtime.build}
          </Button>
        ) : null}
      </SummaryRow>
      {data === undefined ? null : <CheckList checks={runtimeChecks(data)} />}
      {data?.build.state === "failed" && data.build.error !== null ? (
        <div className="flex flex-col gap-1 rounded-md bg-bg-sunken px-3 py-2.5">
          <p className="text-caption-strong text-text-secondary">{copy.runtime.log}</p>
          <p className="whitespace-pre-wrap break-words text-caption text-text-secondary">
            {buildLogTail(data.build.error)}
          </p>
        </div>
      ) : null}
    </SettingsSection>
  );
}
