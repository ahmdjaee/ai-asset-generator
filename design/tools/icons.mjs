// Extract Lucide icons (lucide-react 0.454.0, ISC) into SVG strings for FigCraft import.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const DIR = "/var/www/fe-portfolio/node_modules/lucide-react/dist/esm/icons";
const [, , outPath, size = "20", stroke = "#A1A1A8", width = "1.75", ...names] = process.argv;
const result = {};
const missing = [];
for (const name of names) {
  const file = `${DIR}/${name}.js`;
  if (!existsSync(file)) { missing.push(name); continue; }
  const src = readFileSync(file, "utf8");
  const start = src.indexOf("createLucideIcon(");
  const arrStart = src.indexOf("[", src.indexOf(",", start));
  const end = src.lastIndexOf("]);");
  const literal = src.slice(arrStart, end + 1);
  const nodes = new Function(`return ${literal}`)();
  const body = nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== "key")
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${a}/>`;
    })
    .join("");
  result[name] =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
writeFileSync(outPath, JSON.stringify(result));
console.log(`ok ${Object.keys(result).length} icons` + (missing.length ? `; missing: ${missing.join(", ")}` : ""));
