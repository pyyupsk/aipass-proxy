import { Model, Plugin, Provider } from "@opencode/plugin";

type Options = {
  baseURL?: string;
  name?: string;
  refreshInterval?: number;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "http://localhost:47871/v1";
const DEFAULT_NAME = "AIPass";
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;

type RemoteModel = { id: string; object?: string; owned_by?: string };

async function fetchModels(baseURL: string, timeoutMs: number): Promise<RemoteModel[]> {
  const url = `${baseURL.replace(/\/$/, "")}/models`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status} ${await res.text().catch(() => "")}`);
  const json = (await res.json()) as { data?: RemoteModel[] } | RemoteModel[];
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  throw new Error(`unexpected /v1/models shape: ${JSON.stringify(json).slice(0, 300)}`);
}

function toModelInfos(providerID: Provider.ID, remote: RemoteModel[]): Model.Info[] {
  return remote.map((m) => {
    const id = Model.ID.make(m.id);
    const base = Model.Info.default(providerID, id);
    return {
      ...base,
      name: m.id,
      // aipass proxy emulates tool calls via prompt injection, so advertise tools=true
      capabilities: { tools: true, input: ["text"], output: ["text"] },
    };
  });
}

export default Plugin.define({
  id: "aipass",
  async setup(ctx) {
    const opts = ctx.options as Options;
    const providerID = Provider.ID.make("aipass");
    const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;
    const name = opts.name ?? DEFAULT_NAME;
    const intervalMs = opts.refreshInterval ?? DEFAULT_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const source: { models: Model.Info[] } = { models: [] };

    const load = async (): Promise<Model.Info[]> => {
      try {
        const remote = await fetchModels(baseURL, timeoutMs);
        if (remote.length === 0) return source.models;
        return toModelInfos(providerID, remote);
      } catch (err) {
        console.warn(`[aipass] failed to fetch models from ${baseURL}:`, err instanceof Error ? err.message : String(err));
        return source.models;
      }
    };

    // initial load before transform so first startup already has models if proxy is running
    source.models = await load();

    const providerInfo = {
      ...Provider.Info.empty(providerID),
      name,
      activation: "enabled" as const,
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL, apiKey: "unused" },
    };

    await ctx.provider.transform((editor) => {
      const existing = editor.get(providerID);
      if (existing) editor.remove(providerID);
      editor.add({ info: providerInfo, models: source.models });
    });

    // persist last good inventory to survive proxy offline after first success
    if (source.models.length > 0)
      await ctx.storage.set(
        "models",
        source.models.map((m) => m.id),
      );
    else {
      const cached = (await ctx.storage.get("models")) as string[] | undefined;
      if (cached && cached.length > 0) {
        source.models = cached.map((id) => {
          const mid = Model.ID.make(id);
          const base = Model.Info.default(providerID, mid);
          return { ...base, name: id, capabilities: { tools: true, input: ["text"], output: ["text"] } };
        });
        await ctx.provider.reload();
      }
    }

    const refresh = async () => {
      const next = await load();
      // only reload if set changed (avoid noisy provider.updated events)
      const prevIds = new Set(source.models.map((m) => m.id));
      const nextIds = new Set(next.map((m) => m.id));
      const changed = prevIds.size !== nextIds.size || [...nextIds].some((id) => !prevIds.has(id));
      if (!changed) return;
      source.models = next;
      if (next.length > 0)
        await ctx.storage.set(
          "models",
          next.map((m) => m.id),
        );
      await ctx.provider.reload();
    };

    const timer = setInterval(() => void refresh().catch(console.error), intervalMs);

    await ctx.command.transform((editor) => {
      editor.add({
        name: "aipass:refresh",
        description: "Refresh AIPass models from aipass-proxy (/v1/models)",
        async execute() {
          await refresh();
        },
      });
    });

    // allow agent usage too
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "aipass_refresh",
        description: "Refresh AIPass models from aipass-proxy",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          await refresh();
          return { content: `aipass: ${source.models.length} models` };
        },
      });
    });

    return () => clearInterval(timer);
  },
});
