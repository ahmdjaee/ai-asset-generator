import { Box, Cuboid, LibraryBig, type LucideIcon, Settings } from "lucide-react";
import { useId } from "react";
import { Link, NavLink, useMatch, useNavigate } from "react-router";
import { AccountChip, Avatar } from "@/components/AccountChip.tsx";
import { IconButton } from "@/components/ui/icon-button.tsx";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu.tsx";
import { Tooltip } from "@/components/ui/tooltip.tsx";
import { t } from "@/i18n/id.ts";
import { accountSummary, useAuthStatus } from "@/lib/health.ts";
import { cn } from "@/lib/utils.ts";
import { useTheme } from "@/theme.ts";
import { isThemePreference } from "@/theme-script.ts";

/** Logo (FigCraft #590): 32×32 radius 8 `accent/solid`, ikon `box` 18. */
function Logo() {
  return (
    <span
      role="img"
      aria-label={t.app.name}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-solid text-text-on-accent"
    >
      <Box size={18} />
    </span>
  );
}

/**
 * NavItem (FigCraft #472): 56×52, radius 8, ikon 20 + label 11/14 SemiBold (desain tidak menautkan text style).
 * Default `text/tertiary`; aktif `bg/active` + `text/primary`. Titik indikator proses (#1330) 8×8 `accent/solid`
 * dengan cincin 2 px `bg/app` di kiri 40,5 / atas 6.
 */
function NavItem({
  to,
  label,
  icon: Glyph,
  active,
  busy = false,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  busy?: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-13 w-14 flex-col items-center justify-center gap-1 rounded-lg transition-colors",
        active
          ? "bg-bg-active text-text-primary"
          : "text-text-tertiary hover:bg-bg-hover hover:text-text-secondary",
      )}
    >
      <Glyph size={20} className="shrink-0" />
      <span className="font-semibold text-[11px] leading-[14px]">{label}</span>
      {busy ? (
        <>
          <span
            aria-hidden
            className="absolute top-1.5 left-[40.5px] size-2 rounded-full bg-accent-solid ring-2 ring-bg-app"
          />
          <span className="sr-only"> ({t.nav.jobRunning})</span>
        </>
      ) : null}
    </Link>
  );
}

/**
 * Menu akun dari Avatar: chip akun (email dan paket dari `/api/health/auth`), tautan Pengaturan, dan pilihan tema (gaya
 * Menu sudut dengan centang).
 */
function AccountMenu() {
  const navigate = useNavigate();
  const { preference, setPreference } = useTheme();
  const themeLabelId = useId();
  const account = accountSummary(useAuthStatus().data);
  return (
    <Menu>
      <Tooltip label={t.account.menu} side="right">
        <MenuTrigger aria-label={t.account.menu} className="rounded-full">
          <Avatar />
        </MenuTrigger>
      </Tooltip>
      <MenuContent side="right" align="end" className="w-55">
        <MenuLabel>
          <AccountChip name={account.name} detail={account.detail} />
        </MenuLabel>
        <MenuSeparator />
        <MenuItem icon={Settings} onSelect={() => navigate("/pengaturan")}>
          {t.account.settings}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel id={themeLabelId} className="px-2 py-1 text-overline text-text-tertiary uppercase">
          {t.theme.label}
        </MenuLabel>
        <MenuRadioGroup
          aria-labelledby={themeLabelId}
          value={preference}
          onValueChange={(value) => {
            if (isThemePreference(value)) setPreference(value);
          }}
        >
          <MenuRadioItem value="dark">{t.theme.dark}</MenuRadioItem>
          <MenuRadioItem value="light">{t.theme.light}</MenuRadioItem>
          <MenuRadioItem value="system">{t.theme.system}</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

/**
 * Rel navigasi (FigCraft Rail #746): lebar 64, `bg/app`, garis kanan 1 px `border/default`, padding-y 12.
 * Logo → (20) Studio → (4) Gudang → … → Pengaturan (IconButton Ghost md; Aktif di halaman Pengaturan) → (16) Avatar.
 */
export function Rail({ studioBusy = false }: { studioBusy?: boolean }) {
  // Studio mencakup halaman aset baru dan sesi aset (`/studio/:assetId`, desain 02); keduanya hook terpisah supaya
  // urutan hook tetap.
  const onNewAsset = useMatch({ path: "/", end: true }) !== null;
  const inSession = useMatch("/studio/*") !== null;
  const inGudang = useMatch("/gudang/*") !== null;
  const onSettings = useMatch("/pengaturan") !== null;
  return (
    <nav
      aria-label={t.nav.label}
      className="flex h-full w-16 shrink-0 flex-col items-center border-border-default border-r bg-bg-app py-3"
    >
      <Logo />
      <ul className="mt-5 flex flex-col gap-1">
        <li>
          <NavItem
            to="/"
            active={onNewAsset || inSession}
            label={t.nav.studio}
            icon={Cuboid}
            busy={studioBusy}
          />
        </li>
        <li>
          <NavItem to="/gudang" active={inGudang} label={t.nav.gudang} icon={LibraryBig} />
        </li>
      </ul>
      <div className="mt-auto flex flex-col items-center gap-4">
        <IconButton asChild icon={Settings} label={t.nav.pengaturan} active={onSettings} tooltipSide="right">
          <NavLink to="/pengaturan" />
        </IconButton>
        <AccountMenu />
      </div>
    </nav>
  );
}
