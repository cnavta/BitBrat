---
title: "Building an Enrichment Bit: Sentiment Analyzer"
audience: [ai-agents, developers]
difficulty: intermediate
prerequisites:
  - "BitBrat platform running locally (see Quickstart)"
  - "Basic TypeScript knowledge"
  - "Understanding of agent flow stages"
related:
  - "../concepts/agent-flow-patterns.md"
  - "../concepts/agent-flow-stages.md"
  - "../concepts/platform-flow.md"
estimated_time: "30-45 minutes"
---

# Tutorial: Building an Enrichment Bit (Sentiment Analyzer)

In this tutorial, you will build a **sentiment analyzer** bit that enriches events with sentiment scores using the **enrich-and-next pattern**. This is the canonical pattern for bits participating in BitBrat's agent flow.

## Objective

By the end of this tutorial, you will have:
1. Created a new Bit that subscribes to the **Contextualization** stage
2. Implemented the **enrich-and-next pattern** (ENRICH → NEXT → ACKNOWLEDGE)
3. Tested your bit locally with `brat chat`
4. Understood how annotations accumulate through the routing slip

---

## Prerequisites

- **Platform running locally**: See [Quickstart](../getting-started/quickstart.md)
- **TypeScript knowledge**: Basic familiarity with async/await, imports
- **Agent flow understanding**: Read [Agent Flow Stages](../concepts/agent-flow-stages.md)

**RULE: Complete the prerequisites before starting this tutorial.**

---

## Step 1: Create the Bit

We'll use the `brat bit create` command to scaffold a new service.

```bash
npm run brat -- bit create sentiment-analyzer --profile core --register --active
```

**What this does:**
- Creates `src/apps/sentiment-analyzer-service.ts` (service implementation)
- Creates `src/apps/sentiment-analyzer-service.test.ts` (test file)
- Creates `Dockerfile.sentiment-analyzer` (multi-stage build)
- Creates `infrastructure/docker-compose/services/sentiment-analyzer.compose.yaml`
- Registers the service in `architecture.yaml` with `active: true`

**Expected output:**
```
✔ Created src/apps/sentiment-analyzer-service.ts
✔ Created src/apps/sentiment-analyzer-service.test.ts
✔ Created Dockerfile.sentiment-analyzer
✔ Created infrastructure/docker-compose/services/sentiment-analyzer.compose.yaml
✔ Registered in architecture.yaml (active: true)

Next steps:
1. Implement your service logic in src/apps/sentiment-analyzer-service.ts
2. Add to Docker Compose: docker compose -f infrastructure/docker-compose/docker-compose.yaml up sentiment-analyzer
3. Deploy: npm run brat -- deploy service sentiment-analyzer
```

---

## Step 2: Implement the Enrich-and-Next Pattern

Open `src/apps/sentiment-analyzer-service.ts` and replace its contents with the following implementation:

```typescript
// File: src/apps/sentiment-analyzer-service.ts
import { Bit } from '../common/base-server';
import { InternalEventV2 } from '../types/events';
import { randomUUID } from 'crypto';

const SERVICE_NAME = 'sentiment-analyzer';

export class SentimentAnalyzer extends Bit {
  constructor() {
    super({ serviceName: SERVICE_NAME });
  }

  async setup(): Promise<void> {
    this.getLogger().info('sentiment-analyzer.setup.start');

    // Subscribe to contextualization stage
    await this.onMessage<InternalEventV2>(
      { destination: 'internal.contextualization.v1', queue: SERVICE_NAME, ack: 'explicit' },
      async (event, attrs, ctx) => {
        const correlationId = event.correlationId;
        this.getLogger().info('sentiment-analyzer.message.received', { correlationId });

        const text = event.message?.text;
        if (!text) {
          this.getLogger().warn('sentiment-analyzer.no_text', { correlationId });
          await this.next(event);
          await ctx.ack();
          return;
        }

        // 1. ENRICH: Add sentiment annotation
        const sentiment = this.analyzeSentiment(text);
        event.annotations = event.annotations || [];
        event.annotations.push({
          kind: 'sentiment',
          value: sentiment,
          label: sentiment.label,
          source: SERVICE_NAME,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          payload: {
            score: sentiment.score,
            confidence: sentiment.confidence
          }
        });

        this.getLogger().info('sentiment-analyzer.enriched', {
          correlationId,
          sentiment: sentiment.label,
          score: sentiment.score
        });

        // 2. NEXT: Advance routing slip
        await this.next(event);

        // 3. ACKNOWLEDGE: Required for message bus
        await ctx.ack();
      }
    );

    this.getLogger().info('sentiment-analyzer.setup.complete');
  }

  /**
   * Simple sentiment analysis using keyword matching.
   * In production, you would use an ML model or external API.
   */
  private analyzeSentiment(text: string): {
    label: 'positive' | 'negative' | 'neutral';
    score: number;
    confidence: number;
  } {
    const lowerText = text.toLowerCase();

    // Positive keywords
    const positiveKeywords = ['love', 'great', 'awesome', 'excellent', 'amazing', 'fantastic', 'good', 'nice', 'wonderful', 'happy'];
    const positiveMatches = positiveKeywords.filter(kw => lowerText.includes(kw)).length;

    // Negative keywords
    const negativeKeywords = ['hate', 'terrible', 'awful', 'bad', 'horrible', 'sad', 'angry', 'frustrating', 'annoying', 'worst'];
    const negativeMatches = negativeKeywords.filter(kw => lowerText.includes(kw)).length;

    // Calculate sentiment
    if (positiveMatches > negativeMatches) {
      const score = Math.min(positiveMatches * 0.2, 1.0);
      return { label: 'positive', score, confidence: 0.7 };
    } else if (negativeMatches > positiveMatches) {
      const score = Math.max(-negativeMatches * 0.2, -1.0);
      return { label: 'negative', score, confidence: 0.7 };
    } else {
      return { label: 'neutral', score: 0, confidence: 0.5 };
    }
  }
}

export function createServer() {
  return new SentimentAnalyzer();
}

// Start server if run directly
if (require.main === module) {
  const server = createServer();
  server.start();
}
```

