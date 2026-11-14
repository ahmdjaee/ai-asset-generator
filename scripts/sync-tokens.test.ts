import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { COLOR_VALUES, type ColorToken } from "../web/styles/tokens.ts";
import { buildTokens, PATHS, renderCss, renderTs, TokenError, toHex, tokenName } from "./sync-tokens.ts";

const variablesJson: unknown = JSON.parse(await readFile(PATHS.variables, "utf8"));
const textStylesJson: unknown = JSON.parse(await readFile(PATHS.textStyles, "utf8"));
const tokens = buildTokens(variablesJson, textStylesJson);

/** Salinan ekspor yang bisa diubah untuk menguji kasus gagal. */
function variablesCopy(): {
  meta: { variables: Record<string, { name: string; valuesByMode: Record<string, unknown> }> };
} {
  return structuredClone(variablesJson) as never;
}

describe("konversi dasar", () => {
  test("nama variabel FigCraft → nama token CSS", () => {
    expect(tokenName("bg/app")).toBe("bg-app");
    expect(tokenName("accent/solid-hover")).toBe("accent-solid-hover");
    expect(() => tokenName("Bg/App")).toThrow(TokenError);
    expect(() => tokenName("bg app")).toThrow(TokenError);
  });

  test("warna 0..1 → hex, alpha hanya bila transparan", () => {
    expect(toHex({ r: 1, g: 1, b: 1, a: 1 })).toBe("#ffffff");
    expect(toHex({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("#00000080");
    expect(toHex({ r: 1.2, g: -0.1, b: 0, a: 1 })).toBe("#ff0000");
  });
});

describe("buildTokens dari ekspor FigCraft", () => {
  test("semua warna koleksi Theme punya nilai gelap dan terang", () => {
    expect(tokens.colors.length).toBe(32);
    const bgApp = tokens.colors.find((color) => color.name === "bg-app");
    expect(bgApp).toMatchObject({ dark: "#0e0e10", light: "#f4f4f5" });
    expect(tokens.colors.find((color) => color.name === "overlay-scrim")?.dark).toBe("#000000a6");
  });

  test("radius dan grid spasi 4 px", () => {
    expect(tokens.radii).toEqual([
      { name: "sm", px: 4 },
      { name: "md", px: 6 },
      { name: "lg", px: 8 },
      { name: "xl", px: 12 },
    ]);
    expect(tokens.spacingPx).toBe(4);
  });

  test("text style lengkap dengan tinggi baris, jarak huruf, dan ketebalan", () => {
    expect(tokens.fontFamily).toBe("Inter");
    expect(tokens.textStyles.map((style) => style.name)).toEqual([
      "display",
      "title",
      "heading",
      "body",
      "body-strong",
      "label",
      "small",
      "caption",
      "caption-strong",
      "overline",
    ]);
    expect(tokens.textStyles[0]).toMatchObject({
      sizePx: 24,
      lineHeight: "32px",
      letterSpacing: "-0.015em",
      weight: 600,
    });
    expect(tokens.textStyles.at(-1)).toMatchObject({ uppercase: true, lineHeight: "normal" });
  });

  test("koleksi Icon dan Status tidak diekspor", () => {
    expect(tokens.ignoredCollections).toEqual(["Icon", "Status"]);
  });

  test("grid spasi yang menyimpang ditolak", () => {
    const source = variablesCopy();
    const space = Object.values(source.meta.variables).find((variable) => variable.name === "space/3");
    if (!space) throw new Error("space/3 tidak ada di ekspor");
    for (const mode of Object.keys(space.valuesByMode)) space.valuesByMode[mode] = 13;
    expect(() => buildTokens(source, textStylesJson)).toThrow("space/3");
  });

  test("alias antarvariabel Theme diselesaikan per mode", () => {
    const source = variablesCopy();
    const panel = Object.values(source.meta.variables).find((variable) => variable.name === "bg/panel");
    const app = Object.entries(source.meta.variables).find(([, variable]) => variable.name === "bg/app");
    if (!panel || !app) throw new Error("bg/panel atau bg/app tidak ada di ekspor");
    for (const mode of Object.keys(panel.valuesByMode)) {
      panel.valuesByMode[mode] = { type: "VARIABLE_ALIAS", id: app[0] };
    }
    const resolved = buildTokens(source, textStylesJson).colors.find((color) => color.name === "bg-panel");
    expect(resolved).toMatchObject({ dark: "#0e0e10", light: "#f4f4f5" });
  });
});

describe("file hasil generator", () => {
  test("tokens.css dan tokens.ts sinkron dengan ekspor FigCraft", async () => {
    expect(await readFile(PATHS.css, "utf8")).toBe(renderCss(tokens));
    expect(await readFile(PATHS.ts, "utf8")).toBe(renderTs(tokens));
  });

  test("tema gelap menjadi bawaan dan tema terang menimpa lewat data-theme", () => {
    const css = renderCss(tokens);
    expect(css).toContain("@theme static {");
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain('[data-theme="light"] {');
    expect(css).toContain("--color-bg-app: #f4f4f5;");
  });
});

describe("kontras warna (WCAG 2.1)", () => {
  const luminance = (hex: string) => {
    const channel = (start: number) => {
      const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (foreground: string, background: string) => {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
  };

  /** Pasangan teks/latar yang dipakai desain; semuanya wajib AA (4.5:1). */
  const AA_PAIRS: Array<[ColorToken, ColorToken]> = [
    ...(["bg-app", "bg-panel", "bg-raised", "bg-elevated", "bg-hover", "bg-active"] as const).flatMap(
      (background): Array<[ColorToken, ColorToken]> => [
        ["text-primary", background],
        ["text-secondary", background],
      ],
    ),
    ["text-tertiary", "bg-panel"],
    ["text-tertiary", "bg-raised"],
    ["text-on-accent", "accent-solid"],
    ["text-on-accent", "accent-solid-hover"],
    ["accent-text", "bg-app"],
    ["accent-text", "bg-panel"],
    ["accent-text", "accent-soft"],
    ["danger-text", "danger-soft"],
    ["success-text", "success-soft"],
    ["warning-text", "warning-soft"],
    ["axis-label", "axis-x"],
    ["axis-label", "axis-y"],
    ["axis-label", "axis-z"],
  ];

  /**
   * Temuan Tahap 0 (docs/progress/tahap-00.md): `text/tertiary` sedikit di bawah AA pada dua latar.
   * Nilainya diputuskan pemilik di FigCraft; sampai saat itu tes ini menjaga agar tidak memburuk.
   */
  const KNOWN_BELOW_AA: Array<{ pair: [ColorToken, ColorToken]; theme: "dark" | "light"; min: number }> = [
    { pair: ["text-tertiary", "bg-app"], theme: "light", min: 4.25 },
    { pair: ["text-tertiary", "bg-elevated"], theme: "dark", min: 4.3 },
  ];

  for (const theme of ["dark", "light"] as const) {
    test.each(AA_PAIRS)(`${theme}: %s di atas %s ≥ 4.5`, (foreground, background) => {
      expect(
        contrast(COLOR_VALUES[foreground][theme], COLOR_VALUES[background][theme]),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  test.each(KNOWN_BELOW_AA)(
    "pengecualian tercatat tidak memburuk: $pair ($theme)",
    ({ pair, theme, min }) => {
      const [foreground, background] = pair;
      expect(
        contrast(COLOR_VALUES[foreground][theme], COLOR_VALUES[background][theme]),
      ).toBeGreaterThanOrEqual(min);
    },
  );

  test("cincin fokus terlihat (≥ 3:1) di latar utama", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const background of ["bg-app", "bg-panel", "bg-raised"] as const) {
        expect(
          contrast(COLOR_VALUES["accent-ring"][theme], COLOR_VALUES[background][theme]),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
