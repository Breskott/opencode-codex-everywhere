import { define, type CatalogDraft, type PluginContext } from "@opencode-ai/plugin/v2/promise"

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type RefreshScheduler = (callback: () => Promise<void>, delayMs: number) => unknown

// ---------------------------------------------------------------------------
// Runtime-openCode-2 plugin (catalog API). A versao v1 mora em codex-v1.ts;
// o server.ts escolhe a implementacao certa por runtime.
//
// A Codex Everywhere expoe o MESMO host (codex-easy.ai) em tres protocolos:
//   - OpenAI Responses/Chat:  /v1         -> modelos gpt-*, codex-*, grok-*
//   - Anthropic Messages:     /v1         -> modelos claude-*
//   - Google Gemini:          /v1beta     -> modelos gemini-*
// A lista de modelos depende do POOL da API key escolhido no site
// (Codex Plus/Pro, Claude Kiro/Max, Grok Heavy, Gemini Antigravity) — por isso
// o provider e descoberto ao vivo via GET /v1/models e cada modelo e roteado
// para o provider certo pela familia do id.
// ---------------------------------------------------------------------------

const BASE_HOST = "https://codex-easy.ai"
const REFRESH_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

const DEFAULT_CONTEXT_TOKENS = 400_000
const DEFAULT_OUTPUT_TOKENS = 128_000

declare const process: { env: Record<string, string | undefined> }

// ---------------------------------------------------------------------------
// FAMILIAS -> provider + SDK. Cada familia vira um provider separado no
// catalogo para que cada grupo use o SDK nativo (igual a doc oficial do CE).
// ---------------------------------------------------------------------------
export type Family = "openai" | "claude" | "gemini" | "grok"

export interface FamilySpec {
  providerID: string
  providerName: string
  pkg: string
  baseURL: string
  /** openai/grok falam Responses API; claude fala Messages; gemini fala v1beta. */
}

export const FAMILIES: Readonly<Record<Family, FamilySpec>> = {
  openai: {
    providerID: "codex-everywhere",
    providerName: "Codex Everywhere",
    pkg: "aisdk:@ai-sdk/openai",
    baseURL: `${BASE_HOST}/v1`,
  },
  claude: {
    providerID: "codex-everywhere-claude",
    providerName: "Codex Everywhere · Claude",
    pkg: "aisdk:@ai-sdk/anthropic",
    baseURL: `${BASE_HOST}/v1`,
  },
  gemini: {
    providerID: "codex-everywhere-gemini",
    providerName: "Codex Everywhere · Gemini",
    pkg: "aisdk:@ai-sdk/google",
    baseURL: `${BASE_HOST}/v1beta`,
  },
  grok: {
    providerID: "codex-everywhere-grok",
    providerName: "Codex Everywhere · Grok",
    pkg: "aisdk:@ai-sdk/openai",
    baseURL: `${BASE_HOST}/v1`,
  },
}

// CODEX_EVERYWHERE_COMPAT=1 forca @ai-sdk/openai-compatible (/v1/chat/completions)
// em todas as familias — rota de fuga se algum pool nao aceitar o SDK nativo.
const COMPAT_PACKAGE = "aisdk:@ai-sdk/openai-compatible"
const compatMode = () => process.env.CODEX_EVERYWHERE_COMPAT === "1" || process.env.CODEX_EVERYWHERE_COMPAT === "true"

export function familyOf(id: string): Family {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude-") || lower.includes("/claude")) return "claude"
  if (lower.startsWith("gemini") || lower.includes("/gemini")) return "gemini"
  if (lower.startsWith("grok-") || lower.startsWith("grok_") || lower.includes("/grok")) return "grok"
  return "openai"
}

export function packageOf(id: string): string {
  if (compatMode()) return COMPAT_PACKAGE
  return FAMILIES[familyOf(id)].pkg
}

export function baseURLOf(id: string): string {
  const override = process.env.CODEX_EVERYWHERE_BASE_URL
  if (override) return override
  if (compatMode()) return `${BASE_HOST}/v1`
  return FAMILIES[familyOf(id)].baseURL
}

function resolveEnvKey(): string | undefined {
  return (
    process.env.CODEX_EVERYWHERE_API_KEY ??
    process.env.CODEX_EASY_API_KEY ??
    process.env.CE_API_KEY ??
    process.env.OPENAI_API_KEY
  )
}

