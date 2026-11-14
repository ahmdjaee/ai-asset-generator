/**
 * `bun scripts/fixture-sheets.ts`: membuat contact sheet dan thumbnail/turntable Gudang siap pakai untuk
 * `RUNTIME_DRIVER=fixture` (`tests/fixtures/contact-sheets/`, `tests/fixtures/turntables/`). GLB fixture → pipeline
 * tier Sedang → renderer sungguhan (Chromium + SwiftShader), sama seperti build asli: bentuk dasar dirender mode clay,
 * aset bertekstur mode tekstur; turntable dari `web.glb`. Tanpa Docker dan tanpa kuota. Jalankan ulang hanya bila
 * fixture GLB-nya atau tampilan render berubah.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FIXTURE_PAIR,
  fixtureSheetPath,
  fixtureTurntablePaths,
} from "../server/agent/forge/fixture-builder.ts";
import { processGlb } from "../server/pipeline/process.ts";
import { Renderer } from "../server/render/renderer.ts";
import { composeTurntable } from "../server/render/turntable.ts";

const FIXTURES = join(import.meta.dir, "..", "tests", "fixtures", "glb");

const SHEETS: ReadonlyArray<
  Readonly<{ name: string; stage: "base" | "textured"; mode: "clay" | "texture" }>
> = [
  { name: FIXTURE_PAIR.base, stage: "base", mode: "clay" },
  { name: FIXTURE_PAIR.textured, stage: "textured", mode: "texture" },
];

const renderer = new Renderer();
try {
  for (const sheet of SHEETS) {
    const glb = new Uint8Array(await readFile(join(FIXTURES, `${sheet.name}.glb`)));
    const processed = await processGlb(glb, { tierId: "sedang", stage: sheet.stage });
    const rendered = await renderer.render(processed.glb, { mode: sheet.mode });
    const target = fixtureSheetPath(sheet.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, rendered.sheet.png);
    console.log(`${sheet.name} → ${target} (${rendered.sheet.png.byteLength} byte)`);

    const turntable = await renderer.turntable(processed.web ?? processed.glb, { mode: sheet.mode });
    const images = await composeTurntable(turntable.frames);
    const paths = fixtureTurntablePaths(sheet.name);
    await mkdir(dirname(paths.thumb), { recursive: true });
    await writeFile(paths.thumb, images.thumb);
    await writeFile(paths.turntable, images.strip);
    console.log(
      `${sheet.name} → ${paths.turntable} (${images.strip.byteLength} byte, thumbnail ${images.thumb.byteLength} byte)`,
    );
  }
} finally {
  await renderer.close();
}
