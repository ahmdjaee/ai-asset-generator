import { describe, expect, test } from "bun:test";
import { API_PORT } from "../shared/ports.ts";
import { agentEnv, ConfigError, loadConfig } from "./config.ts";
import { APP_VERSION } from "./version.ts";

describe("loadConfig", () => {
  test("memakai nilai bawaan bila env kosong", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(API_PORT);
    expect(config.mode).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(config.dbPath.endsWith("/data/app.db")).toBe(true);
    // Bawaan = jalur sungguhan; mode palsu harus dipilih eksplisit.
    expect(config.agentDriver).toBe("sdk");
    expect(config.runtimeDriver).toBe("docker");
  });

  test("membaca AGENT_DRIVER dan RUNTIME_DRIVER", () => {
    const config = loadConfig({ AGENT_DRIVER: "fake", RUNTIME_DRIVER: "fixture" });
    expect(config.agentDriver).toBe("fake");
    expect(config.runtimeDriver).toBe("fixture");
  });

  test("string kosong dianggap tidak diisi", () => {
    expect(loadConfig({ PORT: "", DATA_DIR: "" }).port).toBe(API_PORT);
  });

  test("membaca PORT, DATA_DIR, dan DIST_DIR", () => {
    const config = loadConfig({ PORT: "4999", DATA_DIR: "/tmp/aag-data", DIST_DIR: "/tmp/aag-dist" });
    expect(config.port).toBe(4999);
    expect(config.dataDir).toBe("/tmp/aag-data");
    expect(config.dbPath).toBe("/tmp/aag-data/app.db");
    expect(config.distDir).toBe("/tmp/aag-dist");
  });

  test("mode test membungkam log kecuali LOG_LEVEL diisi", () => {
    expect(loadConfig({ NODE_ENV: "test" }).logLevel).toBe("silent");
    expect(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "warn" }).logLevel).toBe("warn");
  });

  test("HOST dari env diabaikan: server selalu loopback", () => {
    expect(loadConfig({ HOST: "0.0.0.0" }).host).toBe("127.0.0.1");
  });

  test.each([
    ["PORT", "abc"],
    ["PORT", "0"],
    ["PORT", "70000"],
    ["LOG_LEVEL", "verbose"],
    ["NODE_ENV", "staging"],
    ["AGENT_DRIVER", "openai"],
    ["RUNTIME_DRIVER", "lokal"],
  ])("menolak %s=%s dengan pesan yang jelas", (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [key]: value })).toThrow(key);
  });
});

describe("agentEnv", () => {
  test("menghapus API key dan token, mempertahankan env lain", () => {
    const env = agentEnv({
      ANTHROPIC_API_KEY: "sk-ant-test",
      ANTHROPIC_AUTH_TOKEN: "token-test",
      PATH: "/usr/bin",
      HOME: "/home/test",
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/test");
  });

  test("menandai klien sebagai ai-asset-generate", () => {
    expect(agentEnv({}).CLAUDE_AGENT_SDK_CLIENT_APP).toBe(`ai-asset-generate/${APP_VERSION}`);
  });
});
