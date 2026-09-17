import { describe, expect, test } from "bun:test"
import type { Model, Plugin, Provider } from "@opencode/plugin"

import { applyProviders, familyOf, fetchModels, isRemoved, packageOf, setupCodexEverywhere } from "./codex-v2.ts"
import type { ProviderEditor, RefreshScheduler } from "./codex-v2.ts"

// Editor de provider fake (API OpenCode 2.0.5): captura cada `add({ info, models })`
// e expoe lookups por providerID, do mesmo jeito que o host aplicaria.
type Added = { info: Provider.Info; models: readonly Model.Info[] }
function fakeProviderEditor() {
  const added: Added[] = []
  const editor = { add: (input: Added) => added.push(input) } as unknown as ProviderEditor
  const provider = (id: string): Record<string, any> | undefined =>
    added.find((a) => String(a.info.id) === id)?.info as unknown as Record<string, any> | undefined
  const modelsOf = (id: string) => {
    const rec = added.find((a) => String(a.info.id) === id)
    return new Map((rec?.models ?? []).map((m) => [String(m.id), m as unknown as Record<string, any>]))
  }
  return { editor, added, provider, modelsOf }
}

// Validacao estrutural do contrato 2.0.5 (Provider.Info / Model.Info). Nao usamos
// Schema.is porque o @opencode/schema traz a sua propria copia de `effect`: um
// `Schema.is` importado do `effect` da raiz valida contra outra instancia e da
// falso-negativo. Checar os campos obrigatorios direto e robusto ao linker.
const ACTIVATIONS = ["auto", "enabled", "disabled"]
const STATUSES = ["alpha", "beta", "deprecated", "active"]
function isValidProviderInfo(info: any): boolean {
  return (
    typeof info?.id === "string" &&
    typeof info?.name === "string" &&
    ACTIVATIONS.includes(info?.activation) &&
    typeof info?.package === "string"
  )
}
function isValidModelInfo(m: any): boolean {
  return (
    typeof m?.id === "string" &&
    typeof m?.modelID === "string" &&
    typeof m?.providerID === "string" &&
    typeof m?.name === "string" &&
    typeof m?.capabilities?.tools === "boolean" &&
    Array.isArray(m?.capabilities?.input) &&
    Array.isArray(m?.capabilities?.output) &&
    Array.isArray(m?.variants) &&
    typeof m?.time?.released === "number" &&
    Array.isArray(m?.cost) &&
    m.cost.every(
      (c: any) =>
        typeof c?.input === "number" &&
        typeof c?.output === "number" &&
        typeof c?.cache?.read === "number" &&
        typeof c?.cache?.write === "number",
    ) &&
    STATUSES.includes(m?.status) &&
    typeof m?.enabled === "boolean" &&
    typeof m?.limit?.context === "number" &&
    typeof m?.limit?.output === "number"
  )
}

const ALL_FAMILIES = [
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
  { id: "grok-4.5", name: "Grok 4.5" },
  { id: "deepseek-flash", name: "deepseek-flash" },
  { id: "deepseek-v4-flash-vision-exp", name: "deepseek-v4-flash-vision-exp" },
  { id: "deepseek-v4-pro", name: "deepseek-v4-pro" },
]

describe("familyOf", () => {
  test("routes model ids to their family", () => {
    expect(familyOf("gpt-5.6-sol")).toBe("openai")
    expect(familyOf("codex-auto-review")).toBe("openai")
    expect(familyOf("claude-opus-5")).toBe("claude")
    expect(familyOf("anthropic/claude-sonnet-5")).toBe("claude")
    expect(familyOf("gemini-3.7-flash")).toBe("gemini")
    expect(familyOf("grok-4.6")).toBe("grok")
    expect(familyOf("xai/grok-4.5")).toBe("grok")
    expect(familyOf("deepseek-flash")).toBe("deepseek")
    expect(familyOf("deepseek-v4-flash-vision-exp")).toBe("deepseek")
    expect(familyOf("deepseek-v4-pro")).toBe("deepseek")
    expect(familyOf("deepseek/deepseek-v4-pro")).toBe("deepseek")
    expect(familyOf("something-new")).toBe("openai")
  })

  test("maps families to their native SDK", () => {
    expect(packageOf("gpt-5.6-sol")).toBe("aisdk:@ai-sdk/openai@3.0.113")
    expect(packageOf("claude-opus-5")).toBe("aisdk:@ai-sdk/anthropic@3.0.118")
    expect(packageOf("gemini-3.7-flash")).toBe("aisdk:@ai-sdk/google@3.0.123")
    expect(packageOf("grok-4.6")).toBe("aisdk:@ai-sdk/openai@3.0.113")
    expect(packageOf("deepseek-flash")).toBe("aisdk:@ai-sdk/openai@3.0.113")
  })
})

