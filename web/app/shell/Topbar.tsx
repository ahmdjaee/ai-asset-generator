import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { Link } from "react-router";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";

/**
 * Topbar (FigCraft layar 01–03): tinggi 52 termasuk garis bawah 1 px `border/default`, latar `bg/app`,
 * padding kanan 16. Padding kiri ditentukan halaman (Studio 20, Gudang 24, sesuai desain).
 */
export function Topbar({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        "flex h-13 shrink-0 items-center border-border-default border-b bg-bg-app pr-4 pl-6",
        className,
      )}
    >
      {children}
    </header>
  );
}

export type Crumb = { label: string; to?: string };

/**
 * Breadcrumb (FigCraft layar 01–02): induk Small `text/tertiary`, pemisah `chevron-right` 14, halaman saat ini
 * Label `text/primary`. Isi tambahan (Tier, Badge) bisa diletakkan sesudahnya lewat `children`.
 */
export function Breadcrumb({ items, children }: { items: readonly Crumb[]; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <nav aria-label={t.shell.breadcrumb} className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1.5">
          {items.map((item, index) => {
            const last = index === items.length - 1;
            return (
              <li key={`${item.to ?? ""}|${item.label}`} className="flex min-w-0 items-center gap-1.5">
                {index > 0 ? <ChevronRight size={14} className="shrink-0 text-text-tertiary" /> : null}
                {last ? (
                  <span aria-current="page" className="truncate text-label text-text-primary">
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to ?? "/"}
                    className="whitespace-nowrap rounded-sm text-small text-text-tertiary hover:text-text-secondary"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
    </div>
  );
}