// ---------------------------------------------------------------------------
// CONHECIMENTO ESTATICO. O /models devolve so id (+name/display_name) — limites,
// esforcos, precos e capabilities vem daqui. Fonte: docs.codex-everywhere.com
// (/models/* e /integrations/opencode). Precos = pools mais comuns do CE
// (Plus 0.03x GPT, Kiro 0.045x Claude, Heavy 0.06x Grok, Antigravity 0.06x
// Gemini, Max 0.24x pro claude-fable-5 que so existe no Max). USD por 1M tok.
// ---------------------------------------------------------------------------
interface ModelSpec {
  context: number
  output: number
  efforts?: readonly string[]
  cost?: { input: number; output: number; cache: { read: number; write: number } }
}

const MODELS: Readonly<Record<string, ModelSpec>> = {
  // ---- OpenAI (pools Codex Plus/Pro) ----
  "gpt-6-astra": { context: 1_050_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max"] },
  // doc de integracao do CE recomenda 500K para o OpenCode (qualidade cai >400K)
  "gpt-5.6-sol": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.15, output: 0.9, cache: { read: 0.015, write: 0 } },
  },
  "gpt-5.6-terra": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.06, output: 0.36, cache: { read: 0.006, write: 0 } },
  },
  "gpt-5.6-luna": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.006, output: 0.036, cache: { read: 0.0006, write: 0 } },
  },
  "gpt-5.5": {
    context: 400_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.15, output: 0.9, cache: { read: 0.015, write: 0 } },
  },
  "gpt-5.3-codex-spark": {
    context: 128_000, output: 128_000, efforts: ["low", "medium", "high"],
    cost: { input: 0.0525, output: 0.42, cache: { read: 0.00525, write: 0 } },
  },
  "codex-auto-review": { context: 400_000, output: 128_000, efforts: ["low", "medium", "high"] },
  "gpt-image-2": { context: 400_000, output: 4_096, efforts: [] },

  // ---- Anthropic (pools Claude Kiro/Max) ----
  "claude-fable-5-1": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 2.4, output: 12, cache: { read: 0.24, write: 0 } }, // Max pool (so existe la)
  },
  "claude-opus-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.225, output: 1.125, cache: { read: 0.0225, write: 0 } },
  },
  "claude-sonnet-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.09, output: 0.45, cache: { read: 0.009, write: 0 } },
  },
  "claude-haiku-4-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.045, output: 0.225, cache: { read: 0.0045, write: 0 } },
  },

  // ---- Google (pool Gemini Antigravity) ----
  "gemini-3.8-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache: { read: 0.0045, write: 0 } },
  },
  "gemini-3.7-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache: { read: 0.0045, write: 0 } },
  },
  "gemini-3.6-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache: { read: 0.0045, write: 0 } },
  },
  "gemini-3.1-pro": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.12, output: 0.72, cache: { read: 0.012, write: 0 } },
  },
  "gemini-3-flash-preview": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.03, output: 0.18, cache: { read: 0.003, write: 0 } },
  },

  // ---- xAI (pool Grok Heavy) ----
  "grok-4.6": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.12, output: 0.36, cache: { read: 0.03, write: 0 } },
  },
  "grok-4.5": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high"],
    cost: { input: 0.12, output: 0.36, cache: { read: 0.018, write: 0 } },
  },
}

const DEFAULT_EFFORTS: readonly string[] = ["low", "medium", "high"]

// Ids que o CE removeu dos pools mas que o /models ainda pode devolver por um
// tempo — sao filtrados do catalogo pra nao aparecerem no seletor (selecionar
// um deles daria erro no gateway). Fonte: roster ativo publicado no site.
export const REMOVED_MODELS: ReadonlySet<string> = new Set([
  "gpt-5.4",
  "gpt-5.4-mini",
  "claude-fable-5",
  "claude-opus-4.8",
  "claude-opus-4.7",
  "claude-opus-4.6",
  "claude-sonnet-4.6",
  "claude-haiku-4.5",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
])

export function isRemoved(id: string): boolean {
  return REMOVED_MODELS.has(id)
}

