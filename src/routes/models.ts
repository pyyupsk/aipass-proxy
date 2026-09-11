import { listModels } from "@/aipass/client";
import { errorResponse } from "@/openai/transform";

export async function handleModels() {
  const [models, err] = await listModels();
  if (err) return errorResponse(err);
  return Response.json({
    object: "list",
    data: models.map((m) => ({ id: m.id, object: "model", owned_by: "aipass" })),
  });
}
