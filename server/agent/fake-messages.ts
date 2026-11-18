/**
 * Pembuat SDKMessage palsu untuk tes dan agent berskenario (`AGENT_DRIVER=fake`). Semua bertipe penuh (`satisfies`),
 * jadi perubahan bentuk pesan di upgrade SDK langsung terlihat sebagai error typecheck.
 */
import type {
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKRateLimitEvent,
  SDKResultError,
  SDKResultSuccess,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
let counter = 0;
function uuid(): Uuid {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

const usage = {
  cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  fallback_credit: null,
  inference_geo: "",
  input_tokens: 1,
  iterations: [],
  output_tokens: 1,
  output_tokens_details: { thinking_tokens: 0 },
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
} satisfies SDKResultSuccess["usage"];

export function initMessage(sessionId: string, model = "claude-opus-5-5"): SDKMessage {
  return {
    type: "system",
    subtype: "init",
    claude_code_version: "0.0.0",
    cwd: "/tmp",
    tools: [],
    mcp_servers: [],
    model,
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [],
    apiKeySource: "none",
    uuid: uuid(),
    session_id: sessionId,
  } satisfies SDKSystemMessage;
}

type Block = SDKAssistantMessage["message"]["content"][number];

export function assistantMessage(
  sessionId: string,
  content: Block[],
  options: { error?: SDKAssistantMessageError } = {},
): SDKMessage {
  return {
    type: "assistant",
    ...(options.error === undefined ? {} : { error: options.error }),
    message: {
      id: `msg_${counter}`,
      container: null,
      content,
      context_management: null,
      diagnostics: null,
      model: "claude-opus-5-5",
      role: "assistant",
      stop_details: null,
      stop_reason: "end_turn",
      stop_sequence: null,
      type: "message",
      usage,
    },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: sessionId,
  } satisfies SDKAssistantMessage;
}

export const text = (value: string): Block => ({ type: "text", text: value, citations: null });
export const thinking = (value: string): Block => ({ type: "thinking", thinking: value, signature: "sig" });
export const toolUse = (id: string, name: string, input: unknown): Block => ({
  type: "tool_use",
  id,
  name,
  input,
});

export function toolResultMessage(
  sessionId: string,
  toolUseId: string,
  content: SDKToolResultContent,
  isError = false,
): SDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: isError }],
    },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: sessionId,
  } satisfies SDKUserMessage;
}
type SDKToolResultContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }
    >;

export function deltaMessage(sessionId: string, kind: "text" | "thinking", value: string): SDKMessage {
  return {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta:
        kind === "text"
          ? { type: "text_delta", text: value }
          : { type: "thinking_delta", thinking: value, estimated_tokens: null },
    },
    parent_tool_use_id: null,
    uuid: uuid(),
    session_id: sessionId,
  } satisfies SDKPartialAssistantMessage;
}

export function resultMessage(
  sessionId: string,
  userMessageUuids: readonly string[],
  options: { subtype?: "success" | "error_during_execution"; costUsd?: number } = {},
): SDKMessage {
  const base = {
    type: "result" as const,
    duration_ms: 10,
    duration_api_ms: 5,
    num_turns: 1,
    stop_reason: "end_turn",
    total_cost_usd: options.costUsd ?? 0.01,
    usage,
    modelUsage: {},
    permission_denials: [],
    uuid: uuid(),
    session_id: sessionId,
    user_message_uuids: [...userMessageUuids],
  };
  if (options.subtype === "error_during_execution") {
    return {
      ...base,
      subtype: "error_during_execution",
      is_error: true,
      errors: ["gagal"],
    } satisfies SDKResultError;
  }
  return { ...base, subtype: "success", is_error: false, result: "selesai" } satisfies SDKResultSuccess;
}

export function rateLimitMessage(
  sessionId: string,
  status: "allowed" | "rejected",
  resetsAt?: number,
): SDKMessage {
  return {
    type: "rate_limit_event",
    rate_limit_info: { status, ...(resetsAt === undefined ? {} : { resetsAt }) },
    uuid: uuid(),
    session_id: sessionId,
  } satisfies SDKRateLimitEvent;
}