### Understanding the Code

**1. ENRICH (Lines 27-42):**
- Analyzes message text for sentiment
- Creates annotation with `kind: 'sentiment'`
- Includes `source: SERVICE_NAME` for provenance
- Adds `score` and `confidence` in `payload`

**2. NEXT (Line 49):**
- Calls `this.next(event)` to advance routing slip
- Event progresses to next step (typically Analysis stage)

**3. ACKNOWLEDGE (Line 52):**
- Calls `ctx.ack()` to confirm message processing
- Required for at-least-once delivery semantics

**RULE: ALWAYS follow ENRICH → NEXT → ACKNOWLEDGE in that order.**

---

## Step 3: Build and Test Locally

### 3.1. Build the Service

```bash
npm run build
```

**Expected output:**
```
> bitbrat-platform@0.13.1 build
> tsc -p tsconfig.json
```

### 3.2. Start the Service Locally

```bash
npm run brat -- dev sentiment-analyzer
```

**Expected output:**
```
{"level":30,"component":"sentiment-analyzer","msg":"sentiment-analyzer.setup.start"}
{"level":30,"component":"sentiment-analyzer","msg":"sentiment-analyzer.setup.complete"}
{"level":30,"component":"sentiment-analyzer","msg":"Server listening on :3000"}
```

### 3.3. Test with brat chat

In a **new terminal**, start a chat session:

```bash
npm run brat -- chat
```

Type a message with clear sentiment:

```
User: I love this platform, it's amazing!
```

**Expected log output (in sentiment-analyzer terminal):**
```json
{
  "level": 30,
  "component": "sentiment-analyzer",
  "msg": "sentiment-analyzer.message.received",
  "correlationId": "c-abc123"
}
{
  "level": 30,
  "component": "sentiment-analyzer",
  "msg": "sentiment-analyzer.enriched",
  "correlationId": "c-abc123",
  "sentiment": "positive",
  "score": 0.4
}
```

**The sentiment annotation is now part of the event**, flowing through to Analysis and Reaction stages.

---

## Step 4: Verify Annotation Accumulation

Let's verify that annotations accumulate correctly through the routing slip.

### 4.1. Enable Debug Logging

Set the log level to `debug` to see full event payloads:

```bash
export LOG_LEVEL=debug
npm run brat -- dev sentiment-analyzer
```

### 4.2. Send Another Message

```bash
npm run brat -- chat
```

Type:
```
User: This is terrible, I hate it!
```

### 4.3. Inspect the Event

Look for the `sentiment-analyzer.enriched` log entry. You should see:

```json
{
  "level": 30,
  "msg": "sentiment-analyzer.enriched",
  "correlationId": "c-xyz789",
  "sentiment": "negative",
  "score": -0.4,
  "annotations": [
    {
      "kind": "user",
      "source": "auth",
      "value": { "id": "user-123", "displayName": "User" }
    },
    {
      "kind": "sentiment",
      "source": "sentiment-analyzer",
      "value": { "label": "negative", "score": -0.4, "confidence": 0.7 }
    }
  ]
}
```