describe("fetchModels", () => {
  test("returns models from an authenticated CE response", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
      return Response.json({ data: ALL_FAMILIES })
    }

    await expect(fetchModels("test-key", fetcher)).resolves.toHaveLength(7)
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

describe("applyProviders", () => {
  test("splits models into one provider per family with native SDKs", () => {
    const { editor, added, provider, modelsOf } = fakeProviderEditor()
    applyProviders(editor, "test-key", ALL_FAMILIES)

    // Todo provider/model registrado respeita o contrato 2.0.5.
    for (const rec of added) {
      expect(isValidProviderInfo(rec.info)).toBe(true)
      expect(rec.models.every(isValidModelInfo)).toBe(true)
    }

    expect(provider("codex-everywhere")).toMatchObject({
      name: "Codex Everywhere",
      activation: "auto",
      package: "aisdk:@ai-sdk/openai@3.0.113",
      body: { store: false },
    })
    expect(provider("codex-everywhere-claude")).toMatchObject({
      package: "aisdk:@ai-sdk/anthropic@3.0.118",
    })
    expect(provider("codex-everywhere-gemini")).toMatchObject({
      package: "aisdk:@ai-sdk/google@3.0.123",
      settings: { baseURL: "https://codex-easy.ai/v1beta" },
    })
    expect(provider("codex-everywhere-grok")).toMatchObject({
      package: "aisdk:@ai-sdk/openai@3.0.113",
    })
    expect(provider("codex-everywhere-deepseek")).toMatchObject({
      name: "Codex Everywhere · DeepSeek",
      activation: "auto",
      package: "aisdk:@ai-sdk/openai@3.0.113",
      body: { store: false },
    })

    expect(modelsOf("codex-everywhere").get("gpt-5.6-sol")).toMatchObject({
      name: "GPT-5.6 Sol",
      limit: { context: 500_000, output: 128_000 },
      capabilities: { tools: true },
      cost: [{ input: 0.15, output: 0.9 }],
    })
    expect(modelsOf("codex-everywhere").get("gpt-5.6-sol")!.variants.map((v: any) => v.id)).toEqual([
      "low", "medium", "high", "xhigh", "max", "ultra",
    ])
    expect(modelsOf("codex-everywhere-claude").get("claude-sonnet-5")).toMatchObject({
      limit: { context: 200_000, output: 64_000 },
    })
    expect(modelsOf("codex-everywhere-gemini").get("gemini-3.7-flash")).toMatchObject({
      capabilities: { input: ["text", "image", "pdf"] },
      limit: { context: 1_048_576, output: 65_536 },
    })
    expect(modelsOf("codex-everywhere-grok").get("grok-4.5")).toMatchObject({
      limit: { context: 500_000, output: 128_000 },
    })
    expect(modelsOf("codex-everywhere-deepseek").get("deepseek-flash")).toMatchObject({
      limit: { context: 1_000_000, output: 384_000 },
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      cost: [{ input: 0.15, output: 0.6 }],
    })
    expect(modelsOf("codex-everywhere-deepseek").get("deepseek-v4-flash-vision-exp")).toMatchObject({
      capabilities: { input: ["text", "image"] },
    })
    // V4-Pro e texto puro (sem visao) — anunciar image quebraria o attach da TUI.
    expect(modelsOf("codex-everywhere-deepseek").get("deepseek-v4-pro")).toMatchObject({
      capabilities: { input: ["text"] },
      limit: { context: 1_000_000, output: 384_000 },
    })
  })

  test("falls back to heuristics for unknown model ids", () => {
    const { editor, modelsOf } = fakeProviderEditor()
    applyProviders(editor, "test-key", [{ id: "gemini-9-ultra" }, { id: "brand-new-thing" }])

    expect(modelsOf("codex-everywhere-gemini").get("gemini-9-ultra")).toMatchObject({
      limit: { context: 1_048_576, output: 65_536 },
    })
    expect(modelsOf("codex-everywhere").get("brand-new-thing")).toMatchObject({
      capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
      limit: { context: 400_000, output: 128_000 },
    })
  })

  test("image models do not advertise tools", () => {
    const { editor, modelsOf } = fakeProviderEditor()
    applyProviders(editor, "test-key", [{ id: "gpt-image-2" }])
    expect(modelsOf("codex-everywhere").get("gpt-image-2")).toMatchObject({
      capabilities: { tools: false, output: ["image"] },
      variants: [],
    })
  })

  test("models the CE roster dropped are filtered out", () => {
    const { editor, modelsOf } = fakeProviderEditor()
    expect(isRemoved("gpt-5.4")).toBe(true)
    expect(isRemoved("gpt-5.4-mini")).toBe(true)
    expect(isRemoved("claude-opus-4-8")).toBe(false)

    applyProviders(editor, "test-key", [
      { id: "gpt-5.4" },
      { id: "gpt-5.4-mini" },
      { id: "claude-opus-4-8" },
      { id: "gpt-5.5" },
    ])

    expect(modelsOf("codex-everywhere").has("gpt-5.4")).toBe(false)
    expect(modelsOf("codex-everywhere").has("gpt-5.4-mini")).toBe(false)
    expect(modelsOf("codex-everywhere").has("gpt-5.5")).toBe(true)
    expect(modelsOf("codex-everywhere-claude").has("claude-opus-4-8")).toBe(true)
  })

  test("gemini variants emit generationConfig.thinkingConfig.thinkingLevel", () => {
    const { editor, modelsOf } = fakeProviderEditor()
    applyProviders(editor, "test-key", [{ id: "gemini-3.7-flash" }, { id: "gpt-5.6-sol" }])

    const gemini = modelsOf("codex-everywhere-gemini").get("gemini-3.7-flash")!
    expect(gemini.variants.map((v: any) => v.id)).toEqual(["minimal", "low", "medium", "high"])
    expect(gemini.variants[0].body).toEqual({
      generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } },
    })

    const gpt = modelsOf("codex-everywhere").get("gpt-5.6-sol")!
    expect(gpt.variants[0].body).toEqual({ reasoning_effort: "low" })
  })

  test("deepseek variants emit nested reasoning.effort (top-level is ignored by the CE Responses route)", () => {
    const { editor, modelsOf } = fakeProviderEditor()
    applyProviders(editor, "test-key", [{ id: "deepseek-flash" }])

    const deepseek = modelsOf("codex-everywhere-deepseek").get("deepseek-flash")!
    expect(deepseek.variants.map((v: any) => v.id)).toEqual(["low", "high", "max"])
    expect(deepseek.variants[0].body).toEqual({ reasoning: { effort: "low" } })
    expect(deepseek.body).toEqual({ store: false })
    expect(deepseek.headers).toEqual({})
  })
})

