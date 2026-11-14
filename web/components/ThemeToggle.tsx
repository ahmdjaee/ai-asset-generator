import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { Segmented } from "@/components/ui/segmented.tsx";
import { t } from "@/i18n/id.ts";
import { useTheme } from "@/theme.ts";
import type { ThemePreference } from "@/theme-script.ts";

const OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "dark", label: t.theme.dark, icon: Moon },
  { value: "light", label: t.theme.light, icon: Sun },
  { value: "system", label: t.theme.system, icon: Monitor },
];

/** Toggle tema (frame Tahap 7): segmen seperti Segmented tier, tiap pilihan ikon 16 + Label. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <Segmented
      label={t.theme.label}
      value={preference}
      onValueChange={setPreference}
      options={OPTIONS.map(({ value, label, icon: Glyph }) => ({
        value,
        label: (
          <>
            <Glyph size={16} className="shrink-0" />
            <span className="text-label">{label}</span>
          </>
        ),
      }))}
    />
  );
}
