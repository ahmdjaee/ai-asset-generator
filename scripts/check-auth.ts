/**
 * `bun run check:auth`: memastikan Agent SDK memakai sesi login Claude Code di mesin ini, bukan API key.
 * Tidak memanggil model, jadi tidak memakai kuota.
 */
import { type AccountInfo, readAccountInfo } from "../server/agent/sdk-adapter.ts";

/** API key dianggap terpakai bila SDK melaporkan sumber selain "none". */
export function usesApiKey(info: AccountInfo): boolean {
  return info.apiKeySource !== undefined && info.apiKeySource !== "none";
}

async function main(): Promise<number> {
  let info: AccountInfo;
  try {
    info = await readAccountInfo();
  } catch (error) {
    console.error("✗ Gagal membaca sesi Claude:", error instanceof Error ? error.message : error);
    console.error("  Pastikan `claude` ada di PATH dan sudah login (`claude auth login`).");
    return 1;
  }

  const rows: Array<[string, string]> = [
    ["email", info.email ?? "-"],
    ["langganan", info.subscriptionType ?? "-"],
    ["organisasi", info.organization ?? "-"],
    ["tokenSource", info.tokenSource ?? "-"],
    ["apiKeySource", info.apiKeySource ?? "none (tidak dilaporkan SDK)"],
    ["apiProvider", info.apiProvider ?? "-"],
  ];
  console.log("Sesi Claude yang dipakai Agent SDK:");
  for (const [label, value] of rows) console.log(`  ${label.padEnd(13)} ${value}`);

  if (usesApiKey(info)) {
    console.error("✗ SDK memakai API key. App ini harus memakai sesi login Claude Code.");
    return 1;
  }
  if (!info.email) {
    console.error("✗ Tidak ada akun yang login. Jalankan `claude auth login`.");
    return 1;
  }
  console.log("✓ Memakai sesi login Claude Code, tanpa API key.");
  return 0;
}

if (import.meta.main) process.exit(await main());
