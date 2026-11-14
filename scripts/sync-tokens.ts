/**
 * `bun run tokens:sync`: token desain FigCraft → `web/styles/tokens.css` + `web/styles/tokens.ts`.
 * `bun run tokens:sync --check`: hanya membandingkan; exit 1 bila hasil berbeda dari file yang ada.
 *
 * Sumber (diekspor dari design/ai-asset-generate.figcraft lewat MCP FigCraft):
 * - design/tokens/figcraft-variables.json   ← `variable.export {format: "json"}`
 * - design/tokens/figcraft-text-styles.json ← `style.list {type: "text"}`
 *
 * Koleksi yang dipakai: Theme (mode Dark = bawaan, Light) dan Scale. Koleksi Icon dan Status hanya alias mode di
 * FigCraft; di kode, warna ikon memakai kelas `text-*` dan badge status memakai varian komponen.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const ROOT = join(import.meta.dir, "..");
export const PATHS = {
  variables: join(ROOT, "design/tokens/figcraft-variables.json"),
  textStyles: join(ROOT, "design/tokens/figcraft-text-styles.json"),
  css: join(ROOT, "web/styles/tokens.css"),
  ts: join(ROOT, "web/styles/tokens.ts"),
} as const;

const USED_COLLECTIONS = ["Theme", "Scale"] as const;
const SPACING_STEP_PX = 4;

// ---------------------------------------------------------------------------------------------- skema sumber

const Rgba = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() });
const Alias = z.object({ type: z.literal("VARIABLE_ALIAS"), id: z.string() });
const VariableValue = z.union([Rgba, Alias, z.number(), z.string(), z.boolean()]);

const VariablesExport = z.object({
  meta: z.object({
    variableCollections: z.record(
      z.string(),
      z.object({
        id: z.string(),
        name: z.string(),
        defaultModeId: z.string(),
        modes: z.array(z.object({ modeId: z.string(), name: z.string() })),
      }),
    ),
    variables: z.record(
      z.string(),
      z.object({
        id: z.string(),
        name: z.string(),
        resolvedType: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
        variableCollectionId: z.string(),
        valuesByMode: z.record(z.string(), VariableValue),
        description: z.string().optional(),
      }),
    ),
  }),
});
type VariablesExport = z.infer<typeof VariablesExport>;
type Variable = VariablesExport["meta"]["variables"][string];

const TextStyles = z.array(
  z.object({
    name: z.string(),
    description: z.string().optional(),
    style: z.object({
      case: z.enum(["original", "upper", "lower", "title"]),
      font_family: z.string(),
      font_size: z.number().positive(),
      font_style: z.string(),
      letter_spacing: z.object({ unit: z.enum(["percent", "pixels"]), value: z.number() }),
      line_height: z.union([
        z.object({ unit: z.literal("auto") }),
        z.object({ unit: z.enum(["pixels", "percent"]), value: z.number().positive() }),
      ]),
    }),
  }),
);
type TextStyles = z.infer<typeof TextStyles>;

// ---------------------------------------------------------------------------------------------- model token

export type ColorToken = { name: string; dark: string; light: string; description?: string };
export type TextStyleToken = {
  name: string;
  label: string;
  sizePx: number;
  lineHeight: string;
  letterSpacing: string;
  weight: number;
  uppercase: boolean;
  description?: string;
};
export type Tokens = {
  colors: ColorToken[];
  radii: Array<{ name: string; px: number }>;
  spacingPx: number;
  fontFamily: string;
  textStyles: TextStyleToken[];
  ignoredCollections: string[];
};

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

const FONT_WEIGHTS: Record<string, number> = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };

/** "bg/app" → "bg-app". Hanya huruf kecil, angka, "-" dan "/" yang diterima. */
export function tokenName(figmaName: string): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(figmaName)) {
    throw new TokenError(
      `Nama variabel "${figmaName}" tidak valid untuk CSS (pakai huruf kecil, angka, - dan /).`,
    );
  }
  return figmaName.replaceAll("/", "-");
}

