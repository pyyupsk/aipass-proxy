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

function envelope(id: string, model: string, object: string, fields: Record<string, unknown>) {
  return { id, object, created: Math.floor(Date.now() / 1000), model, ...fields };
}

export function openaiChunk(id: string, model: string, delta: string, finishReason: string | null) {
  return `data: ${JSON.stringify(
    envelope(id, model, "chat.completion.chunk", {
      choices: [{ index: 0, delta: finishReason ? {} : { content: delta }, finish_reason: finishReason }],
    }),
  )}\n\n`;
}

export function openaiToolCallChunk(id: string, model: string, calls: { name: string; arguments: unknown }[]) {
  const toolCalls = calls.map((call, index) => ({
    index,
    id: crypto.randomUUID(),
    type: "function",
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  const deltaChunk = envelope(id, model, "chat.completion.chunk", {
    choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }],
  });
  const stopChunk = envelope(id, model, "chat.completion.chunk", {
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });
  return `data: ${JSON.stringify(deltaChunk)}\n\ndata: ${JSON.stringify(stopChunk)}\n\n`;
}
