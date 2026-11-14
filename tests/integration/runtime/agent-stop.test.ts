/**
 * Stop dengan Docker sungguhan (tanpa kuota): Claude palsu memanggil `build_base_mesh` lewat MCP, lalu Stop →
 * interrupt Claude + `docker kill` container job, hasil tool CANCELLED, dan tidak ada container tersisa.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAssetSession } from "../../../server/agent/asset-session.ts";
import { FakeAgentPort } from "../../../server/agent/fake-port.ts";
import { DockerAssetBuilder } from "../../../server/agent/forge/builder.ts";
import { HeavyLane } from "../../../server/jobs/heavy-lane.ts";
import { MaterialLibrary } from "../../../server/library/materials.ts";
import { Renderer } from "../../../server/render/renderer.ts";
import { openTestStore } from "../../../server/services/test-support.ts";
import { listVersions, versionDir } from "../../../server/services/versions.ts";
import type { AgentEvent } from "../../../shared/agent-events.ts";
import { DEFAULT_TIERS } from "../../../shared/limits.ts";
import { ENABLED, IT_OWNER, JOBS_ROOT, leftoverJobContainers, requireImage, SCRIPTS_DIR } from "./helpers.ts";

describe.skipIf(!ENABLED)("Stop di tengah build", () => {
  const renderer = new Renderer();
  let base = "";
  let image = "";

  beforeAll(async () => {
    image = await requireImage();
    base = await mkdtemp(join(JOBS_ROOT, "..", "agent-stop-"));
  });

  afterAll(async () => {
    await renderer.close();
    const assetDir = join(base, "asset");
    for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
    await rm(base, { recursive: true, force: true });
  });

  test("interrupt → container di-kill, build CANCELLED, tanpa versi baru", async () => {
    const events: AgentEvent[] = [];
    const port = new FakeAgentPort();
    const asset = {
      id: "stop",
      assetDir: join(base, "asset"),
      tierId: "sedang" as const,
      tier: DEFAULT_TIERS.sedang,
    };
    const db = openTestStore({ id: "stop", tierId: "sedang" });
    const builder = new DockerAssetBuilder({
      lane: new HeavyLane(),
      renderer,
      image,
      owner: IT_OWNER,
      jobsRoot: JOBS_ROOT,
      materialsDir: join(JOBS_ROOT, "tanpa-pustaka"),
    });
    let sawProgress: () => void = () => undefined;
    const progressed = new Promise<void>((resolve) => {
      sawProgress = resolve;
    });
    const { runner, roots } = await createAssetSession({
      asset,
      store: db.store,
      port,
      builder,
      library: new MaterialLibrary(join(JOBS_ROOT, "tanpa-pustaka")),
      emit: (event) => {
        events.push(event);
        if (event.type === "build_progress") sawProgress();
      },
    });
    runner.send("Buat sesuatu.");
    const config = port.current.options.mcpServers?.forge;
    if (config === undefined || config.type !== "sdk" || !("instance" in config))
      throw new Error("forge tidak dipasang");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await config.instance.connect(serverTransport);
    const client = new Client({ name: "claude-palsu", version: "1.0.0" });
    await client.connect(clientTransport);

    await client.callTool({
      name: "record_brief",
      arguments: {
        summary: "uji",
        category: "uji",
        style: "uji",
        dimensionsM: { width: 1, depth: 1, height: 1 },
      },
    });
    // Skrip yang tidak pernah selesai: hanya Stop yang bisa menghentikannya sebelum batas waktu job.
    await copyFile(join(SCRIPTS_DIR, "infinite_loop.py"), join(roots.workDir, "base.py"));
    const build = client.callTool({ name: "build_base_mesh", arguments: {} });
    await progressed;
    expect(await leftoverJobContainers()).toHaveLength(1);

    await runner.interrupt();
    const result = await build;
    expect(JSON.stringify(result.content)).toContain("CANCELLED");
    expect(events.findLast((event) => event.type === "build_finished")).toMatchObject({
      ok: false,
      code: "CANCELLED",
    });
    expect(port.current.calls.interrupt).toBe(1);
    expect(await leftoverJobContainers()).toEqual([]);
    expect(await listVersions(asset.assetDir)).toEqual([]);
    runner.close();
    await client.close();
  }, 60_000);
});
