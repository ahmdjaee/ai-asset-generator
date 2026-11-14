/** Pintu tool `forge` ke runtime + pipeline + renderer. Tes memakai builder palsu. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ShapeStats } from "../../domain/shape.ts";
import type { HeavyLane } from "../../jobs/heavy-lane.ts";
import type { RenderMode, RenderView } from "../../render/protocol.ts";
import type { Renderer } from "../../render/renderer.ts";
import { type BuildOutcome, buildBaseVersion, buildTexturedVersion } from "../../services/build-version.ts";
import { readManifest, versionDir } from "../../services/versions.ts";
import type { ForgeAsset } from "./state.ts";

export type BuildProgress = Readonly<{ jobId: string; step: string; pct: number }>;

/** Bentuk dasar yang disetujui pemilik: dasar build aset final. */
export type ApprovedBase = Readonly<{ version: number; scriptPath: string; shape: ShapeStats }>;

export type BuildRequest = Readonly<{
  asset: ForgeAsset;
  jobId: string;
  scriptPath: string;
  signal: AbortSignal;
  onProgress: (progress: BuildProgress) => void;
}>;

export type TexturedBuildRequest = BuildRequest & Readonly<{ base: ApprovedBase }>;

export type InspectRequest = Readonly<{
  asset: ForgeAsset;
  version: number;
  mode: RenderMode;
  views?: readonly RenderView[];
  signal: AbortSignal;
}>;

export interface AssetBuilder {
  build(request: BuildRequest): Promise<BuildOutcome>;
  buildTextured(request: TexturedBuildRequest): Promise<BuildOutcome>;
  /** Render ulang versi yang sudah ada (tanpa build ulang). Hasil: PNG contact sheet. */
  inspect(request: InspectRequest): Promise<Uint8Array>;
}

export type DockerAssetBuilderOptions = Readonly<{
  lane: HeavyLane;
  renderer: Renderer;
  image: string;
  owner: string;
  jobsRoot: string;
  /** `data/library/materials`; wajib untuk build bertekstur. */
  materialsDir: string;
}>;

/** GLB utama versi: `final.glb` untuk aset final, `base.glb` untuk bentuk dasar. */
export async function versionGlbPath(assetDir: string, version: number): Promise<string> {
  const manifest = await readManifest(assetDir, version);
  const name = manifest.files.some((file) => file.name === "final.glb") ? "final.glb" : "base.glb";
  return join(versionDir(assetDir, version), name);
}

/** Builder sungguhan: Docker + pipeline + Chromium, lewat jalur job berat. */
export class DockerAssetBuilder implements AssetBuilder {
  readonly #options: DockerAssetBuilderOptions;

  constructor(options: DockerAssetBuilderOptions) {
    this.#options = options;
  }

  async #withProgress(request: BuildRequest, run: () => Promise<BuildOutcome>): Promise<BuildOutcome> {
    const unsubscribe = this.#options.lane.on((event) => {
      if (event.jobId === request.jobId && event.type === "progress") {
        request.onProgress({ jobId: request.jobId, step: event.step, pct: event.pct });
      }
    });
    try {
      return await run();
    } finally {
      unsubscribe();
    }
  }

  #common(request: BuildRequest) {
    const { lane, renderer, image, owner, jobsRoot } = this.#options;
    return {
      lane,
      renderer,
      image,
      owner,
      jobsRoot,
      jobId: request.jobId,
      scriptPath: request.scriptPath,
      assetDir: request.asset.assetDir,
      tierId: request.asset.tierId,
      tier: request.asset.tier,
      signal: request.signal,
    };
  }

  build(request: BuildRequest): Promise<BuildOutcome> {
    return this.#withProgress(request, () => buildBaseVersion(this.#common(request)));
  }

  buildTextured(request: TexturedBuildRequest): Promise<BuildOutcome> {
    return this.#withProgress(request, () =>
      buildTexturedVersion({
        ...this.#common(request),
        baseScriptPath: request.base.scriptPath,
        baseVersion: request.base.version,
        baseShape: request.base.shape,
        materialsDir: this.#options.materialsDir,
      }),
    );
  }

  async inspect(request: InspectRequest): Promise<Uint8Array> {
    const glb = new Uint8Array(await readFile(await versionGlbPath(request.asset.assetDir, request.version)));
    const output = await this.#options.renderer.render(glb, {
      mode: request.mode,
      ...(request.views === undefined ? {} : { views: request.views }),
      signal: request.signal,
    });
    return output.sheet.png;
  }
}
