/**
 * Agent berskenario (`AGENT_DRIVER=fake`): pesan SDK yang dihasilkan, pagar (hook + canUseTool) yang benar-benar
 * dilewati, interrupt, proses mati, dan bug skenario. Dijalankan lewat sesi aset asli (runner + opsi + forge).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../../shared/agent-events.ts";
import { DEFAULT_TIERS } from "../../shared/limits.ts";
import { MaterialLibrary } from "../library/materials.ts";
import { openTestStore, type TestStore } from "../services/test-support.ts";
import { listVersions, versionDir } from "../services/versions.ts";
import { createAssetSession } from "./asset-session.ts";
import { FixtureAssetBuilder } from "./forge/fixture-builder.ts";
import { type Scenario, type ScenarioActions, ScenarioAgentPort } from "./scenario-port.ts";

const KNOWLEDGE_DIR = join(import.meta.dir, "../../runtime/knowledge");

let base = "";
let stores: TestStore[] = [];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "aag-skenario-"));
  stores = [];
});

afterEach(async () => {
  for (const store of stores) store.handle.close();
  // Folder versi read-only (write-once): buka dulu supaya bisa dihapus.
  const assetDir = join(base, "asset");
  for (const version of await listVersions(assetDir)) await chmod(versionDir(assetDir, version), 0o755);
  await rm(base, { recursive: true, force: true });
});

async function setup(scenario: Scenario, builder: FixtureAssetBuilder = new FixtureAssetBuilder()) {
  const test = openTestStore();
  stores.push(test);
  const port = new ScenarioAgentPort(scenario);
  const events: AgentEvent[] = [];
  const waiters: Array<{ match: (event: AgentEvent) => boolean; resolve: (event: AgentEvent) => void }> = [];
  const session = await createAssetSession({
    asset: { id: "a1", assetDir: join(base, "asset"), tierId: "sedang", tier: DEFAULT_TIERS.sedang },
    store: test.store,
    port,
    builder,
    library: new MaterialLibrary(join(base, "pustaka")),
    emit: (event) => {
      events.push(event);
      for (const waiter of waiters.splice(0)) {
        if (waiter.match(event)) waiter.resolve(event);
        else waiters.push(waiter);
      }
    },
    knowledgeDir: KNOWLEDGE_DIR,
  });
  const next = (match: (event: AgentEvent) => boolean) =>
    new Promise<AgentEvent>((resolve) => {
      const found = events.find(match);
      if (found !== undefined) resolve(found);
      else waiters.push({ match, resolve });
    });
  const send = (text: string) => session.deliver({ kind: "owner", text });
  return { session, port, events, next, send, workDir: session.roots.workDir };
}

const isResult = (event: AgentEvent) => event.type === "result";

describe("ScenarioAgentPort", () => {
  test("say/think menghasilkan delta + pesan utuh; init sekali; result sukses dengan uuid pesan", async () => {
    const s = await setup(async (turn, claude) => {
      claude.think("menimbang");
      claude.say(`halo ${turn.index}`);
    });
    s.send("pertama");
    await s.next(isResult);
    s.send("kedua");
    await s.next((event) => event.type === "result" && s.events.filter(isResult).length === 2);
    expect(s.events.filter((event) => event.type === "init")).toHaveLength(1);
    expect(s.events.filter((event) => event.type === "delta").length).toBeGreaterThan(2);
    expect(s.events.filter((event) => event.type === "assistant").map((event) => event.text)).toEqual([
      "halo 1",
      "halo 2",
    ]);
    expect(s.events.filter(isResult).every((event) => event.type === "result" && !event.isError)).toBe(true);
    expect(s.session.sessionId).toBe(s.port.current.sessionId);
  });

  test("Write di luar work/ ditolak pagar; di dalam work/ ditulis", async () => {
    const results: boolean[] = [];
    const s = await setup(async (_turn, claude) => {
      results.push(await claude.write(join(claude.cwd, "..", "refs", "jahat.py"), "x"));
      results.push(await claude.write(join(claude.cwd, "base.py"), "print(1)\n"));
    });
    s.send("tulis");
    await s.next(isResult);
    expect(results).toEqual([false, true]);
    expect(await stat(join(base, "asset", "refs", "jahat.py")).catch(() => null)).toBeNull();
    expect((await stat(join(s.workDir, "base.py"))).isFile()).toBe(true);
    const denied = s.events.find((event) => event.type === "tool_result" && event.isError);
    expect(denied).toBeDefined();
  });

  test("tool forge: JSON dibaca, tool tak dikenal menjadi balasan error", async () => {
    const replies: unknown[] = [];
    const s = await setup(async (_turn, claude) => {
      replies.push(await claude.forge("list_versions"));
      replies.push(await claude.forge("tidak_ada"));
    });
    s.send("cek");
    await s.next(isResult);
    expect(replies[0]).toMatchObject({ ok: true, body: { status: "BRIEFING", versions: [] }, images: 0 });
    expect(replies[1]).toMatchObject({ ok: false });
  });

  test("streamText: hanya delta teks, tanpa pesan assistant utuh", async () => {
    const s = await setup(async (_turn, claude) => {
      claude.streamText("Saya mulai dari kotak dasar, lalu");
      await claude.hang();
    });
    s.send("tulis");
    await s.next((event) => event.type === "delta");
    await s.session.interrupt();
    await s.next(isResult);
    const deltas = s.events.flatMap((event) => (event.type === "delta" ? [event] : []));
    expect(deltas.every((event) => event.kind === "text")).toBe(true);
    expect(deltas.map((event) => event.text).join("")).toBe("Saya mulai dari kotak dasar, lalu");
    expect(s.events.some((event) => event.type === "assistant")).toBe(false);
  });

  test("interrupt saat hang: giliran berakhir interrupted, pesan antre ikut dibatalkan", async () => {
    let started: () => void = () => undefined;
    const hanging = new Promise<void>((resolve) => {
      started = resolve;
    });
    const s = await setup(async (_turn, claude: ScenarioActions) => {
      started();
      await claude.hang();
    });
    s.send("macet");
    await hanging;
    const receipt = await s.port.current.interrupt();
    expect(receipt?.cancelled).toEqual([]);
    const result = await s.next(isResult);
    expect(result).toMatchObject({ type: "result", isError: true });
  });

  test("proses mati: aliran berakhir dengan error → SESSION_FAILED", async () => {
    const s = await setup(async (_turn, claude) => {
      claude.crash("segfault palsu");
    });
    s.send("mati");
    const error = await s.next((event) => event.type === "error");
    expect(error).toMatchObject({ type: "error", code: "SESSION_FAILED" });
  });

  test("bug skenario terlihat di thread dan giliran gagal", async () => {
    const s = await setup(async () => {
      throw new Error("lupa langkah");
    });
    s.send("bug");
    const result = await s.next(isResult);
    expect(result).toMatchObject({ isError: true });
    expect(s.events.some((event) => event.type === "assistant" && event.text.includes("lupa langkah"))).toBe(
      true,
    );
  });

  test("batas pemakaian: rate_limit_event ditolak + reset dalam detik → ms", async () => {
    const s = await setup(async (_turn, claude) => {
      claude.usageLimit(1_800_003_600);
    });
    s.send("batas");
    const error = await s.next((event) => event.type === "error");
    expect(error).toMatchObject({ code: "USAGE_LIMIT", resetsAt: 1_800_003_600_000 });
  });

  test("info akun dan daftar model palsu (tanpa proses Claude)", async () => {
    const s = await setup(async () => undefined);
    s.send("halo");
    await s.next(isResult);
    expect(await s.port.current.accountInfo()).toEqual({ subscriptionType: "palsu", tokenSource: "fake" });
    expect((await s.port.current.supportedModels()).map((model) => model.value)).toContain("claude-opus-5-5");
    s.session.close();
    // Pesan setelah ditutup diabaikan.
    s.port.current.send({ type: "user", message: { role: "user", content: "x" }, parent_tool_use_id: null });
  });

  test("AskUserQuestion: kartu pertanyaan → jawaban pemilik kembali ke skenario; Stop membatalkan", async () => {
    const answers: unknown[] = [];
    const s = await setup(async (_turn, claude) => {
      answers.push(
        await claude.ask([
          {
            question: "Warna?",
            header: "Warna",
            multiSelect: false,
            options: [
              { label: "Merah", description: "" },
              { label: "Biru", description: "" },
            ],
          },
        ]),
      );
    });
    s.send("tanya");
    const first = await s.next((event) => event.type === "question");
    const questionId = first.type === "question" ? first.questionId : "";
    expect(s.session.answer(questionId, { "Warna?": { selected: ["Biru"] } })).toEqual({ ok: true });
    await s.next(isResult);
    expect(answers).toEqual([{ "Warna?": "Biru" }]);

    s.send("tanya lagi");
    await s.next((event) => event.type === "question" && event.questionId !== questionId);
    await s.session.interrupt();
    await s.next((event) => event.type === "result" && s.events.filter(isResult).length === 2);
    expect(answers).toHaveLength(1);
  });

  test("urutan seperti CLI asli: pesan sebelum tool (thinking, tool_use) tercatat sebelum kartu pertanyaan", async () => {
    const s = await setup(async (_turn, claude) => {
      claude.think("Merencanakan bentuk dasar.");
      claude.say("Satu pertanyaan dulu.");
      await claude.ask([
        {
          question: "Gaya?",
          header: "Gaya",
          multiSelect: false,
          options: [{ label: "Kartun", description: "" }],
        },
      ]);
    });
    s.send("tanya");
    const question = await s.next((event) => event.type === "question");
    const order = s.events
      .filter((event) => event.type !== "delta")
      .map((event) => (event.type === "tool" ? `tool:${event.name}` : event.type));
    expect(order).toEqual(["user", "init", "thinking", "assistant", "tool:AskUserQuestion", "question"]);
    await s.session.interrupt();
    await s.next(isResult);
    expect(question.type).toBe("question");
  });

  test("build lewat forge: hasil memuat satu gambar contact sheet", async () => {
    const replies: unknown[] = [];
    const s = await setup(async (_turn, claude) => {
      await claude.forge("record_brief", {
        summary: "Peti",
        category: "properti",
        style: "kartun",
        dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
      });
      await claude.write(join(claude.cwd, "base.py"), "from assetkit import scene\n");
      replies.push(await claude.forge("build_base_mesh"));
    });
    s.send("bangun");
    await s.next(isResult);
    expect(replies[0]).toMatchObject({ ok: true, images: 1, body: { version: 1 } });
  });

  test("Stop di tengah panggilan forge: giliran berhenti, tool dibatalkan", async () => {
    const builder = new FixtureAssetBuilder({ script: [{ kind: "hang" }] });
    const s = await setup(async (_turn, claude) => {
      await claude.forge("record_brief", {
        summary: "Peti",
        category: "properti",
        style: "kartun",
        dimensionsM: { width: 0.8, depth: 0.5, height: 0.55 },
      });
      await claude.write(join(claude.cwd, "base.py"), "from assetkit import scene\n");
      await claude.forge("build_base_mesh");
      claude.say("tidak boleh sampai sini");
    }, builder);
    s.send("bangun");
    await s.next((event) => event.type === "build_started");
    await s.session.interrupt();
    await s.next(isResult);
    expect(s.events.some((event) => event.type === "assistant" && event.text.includes("tidak boleh"))).toBe(
      false,
    );
    expect(builder.requests[0]?.signal.aborted).toBe(true);
  });

  test("current tanpa sesi gagal jelas", () => {
    expect(() => new ScenarioAgentPort(async () => undefined).current).toThrow("belum ada sesi");
  });
});
