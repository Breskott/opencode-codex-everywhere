import type { Config, Plugin } from "@opencode-ai/plugin"

declare const process: { env: Record<string, string | undefined> }

// ---------------------------------------------------------------------------
// Plugin v1 (config hook). A versao v2 mora em codex-v2.ts; o server.ts
// escolhe a implementacao por runtime.
//
// No v1 o campo que escolhe o SDK do provider e `npm` (provider-level), entao
// cada familia vira um provider separado — igual a doc oficial do CE:
//   codex-everywhere         -> @ai-sdk/openai      (gpt-*, codex-*, outros)
//   codex-everywhere-claude  -> @ai-sdk/anthropic   (claude-*)
//   codex-everywhere-gemini  -> @ai-sdk/google      (gemini-*, /v1beta)
//   codex-everywhere-grok    -> @ai-sdk/openai      (grok-*)
// ---------------------------------------------------------------------------

const BASE_HOST = "https://codex-easy.ai"
const REQUEST_TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 5 * 60 * 1000

const DEFAULT_CONTEXT_TOKENS = 400_000
const DEFAULT_OUTPUT_TOKENS = 128_000

type Logger = (level: "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => Promise<void>
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type Family = "openai" | "claude" | "gemini" | "grok"

export interface FamilySpec {
  providerID: string
  providerName: string
  npm: string
  baseURL: string
}

export const FAMILIES: Readonly<Record<Family, FamilySpec>> = {
  openai: {
    providerID: "codex-everywhere",
    providerName: "Codex Everywhere",
    npm: "@ai-sdk/openai",
    baseURL: `${BASE_HOST}/v1`,
  },
  claude: {
    providerID: "codex-everywhere-claude",
    providerName: "Codex Everywhere · Claude",
    npm: "@ai-sdk/anthropic",
    baseURL: `${BASE_HOST}/v1`,
  },
  gemini: {
    providerID: "codex-everywhere-gemini",
    providerName: "Codex Everywhere · Gemini",
    npm: "@ai-sdk/google",
    baseURL: `${BASE_HOST}/v1beta`,
  },
  grok: {
    providerID: "codex-everywhere-grok",
    providerName: "Codex Everywhere · Grok",
    npm: "@ai-sdk/openai",
    baseURL: `${BASE_HOST}/v1`,
  },
}

const COMPAT_PACKAGE = "@ai-sdk/openai-compatible"
const compatMode = () => process.env.CODEX_EVERYWHERE_COMPAT === "1" || process.env.CODEX_EVERYWHERE_COMPAT === "true"

export function familyOf(id: string): Family {
  const lower = id.toLowerCase()
  if (lower.startsWith("claude-") || lower.includes("/claude")) return "claude"
  if (lower.startsWith("gemini") || lower.includes("/gemini")) return "gemini"
  if (lower.startsWith("grok-") || lower.startsWith("grok_") || lower.includes("/grok")) return "grok"
  return "openai"
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
// CONHECIMENTO ESTATICO — ver codex-v2.ts (mesma tabela, fonte: docs do CE).
// ---------------------------------------------------------------------------
interface ModelSpec {
  context: number
  output: number
  efforts?: readonly string[]
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number }
}

const MODELS: Readonly<Record<string, ModelSpec>> = {
  "gpt-6-astra": { context: 1_050_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max"] },
  "gpt-5.6-sol": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.15, output: 0.9, cache_read: 0.015 },
  },
  "gpt-5.6-terra": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.06, output: 0.36, cache_read: 0.006 },
  },
  "gpt-5.6-luna": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    cost: { input: 0.006, output: 0.036, cache_read: 0.0006 },
  },
  "gpt-5.5": {
    context: 400_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.15, output: 0.9, cache_read: 0.015 },
  },
  "gpt-5.3-codex-spark": {
    context: 128_000, output: 128_000, efforts: ["low", "medium", "high"],
    cost: { input: 0.0525, output: 0.42, cache_read: 0.00525 },
  },
  "codex-auto-review": { context: 400_000, output: 128_000, efforts: ["low", "medium", "high"] },
  "gpt-image-2": { context: 400_000, output: 4_096, efforts: [] },

  "claude-fable-5-1": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 2.4, output: 12, cache_read: 0.24 },
  },
  "claude-opus-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.225, output: 1.125, cache_read: 0.0225 },
  },
  "claude-sonnet-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.09, output: 0.45, cache_read: 0.009 },
  },
  "claude-haiku-4-5": {
    context: 200_000, output: 64_000, efforts: ["low", "medium", "high", "xhigh", "max"],
    cost: { input: 0.045, output: 0.225, cache_read: 0.0045 },
  },

  "gemini-3.8-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache_read: 0.0045 },
  },
  "gemini-3.7-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache_read: 0.0045 },
  },
  "gemini-3.6-flash": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.045, output: 0.225, cache_read: 0.0045 },
  },
  "gemini-3.1-pro": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.12, output: 0.72, cache_read: 0.012 },
  },
  "gemini-3-flash-preview": {
    context: 1_048_576, output: 65_536, efforts: ["low", "medium", "high"],
    cost: { input: 0.03, output: 0.18, cache_read: 0.003 },
  },

  "grok-4.6": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high", "xhigh"],
    cost: { input: 0.12, output: 0.36, cache_read: 0.03 },
  },
  "grok-4.5": {
    context: 500_000, output: 128_000, efforts: ["low", "medium", "high"],
    cost: { input: 0.12, output: 0.36, cache_read: 0.018 },
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

function specOf(source: CodexModel): ModelSpec {
  const known = MODELS[source.id]
  if (known) return known
  const lower = source.id.toLowerCase()
  const context = source.context_length ?? DEFAULT_CONTEXT_TOKENS
  if (lower.includes("image")) return { context, output: 4_096, efforts: [] }
  if (lower.includes("gemini")) return { context: 1_048_576, output: 65_536, efforts: DEFAULT_EFFORTS }
  if (lower.includes("grok")) return { context: 500_000, output: 128_000, efforts: DEFAULT_EFFORTS }
  if (lower.includes("claude")) return { context: 200_000, output: 64_000, efforts: DEFAULT_EFFORTS }
  return { context, output: DEFAULT_OUTPUT_TOKENS, efforts: DEFAULT_EFFORTS }
}

function inputModalities(id: string): string[] {
  const lower = id.toLowerCase()
  if (lower.includes("image")) return ["text", "image"]
  if (familyOf(id) === "gemini") return ["text", "image", "pdf"]
  return ["text", "image"]
}

function outputModalities(id: string): string[] {
  return id.toLowerCase().includes("image") ? ["image"] : ["text"]
}

function supportsTools(id: string): boolean {
  return !id.toLowerCase().includes("image")
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

/**
 * Escreve os providers por familia em `config.provider`, com merge nao
 * destrutivo: o que o usuario tiver no opencode.json vence.
 */
export function applyConfig(config: Config, apiKey: string, models: readonly CodexModel[]): void {
  const active = models.filter((model) => !isRemoved(model.id))
  if (active.length === 0) return
  const providers = ((config as Record<string, unknown>).provider ??= {}) as Record<string, any>

  const byFamily = new Map<Family, CodexModel[]>()
  for (const model of active) {
    const family = familyOf(model.id)
    const list = byFamily.get(family) ?? []
    list.push(model)
    byFamily.set(family, list)
  }

  for (const [family, familyModels] of byFamily) {
    const spec = FAMILIES[family]
    const npm = compatMode() ? COMPAT_PACKAGE : spec.npm
    const baseURL = process.env.CODEX_EVERYWHERE_BASE_URL ?? spec.baseURL

    const existing = (providers[spec.providerID] ?? {}) as Record<string, any>
    const existingModels = (existing.models ?? {}) as Record<string, any>
    const merged: Record<string, unknown> = { ...existingModels }

    for (const source of familyModels) {
      const spec2 = specOf(source)
      const efforts = spec2.efforts ?? []
      const input = inputModalities(source.id)
      const cost = spec2.cost

      const entry: Record<string, unknown> = {
        id: source.id,
        name: source.name ?? source.display_name ?? source.id,
        tool_call: supportsTools(source.id),
        reasoning: efforts.length > 0,
        attachment: input.includes("image"),
        modalities: { input, output: outputModalities(source.id) },
        limit: {
          context: source.context_length ?? spec2.context,
          output: spec2.output,
        },
        cost: cost
          ? { input: cost.input, output: cost.output, cache_read: cost.cache_read ?? 0, cache_write: cost.cache_write ?? 0 }
          : { input: 0, output: 0 },
      }
      // doc oficial do CE para OpenCode: store:false nos modelos OpenAI
      if (family === "openai" && !source.id.toLowerCase().includes("image")) {
        entry.options = { store: false }
      }
      if (efforts.length > 0) {
        // O gateway do CE traduz reasoning_effort por familia (doc oficial).
        entry.variants = Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
      }
      merged[source.id] = { ...entry, ...(existingModels[source.id] ?? {}) }
    }

    providers[spec.providerID] = {
      npm,
      name: spec.providerName,
      ...existing,
      options: { baseURL, apiKey, ...(existing.options ?? {}) },
      models: merged,
    }
  }
}

let cache: { models: CodexModel[]; at: number } | undefined

async function discover(apiKey: string, log: Logger): Promise<CodexModel[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models
  try {
    const models = await fetchModels(apiKey)
    cache = { models, at: Date.now() }
    const families = [...new Set(models.map((model) => familyOf(model.id)))].join(", ")
    await log("info", `${models.length} modelos descobertos (familias: ${families})`)
    return models
  } catch (error) {
    await log("warn", "descoberta de modelos falhou", {
      error: error instanceof Error ? error.message : String(error),
    })
    return cache?.models ?? []
  }
}

export const CodexEverywherePlugin: Plugin = async ({ client }) => {
  const apiKey = resolveEnvKey()

  const log: Logger = async (level, message, extra) => {
    try {
      await client.app.log({ body: { service: "codex-everywhere", level, message, extra } })
    } catch {
      console.warn(`[codex-everywhere] ${message}`, extra ?? "")
    }
  }

  if (!apiKey) {
    await log("warn", "CODEX_EVERYWHERE_API_KEY / CODEX_EASY_API_KEY / CE_API_KEY ausente, provider nao carregado.")
    return {}
  }

  return {
    config: async (config) => {
      applyConfig(config, apiKey, await discover(apiKey, log))
    },
  }
}

// Forma v1 de modulo de plugin (`{ id, server }`). Sem ela o loader legado
// enumera TODA funcao exportada deste arquivo como factory de plugin.
const plugin = {
  id: "codex-everywhere",
  server: CodexEverywherePlugin,
}

export default plugin
