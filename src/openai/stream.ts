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

function envelope<T extends Record<string, unknown>>(id: string, model: string, object: string, fields: T) {
  return { id, object, created: Math.floor(Date.now() / 1000), model, ...fields };
}

// Plain objects: JsonToSseTransformStream does the SSE framing.
export function openaiChunk(id: string, model: string, delta: string, finishReason: string | null) {
  return envelope(id, model, "chat.completion.chunk", {
    choices: [{ index: 0, delta: finishReason ? {} : { content: delta }, finish_reason: finishReason }],
  });
}

export function openaiToolCallChunks(id: string, model: string, calls: { name: string; arguments: unknown }[]) {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: crypto.randomUUID(),
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  return [
    envelope(id, model, "chat.completion.chunk", {
      choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
    }),
    envelope(id, model, "chat.completion.chunk", { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
  ];
}
