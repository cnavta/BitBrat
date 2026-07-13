# Firestore Vector Index Setup for Context Packs

**Sprint:** 338 (P4 RAG Scale-Out)
**Created:** 2026-07-11
**Purpose:** Document vector index creation for `context_packs` collection

---

## Overview

Firestore Vector Search requires a **vector index** to be created separately from standard composite indexes. The vector index enables semantic similarity search on the `embedding` field (1536-dimensional float array from OpenAI `text-embedding-ada-002`).

**Important:** Vector index creation can take **up to 24 hours** to complete. Start this process early in Phase 1.

---

## Prerequisites

1. **gcloud CLI** installed and authenticated:
   ```bash
   gcloud auth login
   gcloud config set project bitbrat-production  # or bitbrat-staging
   ```

2. **Firestore database** must exist (created via `brat setup` or Terraform)

3. **`context_packs` collection** must exist (seeded via `node dist/tools/brat/src/context/seed-packs.js`)

---

## Vector Index Creation

### Command

```bash
gcloud firestore indexes composite create \
  --collection-group=context_packs \
  --query-scope=COLLECTION \
  --field-config field-path=embedding,vector-config='{"dimension":1536,"flat":{}}'
```

### Parameters Explained

- **`--collection-group=context_packs`**: Apply index to all documents in `context_packs` collection
- **`--query-scope=COLLECTION`**: Index is scoped to the collection (not collection group)
- **`--field-config`**: Vector field configuration
  - **`field-path=embedding`**: The field containing the vector
  - **`vector-config`**: Vector search configuration (JSON-encoded)
    - **`dimension: 1536`**: Vector dimensionality (matches OpenAI text-embedding-ada-002)
    - **`flat: {}`**: Use FLAT algorithm (exact nearest-neighbor search)

### Alternative: Distance Measure

By default, Firestore uses **COSINE** similarity. To explicitly set it:

```bash
gcloud firestore indexes composite create \
  --collection-group=context_packs \
  --query-scope=COLLECTION \
  --field-config field-path=embedding,vector-config='{"dimension":1536,"flat":{},"distance_measure":"COSINE"}'
```

**Supported distance measures:**
- `COSINE` (default, recommended for text embeddings)
- `EUCLIDEAN`
- `DOT_PRODUCT`

---

## Verification

### Check Index Status

```bash
gcloud firestore indexes list --filter="collectionGroup:context_packs"
```

**Expected output:**
```
NAME                                           DATABASE  COLLECTION_GROUP  QUERY_SCOPE  FIELDS                               STATE
[auto-generated-id]                           (default) context_packs     COLLECTION   embedding (VECTOR, 1536D, COSINE)   CREATING
```

### Wait for Index to Become ACTIVE

**Initial status:** `CREATING` (may take up to 24 hours for large databases)
**Final status:** `ACTIVE` (index is ready for queries)

**Poll status:**
```bash
watch -n 300 'gcloud firestore indexes list --filter="collectionGroup:context_packs"'
```
(Checks every 5 minutes)

### Test Vector Query (Once ACTIVE)

```bash
# This will work once the index is ACTIVE
# Run from Node.js REPL or test script:
node -e "
const { getFirestore } = require('./dist/src/common/firebase');
const db = getFirestore();

(async () => {
  const testEmbedding = Array.from({ length: 1536 }, () => Math.random());
  const vectorQuery = db.collection('context_packs')
    .where('active', '==', true)
    .findNearest('embedding', testEmbedding, {
      limit: 5,
      distanceMeasure: 'COSINE'
    });
  const snapshot = await vectorQuery.get();
  console.log('Results:', snapshot.size);
  snapshot.forEach(doc => console.log('  -', doc.id));
})();
"
```

---

## Troubleshooting

### Error: "Vector index does not exist"

**Cause:** Index creation not complete or failed
**Solution:** Check index status with `gcloud firestore indexes list`

### Error: "Invalid vector dimension"

**Cause:** Embedding field has wrong dimensions (not 1536)
**Solution:** Verify seed data has correct embedding dimensions:
```bash
node dist/tools/brat/src/context/seed-packs.js --dry-run --mock-embeddings
```

### Index Creation Takes > 24 Hours

**Cause:** Large existing database (millions of documents)
**Mitigation:**
- For small databases (< 10K docs): usually completes in < 1 hour
- For context_packs (expected < 500 docs): should complete in minutes
- If stuck: contact Google Cloud Support

---

## Local Development

**Note:** Firestore Emulator does **NOT** support vector indexes.

**Workaround for local testing:**
1. Mock `VectorContextProvider.listPacks()` to return fixed results
2. Use integration tests with mocked Firestore
3. Test vector queries only in staging/production environments

---

## Terraform (Optional)

Vector indexes can also be created via Terraform (requires `google-beta` provider):

```hcl
resource "google_firestore_index" "context_packs_vector" {
  project    = var.project_id
  database   = "(default)"
  collection = "context_packs"

  fields {
    field_path = "embedding"
    vector_config {
      dimension = 1536
      flat {}
    }
  }

  query_scope = "COLLECTION"
}
```

**Deploy:**
```bash
cd infrastructure/terraform/firestore
terraform plan
terraform apply
```

---

## References

- **Firestore Vector Search Docs:** https://cloud.google.com/firestore/docs/vector-search
- **gcloud CLI Reference:** https://cloud.google.com/sdk/gcloud/reference/firestore/indexes/composite/create
- **Technical Architecture:** `planning/sprint-338-rag-context-provisioning/technical-architecture.md` (§3.2.1)
- **Schema:** `documentation/firestore/context_packs.md`

---

**Document Status:** Active (P4 implementation, sprint-338)
**Last Updated:** 2026-07-11
