import { UpstreamError } from "@/utils/result";

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

// OpenAI-shaped error envelope so OpenCode surfaces the real upstream status
// and reason instead of a bare "Internal Server Error".
export function errorResponse(err: UpstreamError) {
  console.error(`upstream error (${err.status}):`, err.message);
  const status = err.status >= 400 && err.status < 600 ? err.status : 502;
  return Response.json({ error: { message: err.message, type: "upstream_error", code: err.status } }, { status });
}

export function toUpstreamError(err: unknown): UpstreamError {
  if (err instanceof UpstreamError) return err;
  return new UpstreamError(err instanceof Error ? err.message : JSON.stringify(err), 500);
}
