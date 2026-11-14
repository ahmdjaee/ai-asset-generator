import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils.ts";
import { Input } from "./input.tsx";

/**
 * Kolom cari (FigCraft Search #577): 320 × 32, sama dengan Input (`bg/raised`, garis `border/default`, radius 8,
 * teks Small, placeholder `text/tertiary`). Ikon `search` 16 `text/tertiary` 10 px dari kiri; tombol pintasan 20×20
 * (garis `border/strong`, radius 4, Caption `text/tertiary`) 6 px dari kanan, jarak ke teks 8. Ikon dan pintasan
 * digambar di atas input, jadi seluruh kotak adalah input dan cincin fokus global melingkarinya.
 */
export function SearchField({
  shortcut,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  /** Tombol pintasan yang ditampilkan dan diumumkan (`aria-keyshortcuts`); pemasangannya oleh halaman. */
  shortcut?: string;
}) {
  return (
    <div className={cn("relative w-80 shrink-0", className)}>
      <Search
        size={16}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-tertiary"
      />
      <Input
        type="search"
        {...(shortcut === undefined ? {} : { "aria-keyshortcuts": shortcut })}
        className={cn("pl-8.5 [&::-webkit-search-cancel-button]:appearance-none", shortcut ? "pr-8.5" : "")}
        {...props}
      />
      {shortcut === undefined ? null : (
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm border border-border-strong font-sans text-caption text-text-tertiary"
        >
          {shortcut}
        </kbd>
      )}
    </div>
  );
}
