# Tutorial: The !lurk Command, Part 2 — Routing to the LLM Bot, Prompts & Personalities

In [Part 1](./lurk-command.md), you built a `!lurk` command that replied with one of two **static** candidate responses chosen at random by the Event Router. That works, but every lurker gets one of the same two lines forever.

In this Part 2, we will make `!lurk` feel alive by handing the response off to the **`llm-bot`** service. Along the way you will learn three new concepts:

- **Routing slips** that send an event to another service before egress.
- **Prompt annotations**, which tell the `llm-bot` *what* to generate.
- **Personalities**, which tell the `llm-bot` *how* to sound.

## Prerequisites

- You have completed [Tutorial: Creating the !lurk Command](./lurk-command.md) and your `tutorial-lurk` rule is loaded.
- Platform is running locally (see [Quickstart](../getting-started/quickstart.md)).
- You have a basic understanding of [Event Router Rules](../concepts/event-router-rules.md).

> Where we left off: At the end of Part 1, our rule produced two static `candidates`, picked one at random, set the stage to `reaction`, and used an **empty routing slip** so the platform delivered the message straight to egress. We are going to change exactly that part.

## Step 1: Route the Event to the LLM Bot

So far the Event Router has been writing the response itself. Instead, we want the router to **route** the event to the `llm-bot`, which will generate the reply for us.

Routing is controlled by the `slip` array inside `routing`. Each entry is a `RoutingStep` that names the next Pub/Sub topic the event should visit. The `llm-bot` listens on the `internal.llmbot.v1` topic, so we add a single step pointing there.

### 1a. Add the LLM Bot to the routing slip and add a prompt annotation

Open your `my-lurk-rule.json` from Part 1 and replace its contents with the rule below. There are two important changes:

1. The static `candidates` / `randomCandidate` enrichments are **gone**. The `llm-bot` will produce the response, so the Event Router no longer needs canned text.
2. We added a **prompt annotation** under `enrichments.annotations`. A prompt annotation (`"kind": "prompt"`) is the instruction the `llm-bot` uses to generate text.

```json
{
  "id": "tutorial-lurk",
  "enabled": true,
  "priority": 100,
  "description": "Tutorial Lurk Command (Part 2 - LLM powered)",
  "logic": "{\"and\": [{\"===\": [{\"var\": \"routing.stage\"}, \"contextualization\"]}, {\"text_contains\": [{\"var\": \"message.text\"}, \"!lurk \", true]}]}",
  "enrichments": {
    "annotations": [
      {
        "id": "a1",
        "kind": "prompt",
        "value": "Generate a random lurk response for ${user.displayName}"
      }
    ]
  },
  "routing": {
    "stage": "reaction",
    "slip": [
      {
        "id": "llm-bot",
        "nextTopic": "internal.llmbot.v1"
      }
    ]
  }
}
```

### What changed compared to Part 1?

- **`enrichments`**: We removed the `candidates` array and `randomCandidate` flag. In their place is a single **`prompt`** annotation. The `value`, `Generate a random lurk response for ${user.displayName}`, is the instruction sent to the `llm-bot`. The `${user.displayName}` placeholder is filled in from the event (the `auth` service resolved it during the `contextualization` stage, just like in Part 1).
- **`routing.slip`**: Previously empty. Now it contains one `RoutingStep` that forwards the event to the `llm-bot` on the `internal.llmbot.v1` topic. After the bot finishes, the platform's default routing carries the enriched event on to egress for delivery.

> **Why remove the candidates?** Candidates and a prompt are two competing ways to produce a reply. If you leave the static candidates in, the router may deliver one of them before the `llm-bot` ever runs. Removing them makes the `llm-bot` the single source of the response.

### 1b. Load the updated rule

Load the updated rule into the database. Because the `id` is still `tutorial-lurk`, this overwrites the existing rule:

**PostgreSQL (Default)**:
```bash
# Update existing rule with SQL
psql $DATABASE_URL -c "UPDATE routing_rules SET enrichments = ..., routing = ... WHERE id = 'tutorial-lurk'"

# Or use a migration file - see documentation/guides/seed-data.md
```

**Firestore (Legacy)**:
```bash
npm run firestore:upsert -- configs/routingRules/rules @my-lurk-rule.json
```

### 1c. Test with the default personality

At this point we have **not** configured any personality, so the `llm-bot` uses its built-in **default personality**. That is exactly what we want for a first test — it confirms routing and the prompt work before we add any styling.

1.  Start a chat session:
    ```bash
    npm run brat -- chat
    ```
2.  Type `!lurk` and press Enter.
3.  Instead of one of the two fixed lines from Part 1, you should now see a freshly **generated** lurk response addressed to your display name.