/** Warna 0..1 → "#rrggbb" atau "#rrggbbaa" bila transparan. */
export function toHex(color: z.infer<typeof Rgba>): string {
  const byte = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  const rgb = `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
  return color.a < 1 ? `${rgb}${byte(color.a)}` : rgb;
}

function resolveValue(
  source: VariablesExport,
  variable: Variable,
  modeId: string,
  seen: Set<string> = new Set(),
): z.infer<typeof VariableValue> {
  if (seen.has(variable.id)) throw new TokenError(`Alias melingkar di variabel "${variable.name}".`);
  seen.add(variable.id);
  const value = variable.valuesByMode[modeId];
  if (value === undefined)
    throw new TokenError(`Variabel "${variable.name}" tidak punya nilai untuk mode ${modeId}.`);
  if (typeof value !== "object" || !("type" in value)) return value;
  const target = source.meta.variables[value.id];
  if (!target)
    throw new TokenError(`Alias di "${variable.name}" menunjuk variabel yang tidak ada (${value.id}).`);
  // Alias ke koleksi lain dibaca di mode bawaan koleksi itu.
  const targetCollection = source.meta.variableCollections[target.variableCollectionId];
  const sameCollection = target.variableCollectionId === variable.variableCollectionId;
  const targetMode = sameCollection ? modeId : (targetCollection?.defaultModeId ?? modeId);
  return resolveValue(source, target, targetMode, seen);
}

function collectionByName(source: VariablesExport, name: string) {
  const collection = Object.values(source.meta.variableCollections).find((item) => item.name === name);
  if (!collection) throw new TokenError(`Koleksi "${name}" tidak ada di ekspor FigCraft.`);
  return collection;
}

function modeId(collection: { name: string; modes: Array<{ modeId: string; name: string }> }, mode: string) {
  const found = collection.modes.find((item) => item.name === mode);
  if (!found) throw new TokenError(`Koleksi "${collection.name}" tidak punya mode "${mode}".`);
  return found.modeId;
}

function buildColors(source: VariablesExport): ColorToken[] {
  const theme = collectionByName(source, "Theme");
  const dark = modeId(theme, "Dark");
  const light = modeId(theme, "Light");
  if (theme.defaultModeId !== dark) throw new TokenError('Mode bawaan koleksi Theme harus "Dark".');
  const colors = Object.values(source.meta.variables)
    .filter((variable) => variable.variableCollectionId === theme.id)
    .map((variable): ColorToken => {
      if (variable.resolvedType !== "COLOR") {
        throw new TokenError(`Variabel Theme "${variable.name}" bukan warna (${variable.resolvedType}).`);
      }
      const hexIn = (mode: string) => {
        const value = resolveValue(source, variable, mode);
        const parsed = Rgba.safeParse(value);
        if (!parsed.success) throw new TokenError(`Nilai "${variable.name}" bukan warna RGBA.`);
        return toHex(parsed.data);
      };
      const token: ColorToken = { name: tokenName(variable.name), dark: hexIn(dark), light: hexIn(light) };
      if (variable.description) token.description = variable.description;
      return token;
    });
  return colors.sort((a, b) => a.name.localeCompare(b.name));
}

function buildScale(source: VariablesExport): Pick<Tokens, "radii" | "spacingPx"> {
  const scale = collectionByName(source, "Scale");
  const radii: Tokens["radii"] = [];
  for (const variable of Object.values(source.meta.variables)) {
    if (variable.variableCollectionId !== scale.id) continue;
    const value = resolveValue(source, variable, scale.defaultModeId);
    if (typeof value !== "number") throw new TokenError(`Variabel Scale "${variable.name}" bukan angka.`);
    const [group, step] = variable.name.split("/");
    if (group === "radius" && step) radii.push({ name: step, px: value });
    else if (group === "space" && step) {
      // Tailwind memakai satu basis spasi (`--spacing`); setiap space/N harus N × 4 px.
      if (value !== Number(step) * SPACING_STEP_PX) {
        throw new TokenError(
          `space/${step} = ${value}px, padahal grid ${SPACING_STEP_PX}px mengharuskan ${Number(step) * SPACING_STEP_PX}px.`,
        );
      }
    } else
      throw new TokenError(`Variabel Scale "${variable.name}" tidak dikenal (harus radius/* atau space/*).`);
  }
  return { radii: radii.sort((a, b) => a.px - b.px), spacingPx: SPACING_STEP_PX };
}

function buildTextStyles(styles: TextStyles): { fontFamily: string; textStyles: TextStyleToken[] } {
  const families = new Set(styles.map((item) => item.style.font_family));
  const [family] = families;
  if (families.size !== 1 || !family)
    throw new TokenError("Semua text style harus memakai satu font family.");
  const textStyles = styles.map((item): TextStyleToken => {
    const { style } = item;
    const weight = FONT_WEIGHTS[style.font_style];
    if (weight === undefined)
      throw new TokenError(`Font style "${style.font_style}" di "${item.name}" tidak dikenal.`);
    const lineHeight =
      style.line_height.unit === "auto"
        ? "normal"
        : style.line_height.unit === "pixels"
          ? `${style.line_height.value}px`
          : `${style.line_height.value / 100}`;
    const spacing = style.letter_spacing;
    const letterSpacing = spacing.unit === "percent" ? `${spacing.value / 100}em` : `${spacing.value}px`;
    const token: TextStyleToken = {
      name: item.name.toLowerCase().replaceAll(" ", "-"),
      label: item.name,
      sizePx: style.font_size,
      lineHeight,
      letterSpacing,
      weight,
      uppercase: style.case === "upper",
    };
    if (item.description) token.description = item.description;
    return token;
  });
  return { fontFamily: family, textStyles };
}

export function buildTokens(variablesJson: unknown, textStylesJson: unknown): Tokens {
  const variables = VariablesExport.parse(variablesJson);
  const styles = TextStyles.parse(textStylesJson);
  const ignoredCollections = Object.values(variables.meta.variableCollections)
    .map((collection) => collection.name)
    .filter((name) => !(USED_COLLECTIONS as readonly string[]).includes(name))
    .sort();
  return {
    colors: buildColors(variables),
    ...buildScale(variables),
    ...buildTextStyles(styles),
    ignoredCollections,
  };
}

// ---------------------------------------------------------------------------------------------- keluaran

const HEADER =
  "Dihasilkan oleh `bun run tokens:sync` dari design/tokens/ (ekspor FigCraft). Jangan diedit manual.";

export function renderCss(tokens: Tokens): string {
  const lines: string[] = [
    "/*",
    ` * ${HEADER}`,
    ' * Tema gelap = bawaan (:root); tema terang = [data-theme="light"].',
    " * Pemakaian: bg-bg-app, text-text-primary, border-border-default, rounded-lg, text-body, p-4 (= 16px).",
    " * Overline: tambahkan kelas `uppercase` (case: upper di FigCraft).",
    " */",
    "",
    "@theme static {",
    "  --color-*: initial;",
    ...tokens.colors.map((color) => `  --color-${color.name}: ${color.dark};`),
    "",
    "  --radius-*: initial;",
    ...tokens.radii.map((radius) => `  --radius-${radius.name}: ${radius.px}px;`),
    "",
    `  --spacing: ${tokens.spacingPx}px;`,
    "",
    `  --font-sans: "${tokens.fontFamily} Variable", "${tokens.fontFamily}", ui-sans-serif, system-ui, sans-serif;`,
    "",
    "  --text-*: initial;",
  ];
  for (const style of tokens.textStyles) {
    lines.push(
      `  --text-${style.name}: ${style.sizePx}px;`,
      `  --text-${style.name}--line-height: ${style.lineHeight};`,
      `  --text-${style.name}--letter-spacing: ${style.letterSpacing};`,
      `  --text-${style.name}--font-weight: ${style.weight};`,
    );
  }
  lines.push(
    "}",
    "",
    "@layer base {",
    "  :root {",
    "    color-scheme: dark;",
    "  }",
    "",
    '  [data-theme="light"] {',
    "    color-scheme: light;",
    ...tokens.colors.map((color) => `    --color-${color.name}: ${color.light};`),
    "  }",
    "}",
    "",
  );
  return lines.join("\n");
}

