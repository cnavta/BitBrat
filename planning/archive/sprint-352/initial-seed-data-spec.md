# Initial Seed Data Specification

This document defines the canonical seed data that will be populated when creating a new context.

**References**:
- Story S6.1: Create Persistence-Agnostic Seed Data Model
- tools/brat/src/cli/setup.ts (getInitialRoutingRules)
- Staging database (for reflex examples)

---

## Routing Rules

### 1. Initial Contextualization
**ID**: `initial-contextualization`
**Enabled**: `true`
**Priority**: `100`
**Description**: Route initial events to auth, reflex, query-analysis, and event-router for contextualization stage

**Logic**:
```json
{ "==": [ { "var": "routing.stage" }, "initial" ] }
```

**Routing Slip**:
- auth → `internal.auth.v1`
- reflex → `internal.reflex.v1`
- query-analysis → `internal.query.analysis.v1`
- event-router → `internal.enriched.v1`

**Stage**: `contextualization`

---

### 2. Bot Mention Reaction
**ID**: `contextualization-reaction-bot`
**Enabled**: `true`
**Priority**: `50`
**Description**: Route bot mentions to LLM bot

**Logic**:
```json
{
  "and": [
    { "==": [ { "var": "routing.stage" }, "contextualization" ] },
    { "text_contains": [ { "var": "message.text" }, "{botName}", true ] }
  ]
}
```

**Routing Slip**:
- llm-bot → `internal.llmbot.v1`

**Stage**: `reaction`

**Enrichments**:
```json
{
  "annotations": [
    {
      "id": "a1",
      "kind": "personality",
      "value": "{botName}"
    },
    {
      "id": "a2",
      "kind": "prompt",
      "value": "Create an appropriate answer to user {{username}}'s latest message."
    }
  ]
}
```

---

### 3. Adventure Command
**ID**: `contextualization-reaction-adventure`
**Enabled**: `true`
**Priority**: `40`
**Description**: Route !adventure commands to story engine and LLM bot

**Logic**:
```json
{
  "and": [
    { "==": [ { "var": "routing.stage" }, "contextualization" ] },
    { "re_test": [ { "var": "message.text" }, "^!adventure", "i" ] }
  ]
}
```

**Routing Slip**:
- story-engine → `internal.story.enrich.v1`
- llm-bot → `internal.llmbot.v1`

**Stage**: `reaction`

**Enrichments**:
```json
{
  "annotations": [
    {
      "id": "a1",
      "kind": "personality",
      "value": "{botName}"
    },
    {
      "id": "a2",
      "kind": "prompt",
      "value": "The user is in adventure mode, please react accordingly"
    }
  ]
}
```

---

### 4. Chuck Norris Joke
**ID**: `contextualization-reaction-cnj`
**Enabled**: `true`
**Priority**: `100`
**Description**: Create a Chuck Norris Joke for the user

**Logic**:
```json
{
  "and": [
    { "==": [ { "var": "routing.stage" }, "contextualization" ] },
    { "re_test": [ { "var": "message.text" }, "^cnj", "i" ] }
  ]
}
```

**Routing Slip**:
- llm-bot → `internal.llmbot.v1`

**Stage**: `reaction`

**Enrichments**:
```json
{
  "annotations": [
    {
      "id": "a1",
      "kind": "prompt",
      "value": "Generate one original Chuck Norris joke. Do not reuse classic structures like roundhouse kicks, counting to infinity, or glaring-atoms tropes. Avoid tech-centric humor unless it's genuinely unexpected. Explore any domain—nature, mythology, sports, cooking, art, everyday life, or the absurd. Use a fresh comedic structure and keep it under 20 words with a surprising punchline."
    }
  ]
}
```

---

## Reflexes

### 1. Ping Reflex
**ID**: `ping-reflex`
**Enabled**: `true`
**Priority**: `100`
**Description**: Simple ping/pong reflex for testing system responsiveness

**Trigger Pattern**: `!ping`
**Match Type**: `exact`
**Case Sensitive**: `false`

**Response Template**: `pong!`
**Response Type**: `text`

**PostgreSQL Schema**:
```sql
INSERT INTO reflexes (
  id,
  trigger_pattern,
  match_type,
  case_sensitive,
  response_template,
  response_type,
  enabled,
  priority,
  description,
  created_at,
  updated_at
) VALUES (
  'ping-reflex',
  '!ping',
  'exact',
  false,
  'pong!',
  'text',
  true,
  100,
  'Simple ping/pong reflex for testing system responsiveness',
  NOW(),
  NOW()
);
```

**Firestore Schema**:
```javascript
{
  id: 'ping-reflex',
  trigger_pattern: '!ping',
  match_type: 'exact',
  case_sensitive: false,
  response_template: 'pong!',
  response_type: 'text',
  enabled: true,
  priority: 100,
  description: 'Simple ping/pong reflex for testing system responsiveness',
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
}
```

