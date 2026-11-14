/** Dokumen glTF sintetis untuk tes pipeline (deterministik, tanpa file biner di repo). */
import { Document, Logger, type Material } from "@gltf-transform/core";
import sharp from "sharp";

export function emptyDocument(): Document {
  return new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
}

/** Grid datar `cells × cells` persegi (2 segitiga per sel) di bidang XZ, ukuran 1 m. */
export function gridDocument(cells: number, material?: (document: Document) => Material): Document {
  const document = emptyDocument();
  const buffer = document.createBuffer();
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let z = 0; z <= cells; z++) {
    for (let x = 0; x <= cells; x++) {
      // Sedikit gelombang supaya simplify tidak bisa meratakan grid menjadi 2 segitiga.
      positions.push(x / cells - 0.5, 0.05 * Math.sin(x * 1.7) * Math.cos(z * 1.3), z / cells - 0.5);
      uvs.push(x / cells, z / cells);
    }
  }
  const indices: number[] = [];
  const row = cells + 1;
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const a = z * row + x;
      indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document.createAccessor().setType("VEC2").setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(
      document.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer),
    );
  if (material) primitive.setMaterial(material(document));
  const mesh = document.createMesh("grid").addPrimitive(primitive);
  document.createScene("scene").addChild(document.createNode("grid").setMesh(mesh));
  return document;
}

/**
 * PNG bermotif (bukan warna polos: `prune()` mengganti tekstur polos dengan faktor material).
 * Motif deterministik dari warna dasar + kotak-kotak.
 */
export async function patternPng(size: number, color: [number, number, number]): Promise<Uint8Array> {
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const shade = ((x >> 5) + (y >> 5)) % 2 === 0 ? 1 : 0.7;
      const offset = (y * size + x) * 3;
      pixels[offset] = Math.round(color[0] * shade);
      pixels[offset + 1] = Math.round(color[1] * shade);
      pixels[offset + 2] = Math.round(color[2] * shade);
    }
  }
  const png = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Satu mesh bertekstur penuh: baseColor, normal, dan ORM (occlusion + metallicRoughness dalam satu gambar). */
export async function texturedDocument(size: number): Promise<Document> {
  const [base, normal, orm] = await Promise.all([
    patternPng(size, [160, 82, 45]),
    patternPng(size, [128, 128, 255]),
    patternPng(size, [255, 128, 0]),
  ]);
  return gridDocument(4, (document) => {
    const texture = (name: string, image: Uint8Array) =>
      document.createTexture(name).setImage(image).setMimeType("image/png");
    const ormTexture = texture("orm", orm);
    return document
      .createMaterial("kayu")
      .setBaseColorTexture(texture("baseColor", base))
      .setNormalTexture(texture("normal", normal))
      .setOcclusionTexture(ormTexture)
      .setMetallicRoughnessTexture(ormTexture);
  });
}

/** Tiga mesh dengan material warna polos berbeda (calon palet di tier Ringan). */
export function multiMaterialDocument(): Document {
  const document = emptyDocument();
  const buffer = document.createBuffer();
  const scene = document.createScene("scene");
  const colors: [number, number, number, number][] = [
    [1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, 0, 1, 1],
  ];
  colors.forEach((color, index) => {
    const offset = index * 2;
    const primitive = document
      .createPrimitive()
      .setAttribute(
        "POSITION",
        document
          .createAccessor()
          .setType("VEC3")
          .setArray(new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset, 1, 0]))
          .setBuffer(buffer),
      )
      .setMaterial(document.createMaterial(`warna-${index}`).setBaseColorFactor(color));
    scene.addChild(
      document.createNode(`bagian-${index}`).setMesh(document.createMesh().addPrimitive(primitive)),
    );
  });
  return document;
}

/** Posisi vertex NaN → gltf-validator melaporkan error (optimasi tidak bisa "memperbaikinya"). */
export function invalidDocument(): Document {
  const document = emptyDocument();
  const buffer = document.createBuffer();
  const primitive = document.createPrimitive().setAttribute(
    "POSITION",
    document
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array([0, 0, 0, 1, Number.NaN, 0, 0, 1, 0]))
      .setBuffer(buffer),
  );
  document
    .createScene("scene")
    .addChild(document.createNode("rusak").setMesh(document.createMesh().addPrimitive(primitive)));
  return document;
}