// Heuristicas para modelos futuros que a API devolver antes do snapshot.
function specOf(source: CodexModel): ModelSpec {
  const known = MODELS[source.id]
  if (known) return known
  const lower = source.id.toLowerCase()
  const context = source.context_length ?? DEFAULT_CONTEXT_TOKENS
  if (lower.includes("image")) return { context, output: 4_096, efforts: [] }
  if (lower.includes("gemini")) return { context: 1_048_576, output: 65_536, efforts: DEFAULT_EFFORTS }
  if (lower.includes("grok")) return { context: 500_000, output: 128_000, efforts: DEFAULT_EFFORTS }
  if (lower.includes("claude")) return { context: 200_000, output: 64_000, efforts: DEFAULT_EFFORTS }
  if (lower.includes("mini") || lower.includes("spark") || lower.includes("auto-review")) {
    return { context, output: 128_000, efforts: DEFAULT_EFFORTS }
  }
  return { context, output: DEFAULT_OUTPUT_TOKENS, efforts: DEFAULT_EFFORTS }
}

function inputModalities(id: string): string[] {
  const lower = id.toLowerCase()
  if (lower.includes("image")) return ["text", "image"]
  if (familyOf(id) === "gemini") return ["text", "image", "pdf"]
  return ["text", "image"] // gpt/claude/grok aceitam imagem na entrada
}

function outputModalities(id: string): string[] {
  return id.toLowerCase().includes("image") ? ["image"] : ["text"]
}

function supportsTools(id: string): boolean {
  return !id.toLowerCase().includes("image")
}

export interface CodexModel {
  id: string
  name?: string
  display_name?: string
  context_length?: number
}

interface RawModel {
  id?: unknown
  name?: unknown
  display_name?: unknown
  context_length?: unknown
}

export async function fetchModels(apiKey: string, fetcher: Fetcher = fetch): Promise<CodexModel[]> {
  const base = (process.env.CODEX_EVERYWHERE_BASE_URL ?? `${BASE_HOST}/v1`).replace(/\/$/, "")
  const response = await fetcher(`${base}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Codex Everywhere: falha ao buscar modelos (HTTP ${response.status})`)
  }
  const body: unknown = await response.json()
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray((body as { data: unknown }).data)) {
    throw new Error("Codex Everywhere: resposta de modelos invalida")
  }
  const out: CodexModel[] = []
  for (const raw of (body as { data: RawModel[] }).data) {
    if (typeof raw !== "object" || raw === null) continue
    if (typeof raw.id !== "string" || raw.id.length === 0) continue
    const model: CodexModel = { id: raw.id }
    const nameCandidate =
      typeof raw.display_name === "string" && raw.display_name.length > 0
        ? raw.display_name
        : typeof raw.name === "string" && raw.name.length > 0
          ? raw.name
          : undefined
    if (nameCandidate) model.name = nameCandidate
    if (typeof raw.context_length === "number" && raw.context_length >= 0) model.context_length = raw.context_length
    out.push(model)
  }
  if (out.length === 0) throw new Error("Codex Everywhere: nenhum modelo retornado")
  return out
}

export function applyCatalog(catalog: CatalogDraft, apiKey: string, models: readonly CodexModel[]): void {
  const active = models.filter((model) => !isRemoved(model.id))
  const byFamily = new Map<Family, CodexModel[]>()
  for (const model of active) {
    const family = familyOf(model.id)
    const list = byFamily.get(family) ?? []
    list.push(model)
    byFamily.set(family, list)
  }

  for (const [family, familyModels] of byFamily) {
    const spec = FAMILIES[family]
    const pkg = compatMode() ? COMPAT_PACKAGE : spec.pkg
    const baseURL = process.env.CODEX_EVERYWHERE_BASE_URL ?? spec.baseURL
    const settings = { baseURL, apiKey }

    catalog.provider.update(spec.providerID, (provider) => {
      provider.name = spec.providerName
      const p = provider as unknown as Record<string, unknown>
      p.package = pkg
      p.settings = settings
      provider.api = { type: "aisdk", package: pkg, settings }
      provider.request = { headers: {}, body: family === "openai" ? { store: false } : {} }
    })

    for (const source of familyModels) {
      catalog.model.update(spec.providerID, source.id, (model) => {
        model.name = source.name ?? source.display_name ?? source.id
        const m = model as unknown as Record<string, unknown>
        m.package = pkg
        m.settings = settings
        m.family = family
        model.api = { id: source.id, type: "aisdk", package: pkg, settings }
        const spec2 = specOf(source)
        model.limit = { context: source.context_length ?? spec2.context, output: spec2.output }
        model.capabilities = {
          tools: supportsTools(source.id),
          input: inputModalities(source.id),
          output: outputModalities(source.id),
        }
        // O CE nao expoe custo no /models; usamos as tabelas dos pools (doc).
        model.cost = [spec2.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } }]
        const efforts = spec2.efforts ?? []
        model.variants = efforts.map((effort) => ({
          id: effort,
          headers: {},
          // O gateway do CE traduz reasoning_effort por familia (doc oficial).
          body: { reasoning_effort: effort },
        }))
        if (family === "openai") {
          // doc oficial do CE para OpenCode: store:false nos modelos OpenAI
          model.request = { headers: {}, body: { store: false } }
        }
        const mm = model as unknown as Record<string, unknown>
        if (mm.enabled === undefined) mm.enabled = true
        if (mm.status === undefined) mm.status = "active"
      })
    }
  }
}