---

## Personalities

### 1. Default Bot Personality
**ID**: `{botName.toLowerCase()}`
**Name**: `{botName}`
**Status**: `active`
**Version**: `1`

**Instructions**: `You are {botName}, a helpful AI assistant.`
**Description**: `Default personality for {botName}`

**PostgreSQL Schema**:
```sql
INSERT INTO personalities (
  id,
  name,
  instructions,
  description,
  status,
  version,
  created_at,
  updated_at
) VALUES (
  '{botName.toLowerCase()}',
  '{botName}',
  'You are {botName}, a helpful AI assistant.',
  'Default personality for {botName}',
  'active',
  1,
  NOW(),
  NOW()
);
```

**Firestore Schema**:
```javascript
{
  name: '{botName}',
  text: 'You are {botName}, a helpful AI assistant.',
  description: 'Default personality for {botName}',
  status: 'active',
  version: 1,
  createdAt: FieldValue.serverTimestamp()
}
```

---

## Context Packs

### 1. Internal Event Schema
**ID**: `schema.internal-event-v2`
**Version**: `1`
**Title**: `Internal Event V2 Schema`
**Priority**: `1`
**Format**: `markdown`
**Source**: `platform-core`

*Content*: Auto-generated from `buildInternalEventSchemaPack()`

---

### 2. Router JsonLogic Guide
**ID**: `router.jsonlogic-guide`
**Version**: `1`
**Title**: `Event Router JsonLogic Guide`
**Priority**: `1`
**Format**: `markdown`
**Source**: `platform-core`

*Content*: Auto-generated from `buildRouterJsonLogicPack()`

---

### 3. Scheduler Guide
**ID**: `scheduler.guide`
**Version**: `1`
**Title**: `Scheduler Usage Guide`
**Priority**: `2`
**Format**: `markdown`
**Source**: `platform-core`

*Content*: Cron syntax and event definition guide

---

## API Tokens

### 1. Admin API Token
**UID**: `brat-admin`
**Description**: `Initial admin token for chat`

**Token**: Auto-generated UUID
**Token Hash**: SHA-256 of token

**PostgreSQL Schema**:
```sql
INSERT INTO api_tokens (
  token_hash,
  uid,
  description,
  created_at
) VALUES (
  '{sha256(token)}',
  'brat-admin',
  'Initial admin token for chat',
  NOW()
);
```

**Firestore Schema**:
```javascript
// Collection: gateways/api/tokens
{
  token_hash: '{sha256(token)}',
  uid: 'brat-admin',
  description: 'Initial admin token for chat',
  createdAt: FieldValue.serverTimestamp()
}
```

**Also stored in**:
- `.bitbrat.json` (local file)
- `.secure.{context}` as `BITBRAT_API_TOKEN`

---

## Summary

**Total Seed Entities**:
- Routing Rules: 4
- Reflexes: 1 (!ping)
- Personalities: 1 (default bot personality)
- Context Packs: 3 (schema, router guide, scheduler guide)
- API Tokens: 1 (admin token)

**Parameterization**:
- `{botName}`: Provided during context creation (default: "BitBrat")
- `{context}`: Context name (e.g., "agent-dev", "local", "staging")

**Implementation**:
- Story S6.1: Define seed data model with these entities
- Story S6.2: PostgreSQL writer implements INSERT statements
- Story S6.3: Firestore writer implements Firestore writes
- Story S6.4: `brat seed` command uses this specification
- Story S6.5: Integrated into `brat context create`

---

## Validation

After seeding, the following should be true:

**PostgreSQL**:
```sql
SELECT COUNT(*) FROM routing_rules;  -- Should return 4
SELECT COUNT(*) FROM reflexes;       -- Should return 1
SELECT COUNT(*) FROM personalities;  -- Should return 1
SELECT COUNT(*) FROM context_packs;  -- Should return 3
SELECT COUNT(*) FROM api_tokens;     -- Should return 1
```

**Firestore**:
```javascript
db.collection('configs/routingRules/rules').get()  // size: 4
db.collection('reflexes').get()                    // size: 1
db.collection('personalities').get()               // size: 1
db.collection('context_packs').get()              // size: 3
db.collection('gateways/api/tokens').get()        // size: 1
```

**Functional Test**:
```bash
# After context creation and deployment
echo "!ping" | npm run brat -- chat
# Expected: "pong!"
```

---

## References

- `tools/brat/src/cli/setup.ts` - Current Firestore seeding logic
- `tools/brat/src/seeding/seed-data-definitions.ts` - To be created in S6.1
- Sprint 352 Story S6.1 - Create Persistence-Agnostic Seed Data Model
