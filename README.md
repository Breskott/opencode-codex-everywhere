# opencode-codex-everywhere

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.x%20%7C%202.x%20(beta)-blueviolet)](https://opencode.ai)
[![Codex Everywhere](https://img.shields.io/badge/Provider-Codex%20Everywhere-00A86B)](https://codex-everywhere.com)

> 🇧🇷 **[Versão em Português (Brasil)](README.pt-BR.md)**

Plugin that wires the [Codex Everywhere](https://codex-everywhere.com) gateway (`codex-easy.ai`) into [OpenCode](https://opencode.ai) as a first-class provider — with **per-family providers** so each pool talks its native protocol, exactly like the official CE OpenCode guide.

This repo ships **three files**:

| File | OpenCode | What it is |
| --- | --- | --- |
| `codex-v1.ts` | **v1** (stable) | Codex Everywhere provider (server plugin) — used with OpenCode 1.x |
| `codex-v2.ts` | **v2** (beta) | Codex Everywhere provider (server plugin) — used with OpenCode 2.x (beta) |
| `server.ts` | **both** | Entrypoint — dispatches to the right implementation by runtime |

> You never pick a file yourself: `server.ts` exports `{ id, server, setup }` — OpenCode 1.x calls `server`, OpenCode 2.x calls `setup`.

---

## What the plugin does

Codex Everywhere exposes the same host (`codex-easy.ai`) over three protocols:

| Family | Endpoint | Models | SDK used |
| --- | --- | --- | --- |
| OpenAI | `/v1` (Responses/Chat) | `gpt-*`, `codex-*`, `o*`, others | `@ai-sdk/openai` |
| Anthropic | `/v1` (Messages) | `claude-*` | `@ai-sdk/anthropic` |
| Google | `/v1beta` (Gemini API) | `gemini-*` | `@ai-sdk/google` |
| xAI | `/v1` (Responses) | `grok-*` | `@ai-sdk/openai` |

Which models you get depends on the **pool assigned to your API key** on the site (Codex Plus/Pro, Claude Kiro/Max, Grok Heavy, Gemini Antigravity). The plugin therefore **discovers models live** instead of hardcoding a list:

1. `GET {base}/v1/models` returns the models your key's pool exposes.
2. Each model is routed to a family by its `id` (`claude-*` → Anthropic SDK, `gemini-*` → Google SDK + `/v1beta`, `grok-*` → OpenAI SDK, `gpt-*`/`codex-*` → OpenAI SDK, unknown → OpenAI-compatible).
3. Each family becomes its own provider in OpenCode:

   | Provider id | Shows up as |
   | --- | --- |
   | `codex-everywhere` | Codex Everywhere |
   | `codex-everywhere-claude` | Codex Everywhere · Claude |
   | `codex-everywhere-gemini` | Codex Everywhere · Gemini |
   | `codex-everywhere-grok` | Codex Everywhere · Grok |

   A provider only appears if your key's pool actually has models in that family — a Codex Plus key only shows `codex-everywhere`, a Claude Max key only shows `codex-everywhere-claude`, and so on.

4. Every model is enriched from a static knowledge table (source: [docs.codex-everywhere.com](https://docs.codex-everywhere.com)): context/output limits, reasoning-effort variants (`low / medium / high / xhigh / max / ultra` where supported), modalities (`text/image/pdf` input for Gemini, `image` output for `gpt-image-2`), and CE pool pricing so the TUI shows a real cost instead of `$0.00`.
5. On OpenCode 2.x the discovery re-runs every 5 minutes in the background — if you switch pools on the site (or the pool roster changes), the new models appear without restarting. On OpenCode 1.x discovery runs once at startup (with a 5-minute in-memory cache).

`store: false` is set on OpenAI-family models, per the official CE OpenCode configuration.

---

## Requirements

- OpenCode installed (1.x stable or 2.x beta)
- A Codex Everywhere account with an API key (`API Keys` → `Use Key` on the site)

---

## Installation (Windows / PowerShell)

### 1. Set `CODEX_EVERYWHERE_API_KEY` in the **User** scope (recommended)

```powershell
$env:CODEX_EVERYWHERE_API_KEY = Read-Host "CODEX_EVERYWHERE_API_KEY" -MaskInput
[Environment]::SetEnvironmentVariable("CODEX_EVERYWHERE_API_KEY", $env:CODEX_EVERYWHERE_API_KEY, "User")
```

Open a new terminal afterwards so the variable loads into fresh sessions. Verify with:

```powershell
[Environment]::GetEnvironmentVariable("CODEX_EVERYWHERE_API_KEY", "User")
```

> The plugin also accepts `CODEX_EASY_API_KEY` and `CE_API_KEY`. Check the base URL shown under `API Keys` → `Use Key` — if yours differs from `codex-easy.ai`, set `CODEX_EVERYWHERE_BASE_URL` too.

### 2. Install the plugin

The repo is an installable package (`package.json` exposes `./server` → `server.ts`, which serves OpenCode 1.x and 2.x), so OpenCode can install it straight from GitHub.

**OpenCode 1.x** — `opencode.json` / `opencode.jsonc` (global: `~/.config/opencode/opencode.jsonc`, or project root):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"]
}
```

**OpenCode 2.x (beta)** — same spec, plural `plugins` key, or the v2 CLI (validated against opencode2 `0.0.0-beta-19425`):

```bash
opencode2 plugin add "opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"
```

```json
{
  "plugins": ["opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"]
}
```

> Keep the `opencode-codex-everywhere@` prefix in the spec. Without it OpenCode cannot cache the git package and re-clones the repo on every start.

<details>
<summary>Manual install (without git)</summary>

Download `codex-v1.ts` (OpenCode 1.x) or `codex-v2.ts` (OpenCode 2.x) plus `server.ts` from this repo and drop them into `~/.config/opencode/plugins/` (Windows: `%USERPROFILE%\.config\opencode\plugins\`). If you previously copied a `codex-everywhere.ts` by hand and now switch to the git install, delete the old copy — otherwise the plugin loads twice.

</details>

### 3. Restart OpenCode

Done. The Codex Everywhere providers appear in the model picker with every model your pool exposes — correct context windows, capabilities, CE pricing, and reasoning-effort variants where supported.

---

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `CODEX_EVERYWHERE_API_KEY` | yes* | Your CE API key |
| `CODEX_EASY_API_KEY` / `CE_API_KEY` | alternative | Same key, alternate names |
| `CODEX_EVERYWHERE_BASE_URL` | no | Override the base host (default `https://codex-easy.ai`, Gemini uses `/v1beta`) |
| `CODEX_EVERYWHERE_COMPAT` | no | Set to `1` to route **all** families through `@ai-sdk/openai-compatible` (`/v1/chat/completions`) — escape hatch if a pool rejects the native SDK |

If no key is found, the plugin logs a warning and moves on — OpenCode does not crash.

---

## How the v1 and v2 implementations differ

| | `codex-v1.ts` | `codex-v2.ts` |
| --- | --- | --- |
| **OpenCode version** | 1.x (stable) | 2.x (beta) |
| **Import API** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **How providers are registered** | `config.provider[id] = {...}` via the `config` hook | `ctx.catalog.transform(catalog => ...)` |
| **SDK field** | `npm: "@ai-sdk/..."` (provider level) | `package: "aisdk:@ai-sdk/..."` (provider + per model) |
| **Discovery timing** | Inside `config` at startup, 5-min in-memory cache | Background, non-blocking, `catalog.reload()` every 5 min when the model list changes |
| **`variants` (reasoning)** | Named object `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body: { reasoning_effort } }[]` |
| **`cost` shape** | Object `{ input, output, cache_read, cache_write }` | `ModelCost[]` array `{ input, output, cache: { read, write } }` |
| **If `/models` fails** | Provider registers with an empty model list | Same; the 5-minute refresh keeps retrying |

**TL;DR:** same data and same pool logic — only the registration surface differs between runtimes.

---

## Model knowledge table

The `/models` endpoint only returns `id` (sometimes `name`). Limits, efforts, prices, and modalities come from a static table in `codex-v1.ts` / `codex-v2.ts`, maintained against [docs.codex-everywhere.com](https://docs.codex-everywhere.com/models/):

- **OpenAI** — `gpt-6-astra`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.3-codex-spark`, `codex-auto-review`, `gpt-image-2` (prices = Codex Plus Pool `0.03x`; `gpt-5.3-codex-spark` uses Pro Pool `0.05x`)
- **Anthropic** — `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-opus-4-8/4-7/4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5(-20251001)` (prices = Kiro `0.045x`; `fable-5*` uses Max Pool `0.24x` since Kiro does not carry it)
- **Google** — `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro(-preview)`, `gemini-3-flash-preview` (prices = Antigravity `0.06x`)
- **xAI** — `grok-4.6`, `grok-4.5` (prices = Heavy Pool `0.06x`)

Ids the CE roster dropped (`gpt-5.4`, `gpt-5.4-mini`) live in `REMOVED_MODELS` — if `/models` still lists one of them, the plugin filters it out so it never reaches the picker (selecting it would fail at the gateway anyway). Unknown model ids that are *not* on that list fall back to family heuristics (conservative defaults), so new models added to a pool show up before the table is updated.

### Variants per family

Variants map to whatever each gateway actually understands:

- **OpenAI / xAI / Anthropic** — `reasoning_effort` in the request body (CE translates it per family; levels `low`→`ultra`/`max` depending on the model)
- **Gemini** — `generationConfig.thinkingConfig.thinkingLevel` (`minimal`, `low`, `medium`, `high`). Verified live: `xhigh` is rejected with HTTP 400, so Gemini variants only expose the four valid levels.

> Prices shown in the TUI are the CE pool rates above. If your key sits on a different pool (e.g. Claude Max instead of Kiro), the displayed cost is an approximation — CE bills by pool, and the `/models` response does not say which pool you are on.

---

## Updating

OpenCode keeps the git clone in its package cache. To pull the latest code:

**OpenCode 2.x:**

```bash
opencode2 plugin update
```

**OpenCode 1.x:** delete the cached package and restart — OpenCode re-clones automatically:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\opencode-codex-everywhere@git+https_"
```

```bash
rm -rf ~/.cache/opencode/packages/opencode-codex-everywhere@git+https*
```

**Pin a commit — optional:**

```
opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git#<commit>
```

**Pool changes on the site need no plugin update** — the 5-minute rediscovery picks them up automatically on OpenCode 2; on OpenCode 1 restart the app.

---

## Plugin log messages

- **v1:** `client.app.log`, falling back to `console.warn`
- **v2:** `console.info` / `console.warn`

You'll see lines like:

```
[codex-everywhere] 8 modelos descobertos: gpt-6-astra, gpt-5.6-sol, ...
[codex-everywhere] descoberta inicial de modelos falhou: ...
[codex-everywhere] CODEX_EVERYWHERE_API_KEY / CODEX_EASY_API_KEY / CE_API_KEY ausente, provider nao carregado.
```

---

## Compatibility

- **OpenCode 1.x** → `server.ts` serves the v1 hook-based factory (`codex-v1.ts`).
- **OpenCode 2.x (beta)** → `server.ts` serves the v2 catalog plugin (`codex-v2.ts`).
- Manual (non-git) installs are version-specific: `codex-v1.ts` for OpenCode 1.x, `codex-v2.ts` for OpenCode 2.x. Cross-mixing does not work — the `Config`/`Plugin`/`define`/`CatalogDraft` types are incompatible.

---

## Credits

- Provider: [Codex Everywhere](https://codex-everywhere.com) — multi-pool gateway for Codex/Claude/Gemini/Grok at pool pricing ([docs](https://docs.codex-everywhere.com)).
- Client: [OpenCode](https://opencode.ai) — open-source AI coding agent.
- Maintained by **Victor Brescott** ([@Breskott](https://github.com/Breskott)).
- License: MIT — use freely.