const signatureOf = (models: readonly CodexModel[]): string =>
  models
    .map((model) => model.id)
    .sort()
    .join(",")

// ---------------------------------------------------------------------------
// Descoberta dinamica com refresh: o conjunto de modelos muda quando o pool da
// API key muda no site (Codex/Claude/Grok/Gemini) — entao rebuscamos e, se a
// assinatura mudou, pedimos catalog.reload() pro host re-transformar.
// ---------------------------------------------------------------------------
export async function registerDynamicModelCatalog<Model>(options: {
  ctx: PluginContext
  load: () => Promise<Model[]>
  apply: (catalog: CatalogDraft, models: readonly Model[]) => void
  signature: (models: readonly Model[]) => string
  refreshMs: number
  schedule?: RefreshScheduler
  onError: (phase: "initial" | "refresh", error: unknown) => void
  onApplied?: (models: readonly Model[]) => void
  onStale?: () => void
}): Promise<void> {
  let models: Model[] = []
  let initialLoaded = false
  try {
    models = await options.load()
    initialLoaded = true
  } catch (error) {
    options.onError("initial", error)
  }
  let signature = options.signature(models)
  let generation = 0
  let appliedGeneration = -1
  await options.ctx.catalog.transform((catalog) => {
    options.apply(catalog, models)
    appliedGeneration = generation
  })
  if (initialLoaded) options.onApplied?.(models)
  let refreshing = false
  const refresh = async () => {
    if (refreshing) return
    refreshing = true
    try {
      const next = await options.load()
      const nextSignature = options.signature(next)
      if (nextSignature === signature) return
      models = next
      const targetGeneration = ++generation
      for (let attempt = 0; appliedGeneration < targetGeneration && attempt < 2; attempt++) {
        await options.ctx.catalog.reload()
      }
      if (appliedGeneration < targetGeneration) {
        options.onStale?.()
        return
      }
      signature = nextSignature
      options.onApplied?.(next)
    } catch (error) {
      options.onError("refresh", error)
    } finally {
      refreshing = false
    }
  }
  const schedule = options.schedule ?? ((callback, delayMs) => setInterval(() => void callback(), delayMs))
  schedule(refresh, options.refreshMs)
}

export async function setupCodexEverywhere(
  ctx: PluginContext,
  apiKey: string,
  fetcher: Fetcher = fetch,
  schedule?: RefreshScheduler,
): Promise<void> {
  await registerDynamicModelCatalog({
    ctx,
    load: () => fetchModels(apiKey, fetcher),
    apply: (catalog, models) => applyCatalog(catalog, apiKey, models),
    signature: signatureOf,
    refreshMs: REFRESH_MS,
    schedule,
    onError: (phase, error) =>
      console.warn(
        `[codex-everywhere] descoberta ${phase === "initial" ? "inicial " : ""}de modelos falhou:`,
        error,
      ),
    onApplied: (models) =>
      console.info(
        `[codex-everywhere] ${models.length} modelos descobertos: ${models.map((model) => model.id).join(", ")}`,
      ),
    onStale: () =>
      console.warn("[codex-everywhere] catalogo nao aplicou a geracao mais recente; nova tentativa no proximo refresh."),
  })
}

export default define({
  id: "codex-everywhere",
  setup: async (ctx) => {
    const apiKey = resolveEnvKey()
    if (!apiKey) {
      console.warn(
        "[codex-everywhere] CODEX_EVERYWHERE_API_KEY / CODEX_EASY_API_KEY / CE_API_KEY ausente, provider nao carregado.",
      )
      return
    }
    await setupCodexEverywhere(ctx, apiKey)
  },
})
