import { describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"

import { applyConfig, familyOf, fetchModels } from "./codex-v1.ts"

describe("familyOf", () => {
  test("routes model ids to their family", () => {
    expect(familyOf("gpt-5.6-sol")).toBe("openai")
    expect(familyOf("claude-opus-5")).toBe("claude")
    expect(familyOf("gemini-3.7-flash")).toBe("gemini")
    expect(familyOf("grok-4.6")).toBe("grok")
  })
})

describe("fetchModels", () => {
  test("returns models from an authenticated CE response", async () => {
    const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-key")
      return Response.json({ data: [{ id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context_length: 500_000 }] })
    }
    await expect(fetchModels("test-key", fetcher)).resolves.toEqual([
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", context_length: 500_000 },
    ])
  })

  test("rejects an unsuccessful response", async () => {
    const fetcher = async () => new Response("unauthorized", { status: 401 })
    await expect(fetchModels("bad-key", fetcher)).rejects.toThrow("HTTP 401")
  })
})

describe("applyConfig", () => {
  test("writes one provider per family with the right npm package", () => {
    const config = {} as Config
    applyConfig(config, "test-key", [
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
      { id: "claude-sonnet-5" },
      { id: "gemini-3.1-pro" },
      { id: "grok-4.5" },
    ])

    const providers = (config as any).provider
    expect(providers["codex-everywhere"]).toMatchObject({
      npm: "@ai-sdk/openai",
      name: "Codex Everywhere",
      options: { baseURL: "https://codex-easy.ai/v1", apiKey: "test-key" },
    })
    expect(providers["codex-everywhere-claude"]).toMatchObject({ npm: "@ai-sdk/anthropic" })
    expect(providers["codex-everywhere-gemini"]).toMatchObject({
      npm: "@ai-sdk/google",
      options: { baseURL: "https://codex-easy.ai/v1beta" },
    })
    expect(providers["codex-everywhere-grok"]).toMatchObject({ npm: "@ai-sdk/openai" })

    expect(providers["codex-everywhere"].models["gpt-5.6-sol"]).toMatchObject({
      name: "GPT-5.6 Sol",
      tool_call: true,
      reasoning: true,
      options: { store: false },
      limit: { context: 500_000, output: 128_000 },
    })
    expect(Object.keys(providers["codex-everywhere"].models["gpt-5.6-sol"].variants)).toEqual([
      "low", "medium", "high", "xhigh", "max", "ultra",
    ])
    expect(providers["codex-everywhere-claude"].models["claude-sonnet-5"]).toMatchObject({
      limit: { context: 200_000, output: 64_000 },
    })
  })

  test("user config wins over generated entries", () => {
    const config = {
      provider: {
        "codex-everywhere": {
          options: { baseURL: "https://custom.example/v1" },
          models: { "gpt-5.6-sol": { name: "My Custom Name" } },
        },
      },
    } as unknown as Config
    applyConfig(config, "test-key", [{ id: "gpt-5.6-sol" }])

    const providers = (config as any).provider
    expect(providers["codex-everywhere"].options.baseURL).toBe("https://custom.example/v1")
    expect(providers["codex-everywhere"].options.apiKey).toBe("test-key")
    expect(providers["codex-everywhere"].models["gpt-5.6-sol"].name).toBe("My Custom Name")
  })

  test("does nothing with an empty model list", () => {
    const config = {} as Config
    applyConfig(config, "test-key", [])
    expect((config as any).provider).toBeUndefined()
  })

  test("models the CE roster dropped are filtered out", () => {
    const config = {} as Config
    applyConfig(config, "test-key", [
      { id: "gpt-5.4" },
      { id: "gpt-5.4-mini" },
      { id: "claude-sonnet-4-6" },
      { id: "gpt-5.5" },
    ])

    const providers = (config as any).provider
    expect(providers["codex-everywhere"].models["gpt-5.4"]).toBeUndefined()
    expect(providers["codex-everywhere"].models["gpt-5.4-mini"]).toBeUndefined()
    expect(providers["codex-everywhere"].models["gpt-5.5"]).toBeDefined()
    // claude-sonnet-4-6 segue ativo nos pools (dash form) — provider existe
    expect(providers["codex-everywhere-claude"].models["claude-sonnet-4-6"]).toBeDefined()
  })

  test("gemini variants use valid thinking levels only", () => {
    const config = {} as Config
    applyConfig(config, "test-key", [{ id: "gemini-3.7-flash" }])
    const variants = (config as any).provider["codex-everywhere-gemini"].models["gemini-3.7-flash"].variants
    expect(Object.keys(variants)).toEqual(["minimal", "low", "medium", "high"])
  })
})
