# Message Acknowledgment Analysis

## Question: Are debug messages properly ack'd at egress?

### Egress Handler 1: Instance-Specific (`internal.egress.v1.{instanceId}`)

**File:** `src/apps/ingress-egress-service.ts:421-444`

```typescript
await this.onMessage<any>(
  { destination: egressTopic, queue: `ingress-egress.${instanceId}`, ack: 'explicit' },
  async (evt: any, _attributes: AttributeMap, ctx) => {
    try {
      await this.processEgress(evt, egressTopic);
      await ctx.ack();  // ✅ Line 428: Ack on success
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (/json|unexpected token|position \d+/i.test(msg)) {
        await ctx.ack();  // ✅ Line 433: Ack on JSON error
      } else {
        await ctx.ack();  // ✅ Line 436: Ack on process error
      }
    }
  }
);
```

**Verdict:** ✅ **ALWAYS acks** (success or error)

---

### Egress Handler 2: Generic (`internal.egress.v1`)

**File:** `src/apps/ingress-egress-service.ts:452-514`

```typescript
await this.onMessage<InternalEventV2>(
  { destination: genericEgressTopic, queue: genericQueue, ack: 'explicit' },
  async (evt: InternalEventV2, attributes: AttributeMap, ctx) => {
    try {
      // Debug message detection (line 477)
      const isDebugMessage = source.startsWith('debug.');

      // Process egress (line 496)
      const result = await this.processEgress(evt, genericEgressSubject);

      await ctx.ack();  // ✅ Line 508: Ack on success
    } catch (e: any) {
      await ctx.ack();  // ✅ Line 512: Ack on error
    }
  }
);
```

**Verdict:** ✅ **ALWAYS acks** (success or error)

---

## Conclusion: Egress Acking is CORRECT

**Debug messages ARE properly ack'd at egress.** Both handlers unconditionally call `ctx.ack()` regardless of success or failure.

---

## REVISED Root Cause

The problem is **NOT** at the egress layer. The problem is earlier in the pipeline:

### The Real Issue: Routing Message Acknowledgment

1. **Event Flow:**
   ```
   ingress → internal.auth.v1 → internal.llm.v1 → internal.egress.v1
             ↑ PROBLEM HERE     ↑ PROBLEM HERE
   ```

2. **What Happens:**
   - Auth service receives message on `internal.auth.v1`
   - Auth calls `next()` which:
     - Sends debug update to `internal.egress.v1` ✅ (ack'd correctly)
     - Publishes event to `internal.llm.v1` ✅
   - **Auth crashes BEFORE calling `ctx.ack()`** ❌
   - NATS redelivers original message on `internal.auth.v1`
   - Auth restarts (empty dedupe cache)
   - Auth processes redelivered message
   - **Sends DUPLICATE debug update** ❌

3. **Key Insight:**
   - Egress messages are ack'd correctly ✅
   - **Routing messages** (auth, llm, etc.) are NOT ack'd if service crashes ❌
   - Dedupe cache is in-memory → lost on restart ❌

---

## Why This Confirms the Original Analysis

The persistent dedupe cache solution is still correct because:

1. **Problem:** Routing services crash before ack, causing redelivery
2. **Symptom:** In-memory dedupe cache cleared on restart
3. **Result:** Duplicate debug messages sent
4. **Solution:** Persistent cache survives restart, prevents duplicates

**Egress is innocent** - the bug is in the routing layer's ack timing combined with ephemeral cache.
