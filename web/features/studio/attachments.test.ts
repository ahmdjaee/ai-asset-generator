import { describe, expect, test } from "bun:test";
import { ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_MAX_FILES } from "../../../shared/limits.ts";
import { ACCEPT_ALL, ACCEPT_IMAGES, attachmentKind, checkFiles, fileMeta } from "./attachments.ts";

/** File dengan ukuran tertentu tanpa mengalokasikan isinya. */
function sized(name: string, size: number): File {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("lampiran composer", () => {
  test("jenis dari ekstensi, tanpa membedakan huruf besar", () => {
    expect(attachmentKind("sketsa.JPG")).toBe("image");
    expect(attachmentKind("referensi.webp")).toBe("image");
    expect(attachmentKind("kursi.glb")).toBe("model");
    expect(attachmentKind("pohon.STL")).toBe("model");
    expect(attachmentKind("catatan.pdf")).toBeNull();
    expect(attachmentKind("tanpa-ekstensi")).toBeNull();
    expect(ACCEPT_ALL).toBe(".png,.jpg,.jpeg,.webp,.gif,.glb,.gltf,.obj,.fbx,.stl");
    expect(ACCEPT_IMAGES).toBe(".png,.jpg,.jpeg,.webp,.gif");
  });

  test("keterangan chip seperti desain: JPG · 184 KB", () => {
    expect(fileMeta("sketsa-peti.jpeg", 184_000)).toBe("JPG · 184 KB");
    expect(fileMeta("kursi.glb", 1_500_000)).toBe("GLB · 1,5 MB");
  });

  test("file tak didukung dan terlalu besar ditolak dengan pesan per file", () => {
    const result = checkFiles(0, [
      sized("ok.png", 10),
      sized("dokumen.pdf", 10),
      sized("besar.png", ATTACHMENT_IMAGE_MAX_BYTES + 1),
    ]);
    expect(result.accepted.map((file) => file.name)).toEqual(["ok.png"]);
    expect(result.errors).toEqual([
      "dokumen.pdf bukan gambar (PNG, JPG, WebP, GIF) atau model 3D (GLB, glTF, OBJ, FBX, STL).",
      "besar.png lebih besar dari 20 MB.",
    ]);
  });

  test("batas jumlah per pesan menghitung lampiran yang sudah ada", () => {
    const files = Array.from({ length: 3 }, (_, index) => sized(`gambar-${index}.png`, 10));
    const result = checkFiles(ATTACHMENT_MAX_FILES - 2, files);
    expect(result.accepted.map((file) => file.name)).toEqual(["gambar-0.png", "gambar-1.png"]);
    expect(result.errors).toEqual([`Maksimal ${ATTACHMENT_MAX_FILES} lampiran per pesan.`]);
    expect(checkFiles(ATTACHMENT_MAX_FILES, files).accepted).toEqual([]);
  });
});
