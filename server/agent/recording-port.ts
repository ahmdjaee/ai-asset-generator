/** AgentPort pembungkus yang menyalin setiap SDKMessage ke `record` (perekaman stream untuk eval dan fixture). */
import type { AgentPort, AgentSession, SDKMessage } from "./port.ts";

export function recordingPort(inner: AgentPort, record: (message: SDKMessage) => void): AgentPort {
  return {
    start(options): AgentSession {
      const session = inner.start(options);
      const messages: AsyncIterable<SDKMessage> = {
        async *[Symbol.asyncIterator]() {
          for await (const message of session.messages) {
            record(message);
            yield message;
          }
        },
      };
      return {
        messages,
        send: (message) => session.send(message),
        interrupt: () => session.interrupt(),
        close: () => session.close(),
        accountInfo: () => session.accountInfo(),
        supportedModels: () => session.supportedModels(),
      };
    },
  };
}
