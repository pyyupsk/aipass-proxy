export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type Result<T> = [T, null] | [null, UpstreamError];

// Business logic never throws to its callers: functions that talk to AIPass
// return a Result tuple. safe() is the one place that turns a thrown
// UpstreamError (or a raw fetch/JSON exception) into that tuple.
export async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return [await fn(), null];
  } catch (err) {
    if (err instanceof UpstreamError) return [null, err];
    return [null, new UpstreamError(err instanceof Error ? err.message : String(err), 502)];
  }
}

export async function upstreamText(res: Response) {
  const text = await res.text();
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

// 403 from AIPass is the WAF traversal block: deterministic, retrying just
// triples latency for a guaranteed failure. Only retry what's actually
// transient (rate limiting, upstream 5xx, network/timeout).
function isRetryable(err: UpstreamError) {
  return err.status === 429 || err.status >= 500;
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4000;

export async function safeWithRetry<T>(fn: () => Promise<T>): Promise<Result<T>> {
  let result = await safe(fn);
  for (let attempt = 1; attempt < RETRY_ATTEMPTS && result[1] && isRetryable(result[1]); attempt++) {
    const delay = Math.random() * Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)); // NOSONAR: jitter timing, not security-sensitive
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await safe(fn);
  }
  return result;
}
