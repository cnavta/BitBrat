# Evaluator's Guide: BitBrat as an AI Agent Framework

This guide is for **prospective adopters and technical evaluators** who want to understand, try, and
extend BitBrat quickly — especially as an **AI agent framework** rather than only a streaming bot.

## Explore interactively with `brat code` (~2 minutes)

The fastest way to understand BitBrat is to let it explain itself:

1. **Install a coding agent** (if not already installed):
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Launch with context**:
   ```bash
   npm install
   npm run brat -- code
   ```

3. **On first run**, BitBrat will automatically prompt: "Explain the BitBrat project to me" — providing an interactive architecture tour with the full codebase as reference.

This gives you a guided walkthrough of the agent loop, dual execution paths, and MCP tool integration before reading static docs.

## Try the full platform in ~5 minutes (no OpenAI key, no GCP)

You can also exercise the full agent loop locally with a free local model:

1. **Install [Ollama](https://ollama.com)** and pull a small model:
   ```bash
   ollama pull llama3 && ollama serve   # serves http://localhost:11434
   ```
2. **Clone and install:**
   ```bash
   git clone https://github.com/cnavta/BitBrat.git
   cd BitBrat
   npm install
   ```
3. **Select the local provider** (no API key needed):
   ```bash
   export LLM_PROVIDER=ollama
   export LLM_MODEL=llama3
   export LLM_BASE_URL=http://localhost:11434   # http://host.docker.internal:11434 from Docker
   ```
4. **Initialize, run, and chat** (you can leave the OpenAI key blank during setup):
   ```bash
   npm run brat -- setup
   npm run local
   npm run brat -- chat
   ```

Send a message in the chat: the `event-router` plans a route, `llm-bot` reasons with your local model,
and the reply returns through `ingress-egress` — a complete perceive → plan → act → observe loop.

See the README [Offline / Local-LLM Quickstart](../../README.md#offline--local-llm-quickstart-no-openai-key)
for more detail, or the [full Quickstart](./quickstart.md).

## What to read first

| If you want to understand… | Read |
|---|---|
| The agent story / "where is the agent?" | README [What is BitBrat?](../../README.md#what-is-bitbrat) |
| The end-to-end event lifecycle | [Platform Flow Overview](../concepts/platform-flow.md) |
| How decisions/routing work | [Event Router & Rules](../concepts/event-router-rules.md) |
| The canonical system definition | [`architecture.yaml`](../../architecture.yaml) (validate with `npm run brat -- config validate`) |
| How to extend it | `architecture.yaml` `extension_points:` + the [`brat` CLI](../tools/brat.md#service-management) |
| Agent-assisted contribution workflow | [AGENTS.md](../../AGENTS.md) |

## How the pieces form an agent

BitBrat decomposes the classic agent loop into independent, message-passing services:

- **Perceive** — `ingress-egress` and `api-gateway` normalize external events into an `Envelope v1`.
- **Plan** — `event-router` matches [JsonLogic](https://jsonlogic.com/) rules and attaches a **routing
  slip** (the plan) that travels with the message. `auth` enriches with identity/roles.
- **Act (Dual Paths)** — Two execution mechanisms:
  - **Deterministic**: `reflex` pattern-matches and executes MCP tools in <150ms (no LLM overhead)
  - **LLM-Based**: `llm-bot` / `query-analyzer` reason and select tools via full AI inference (2-10s)
  - Both paths call tools via MCP servers behind `tool-gateway`
- **Observe / Memory** — `state-engine`, `disposition-service`, and `persistence` store state and
  history in PostgreSQL (default) or Firestore (legacy).

**Key Insight**: The dual execution paths let you choose speed/cost vs. reasoning capability per event type.

The same primitives apply beyond streaming (chat-ops, webhooks, support triage, telephony): swap the
`ingress-egress` adapters and the Event Router rules, and reuse the reasoning/tool/memory planes.

## Evaluation checklist

- [ ] Used `brat code` to get an interactive platform explanation.
- [ ] Cloned via the correct URL and `npm install` succeeds.
- [ ] `npm run brat -- config validate` reports the config valid against the shipped schema.
- [ ] `npm run build` and `npm test` pass.
- [ ] The offline (Ollama) chat loop produces a response with no paid API key.
- [ ] You can locate the agent loop, extension points, and collaboration protocol from the README.
