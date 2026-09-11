import { errorResponse, toUpstreamError } from "@/format/openai-format";
import { handleChatCompletions, handleModels } from "@/handlers/handlers";
import { PORT } from "./config";

export function startServer() {
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      try {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") return await handleModels();
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") return await handleChatCompletions(req);
        return new Response("Not found", { status: 404 });
      } catch (err) {
        return errorResponse(toUpstreamError(err));
      }
    },
  });

  console.log(`aipass-proxy listening on http://localhost:${PORT}`);
}
