# Firestore Collection: `context_packs`

**Purpose:** Store Context Packs with vector embeddings for semantic retrieval (P4 RAG Scale-Out, sprint-338).

**Created:** 2026-07-11 (sprint-338)
**Owner:** tool-gateway (upserts packs on `INTERNAL_MCP_REGISTRATION_V1`)

---

## Schema

### Document Structure

**Collection:** `context_packs`
**Document ID:** `{pack.id}` (e.g., `schema.internal-event-v2`, `scheduler.cron-syntax`)

```typescript
interface ContextPackDocument {
  // Core pack identity (matches ContextPack interface from src/common/context/types.ts)
  id: string;                      // Pack ID (same as doc ID); stable, unique
  version: string;                 // Pack version (e.g., "2" for InternalEventV2)
  title: string;                   // Human/agent-readable heading
  priority?: 1 | 2 | 3 | 4 | 5;    // Maps to prompt-assembly Priority (1=highest, default: 3)
  format: 'markdown' | 'json';     // Body content format
  body: string | object;           // Pack content (markdown text or JSON object)
  source: string;                  // Provenance (e.g., "src/types/events.ts")

  // Vector search fields (P4 RAG)
  embedding: admin.firestore.VectorValue;  // 1536-dim float[] from text-embedding-ada-002
  embeddingText: string;                   // The text that was embedded (title + body preview, 500 chars)

  // Metadata
  bitName: string;                 // The Bit that registered this pack (e.g., "scheduler", "event-router")
  createdAt: string;               // ISO8601 timestamp (first registration)
  updatedAt: string;               // ISO8601 timestamp (last registration / heartbeat)
  active: boolean;                 // Allow disabling packs without deletion (default: true)
}
```

### Field Constraints

- **id:** Required, unique (doc ID matches field)
- **version:** Required, string (not numeric to allow semver-style)
- **title:** Required, non-empty
- **format:** Required, enum (`markdown` | `json`)
- **body:** Required, non-empty (string for markdown, object for json)
- **source:** Required, non-empty (file path or description)
- **embedding:** Required for searchability; 1536-dimension float array (OpenAI text-embedding-ada-002)
- **embeddingText:** Required; the text that was embedded (for debugging/auditing)
- **bitName:** Required, non-empty (owning Bit service name)
- **createdAt:** Required, ISO8601
- **updatedAt:** Required, ISO8601
- **active:** Required, boolean (default: true)

---

## Indexes

### Composite Index (Filtering + Ordering)

**Name:** `context_packs_active_bitName_id`
**Fields:**
1. `active` (ASCENDING)
2. `bitName` (ASCENDING)
3. `id` (ASCENDING)

**Purpose:** Query active packs by Bit, ordered by ID

**Creation:**
```bash
# Defined in firestore.indexes.json; created via Terraform or gcloud CLI
```

### Vector Index (Semantic Search)

**Name:** `context_packs_embedding_vector`
**Field:** `embedding`
**Config:**
- **Dimension:** 1536 (OpenAI text-embedding-ada-002)
- **Distance Measure:** COSINE
- **Algorithm:** FLAT (exact nearest-neighbor; sufficient for <10K packs)

**Purpose:** Semantic similarity search via Firestore Vector Search

**Creation:**
```bash
gcloud firestore indexes composite create \
  --collection-group=context_packs \
  --query-scope=COLLECTION \
  --field-config field-path=embedding,vector-config='{"dimension":1536,"flat":{}}'

# Note: Index creation may take up to 24 hours; status: CREATING -> ACTIVE
# Verify: gcloud firestore indexes list --filter="collectionGroup:context_packs"
```

---

## Usage Patterns

### Write (Upsert on Registration)

**Trigger:** `tool-gateway.handleMcpRegistration` receives `INTERNAL_MCP_REGISTRATION_V1` with `payload.context.packs[]`

**Flow:**
1. For each pack in `payload.context.packs`:
2. Generate `embeddingText` = `pack.title + '\n\n' + String(pack.body).slice(0, 500)`
3. Call OpenAI embeddings API (model: `text-embedding-ada-002`, input: `embeddingText`)
4. Upsert to Firestore:
   ```typescript
   await db.collection('context_packs').doc(pack.id).set({
     ...pack,                    // id, version, title, priority, format, body, source
     bitName: payload.name,
     embedding: embedding,       // VectorValue (1536-dim float[])
     embeddingText: embeddingText,
     active: true,
     createdAt: existingDoc?.createdAt || new Date().toISOString(),
     updatedAt: new Date().toISOString(),
   }, { merge: true });
   ```

