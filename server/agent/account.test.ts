import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { fakeClock } from "../services/test-support.ts";
import {
  AccountProbe,
  AUTH_CACHE_MS,
  AUTH_ERROR_MESSAGE,
  AUTH_FAILURE_CACHE_MS,
  AUTH_PROBE_TIMEOUT_MS,
  authStatus,
} from "./account.ts";
import { FakeAgentPort, type FakeAgentSession } from "./fake-port.ts";
import { buildProbeOptions } from "./options.ts";
import { AgentPool } from "./pool.ts";

// Bentuk dari CLI asli: alias di `value`, id lengkap di `resolvedModel`.
const opus: ModelInfo = {
  value: "opus",
  resolvedModel: "claude-opus-5-5",
  displayName: "Opus 5.5",
  description: "Paling mampu",
  supportsEffort: true,
  supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
};
const haiku: ModelInfo = {
  value: "claude-haiku-5-5",
  displayName: "Haiku 5.5",
  description: "Cepat",
  supportsEffort: false,
};

function harness(configure: (session: FakeAgentSession) => void = () => undefined) {
  const port = new FakeAgentPort();
  port.onStart = (session) => {
    session.models = async () => [opus, haiku];
    configure(session);
  };
  const clock = fakeClock();
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const errors: unknown[] = [];
  const probe = new AccountProbe({
    port,
    pool: new AgentPool(),
    now: clock,
    options: () => buildProbeOptions({ PATH: "/usr/bin" }),
    setTimer: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onError: (error) => errors.push(error),
  });
  return { port, clock, probe, timers, errors };
}

describe("authStatus", () => {
  test("login langganan → ok dengan daftar model; effort mengikuti SDK", () => {
    const status = authStatus({ email: "a@b.invalid", subscriptionType: "max" }, [opus, haiku], 5);
    expect(status).toEqual({
      state: "ok",
      email: "a@b.invalid",
      subscription: "max",
      organization: null,
      checkedAt: 5,
      models: [
        {
          value: "opus",
          resolvedModel: "claude-opus-5-5",
          displayName: "Opus 5.5",
          description: "Paling mampu",
          efforts: ["low", "medium", "high", "xhigh", "max"],
        },
        {
          value: "claude-haiku-5-5",
          resolvedModel: null,
          displayName: "Haiku 5.5",
          description: "Cepat",
          efforts: [],
        },
      ],
    });
  });

  test("tanpa email → belum login; API key → ditolak walau ada email", () => {
    expect(authStatus({ subscriptionType: "max" }, [], 1).state).toBe("logged_out");
    expect(authStatus({ email: "a@b.invalid", apiKeySource: "ANTHROPIC_API_KEY" }, [], 1).state).toBe(
      "api_key",
    );
    expect(authStatus({ email: "a@b.invalid", apiKeySource: "none" }, [], 1).state).toBe("ok");
  });
});

describe("AccountProbe", () => {
  test("proses pemeriksa tanpa tool dan tanpa transkrip, lalu ditutup", async () => {
    const h = harness();
    expect((await h.probe.status()).state).toBe("ok");
    const session = h.port.current;
    expect(session.options).toMatchObject({
      tools: [],
      disallowedTools: ["*"],
      settingSources: [],
      persistSession: false,
    });
    expect(session.options.env).toEqual({ PATH: "/usr/bin" });
    expect(session.sent).toEqual([]);
    expect(session.calls.close).toBe(1);
    expect(h.timers.every((timer) => timer.cancelled)).toBe(true);
  });

  test("hasil ok di-cache 10 menit; `fresh` memeriksa ulang", async () => {
    const h = harness();
    await h.probe.status();
    h.clock.advance(AUTH_CACHE_MS - 1);
    await h.probe.status();
    expect(h.port.sessions).toHaveLength(1);
    await h.probe.status({ fresh: true });
    expect(h.port.sessions).toHaveLength(2);
    h.clock.advance(AUTH_CACHE_MS);
    await h.probe.status();
    expect(h.port.sessions).toHaveLength(3);
  });

  test("permintaan bersamaan berbagi satu proses", async () => {
    const h = harness();
    const [a, b] = await Promise.all([h.probe.status(), h.probe.status()]);
    expect(a).toBe(b);
    expect(h.port.sessions).toHaveLength(1);
  });

  test("belum login: daftar model tidak diminta, dan hanya di-cache 1 menit", async () => {
    let asked = 0;
    const h = harness((session) => {
      session.account = async () => ({ tokenSource: "none" });
      session.models = async () => {
        asked += 1;
        return [];
      };
    });
    expect((await h.probe.status()).state).toBe("logged_out");
    expect(asked).toBe(0);
    h.clock.advance(AUTH_FAILURE_CACHE_MS);
    await h.probe.status();
    expect(h.port.sessions).toHaveLength(2);
  });

  test("CLI gagal dijalankan → error dengan pesan aman; detail ke log", async () => {
    const h = harness();
    h.port.startError = new Error("spawn claude ENOENT /home/rahasia");
    const status = await h.probe.status();
    expect(status).toEqual({ state: "error", message: AUTH_ERROR_MESSAGE, checkedAt: h.clock() });
    expect(h.errors).toHaveLength(1);
  });

  test("CLI macet → batas waktu, proses ditutup", async () => {
    const h = harness((session) => {
      session.account = () => new Promise(() => undefined);
    });
    const pending = h.probe.status();
    await Promise.resolve();
    for (let tick = 0; tick < 20 && h.timers.length === 0; tick += 1) await Promise.resolve();
    const timer = h.timers[0];
    expect(timer?.ms).toBe(AUTH_PROBE_TIMEOUT_MS);
    timer?.run();
    expect((await pending).state).toBe("error");
    expect(h.port.current.calls.close).toBe(1);
  });
});
