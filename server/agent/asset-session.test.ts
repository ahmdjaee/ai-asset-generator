/**
 * Skenario ujung-ke-ujung tanpa kuota: AgentPort palsu berperan sebagai Claude dan memanggil tool `forge`
 * lewat server MCP yang benar-benar dipasang di opsi sesi (InMemoryTransport). Status aset lewat database.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AgentEvent } from "../../shared/agent-events.ts";
import { DEFAULT_TIERS, type TierId } from "../../shared/limits.ts";
import { type AssetState, INITIAL_STATE } from "../domain/status.ts";
import { MaterialLibrary } from "../library/materials.ts";
import { openTestStore, type TestStore } from "../services/test-support.ts";
import { listVersions, versionDir } from "../services/versions.ts";
import { createAssetSession } from "./asset-session.ts";
import { initMessage, resultMessage } from "./fake-messages.ts";
import { FakeAgentPort, type FakeAgentSession } from "./fake-port.ts";
import { FixtureAssetBuilder } from "./forge/fixture-builder.ts";

const KNOWLEDGE_DIR = join(import.meta.dir, "../../runtime/knowledge");

let base = "";
let stores: TestStore[] = [];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "aag-session-"));
  stores = [];
});

afterEach(async () => {
  for (const store of stores) store.handle.close();
  const assetDir = join(base, "asset");
  for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
  await rm(base, { recursive: true, force: true });
});

/** Klien MCP ke server `forge` yang dipasang di opsi sesi palsu, seperti yang dilakukan Claude Code. */
async function forgeClient(session: FakeAgentSession): Promise<Client> {
  const config = session.options.mcpServers?.forge;
  if (config === undefined || config.type !== "sdk" || !("instance" in config))
    throw new Error("server forge tidak dipasang");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await config.instance.connect(serverTransport);
  const client = new Client({ name: "claude-palsu", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function setup(options: { tierId?: TierId; state?: AssetState } = {}) {
  const tierId = options.tierId ?? "sedang";
  const test = openTestStore({ tierId, ...(options.state === undefined ? {} : { state: options.state }) });
  stores.push(test);
  const port = new FakeAgentPort();
  const events: AgentEvent[] = [];
  const session = await createAssetSession({
    asset: { id: "a1", assetDir: join(base, "asset"), tierId, tier: DEFAULT_TIERS[tierId] },
    store: test.store,
    port,
    builder: new FixtureAssetBuilder(),
    library: new MaterialLibrary(join(base, "pustaka")),
    emit: (event) => events.push(event),
    knowledgeDir: KNOWLEDGE_DIR,
  });
  // `agent` utuh (bukan spread): `sessionId` adalah getter.
  return { ...session, agent: session, port, events, test };
}

describe("createAssetSession", () => {
  test("brief → tulis base.py → build → submit, lalu giliran selesai", async () => {
    const s = await setup();
    s.runner.send("Buatkan peti kayu kartun.");
    const session = s.port.current;
    expect(session.options.cwd).toBe(s.roots.workDir);
    expect(session.options.systemPrompt).toMatchObject({ type: "preset", preset: "claude_code" });
    const uuid = session.sent[0]?.uuid ?? "";

    const client = await forgeClient(session);
    await client.callTool({
      name: "record_brief",
      arguments: {
        summary: "Peti kayu kartun",
        category: "properti",
        style: "kartun",
        dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
      },
    });
    await writeFile(
      join(s.roots.workDir, "base.py"),
      "from assetkit import prim, scene\nscene.reset()\nprim.box((0.8, 0.5, 0.55))\n",
    );
    const build = await client.callTool({ name: "build_base_mesh", arguments: {} });
    expect(build.isError).not.toBe(true);
    await client.callTool({ name: "submit_for_review", arguments: { version: 1, summary: "Peti siap" } });
    session.push(initMessage("S1"), resultMessage("S1", [uuid]));
    session.end();
    await session.drained;

    expect(s.test.store.read()).toMatchObject({ status: "BASE_REVIEW", currentVersion: 1 });
    expect(s.runner.status).toBe("idle");
    expect(s.agent.sessionId).toBe("S1");
    expect(s.events.map((event) => event.type)).toEqual([
      "user",
      "brief",
      "build_started",
      "build_progress",
      "build_progress",
      "build_finished",
      "submitted",
      "init",
      "result",
    ]);
    await client.close();
  });

  test("pesan yang terkirim = giliran baru: jatah build direset di database", async () => {
    const s = await setup({
      state: { ...INITIAL_STATE, status: "BASE_WORKING", runState: "running", buildsThisMessage: 5 },
    });
    s.deliver({ kind: "owner", text: "Tutupnya terlalu tipis." });
    expect(s.test.store.read()).toMatchObject({ buildsThisMessage: 0, runState: "running" });
    expect(s.forge.buildsLeft).toBe(8);
  });

  test("deliver: pesan sistem membawa origin; sesi baru pada aset berjalan diberi pembuka sekali", async () => {
    const s = await setup({
      state: { ...INITIAL_STATE, status: "TEXTURE_WORKING", approvedBaseVersion: 2, currentVersion: 2 },
    });
    s.deliver({ kind: "approved", version: 2 });
    const first = s.port.current.sent[0];
    expect(String(first?.message.content)).toStartWith("[Sistem] Ini sesi baru");
    expect(String(first?.message.content)).toContain("Pemilik menyetujui bentuk dasar v2");
    expect(s.events[0]).toMatchObject({ type: "user", origin: "approved" });

    s.port.current.push(initMessage("S9"), resultMessage("S9", [first?.uuid ?? ""]));
    await s.port.current.lastSent(1);
    s.deliver({ kind: "owner", text: "kayunya lebih gelap" });
    const second = await s.port.current.lastSent(2);
    expect(second.message.content).toBe("kayunya lebih gelap");
  });

  test("aset baru (BRIEFING) tanpa sesi lama: pesan pertama tanpa pembuka", async () => {
    const s = await setup();
    s.deliver({ kind: "owner", text: "Buatkan kursi." });
    expect(s.port.current.sent[0]?.message.content).toBe("Buatkan kursi.");
  });

  test("canUseTool sesi memakai pagar sungguhan: Read /etc/passwd ditolak, Read API.md diizinkan", async () => {
    const s = await setup({ tierId: "ringan" });
    s.runner.send("halo");
    const canUseTool = s.port.current.options.canUseTool;
    if (canUseTool === undefined) throw new Error("canUseTool tidak dipasang");
    const context = { signal: new AbortController().signal, toolUseID: "tu", requestId: "rq" };
    expect(await canUseTool("Read", { file_path: "/etc/passwd" }, context)).toMatchObject({
      behavior: "deny",
    });
    expect(await canUseTool("Bash", { command: "id" }, context)).toMatchObject({ behavior: "deny" });
    expect(await canUseTool("Read", { file_path: join(KNOWLEDGE_DIR, "API.md") }, context)).toMatchObject({
      behavior: "allow",
    });
  });
});
