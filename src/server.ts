import { toUpstreamError } from "@/lib/safe";
import { errorResponse } from "@/openai/transform";
import { handleChatCompletions } from "@/routes/chat-completions";
import { handleModels } from "@/routes/models";
import { PORT } from "./env";

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
