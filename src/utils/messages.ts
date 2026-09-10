import type { OpenAIMessage } from "@/types";
import { sanitizeOutbound } from "./sanitize";

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
