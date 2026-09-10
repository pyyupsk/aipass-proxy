export type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type OpenAIMessage = {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};
export type OpenAITool = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };
export type AipassModel = { id: string; displayName: string };
