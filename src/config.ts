export const AIPASS_BASE = "https://de.aipass.net";
const SESSION_TOKEN = process.env.AIPASS_SESSION_TOKEN;
export const PORT = Number(process.env.PORT ?? 47871);

if (!SESSION_TOKEN) {
  throw new Error("AIPASS_SESSION_TOKEN is required (see .env)");
}

const cookieHeader = `__Secure-ai_passport_auth.session_token=${SESSION_TOKEN}`;

// Cloudflare blocks requests missing browser-like User-Agent, Referer, and sec-fetch-* headers.
export const baseHeaders = {
  Cookie: cookieHeader,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: AIPASS_BASE,
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
};
