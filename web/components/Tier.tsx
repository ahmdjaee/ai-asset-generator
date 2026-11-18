import { Info } from "lucide-react";
import { Segmented } from "@/components/ui/segmented.tsx";
import { t } from "@/i18n/id.ts";
import { cn } from "@/lib/utils.ts";
import { formatBytes, formatCompact } from "../../shared/format.ts";
import { bakeSizes, TIER_IDS, type TierBudget, type TierId } from "../../shared/limits.ts";

const LEVEL: Record<TierId, number> = { ringan: 1, sedang: 2, maksimal: 3 };
const BAR_HEIGHTS = ["h-1.5", "h-[9px]", "h-3"] as const;

/**
 * Tier (FigCraft #502, "3 bar, bukan warna"): tingkat dibaca dari jumlah bar terisi, bukan dari warna.
 * Bar 3 px (tinggi 6/9/12, radius 1, jarak 2) + label Caption. Warna mengikuti teks induk (`currentColor`);
 * bar kosong `border/strong`. Status bar ada di `data-state` (terisi/kosong), sumber warna sekaligus pegangan tes.
 */
export function TierIndicator({ tier, className }: { tier: TierId; className?: string }) {
  const level = LEVEL[tier];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-caption", className)}>
      <span aria-hidden className="flex h-3 w-[13px] shrink-0 items-end gap-0.5">
        {BAR_HEIGHTS.map((height, index) => (
          <span
            key={height}
            data-state={index < level ? "filled" : "empty"}
            className={cn(
              "w-[3px] rounded-[1px] data-[state=empty]:bg-border-strong data-[state=filled]:bg-current",
              height,
            )}
          />
        ))}
      </span>
      {t.tier[tier]}
    </span>
  );
}

/** Segmented tier (FigCraft #596): tiga pilihan tier sebagai grup radio. */
export function TierPicker({
  value,
  onValueChange,
  label = t.tier.label,
  className,
}: {
  value: TierId;
  onValueChange: (tier: TierId) => void;
  /** Nama grup untuk pembaca layar (Pengaturan: "Tier bawaan"). */
  label?: string;
  className?: string;
}) {
  return (
    <Segmented
      label={label}
      value={value}
      onValueChange={onValueChange}
      options={TIER_IDS.map((tier) => ({ value: tier, label: <TierIndicator tier={tier} /> }))}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/** "1K" untuk 1024 px, "2K" untuk 2048 px; di bawah 1024 ditulis angkanya. */
export function textureLabel(px: number): string {
  return px >= 1024 && px % 1024 === 0 ? `${px / 1024}K` : `${px}`;
}

/** Ringkasan budget tier: "Sedang — target 8k segitiga, tekstur 1K, file ±800 KB. Cocok untuk …". */
export function tierSummary(tier: TierId, budget: TierBudget): string {
  // Ukuran atlas warna yang benar-benar di-bake: bawaannya sama dengan pipeline bila tier tidak menyebutnya.
  const texture = bakeSizes(budget).baseColor;
  const numbers = t.tier.info(
    t.tier[tier],
    formatCompact(budget.triangles.target),
    textureLabel(texture),
    formatBytes(budget.webBytes.target),
  );
  return `${numbers} ${t.tier.useCase[tier]}`;
}

/** Baris info tier di bawah composer (FigCraft #877): ikon `info` 14 + Caption `text/secondary`. */
export function TierInfo({
  tier,
  budget,
  className,
}: {
  tier: TierId;
  budget: TierBudget;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 px-1 text-caption text-text-secondary", className)}>
      <Info size={14} className="shrink-0 text-text-tertiary" />
      <span>{tierSummary(tier, budget)}</span>
    </p>
  );
}
