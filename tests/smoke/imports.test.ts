/**
 * Gerbang kompatibilitas Tahap 0: setiap paket server ter-import di Bun dan menjalankan satu operasi kecil.
 * Pemakaian sebenarnya diuji di tahap masing-masing (pipeline di Tahap 2, Agent SDK di Tahap 3).
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { Document, Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { validateBytes } from "gltf-validator";
import { Hono } from "hono";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import pino from "pino";
import { chromium } from "playwright";
import sharp from "sharp";
import * as THREE from "three";
import { z } from "zod";

/** Satu segitiga sebagai dokumen glTF. Log info gltf-transform dimatikan supaya output tes bersih. */
function triangle(): Document {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", position);
  const mesh = doc.createMesh("segitiga").addPrimitive(primitive);
  doc.createScene("scene").addChild(doc.createNode("segitiga").setMesh(mesh));
  return doc;
}

describe("paket pipeline 3D", () => {
  test("gltf-transform menulis GLB yang lolos gltf-validator tanpa error", async () => {
    const glb = await new NodeIO().writeBinary(triangle());
    const report = await validateBytes(glb);
    expect(report.issues.numErrors).toBe(0);
  });

  test("kompresi meshopt bisa dibaca ulang", async () => {
    await MeshoptEncoder.ready;
    await MeshoptDecoder.ready;
    // meshopt() juga memakai KHR_mesh_quantization, jadi semua ekstensi harus terdaftar di IO.
    const io = new NodeIO()
      .setLogger(new Logger(Logger.Verbosity.ERROR))
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
    const doc = triangle();
    await doc.transform(meshopt({ encoder: MeshoptEncoder }));
    const reread = await io.readBinary(await io.writeBinary(doc));
    const position = reread.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getAttribute("POSITION");
    expect(position?.getCount()).toBe(3);
    const used = reread
      .getRoot()
      .listExtensionsUsed()
      .map((ext) => ext.extensionName);
    expect(used).toContain("EXT_meshopt_compression");
    expect(used).toContain("KHR_mesh_quantization");
  });

  test("sharp mengubah PNG ke WebP", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#2e6bf0" } })
      .png()
      .toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    expect((await sharp(webp).metadata()).format).toBe("webp");
  });

  test("three dapat di-import di Bun", () => {
    expect(THREE.REVISION).toBe("187");
  });

  test("fflate ZIP bolak-balik", () => {
    const zip = zipSync({ "catatan.txt": strToU8("halo") });
    expect(strFromU8(unzipSync(zip)["catatan.txt"] ?? new Uint8Array())).toBe("halo");
  });
});

describe("paket server", () => {
  test("hono, drizzle, pino, zod", () => {
    expect(typeof new Hono().fetch).toBe("function");
    expect(typeof drizzle).toBe("function");
    expect(typeof pino).toBe("function");
    expect(z.string().parse("ok")).toBe("ok");
  });

  test("Chromium untuk Playwright sudah terpasang", () => {
    expect(existsSync(chromium.executablePath())).toBe(true);
  });
});

describe("Agent SDK dan MCP", () => {
  test("Agent SDK mengekspor query, tool, createSdkMcpServer", () => {
    expect(typeof query).toBe("function");
    expect(typeof tool).toBe("function");
    expect(typeof createSdkMcpServer).toBe("function");
  });

  test("MCP SDK menyediakan InMemoryTransport untuk tes tool", async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    expect(typeof serverSide.start).toBe("function");
    const client = new Client({ name: "tes", version: "0.0.0" });
    expect(typeof client.connect).toBe("function");
    await clientSide.close();
  });
});