describe("setupCodexEverywhere", () => {
  function fakeProviderCtx(added: Added[], transforms: number[]) {
    const editor = { add: (input: Added) => added.push(input) } as unknown as ProviderEditor
    return {
      provider: {
        transform: async (fn: (editor: ProviderEditor) => void) => {
          transforms.push(transforms.length + 1)
          fn(editor)
        },
        reload: async () => {
          transforms.push(transforms.length + 1)
        },
      },
    } as unknown as Plugin.Context
  }

  test("applies discovered models with a v2.0.5 provider context", async () => {
    const added: Added[] = []
    const transforms: number[] = []
    const fetcher = async () => Response.json({ data: [{ id: "gpt-5.6-luna" }] })
    const schedule: RefreshScheduler = () => undefined

    await setupCodexEverywhere(fakeProviderCtx(added, transforms), "test-key", fetcher, schedule)

    expect(transforms.length).toBe(1)
    expect(added).toHaveLength(1)
    expect(isValidProviderInfo(added[0].info)).toBe(true)
    expect(added[0].models.every(isValidModelInfo)).toBe(true)
    expect(String(added[0].info.id)).toBe("codex-everywhere")
    expect(added[0].models.some((model) => String(model.id) === "gpt-5.6-luna")).toBe(true)
  })
})