**Notice:**
- The `auth` annotation (added by the Auth service) is **preserved**
- The `sentiment` annotation (added by your service) is **appended**
- **Annotations accumulate** as the event progresses through the routing slip

**RULE: Services add annotations, never modify existing ones.**

---

## Step 5: Deploy to Docker Compose

### 5.1. Add to Docker Compose Stack

```bash
docker compose -f infrastructure/docker-compose/docker-compose.yaml up -d sentiment-analyzer
```

### 5.2. Verify Service is Running

```bash
docker compose -f infrastructure/docker-compose/docker-compose.yaml ps sentiment-analyzer
```

**Expected output:**
```
NAME                    SERVICE               STATUS
sentiment-analyzer      sentiment-analyzer    running
```

### 5.3. Test with Chat

```bash
npm run brat -- chat
```

Your sentiment analyzer is now running as part of the full platform stack!

---

## Extensions & Next Steps

### Extension 1: Use an External API

Replace the simple keyword matching with a real sentiment analysis API:

```typescript
private async analyzeSentiment(text: string): Promise<SentimentResult> {
  const response = await fetch('https://api.sentimentanalysis.com/v1/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SENTIMENT_API_KEY}` },
    body: JSON.stringify({ text })
  });
  return await response.json();
}
```

**Add to `architecture.yaml`:**
```yaml
services:
  sentiment-analyzer:
    secrets:
      - SENTIMENT_API_KEY
```

### Extension 2: Conditional Enrichment

Only analyze sentiment for questions:

```typescript
// Only enrich if message is a question
if (!text.includes('?')) {
  this.getLogger().info('sentiment-analyzer.skip_non_question', { correlationId });
  await this.next(event);
  await ctx.ack();
  return;
}

// Otherwise, proceed with enrichment...
```

### Extension 3: Build a Reaction Bit

Create a **reaction bit** that uses the sentiment annotation to trigger different responses:

```typescript
// File: src/apps/sentiment-responder-service.ts
await this.onMessage<InternalEventV2>('internal.reaction.v1', async (event, attrs, ctx) => {
  const sentiment = event.annotations.find(a => a.kind === 'sentiment');

  if (sentiment?.value?.label === 'negative') {
    // Send empathetic response
    event.candidates.push({
      kind: 'text',
      text: 'I sense you might be frustrated. How can I help?',
      source: this.name,
      id: randomUUID()
    });
  }

  await this.complete(event);
  await ctx.ack();
});
```

### Extension 4: Subscribe to Multiple Stages

A single bit can participate in multiple stages:

```typescript
async setup(): Promise<void> {
  // Contextualization: Fast pre-analysis
  await this.onMessage<InternalEventV2>('internal.contextualization.v1', this.handleContextualization.bind(this));

  // Analysis: Deep sentiment analysis with ML
  await this.onMessage<InternalEventV2>('internal.analysis.v1', this.handleAnalysis.bind(this));
}
```

---

## Summary

You've successfully built an **enrichment bit** following the **enrich-and-next pattern**:

1. ✅ Created a new Bit with `brat bit create`
2. ✅ Implemented ENRICH → NEXT → ACKNOWLEDGE pattern
3. ✅ Tested locally with `brat chat`
4. ✅ Verified annotation accumulation
5. ✅ Deployed to Docker Compose

**Key Learnings:**
- **Enrich-and-next** is THE pattern for agent-flow bits
- **Annotations accumulate** as events progress through stages
- **Provenance tracking** via `source: this.name`
- **`next()` by default**, `complete()` for short-circuiting

---

## Related Documentation

**Core Concepts:**
- [Agent Flow Patterns](../concepts/agent-flow-patterns.md) — Complete enrich-and-next reference
- [Agent Flow Stages](../concepts/agent-flow-stages.md) — The 5-stage model
- [Platform Flow Overview](../concepts/platform-flow.md) — End-to-end event lifecycle

**Other Tutorials:**
- [Creating the !lurk Command](./lurk-command.md) — Event router rules
- [Creating a Reflex](./creating-a-reflex.md) — Fast deterministic pattern matching

**Reference:**
- [The Bit Model](../concepts/bit-model.md) — Base abstraction
- [Capability Profiles](../concepts/capability-profiles.md) — Eventing, LLM, MCP

---

**Next Challenge:** Build a **named entity recognition (NER)** bit that extracts entities (people, places, organizations) from messages and adds them as annotations!
