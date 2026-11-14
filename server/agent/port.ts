/**
 * Kontrak antara app dan Claude. Hanya `sdk-adapter.ts` yang mengimplementasikannya dengan Agent SDK sungguhan;
 * tes memakai `FakeAgentPort` (lihat `fake-port.ts`). Kode lain tidak pernah meng-import `query`.
 */
import type {
  AccountInfo,
  ModelInfo,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

export type { AccountInfo, ModelInfo, SDKMessage, SDKUserMessage };
export type AgentOptions = Options;

/** Kuitansi interrupt (capability `interrupt_receipt_v1`): uuid pesan yang dibatalkan atau masih antre. */
export type InterruptReceipt = Readonly<{ cancelled?: readonly string[]; stillQueued?: readonly string[] }>;

/** Satu sesi Claude yang hidup (satu proses Claude Code). */
export interface AgentSession {
  /** Aliran pesan SDK. Satu pembaca saja, dan pembacanya hidup selama sesi. */
  readonly messages: AsyncIterable<SDKMessage>;
  /** Mengirim pesan pengguna. `uuid` di-echo kembali di `result.user_message_uuids`. */
  send(message: SDKUserMessage): void;
  /** Menghentikan turn yang berjalan dan membatalkan pesan kita yang masih antre. */
  interrupt(): Promise<InterruptReceipt | undefined>;
  /** Menutup proses. Pesan yang sudah ter-buffer masih bisa keluar dari `messages` setelah ini. */
  close(): void;
  accountInfo(): Promise<AccountInfo>;
  supportedModels(): Promise<ModelInfo[]>;
}

export interface AgentPort {
  start(options: AgentOptions): AgentSession;
}
