import type { OpenAITool } from "./types";

export const TOOL_CALL_TAG = /<tool_call>([\s\S]*?)<\/tool_call>/g;
export const TOOL_CALL_OPEN_TAG = "<tool_call>";

// While streaming, we can't tell a plain reply from the start of a
// <tool_call> tag until we've seen enough of it. Emit everything except a
// trailing fragment that could still turn into the tag opening, so we never
// leak a partial "<tool_c" onto the wire.
export function safeToEmitLength(buffer: string, tag: string) {
  const maxOverlap = Math.min(buffer.length, tag.length - 1);
  for (let len = maxOverlap; len > 0; len--) {
    if (buffer.endsWith(tag.slice(0, len))) return buffer.length - len;
  }
  return buffer.length;
}

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
    if ("name" in parsed && "arguments" in parsed) {
      calls.push(parsed as { name: string; arguments: unknown });
    } else if (tools.length === 1 && tools[0]) {
      // Model sometimes emits bare arguments instead of the {name, arguments} envelope.
      calls.push({ name: tools[0].function.name, arguments: parsed });
    }
  }
  return calls;
}
