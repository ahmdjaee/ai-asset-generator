// Render design thumbnails/heroes with three.js in headless Chromium (SwiftShader).
// Usage: bun design/tools/render/run.mjs <outDir> <jobs.json>   e.g. outDir = design/assets
import { chromium } from "/var/www/ai-team/node_modules/playwright/index.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const ROOT = import.meta.dir;
const THREE_DIR = "/var/www/THREE.Terrain/vendor/three/build";
const OUT = process.argv[2];
const jobs = JSON.parse(readFileSync(process.argv[3], "utf8"));
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
  const p = new URL(req.url).pathname;
  const file = p.startsWith("/three/") ? `${THREE_DIR}/${p.slice(7)}` : `${ROOT}${p === "/" ? "/index.html" : p}`;
  const type = file.endsWith(".js") ? "text/javascript" : "text/html";
  try { return new Response(readFileSync(file), { headers: { "content-type": type } }); } catch { return new Response("nf", { status: 404 }); }
} });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://127.0.0.1:${server.port}/`);
await page.waitForFunction("window.ready === true", null, { timeout: 60000 });
console.log("renderer:", await page.evaluate("window.glInfo()"));
const t0 = Date.now();
const results = await page.evaluate((j) => window.renderAll(j), jobs);
for (const r of results) {
  writeFileSync(`${OUT}/${r.name}.png`, Buffer.from(r.url.split(",")[1], "base64"));
  console.log(`${r.name}: ${r.ms} ms, tris=${r.tris}, size=${r.size.join(" x ")} m`);
}
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close(); server.stop();
