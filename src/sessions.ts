import type { OpenAIMessage } from "./types";

// session key -> {conversationId, sentCount}, so a session reuses one AIPass
// conversation and only sends new turns. Capped with FIFO eviction so a
// long-running proxy doesn't grow unbounded across many client sessions.
const MAX_SESSIONS = 500;
export const conversationsBySessionKey = new Map<string, { conversationId: string; sentCount: number }>();

export function evictOldestSessionIfFull() {
  if (conversationsBySessionKey.size < MAX_SESSIONS) return;
  const oldestKey = conversationsBySessionKey.keys().next().value;
  if (oldestKey !== undefined) conversationsBySessionKey.delete(oldestKey);
}

// OpenCode sends a stable x-session-id header per session; fall back to
// hashing the first message for clients that don't (two sessions that
// happen to open with an identical first message would then collide).
export function sessionKey(req: Request, messages: OpenAIMessage[]) {
  return req.headers.get("x-session-id") ?? JSON.stringify(messages[0]);
}
