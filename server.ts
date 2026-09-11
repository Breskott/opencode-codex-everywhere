import { CodexEverywherePlugin } from "./codex-v1.ts"

// Entrypoint de server do pacote. O mesmo arquivo serve os dois runtimes:
//   - OpenCode 1.x: usa `server` (server plugin classico, com hooks).
//   - OpenCode 2.x: usa `setup` (plugin v2, via catalog).
// O import do v2 e dinamico de proposito: no OpenCode 1 ele nunca executa, entao
// a dependencia `@opencode-ai/plugin/v2/promise` (so usada la) nao precisa
// existir para o v1 continuar funcionando.
const CodexEverywhere = {
  id: "codex-everywhere",
  server: CodexEverywherePlugin,
  async setup(context: unknown) {
    const mod = await import("./codex-v2.ts")
    const plugin = mod.default as { setup?: (ctx: unknown) => unknown }
    if (typeof plugin.setup !== "function") {
      throw new Error("Codex Everywhere: codex-v2.ts nao exporta setup")
    }
    return plugin.setup(context)
  },
}

export default CodexEverywhere