Run it a few times — each response should vary, because the `llm-bot` is generating them on the fly rather than picking from a fixed list.

### 1d. Which model and provider answered?

You never chose a model anywhere — so where did that response come from? Out of the box, the platform assumes **OpenAI** as the LLM provider. For the `llm-bot` to generate anything, its environment must include a valid **`OPENAI_API_KEY`** secret. The model it uses is controlled by the `OPENAI_MODEL` environment variable; the `llm-bot` falls back to `gpt-4o` if it is unset, and the local/deployed environments in this repo ship with `gpt-4.1-mini`.

In other words, the reply you just saw came from OpenAI's configured default model. That is the platform-wide default, and unless you override it (we will do that in [Step 2e](#2e-optional-change-the-model-or-provider-per-personality)), **every** personality — including the default one — uses it.

> **Got an error instead of a response?** The most common cause is a missing or invalid `OPENAI_API_KEY`. See [LLM Bot Service → Configuration](../services/llm-bot.md#configuration) for the full list of model and provider settings.

> **No response, or the old static lines?** See [Troubleshooting](#troubleshooting) below.

## Step 2: Add a Personality

The default personality is generic. To give `!lurk` a consistent voice, we attach a **personality**. Personalities tell the `llm-bot` *how* to speak (tone, style, persona), while the prompt tells it *what* to say.

### 2a. Understand the personalities collection

Personalities live in the database **`personalities`** collection/table. When the `llm-bot` receives an event carrying a `personality` annotation, it looks the personality up by name and folds its `text` into the system prompt. (For the full reference, see [LLM Bot – Modular Personality Injection](../llm-bot-personality.md).)

A personality document looks like this:

| Field | Type | Description |
| --- | --- | --- |
| `name` | string | The lookup key referenced from a rule's personality annotation. |
| `text` | string | The instructions injected into the `llm-bot` system prompt. |
| `status` | `active` \| `inactive` \| `archived` | Only `active` documents are selected. |
| `version` | number | Monotonic; the **highest** active version wins. |
| `tags` | string[] | Optional labels for organization. |
| `model` | string | **Optional.** Overrides the model for this personality (otherwise the platform default from `OPENAI_MODEL`). |
| `platform` | string | **Optional.** Overrides the LLM provider for this personality (defaults to `openai`). |
| `createdAt` / `updatedAt` | ISO‑8601 string | Timestamps. |

When resolving a personality, the `llm-bot` queries the `personalities` collection/table for `name == <annotation value>` and `status == "active"`, ordered by `version` descending, and uses the latest match. This is why bumping `version` lets you publish a new revision without deleting the old one.

### 2b. Add a personality document

Create a file named `my-lurk-personality.json`:

```json
{
  "name": "lurk-master",
  "text": "You are the Lurk Master: a warm, slightly mysterious narrator who welcomes viewers into the shadows. Keep responses to a single short sentence, playful and inviting, and never break character.",
  "status": "active",
  "tags": ["tutorial", "lurk"],
  "version": 1,
  "createdAt": "2026-06-22T17:09:00Z",
  "updatedAt": "2026-06-22T17:09:00Z"
}
```

Load it into the `personalities` collection/table:

**PostgreSQL (Default)**:
```bash
psql $DATABASE_URL -c "INSERT INTO personalities (id, name, text, status, tags, version, created_at, updated_at) VALUES ('lurk-master', 'lurk-master', 'You are the Lurk Master...', 'active', ARRAY['tutorial', 'lurk'], 1, '2026-06-22T17:09:00Z', '2026-06-22T17:09:00Z')"
```

**Firestore (Legacy)**:
```bash
npm run firestore:upsert -- personalities @my-lurk-personality.json --id lurk-master
```

> A ready-to-use copy of this document is also available at [`documentation/reference/setup/lurk_personality.json`](../reference/setup/lurk_personality.json).

### 2c. Add a personality attribution to the !lurk rule

Now update `my-lurk-rule.json` to **attribute** this personality to the command. We do that with a second annotation of `"kind": "personality"` whose `value` is the personality's `name`:

```json
{
  "id": "tutorial-lurk",
  "enabled": true,
  "priority": 100,
  "description": "Tutorial Lurk Command (Part 2 - LLM powered)",
  "logic": "{\"and\": [{\"===\": [{\"var\": \"routing.stage\"}, \"contextualization\"]}, {\"text_contains\": [{\"var\": \"message.text\"}, \"!lurk \", true]}]}",
  "enrichments": {
    "annotations": [
      {
        "id": "a1",
        "kind": "prompt",
        "value": "Generate a random lurk response for ${user.displayName}"
      },
      {
        "id": "a2",
        "kind": "personality",
        "value": "lurk-master"
      }
    ]
  },
  "routing": {
    "stage": "reaction",
    "slip": [
      {
        "id": "llm-bot",
        "nextTopic": "internal.llmbot.v1"
      }
    ]
  }
}
```

The only change from Step 1 is the new `a2` annotation. Reload the rule into the database:

**PostgreSQL (Default)**:
```bash
psql $DATABASE_URL -c "UPDATE routing_rules SET enrichments = ... WHERE id = 'tutorial-lurk'"
```

**Firestore (Legacy)**:
```bash
npm run firestore:upsert -- configs/routingRules/rules @my-lurk-rule.json
```

### 2d. Test with the personality in place

Start a chat session again and type `!lurk`:

```bash
npm run brat -- chat
```

The response should now carry the **Lurk Master** voice defined in your personality `text` — warm, mysterious, and one short sentence — while still being generated fresh from your prompt. Try editing the personality `text`, bumping its `version`, re-upserting it, and watching the tone change without touching the rule at all.

### 2e. (Optional) Change the model or provider per personality

Back in [Step 1d](#1d-which-model-and-provider-answered) we saw that the platform defaults to OpenAI and a single configured model for *every* personality. You can override both **per personality** — without touching any environment variable or rule — using the two optional fields from the schema:

- **`model`** — the model name to use when this personality is active (e.g., `gpt-4o`, `gpt-4.1-mini`).
- **`platform`** — the LLM provider to use (defaults to `openai`).

When the `llm-bot` resolves a personality that sets either field, it uses those values for that request instead of the platform defaults. For example, to pin the Lurk Master to a specific model, add `model` (and optionally `platform`) and bump the `version`:

```json
{
  "name": "lurk-master",
  "text": "You are the Lurk Master: a warm, slightly mysterious narrator who welcomes viewers into the shadows. Keep responses to a single short sentence, playful and inviting, and never break character.",
  "status": "active",
  "tags": ["tutorial", "lurk"],
  "version": 2,
  "model": "gpt-4o",
  "platform": "openai",
  "createdAt": "2026-06-22T17:09:00Z",
  "updatedAt": "2026-06-22T17:30:00Z"
}
```

Update the personality in the database and the next `!lurk` runs on the model you specified — no rule change required:

**PostgreSQL (Default)**:
```bash
psql $DATABASE_URL -c "UPDATE personalities SET model = 'gpt-4o', platform = 'openai', version = 2, updated_at = '2026-06-22T17:30:00Z' WHERE id = 'lurk-master'"
```

**Firestore (Legacy)**:
```bash
npm run firestore:upsert -- personalities @my-lurk-personality.json --id lurk-master
```

Omit `model` and `platform` to fall back to the platform default. Whichever provider you target must still be configured and credentialed (for `openai`, that means a valid `OPENAI_API_KEY` in the `llm-bot` environment).

## Troubleshooting

- **Still seeing the two static lines from Part 1?** Make sure you removed the `candidates`/`randomCandidate` enrichments and reloaded the rule. Check `npm run local:logs` for `rule_loader.snapshot_applied` to confirm the new rule loaded.
- **No response at all?** Run `npm run brat -- doctor` to confirm the services (including `llm-bot`) are healthy and connected to the database.
- **Response ignores the personality?** Confirm the personality `status` is `active` and the annotation `value` matches the document `name` exactly. The `llm-bot` logs `personality.resolve.miss` when a name cannot be found and `personality.resolve.inactive` when the document is not active.
- **Personality feature disabled?** The `llm-bot` honors a `PERSONALITY_ENABLED` flag; if it is set to `false`, only the base system prompt is used. See [LLM Bot – Modular Personality Injection](../llm-bot-personality.md).
- **Errors mentioning the model or API key?** The platform defaults to OpenAI, so the `llm-bot` needs a valid `OPENAI_API_KEY`. If you set a personality `model`, make sure it is a model your key/provider can serve. See [LLM Bot Service → Configuration](../services/llm-bot.md#configuration).

## Summary

You upgraded `!lurk` from static, router-authored text to a fully **LLM-generated** response:

1. You added the `llm-bot` to the **routing slip** so the event is enriched before egress.
2. You replaced the static candidates with a **prompt annotation** describing what to generate.
3. You tested with the **default personality**, then introduced the **`personalities`** collection/table and attributed a **personality** to the command for a consistent voice.
4. You learned that the platform defaults to **OpenAI** (requiring an `OPENAI_API_KEY`) with a model set by `OPENAI_MODEL`, and that any personality can override the `model` and `platform` for itself.

From here you can experiment with multiple personalities, richer prompts that reference more event fields, per-personality model/provider tuning, or adding `contextualization`-stage steps before the `llm-bot` runs.
