/**
 * SDKMessage → event app. Port dari `toUiEvents` ai-team, ditambah ringkasan berpikir dan deteksi batas pemakaian.
 */
import { type SDKMessage, USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "../../shared/agent-events.ts";
import { ellipsize } from "../../shared/text.ts";

/** Batas pratinjau hasil tool di event (bukan yang dikirim ke Claude). */
const PREVIEW_MAX = 600;

function preview(text: string): string {
  return ellipsize(text, PREVIEW_MAX);
}

/** Di bawah ini sebuah epoch pasti dalam detik (1e12 ms = tahun 2001). */
const EPOCH_MS_FLOOR = 1e12;

/** Waktu reset dari SDK (detik epoch, mengikuti header reset API) → ms epoch. Nilai ms dibiarkan. */
export function resetTimeMs(value: number): number {
  return value < EPOCH_MS_FLOOR ? value * 1000 : value;
}

export function isUsageLimitText(text: string): boolean {
  return USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/** Data `result` yang dipakai runner: pesan kita mana yang dijawab turn ini. */
export type ResultMeta = Readonly<{ sessionId: string; userMessageUuids: readonly string[] }>;

export function resultMeta(message: SDKMessage): ResultMeta | undefined {
  if (message.type !== "result") return undefined;
  const list =
    message.user_message_uuids ??
    (message.user_message_uuid === undefined ? [] : [message.user_message_uuid]);
  return { sessionId: message.session_id, userMessageUuids: list };
}

type ToolResultContent = string | ReadonlyArray<{ type: string; text?: string }> | undefined;

function toolResultText(content: ToolResultContent): { text: string; images: number } {
  if (content === undefined) return { text: "", images: 0 };
  if (typeof content === "string") return { text: content, images: 0 };
  let images = 0;
  const parts = content.map((part) => {
    if (part.type === "text") return part.text ?? "";
    if (part.type === "image") {
      images += 1;
      return "[gambar]";
    }
    return `[${part.type}]`;
  });
  return { text: parts.join("\n"), images };
}

/** Satu SDKMessage → nol atau beberapa event. Tipe pesan yang tidak dikenal diabaikan. */
export function toAgentEvents(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case "system":
      if (message.subtype === "init")
        return [{ type: "init", sessionId: message.session_id, model: message.model }];
      if (message.subtype === "permission_denied") {
        return [
          {
            type: "error",
            code: "TOOL_DENIED",
            message: `Tool ${message.tool_name} ditolak: ${message.message}`,
          },
        ];
      }
      return [];
    case "rate_limit_event": {
      const info = message.rate_limit_info;
      if (info.status !== "rejected") return [];
      return [
        {
          type: "error",
          code: "USAGE_LIMIT",
          message: "Batas pemakaian Claude tercapai.",
          ...(info.resetsAt === undefined ? {} : { resetsAt: resetTimeMs(info.resetsAt) }),
        },
      ];
    }
    case "stream_event": {
      const event = message.event;
      if (event.type !== "content_block_delta") return [];
      if (event.delta.type === "text_delta" && event.delta.text !== "") {
        return [{ type: "delta", kind: "text", text: event.delta.text }];
      }
      if (event.delta.type === "thinking_delta" && event.delta.thinking !== "") {
        return [{ type: "delta", kind: "thinking", text: event.delta.thinking }];
      }
      return [];
    }
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of message.message.content) {
        if (block.type === "text" && block.text.trim() !== "") {
          events.push(
            isUsageLimitText(block.text)
              ? { type: "error", code: "USAGE_LIMIT", message: block.text }
              : { type: "assistant", text: block.text },
          );
        } else if (block.type === "thinking" && block.thinking.trim() !== "") {
          events.push({ type: "thinking", text: block.thinking });
        } else if (block.type === "tool_use") {
          events.push({ type: "tool", toolUseId: block.id, name: block.name, input: block.input });
        }
      }
      return events;
    }
    case "user": {
      const content = message.message.content;
      if (typeof content === "string") return [];
      const events: AgentEvent[] = [];
      for (const block of content) {
        if (block.type !== "tool_result") continue;
        const { text, images } = toolResultText(block.content);
        events.push({
          type: "tool_result",
          toolUseId: block.tool_use_id,
          isError: block.is_error === true,
          preview: preview(text),
          images,
        });
      }
      return events;
    }
    case "result":
      return [
        {
          type: "result",
          subtype: message.subtype,
          isError: message.is_error,
          interrupted: false,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
          costUsd: message.total_cost_usd,
        },
      ];
    default:
      return [];
  }
}
