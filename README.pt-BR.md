# opencode-codex-everywhere

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-1.x%20%7C%202.x%20(beta)-blueviolet)](https://opencode.ai)
[![Codex Everywhere](https://img.shields.io/badge/Provider-Codex%20Everywhere-00A86B)](https://codex-everywhere.com)

> 🇺🇸 **[English version](README.md)**

Plugin que liga o gateway [Codex Everywhere](https://codex-everywhere.com) (`codex-easy.ai`) ao [OpenCode](https://opencode.ai) como provider de primeira classe — com **um provider por família** para que cada pool fale o protocolo nativo, igual ao guia oficial do CE para OpenCode.

O repo tem **três arquivos**:

| Arquivo | OpenCode | O que é |
| --- | --- | --- |
| `codex-v1.ts` | **v1** (estável) | Provider Codex Everywhere (server plugin) — usado no OpenCode 1.x |
| `codex-v2.ts` | **v2** (beta) | Provider Codex Everywhere (server plugin) — usado no OpenCode 2.x (beta) |
| `server.ts` | **ambos** | Entrypoint — escolhe a implementação certa por runtime |

> Você nunca escolhe o arquivo: o `server.ts` exporta `{ id, server, setup }` — o OpenCode 1.x chama `server`, o OpenCode 2.x chama `setup`.

---

## O que o plugin faz

A Codex Everywhere expõe o mesmo host (`codex-easy.ai`) em três protocolos:

| Família | Endpoint | Modelos | SDK usado |
| --- | --- | --- | --- |
| OpenAI | `/v1` (Responses/Chat) | `gpt-*`, `codex-*`, `o*`, outros | `@ai-sdk/openai` |
| Anthropic | `/v1` (Messages) | `claude-*` | `@ai-sdk/anthropic` |
| Google | `/v1beta` (API Gemini) | `gemini-*` | `@ai-sdk/google` |
| xAI | `/v1` (Responses) | `grok-*` | `@ai-sdk/openai` |
| DeepSeek | `/v1` (Responses) | `deepseek-*` | `@ai-sdk/openai` |

Quais modelos aparecem depende do **pool atribuído à sua API key** no site (Codex Plus/Pro, Claude Kiro/Max, Grok Heavy, Gemini Antigravity, DeepSeek). Por isso o plugin **descobre os modelos ao vivo** em vez de fixar uma lista:

1. `GET {base}/v1/models` devolve os modelos que o pool da sua key expõe.
2. Cada modelo é roteado para uma família pelo `id` (`claude-*` → SDK Anthropic, `gemini-*` → SDK Google + `/v1beta`, `grok-*` → SDK OpenAI, `deepseek-*` → SDK OpenAI via Responses API, `gpt-*`/`codex-*` → SDK OpenAI, desconhecido → OpenAI-compatible).
3. Cada família vira um provider separado no OpenCode:

   | Provider id | Aparece como |
   | --- | --- |
   | `codex-everywhere` | Codex Everywhere |
   | `codex-everywhere-claude` | Codex Everywhere · Claude |
   | `codex-everywhere-gemini` | Codex Everywhere · Gemini |
   | `codex-everywhere-grok` | Codex Everywhere · Grok |
   | `codex-everywhere-deepseek` | Codex Everywhere · DeepSeek |

   O provider só aparece se o pool da sua key tiver modelos daquela família — uma key Codex Plus só mostra `codex-everywhere`, uma key Claude Max só mostra `codex-everywhere-claude`, e assim por diante.

4. Cada modelo é enriquecido por uma tabela de conhecimento estática (fonte: [docs.codex-everywhere.com](https://docs.codex-everywhere.com)): limites de contexto/saída, variantes de esforço (`low / medium / high / xhigh / max / ultra` onde suportado), modalidades (`text/image/pdf` na entrada pro Gemini, saída `image` pro `gpt-image-2`) e preços dos pools do CE para a TUI mostrar custo real em vez de `$0.00`.
5. No OpenCode 2.x a descoberta roda de novo a cada 5 minutos em background — se você trocar de pool no site (ou o pool mudar o catálogo), os modelos novos aparecem sem reiniciar. No OpenCode 1.x a descoberta roda uma vez no startup (com cache em memória de 5 minutos).

`store: false` é aplicado nos modelos da família OpenAI, conforme a configuração oficial do CE para OpenCode.

---

## Requisitos

- OpenCode instalado (1.x estável ou 2.x beta)
- Conta na Codex Everywhere com API key (`API Keys` → `Use Key` no site)

---

## Instalação (Windows / PowerShell)

### 1. Defina `CODEX_EVERYWHERE_API_KEY` no escopo de **Usuário** (recomendado)

```powershell
$env:CODEX_EVERYWHERE_API_KEY = Read-Host "CODEX_EVERYWHERE_API_KEY" -MaskInput
[Environment]::SetEnvironmentVariable("CODEX_EVERYWHERE_API_KEY", $env:CODEX_EVERYWHERE_API_KEY, "User")
```

Abra um terminal novo depois, para a variável carregar em sessões novas. Verifique com:

```powershell
[Environment]::GetEnvironmentVariable("CODEX_EVERYWHERE_API_KEY", "User")
```

> O plugin também aceita `CODEX_EASY_API_KEY` e `CE_API_KEY`. Confira a base URL em `API Keys` → `Use Key` — se a sua for diferente de `codex-easy.ai`, defina também `CODEX_EVERYWHERE_BASE_URL`.

### 2. Instale o plugin

O repo é um pacote instalável (`package.json` expõe `./server` → `server.ts`, que serve OpenCode 1.x e 2.x), então o OpenCode instala direto do GitHub.

**OpenCode 1.x** — `opencode.json` / `opencode.jsonc` (global: `~/.config/opencode/opencode.jsonc`, ou raiz do projeto):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"]
}
```

**OpenCode 2.x (beta)** — mesma spec, chave `plugins` no plural, ou a CLI do v2 (validado com opencode2 `0.0.0-beta-19425`):

```bash
opencode2 plugin add "opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"
```

```json
{
  "plugins": ["opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git"]
}
```

> Mantenha o prefixo `opencode-codex-everywhere@` na spec. Sem ele o OpenCode não consegue cachear o pacote git e re-clona o repo a cada start.

<details>
<summary>Instalação manual (sem git)</summary>

Baixe `codex-v1.ts` (OpenCode 1.x) ou `codex-v2.ts` (OpenCode 2.x) junto com o `server.ts` e jogue em `~/.config/opencode/plugins/` (Windows: `%USERPROFILE%\.config\opencode\plugins\`). Se você já tinha um `codex-everywhere.ts` copiado à mão e agora migrou pro git, apague a cópia antiga — senão o plugin carrega duas vezes.

</details>

### 3. Reinicie o OpenCode

Pronto. Os providers Codex Everywhere aparecem no seletor de modelos com todos os modelos do seu pool — contexto correto, capabilities, preço do CE e variantes de esforço onde houver.

---

## Variáveis de ambiente

| Variável | Obrigatória | O que faz |
| --- | --- | --- |
| `CODEX_EVERYWHERE_API_KEY` | sim* | Sua API key do CE |
| `CODEX_EASY_API_KEY` / `CE_API_KEY` | alternativa | Mesma key, nomes alternativos |
| `CODEX_EVERYWHERE_BASE_URL` | não | Sobrescreve o host base (padrão `https://codex-easy.ai`, Gemini usa `/v1beta`) |
| `CODEX_EVERYWHERE_COMPAT` | não | `1` força `@ai-sdk/openai-compatible` (`/v1/chat/completions`) em **todas** as famílias — rota de fuga se um pool rejeitar o SDK nativo. No DeepSeek isso abre mão de tools multi-turno: o chat/completions exige devolver o `reasoning_content` ou retorna HTTP 400 |

Sem key o plugin só loga um aviso e segue — o OpenCode não quebra.

---

## Diferenças entre v1 e v2

| | `codex-v1.ts` | `codex-v2.ts` |
| --- | --- | --- |
| **Versão do OpenCode** | 1.x (estável) | 2.x (beta) |
| **API importada** | `import type { Config, Plugin } from "@opencode-ai/plugin"` | `import { define, type CatalogDraft } from "@opencode-ai/plugin/v2/promise"` |
| **Como os providers registram** | `config.provider[id] = {...}` pelo hook `config` | `ctx.catalog.transform(catalog => ...)` |
| **Campo do SDK** | `npm: "@ai-sdk/..."` (por provider) | `package: "aisdk:@ai-sdk/..."` (provider + por modelo) |
| **Momento da descoberta** | Dentro do `config` no startup, cache em memória de 5 min | Background, sem bloquear, `catalog.reload()` a cada 5 min quando a lista muda |
| **`variants` (esforço)** | Objeto nomeado `{ low: { reasoningEffort: "low" }, ... }` | Array `{ id, headers: {}, body }` — `reasoning_effort` (OpenAI/xAI/Anthropic), `reasoning.effort` (DeepSeek), `generationConfig.thinkingConfig.thinkingLevel` (Gemini) |
| **Formato de `cost`** | Objeto `{ input, output, cache_read, cache_write }` | Array `ModelCost[]` `{ input, output, cache: { read, write } }` |
| **Se o `/models` falhar** | Provider sobe com lista vazia | Igual; o refresh de 5 min continua tentando |

**TL;DR:** mesmos dados e mesma lógica de pool — só muda a superfície de registro entre os runtimes.

---

## Tabela de conhecimento de modelos

O `/models` só devolve `id` (às vezes `name`). Limites, esforços, preços e modalidades vêm de uma tabela estática em `codex-v1.ts` / `codex-v2.ts`, mantida contra [docs.codex-everywhere.com](https://docs.codex-everywhere.com/models/):

- **OpenAI** — `gpt-6-astra`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.3-codex-spark`, `codex-auto-review`, `gpt-image-2` (preços = Codex Plus Pool `0.03x`; `gpt-5.3-codex-spark` usa Pro Pool `0.05x`)
- **Anthropic** — `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-sonnet-5`, `claude-opus-4-8/4-7/4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5(-20251001)` (preços = Kiro `0.045x`; `fable-5*` usa Max Pool `0.24x` porque o Kiro não tem)
- **Google** — `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.1-pro(-preview)`, `gemini-3-flash-preview` (preços = Antigravity `0.06x`)
- **xAI** — `grok-4.6`, `grok-4.5` (preços = Heavy Pool `0.06x`)
- **DeepSeek** — `deepseek-flash` (= DeepSeek-V4.1-Flash, multimodal nativo, thinking mode) e `deepseek-v4-pro` (= V4-Pro-0813, texto puro), mais os aliases legados `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash-expires-on-0910` e `deepseek-v4-pro-0813` (aposentados pela DeepSeek mas ainda roteados por compatibilidade, mesma tarifa). Limites: **1M de contexto / 384K de saída**. Preços = oficiais da DeepSeek (off-peak; pico custa 2x) — o CE ainda não publicou o preço do pool DeepSeek, então a TUI mostra a referência oficial.

Ids que o CE tirou do roster (`gpt-5.4`, `gpt-5.4-mini`) ficam em `REMOVED_MODELS` — se o `/models` ainda listar um deles, o plugin filtra pra não chegar no seletor (selecionar daria erro no gateway de qualquer jeito). Ids desconhecidos que **não** estão nessa lista caem na heurística da família (defaults conservadores), então modelos novos num pool aparecem antes da tabela ser atualizada.

### Variants por família

Cada variant vira o que o gateway realmente entende:

- **OpenAI / xAI / Anthropic** — `reasoning_effort` no body da request (o CE traduz por família; níveis `low`→`ultra`/`max` conforme o modelo)
- **DeepSeek** — `reasoning.effort` aninhado na Responses API (`low`, `high`, `max`). Verificado ao vivo: `reasoning_effort` de topo é **ignorado** pela rota Responses do CE, e a rota chat/completions exige devolver o `reasoning_content` em todo turno com tools (HTTP 400 caso contrário) — por isso essa família usa Responses
- **Gemini** — `generationConfig.thinkingConfig.thinkingLevel` (`minimal`, `low`, `medium`, `high`). Validado ao vivo: `xhigh` é rejeitado com HTTP 400, então as variants do Gemini só expõem os quatro níveis válidos.

> Os preços exibidos na TUI são as taxas dos pools CE acima. Se a sua key estiver num pool diferente (ex.: Claude Max em vez de Kiro), o custo mostrado é uma aproximação — o CE cobra por pool e o `/models` não informa em qual você está.

---

## Atualizando

O OpenCode guarda o clone git no cache de pacotes. Para puxar o código mais recente:

**OpenCode 2.x:**

```bash
opencode2 plugin update
```

**OpenCode 1.x:** apague o pacote cacheado e reinicie — o OpenCode re-clona sozinho:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.cache\opencode\packages\opencode-codex-everywhere@git+https_"
```

```bash
rm -rf ~/.cache/opencode/packages/opencode-codex-everywhere@git+https*
```

**Fixar um commit — opcional:**

```
opencode-codex-everywhere@git+https://github.com/Breskott/opencode-codex-everywhere.git#<commit>
```

**Mudança de pool no site não precisa de update do plugin** — a redescoberta de 5 minutos pega sozinha no OpenCode 2; no OpenCode 1 reinicie o app.

---

## Mensagens de log do plugin

- **v1:** `client.app.log`, com fallback pra `console.warn`
- **v2:** `console.info` / `console.warn`

Linhas típicas:

```
[codex-everywhere] 8 modelos descobertos: gpt-6-astra, gpt-5.6-sol, ...
[codex-everywhere] descoberta inicial de modelos falhou: ...
[codex-everywhere] CODEX_EVERYWHERE_API_KEY / CODEX_EASY_API_KEY / CE_API_KEY ausente, provider nao carregado.
```

---

## Compatibilidade

- **OpenCode 1.x** → `server.ts` serve a factory v1 por hooks (`codex-v1.ts`).
- **OpenCode 2.x (beta)** → `server.ts` serve o plugin v2 de catálogo (`codex-v2.ts`).
- Instalação manual é específica de versão: `codex-v1.ts` no OpenCode 1.x, `codex-v2.ts` no OpenCode 2.x. Misturar não funciona — os tipos `Config`/`Plugin`/`define`/`CatalogDraft` são incompatíveis.

---

## Créditos

- Provider: [Codex Everywhere](https://codex-everywhere.com) — gateway multi-pool para Codex/Claude/Gemini/Grok/DeepSeek com preço de pool ([docs](https://docs.codex-everywhere.com)).
- Cliente: [OpenCode](https://opencode.ai) — agente de código aberto com IA.
- Mantido por **Victor Brescott** ([@Breskott](https://github.com/Breskott)).
- Licença: MIT — use à vontade.
