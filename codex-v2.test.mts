import { describe, expect, test } from "bun:test"
import type { CatalogDraft, PluginContext } from "@opencode-ai/plugin/v2/promise"

import { applyCatalog, familyOf, fetchModels, packageOf, setupCodexEverywhere } from "./codex-v2.ts"
import type { RefreshScheduler } from "./codex-v2.ts"

function fakeCatalog() {
  const providers = new Map<string, Record<string, unknown>>()
  const models = new Map<string, Map<string, Record<string, unknown>>>()
  const catalog = {
    provider: {
      list: () => [],
      get: () => undefined,
      update: (id: string, update: (provider: Record<string, unknown>) => void) => {
        const provider = providers.get(id) ?? { id }
        update(provider)
        providers.set(id, provider)
      },
      remove: () => {},
    },
    model: {
      get: () => undefined,
      update: (providerID: string, id: string, update: (model: Record<string, unknown>) => void) => {
        const bucket = models.get(providerID) ?? new Map<string, Record<string, unknown>>()
        const model = bucket.get(id) ?? { id, providerID }
        update(model)
        bucket.set(id, model)
        models.set(providerID, bucket)
      },
      remove: () => {},
      default: { get: () => undefined, set: () => {} },
    },
  } as unknown as CatalogDraft
  return { catalog, providers, models }
}

const ALL_FAMILIES = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
  { id: "grok-4.5", name: "Grok 4.5" },
]

describe("familyOf", () => {
  test("routes model ids to their family", () => {
    expect(familyOf("gpt-5.6-sol")).toBe("openai")
    expect(familyOf("codex-auto-review")).toBe("openai")
    expect(familyOf("claude-opus-5")).toBe("claude")
    expect(familyOf("anthropic/claude-sonnet-5")).toBe("claude")
    expect(familyOf("gemini-3.5-flash")).toBe("gemini")
    expect(familyOf("grok-4.6")).toBe("grok")
    expect(familyOf("xai/grok-4.5")).toBe("grok")
    expect(familyOf("something-new")).toBe("openai")
  })

  test("maps families to their native SDK", () => {
    expect(packageOf("gpt-5.6-sol")).toBe("aisdk:@ai-sdk/openai")
    expect(packageOf("claude-opus-5")).toBe("aisdk:@ai-sdk/anthropic")
    expect(packageOf("gemini-3.5-flash")).toBe("aisdk:@ai-sdk/google")
    expect(packageOf("grok-4.6")).toBe("aisdk:@ai-sdk/openai")
  })
})

describe("fetchModels", () => {
  test("returns models from an authenticated CE response", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
      return Response.json({ data: ALL_FAMILIES })
    }

    await expect(fetchModels("test-key", fetcher)).resolves.toHaveLength(4)
  })

  test("rejects an unsuccessful response", async () => {
    const fetcher = async () => new Response("unauthorized", { status: 401 })
    await expect(fetchModels("bad-key", fetcher)).rejects.toThrow("HTTP 401")
  })

  test("rejects a malformed model payload", async () => {
    const fetcher = async () => Response.json({ data: [{ name: "missing id" }] })
    await expect(fetchModels("test-key", fetcher)).rejects.toThrow("nenhum modelo retornado")
  })
})

describe("applyCatalog", () => {
  test("splits models into one provider per family with native SDKs", () => {
    const { catalog, providers, models } = fakeCatalog()
    applyCatalog(catalog, "test-key", ALL_FAMILIES)

    expect(providers.get("codex-everywhere")).toMatchObject({
      name: "Codex Everywhere",
      package: "aisdk:@ai-sdk/openai",
      api: { type: "aisdk", package: "aisdk:@ai-sdk/openai" },
      request: { body: { store: false } },
    })
    expect(providers.get("codex-everywhere-claude")?.api).toMatchObject({
      package: "aisdk:@ai-sdk/anthropic",
    })
    expect(providers.get("codex-everywhere-gemini")?.api).toMatchObject({
      package: "aisdk:@ai-sdk/google",
      settings: { baseURL: "https://codex-easy.ai/v1beta" },
    })
    expect(providers.get("codex-everywhere-grok")?.api).toMatchObject({
      package: "aisdk:@ai-sdk/openai",
    })

    expect(models.get("codex-everywhere")!.get("gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol",
      limit: { context: 500_000, output: 128_000 },
      capabilities: { tools: true },
      cost: [{ input: 0.15, output: 0.9 }],
    })
    expect(models.get("codex-everywhere")!.get("gpt-5.6-sol")!.variants.map((v: any) => v.id)).toEqual([
      "low", "medium", "high", "xhigh", "max", "ultra",
    ])
    expect(models.get("codex-everywhere-claude")!.get("claude-sonnet-5")).toMatchObject({
      limit: { context: 200_000, output: 64_000 },
    })
    expect(models.get("codex-everywhere-gemini")!.get("gemini-3.5-flash")).toMatchObject({
      capabilities: { input: ["text", "image", "pdf"] },
      limit: { context: 1_048_576, output: 65_536 },
    })
    expect(models.get("codex-everywhere-grok")!.get("grok-4.5")).toMatchObject({
      limit: { context: 500_000, output: 128_000 },
    })
  })

  test("falls back to heuristics for unknown model ids", () => {
    const { catalog, models } = fakeCatalog()
    applyCatalog(catalog, "test-key", [{ id: "gemini-9-ultra" }, { id: "brand-new-thing" }])

    expect(models.get("codex-everywhere-gemini")!.get("gemini-9-ultra")).toMatchObject({
      limit: { context: 1_048_576, output: 65_536 },
    })
    expect(models.get("codex-everywhere")!.get("brand-new-thing")).toMatchObject({
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      limit: { context: 400_000, output: 128_000 },
    })
  })

  test("image models do not advertise tools", () => {
    const { catalog, models } = fakeCatalog()
    applyCatalog(catalog, "test-key", [{ id: "gpt-image-2" }])
    expect(models.get("codex-everywhere")!.get("gpt-image-2")).toMatchObject({
      capabilities: { tools: false, output: ["image"] },
      variants: [],
    })
  })
})

describe("setupCodexEverywhere", () => {
  function fakeCtx(catalog: CatalogDraft, transforms: number[]) {
    return {
      catalog: {
        transform: async (fn: (c: CatalogDraft) => void) => {
          transforms.push(transforms.length + 1)
          fn(catalog)
        },
        reload: async () => {
          transforms.push(transforms.length + 1)
        },
      },
    } as unknown as PluginContext
  }

  test("applies discovered models on setup", async () => {
    const { catalog, models } = fakeCatalog()
    const transforms: number[] = []
    const fetcher = async () => Response.json({ data: [{ id: "gpt-5.6-luna" }] })
    const schedule: RefreshScheduler = () => undefined

    await setupCodexEverywhere(fakeCtx(catalog, transforms), "test-key", fetcher, schedule)

    expect(transforms.length).toBe(1)
    expect(models.get("codex-everywhere")!.has("gpt-5.6-luna")).toBe(true)
  })
})
