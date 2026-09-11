import { sanitizeOutbound } from "@/aipass/sanitize";
import type { UpstreamError } from "@/lib/safe";
import type { OpenAIMessage, OpenAITool } from "./types";

function envelope(id: string, model: string, object: string, fields: Record<string, unknown>) {
  return { id, object, created: Math.floor(Date.now() / 1000), model, ...fields };
}

export function toolCallResponse(id: string, modelId: string, calls: { name: string; arguments: unknown }[]) {
  return Response.json(
    envelope(id, modelId, "chat.completion", {
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: calls.map((call) => ({
              id: crypto.randomUUID(),
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          },
          finish_reason: "tool_calls",
        },
      ],
    }),
  );
}

export function textResponse(id: string, modelId: string, content: string) {
  return Response.json(
    envelope(id, modelId, "chat.completion", {
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
  );
}

// OpenAI-shaped error envelope so OpenCode surfaces the real upstream status
// and reason instead of a bare "Internal Server Error".
export function errorResponse(err: UpstreamError) {
  console.error(`upstream error (${err.status}):`, err.message);
  const status = err.status >= 400 && err.status < 600 ? err.status : 502;
  return Response.json({ error: { message: err.message, type: "upstream_error", code: status } }, { status });
}

const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/g;

export function buildToolsPrompt(tools: OpenAITool[]) {
  const docs = tools
    .map((t) => `- ${t.function.name}: ${t.function.description ?? ""}\n  arguments schema: ${JSON.stringify(t.function.parameters ?? {})}`)
    .join("\n");
  const example = tools[0]?.function.name ?? "tool_name";
  return (
    `You have access to these tools:\n${docs}\n\n` +
    `To call one, respond with ONLY this and nothing else, replacing "name" with the exact tool name ` +
    `(e.g. "${example}") and "arguments" with an object matching that tool's arguments schema:\n` +
    `<tool_call>{"name": "${example}", "arguments": {...}}</tool_call>\n` +
    `Never omit the "name" and "arguments" keys. To call multiple tools in one reply, emit one ` +
    `<tool_call>...</tool_call> tag per call, back to back. If no tool is needed, just answer normally.`
  );
}

export function extractToolCall(text: string, tools: OpenAITool[]): { name: string; arguments: unknown }[] {
  const calls: { name: string; arguments: unknown }[] = [];
  for (const match of text.matchAll(TOOL_CALL_TAG)) {
    if (!match[1]) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    if (
      "name" in parsed &&
      "arguments" in parsed &&
      typeof parsed.name === "string" &&
      tools.some((t) => t.function.name === parsed.name)
    ) {
      calls.push(parsed as { name: string; arguments: unknown });
    } else if (tools.length === 1 && tools[0]) {
      // Model sometimes emits bare arguments instead of the {name, arguments} envelope.
      calls.push({ name: tools[0].function.name, arguments: parsed });
    }
  }
  return calls;
}

// AIPass has no role:"system"/"tool" and no native tool-calling, so fold
// both into plain user/assistant text turns AIPass actually understands.
function normalizeMessages(messages: OpenAIMessage[]) {
  const flattened = messages.map((m): OpenAIMessage => {
    if (m.role === "assistant" && !m.content && m.tool_calls?.length) {
      const content = m.tool_calls
        .map(
          (call) =>
            `<tool_call>${JSON.stringify({ name: call.function.name, arguments: JSON.parse(call.function.arguments) })}</tool_call>`,
        )
        .join("");
      return { role: "assistant", content };
    }
    if (m.role === "tool") {
      return {
        role: "system",
        content: `Tool result (${m.name ?? m.tool_call_id}): ${m.content}\n\nUse this result to answer the user's original question directly and naturally. Do not repeat or quote the raw tool result.`,
      };
    }
    return m;
  });

  const merged: OpenAIMessage[] = [];
  let systemBuffer = "";
  for (const m of flattened) {
    if (m.role === "system") {
      systemBuffer += (systemBuffer ? "\n\n" : "") + m.content;
      continue;
    }
    if (m.role === "user" && systemBuffer) {
      merged.push({ role: "user", content: `${systemBuffer}\n\n${m.content}` });
      systemBuffer = "";
    } else {
      if (systemBuffer) {
        merged.push({ role: "user", content: systemBuffer });
        systemBuffer = "";
      }
      merged.push(m);
    }
  }
  if (systemBuffer) merged.push({ role: "user", content: systemBuffer });
  return merged;
}

export function toAipassMessages(messages: OpenAIMessage[]) {
  return normalizeMessages(messages).map((m) => ({
    id: crypto.randomUUID(),
    role: m.role === "assistant" ? "assistant" : "user",
    parts: [{ type: "text", text: sanitizeOutbound(m.content ?? "") }],
  }));
}
