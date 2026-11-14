/**
 * AgentPort palsu (port dari `fakeQuery` di ai-team `scripts/check-runner.ts`): tanpa proses Claude dan tanpa kuota.
 * Meniru perilaku SDK yang penting: pesan dari prompt dikonsumsi, `result` meng-echo uuid pesan,
 * dan pesan yang sudah ter-buffer tetap keluar setelah `close()`.
 */
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { InputQueue } from "./input-queue.ts";
import type {
  AccountInfo,
  AgentOptions,
  AgentPort,
  AgentSession,
  InterruptReceipt,
  ModelInfo,
} from "./port.ts";

export class FakeAgentSession implements AgentSession {
  readonly options: AgentOptions;
  readonly sent: SDKUserMessage[] = [];
  readonly calls = { interrupt: 0, close: 0 };
  readonly #queue = new InputQueue<SDKMessage>();
  #failure: Error | undefined;
  #sentWaiters: Array<() => void> = [];
  /** Kuitansi untuk interrupt berikutnya. */
  receipt: (sent: readonly SDKUserMessage[]) => InterruptReceipt | undefined = () => ({ stillQueued: [] });
  /** `true`: close() tidak mengakhiri aliran (pesan ter-buffer masih bisa didorong). */
  holdOnClose = false;
  /** Selesai setelah pembaca menghabiskan aliran (semua pesan sudah diproses). */
  readonly drained: Promise<void>;
  #markDrained: () => void = () => undefined;

  constructor(options: AgentOptions) {
    this.options = options;
    this.drained = new Promise((resolve) => {
      this.#markDrained = resolve;
    });
  }

  get messages(): AsyncIterable<SDKMessage> {
    const queue = this.#queue;
    const session = this;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const message of queue) yield message;
          const failure = session.#failure;
          if (failure !== undefined) throw failure;
        } finally {
          session.#markDrained();
        }
      },
    };
  }

  send(message: SDKUserMessage): void {
    this.sent.push(message);
    for (const waiter of this.#sentWaiters.splice(0)) waiter();
  }

  /** uuid pesan terakhir yang diterima; menunggu bila belum ada. */
  async lastSent(count = 1): Promise<SDKUserMessage> {
    while (this.sent.length < count) await new Promise<void>((resolve) => this.#sentWaiters.push(resolve));
    const message = this.sent[count - 1];
    if (message === undefined) throw new Error("pesan tidak ada");
    return message;
  }

  async interrupt(): Promise<InterruptReceipt | undefined> {
    this.calls.interrupt += 1;
    return this.receipt(this.sent);
  }

  close(): void {
    this.calls.close += 1;
    if (!this.holdOnClose) this.end();
  }

  push(...messages: SDKMessage[]): void {
    for (const message of messages) this.#queue.push(message);
  }

  /** Aliran berakhir tanpa error (proses selesai). */
  end(): void {
    if (!this.#queue.ended) this.#queue.end();
  }

  /** Aliran berakhir dengan error (proses mati). */
  fail(error: Error): void {
    this.#failure = error;
    this.end();
  }

  async accountInfo(): Promise<AccountInfo> {
    return { email: "pemilik@contoh.invalid", subscriptionType: "tes" };
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return [];
  }
}

export class FakeAgentPort implements AgentPort {
  readonly sessions: FakeAgentSession[] = [];
  /** Bila diisi, `start()` berikutnya gagal dengan error ini (mis. CLI `claude` tidak ditemukan). */
  startError: Error | undefined;

  start(options: AgentOptions): FakeAgentSession {
    const error = this.startError;
    if (error !== undefined) {
      this.startError = undefined;
      throw error;
    }
    const session = new FakeAgentSession(options);
    this.sessions.push(session);
    return session;
  }

  get current(): FakeAgentSession {
    const session = this.sessions.at(-1);
    if (session === undefined) throw new Error("belum ada sesi");
    return session;
  }
}