**Idempotency:** Merge mode preserves `createdAt`; updates `updatedAt` on heartbeat re-registrations

### Read (Vector Search)

**Trigger:** `VectorContextProvider.listPacks()` called with semantic query

**Flow:**
1. Embed query text (same API call, cached)
2. Execute Firestore Vector Search:
   ```typescript
   const vectorQuery = db.collection('context_packs')
     .where('active', '==', true)
     .findNearest('embedding', queryEmbedding, {
       limit: 5,                  // maxResults
       distanceMeasure: 'COSINE'
     });
   const snapshot = await vectorQuery.get();
   ```
3. Filter results by similarity threshold (distance → similarity: `1 - distance`)
4. Map to `ContextPack[]`

---

## Lifecycle

### Pack Creation
- Bit registers tools + context packs on startup (publishes `INTERNAL_MCP_REGISTRATION_V1`)
- tool-gateway receives event, upserts packs into Firestore
- Embedding generated once per pack (cached for heartbeats)

### Pack Updates
- Bit re-publishes registration on heartbeat (every N minutes)
- tool-gateway merges update (preserves `createdAt`, updates `updatedAt`)
- If pack body/title changed, embedding is regenerated (cache miss)

### Pack Deactivation
- Manual: Set `active: false` in Firestore console (excluded from vector search)
- Future: Add `bit.context.deactivate` control-plane tool

### Pack Deletion
- Not recommended (breaks audit trail)
- Alternative: Set `active: false` (soft delete)

---

## Data Volume Projections

| Scenario | Pack Count | Embedding Storage | Comments |
|----------|-----------|------------------|----------|
| Current (P3) | 2 | ~24 KB | schema.internal-event-v2, router.jsonlogic-guide |
| Small (6 months) | 10-20 | ~240 KB | Per-service domain packs (scheduler, obs-mcp, etc.) |
| Medium (1 year) | 50-100 | ~1.2 MB | Mature ecosystem with third-party Bits |
| Large (2 years) | 200-500 | ~6 MB | Multi-tenant, diverse domain coverage |

**Note:** Firestore Vector Search scales to millions of documents; 500 packs is negligible.

---

## Security & RBAC

### Pack Registration
- **Authentication:** Only Bits in `mcp_servers` collection can publish `INTERNAL_MCP_REGISTRATION_V1`
- **Authorization:** tool-gateway validates `MCP_AUTH_TOKEN` on registration events
- **Audit:** Every pack carries `bitName` (source traceability) and `source` (code provenance)

### Pack Retrieval
- **No per-pack RBAC in P4:** Context packs are informational (not executable like tools)
- **Future:** Add `requiredRoles: string[]` field and filter post-retrieval

### Prompt Injection Risk
- **Mitigation:** Packs are served to the LLM as context (not code)
- **Audit trail:** `bitName` + `source` fields trace every pack to its origin
- **Future:** Content filtering (OpenAI Moderation API) on pack bodies before persisting

---

## Monitoring & Observability

### Metrics
- **Pack count:** `SELECT COUNT(*) FROM context_packs WHERE active = true` (daily)
- **Average embedding dimensions:** Verify all packs have 1536-dim embeddings
- **Stale packs:** Packs with `updatedAt > 7 days ago` (may indicate inactive Bit)

### Logs (tool-gateway)
- `tool_gateway.context.pack_registered` (info): Pack upserted with embedding
- `tool_gateway.context.pack_embedding_failed` (warning): Embedding generation failed (pack persisted without embedding)
- `tool_gateway.context.pack_update_skipped` (debug): Heartbeat re-registration, no changes

---

## References

- **ADR:** `documentation/architecture/tool-context-provisioning.md` (P4 §6.1)
- **Technical Architecture:** `planning/sprint-338-rag-context-provisioning/technical-architecture.md` (§3.2.1)
- **Types:** `src/common/context/types.ts` (`ContextPack` interface)
- **Provider:** `src/common/context/vector-provider.ts` (`VectorContextProvider`)
- **Registration Handler:** `src/apps/tool-gateway.ts` (`handleMcpRegistration`)

---

**Document Status:** Active (P4 implementation, sprint-338)
**Last Updated:** 2026-07-11
