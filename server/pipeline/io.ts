/** Satu `NodeIO` untuk seluruh pipeline: semua ekstensi glTF + encoder/decoder meshopt terdaftar. */
import { type Document, Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

let ioPromise: Promise<NodeIO> | undefined;

async function createIo(): Promise<NodeIO> {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  return new NodeIO()
    .setLogger(new Logger(Logger.Verbosity.ERROR))
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
}

export function gltfIo(): Promise<NodeIO> {
  ioPromise ??= createIo();
  return ioPromise;
}

export async function readGlb(bytes: Uint8Array): Promise<Document> {
  const io = await gltfIo();
  return io.readBinary(bytes);
}

export async function writeGlb(document: Document): Promise<Uint8Array> {
  const io = await gltfIo();
  return io.writeBinary(document);
}