export function renderTs(tokens: Tokens): string {
  const list = (values: string[]) => values.map((value) => `  "${value}",`).join("\n");
  const colorValues = tokens.colors
    .map((color) => `  "${color.name}": { dark: "${color.dark}", light: "${color.light}" },`)
    .join("\n");
  return [
    `// ${HEADER}`,
    "",
    "/** Nama token warna (tanpa awalan `--color-`). */",
    `export const COLOR_TOKENS = [\n${list(tokens.colors.map((color) => color.name))}\n] as const;`,
    "export type ColorToken = (typeof COLOR_TOKENS)[number];",
    "",
    "/** Nilai warna per tema, untuk kode yang tidak membaca CSS (tes kontras, renderer headless). */",
    `export const COLOR_VALUES: Record<ColorToken, { dark: string; light: string }> = {\n${colorValues}\n};`,
    "",
    "/** Nama text style untuk kelas `text-*` (ukuran, tinggi baris, jarak huruf, ketebalan). */",
    `export const TEXT_STYLES = [\n${list(tokens.textStyles.map((style) => style.name))}\n] as const;`,
    "",
    "/** Nama radius untuk kelas `rounded-*`. */",
    `export const RADII = [\n${list(tokens.radii.map((radius) => radius.name))}\n] as const;`,
    "",
  ].join("\n");
}

async function main(): Promise<number> {
  const check = process.argv.includes("--check");
  const [variablesJson, textStylesJson] = await Promise.all([
    readFile(PATHS.variables, "utf8").then((text): unknown => JSON.parse(text)),
    readFile(PATHS.textStyles, "utf8").then((text): unknown => JSON.parse(text)),
  ]);
  const tokens = buildTokens(variablesJson, textStylesJson);
  const outputs = [
    { path: PATHS.css, content: renderCss(tokens) },
    { path: PATHS.ts, content: renderTs(tokens) },
  ];

  if (check) {
    const stale: string[] = [];
    for (const output of outputs) {
      const current = await readFile(output.path, "utf8").catch(() => "");
      if (current !== output.content) stale.push(output.path);
    }
    if (stale.length > 0) {
      console.error(
        `✗ Token tidak sinkron dengan FigCraft: ${stale.join(", ")}. Jalankan \`bun run tokens:sync\`.`,
      );
      return 1;
    }
    console.log("✓ Token sinkron dengan ekspor FigCraft.");
    return 0;
  }

  await Promise.all(outputs.map((output) => writeFile(output.path, output.content)));
  console.log(
    `✓ ${tokens.colors.length} warna, ${tokens.radii.length} radius, ${tokens.textStyles.length} text style → web/styles/tokens.{css,ts}`,
  );
  if (tokens.ignoredCollections.length > 0) {
    console.log(
      `  Koleksi yang tidak diekspor (alias mode FigCraft): ${tokens.ignoredCollections.join(", ")}`,
    );
  }
  return 0;
}

if (import.meta.main) {
  process.exit(
    await main().catch((error: unknown) => {
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }),
  );
}
