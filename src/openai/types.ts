import { z } from "zod";

export const openAIMessageSchema = z.object({
  role: z.string(),
  content: z.string().nullable(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({
          name: z.string(),
          arguments: z.string().refine(
            (v) => {
              try {
                JSON.parse(v);
                return true;
              } catch {
                return false;
              }
            },
            { message: "tool_calls[].function.arguments must be valid JSON" },
          ),
        }),
      }),
    )
    .optional(),
  tool_call_id: z.string().optional(),
  name: z.string().optional(),
});
export const openAIToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.unknown().optional() }),
});
export const chatCompletionsBodySchema = z.object({
  messages: z.array(openAIMessageSchema),
  model: z.string().optional(),
  stream: z.boolean().optional(),
  tools: z.array(openAIToolSchema).optional(),
});

export type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type OpenAIMessage = z.infer<typeof openAIMessageSchema>;
export type OpenAITool = z.infer<typeof openAIToolSchema>;
