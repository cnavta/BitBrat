# Technical Architecture — `brat backup`: Firestore Config Export / Import (v1)

> **DEPRECATED LEGACY DESIGN**
>
> This document describes a **Firestore-specific backup design** which is now **legacy**. The `brat backup` command was implemented for Firestore but is deprecated in favor of PostgreSQL-based persistence.
>
> **Current Implementation:** BitBrat now uses **PostgreSQL** as the default persistence backend. For backup/restore operations, see:
> - [Backup and Migration Guide](../guides/backup-and-migration.md) - PostgreSQL `pg:backup` and `pg:restore` commands
> - PostgreSQL backups are comprehensive (all data), while Firestore backups are config-only

> Status: **Proposed** (sprint-319-740b5b, Task 1 — design only; no implementation yet)
> Owner: Architect
> Precedence: `architecture.yaml` is canonical. This document defines an approach; any conflict
> with `architecture.yaml` is resolved in favor of `architecture.yaml`.

## 1. Objective

Add a new `brat` command that **exports** and **imports** JSON-based backups of the platform's
**core configuration** Firestore collections, so the configuration of one platform instance can be
lifted and dropped onto a **blank** instance.

Primary use cases:
- **Environment cloning / seeding** — stand up a new `dev`/`prod` instance from a known-good config.
- **Disaster recovery** — restore the platform's configuration into an empty database.
- **Config portability / review** — human-readable, version-controllable snapshots of config.

Hard requirement from the sprint brief:
> The `events` collection and other **log-based** collections MUST NOT be included.

The backup is therefore **config-only**, not a full database dump. Operational/event/log data is
intentionally left behind so a restore re-creates a clean configured platform, not a copy of
historical traffic.

## 2. Background & Current State

- The `brat` CLI lives under `tools/brat/src`. Subcommands are dispatched by simple string matching
  in `tools/brat/src/cli/index.ts` `main()`, with help text in `printHelp()`. Existing command
  families: `setup`, `doctor`, `config`, `service bootstrap`, `deploy`, `infra`, `lb`, `apis`,
  `chat`, `cloud-run`, `trigger`, `docker`.
- `brat` compiles against the **root** `package.json` (there is no `tools/brat/package.json`), which
  already depends on `firebase-admin ^13.6.0`. No new dependency is required.
- The canonical Firestore connection pattern is `src/common/firebase.ts` `getFirestore()`:
  firebase-admin via **ADC**, named/multi-database via `resolveDatabaseId()`, and
  `FIRESTORE_EMULATOR_HOST` awareness. `brat` has **no Firestore provider yet**.
- Firestore is a **schemaless, document/collection** store with **arbitrarily nested
  subcollections** and **native value types** (Timestamp, GeoPoint, DocumentReference, Bytes) that
  do not survive a naive `JSON.stringify`.

## 3. Collection Classification

The single most important design decision is **which collections are config vs. log/event**. The
list below is derived from a survey of `collection(...)` usage across `src/**`.

### 3.1 Config / Core — INCLUDED in backups

| Collection (path) | Source | Notes |
|---|---|---|
| `users` | story-engine-mcp, auth, llm-bot | Profiles, roles, descriptions. Includes `users/{id}/roles` subcollection. |
| `stories` | story-engine-mcp | Story definitions/state authored as config. |
| `configs` (+ nested) | event-router (`configs/routingRules/rules`), llm-bot (`configs/bot/roles`) | Configuration container with **subcollections**; must recurse. |
| `stream_observers` | stream-analyst | Observer definitions/triggers. |
| `mcp_servers` | tool-gateway, registry-watcher | Registered MCP server config. |
| `schedules` | scheduler-service | Scheduled job definitions. |
| `sources` | persistence (`COLLECTION_SOURCES`) | Configured platform sources/channels. Contains some runtime-ish status/metrics fields — see §3.3. |
| `gateways/api/tokens` | auth, api-gateway | API tokens (**sensitive**) — see §7.3; excluded by default. |

### 3.2 Log / Event — EXCLUDED from backups (fail-safe)

| Collection (path) | Source | Why excluded |
|---|---|---|
| `events` (+ `snapshots` subcollection) | persistence (`COLLECTION_EVENTS`, `SUBCOLLECTION_SNAPSHOTS`) | Event ledger — the explicit exclusion in the brief. |
| `mutation_log` | state-engine | Append-only mutation history. |
| `state` | state-engine | Runtime/derived state (paired with `mutation_log`); not authored config. |
| `summarization_runs` | stream-analyst | Idempotency/run records. |
| `tool_usage` | mcp observability | Usage telemetry. |
| `services/{svc}/prompt_logs` | llm-bot, query-analyzer | LLM prompt logs. |
| disposition observation records | disposition-service | Observational/log data. |

### 3.3 Design rule: allowlist, not denylist

The backup set is defined by an **explicit allowlist registry** in code. This is **fail-safe**: any
collection not in the registry (including future log collections nobody remembered to exclude) is
**never exported**. A denylist would silently start exporting new log data the moment someone adds
a collection. Borderline collections (`sources`, `state`) are decided **once, explicitly** in the
registry with a documented rationale, rather than inferred at runtime.

> `state` is classified as **runtime** (excluded). `sources` is classified as **config** (included)
> because it represents which channels/sources the platform is configured to connect to; its
> volatile sub-fields (`status`, `metrics`, `lastHeartbeat`, `viewerCount`, `latencyMs`) are
> handled via an optional per-entry **field strip list** (see §5.2) so a restore yields a clean
> "configured but not yet connected" source.

## 4. Collection Registry

A declarative registry is the source of truth for the command. Proposed shape (TypeScript,
`tools/brat/src/backup/registry.ts`):

```ts
export interface BackupCollectionSpec {
  /** Top-level collection id or a path to a nested collection, e.g. "configs/routingRules/rules". */
  path: string;
  /** Recurse into ALL subcollections of each document (default true). */
  recurseSubcollections?: boolean;
  /** Explicit subcollection allowlist; when set, only these subcollections are followed. */
  subcollections?: string[];
  /** Treat docs as sensitive (skip unless --include-secrets). */
  sensitive?: boolean;
  /** Field paths stripped on EXPORT (volatile/runtime fields on otherwise-config docs). */
  stripFields?: string[];
  /** Human rationale (kept in code + surfaced by `brat backup list`). */
  rationale: string;
}

export const CONFIG_BACKUP_REGISTRY: BackupCollectionSpec[] = [
  { path: 'users', recurseSubcollections: true, rationale: 'User profiles + roles subcollection' },
  { path: 'stories', rationale: 'Authored story definitions' },
  { path: 'configs', recurseSubcollections: true, rationale: 'Routing rules, bot roles, etc.' },
  { path: 'stream_observers', rationale: 'Stream observer config' },
  { path: 'mcp_servers', rationale: 'Registered MCP servers' },
  { path: 'schedules', rationale: 'Scheduled job definitions' },
  { path: 'sources', stripFields: ['status', 'streamStatus', 'metrics', 'lastHeartbeat',
      'lastStatusUpdate', 'lastStreamUpdate', 'lastError', 'viewerCount', 'latencyMs'],
    rationale: 'Configured sources/channels (volatile status fields stripped)' },
  { path: 'gateways/api/tokens', sensitive: true, rationale: 'API tokens (opt-in via --include-secrets)' },
];

/** Hard guard: collections that must NEVER appear in a backup, even if added to the registry. */
export const FORBIDDEN_PREFIXES = ['events', 'mutation_log', 'state', 'summarization_runs',
  'tool_usage', 'prompt_logs'];
```

`FORBIDDEN_PREFIXES` is a belt-and-braces guard (asserted in code + unit-tested) so the brief's
"never export `events`/logs" rule cannot be violated by a registry edit. Any registry path matching
a forbidden prefix fails fast at startup.

## 5. Backup File Format

### 5.1 Envelope

A single versioned JSON document (human-readable, diff-able, git-friendly). For the small volume of
config data this is simpler and safer than a directory of shards; a future `--format ndjson` /
per-collection-file option is left as an extension point.

```json
{
  "format": "bitbrat.config-backup",
  "schemaVersion": 1,
  "metadata": {
    "exportedAt": "2026-06-22T19:39:00.000Z",
    "sourceProjectId": "bitbrat-dev",
    "databaseId": "(default)",
    "bratVersion": "0.1.0",
    "registryVersion": 1,
    "includeSecrets": false,
    "collectionCount": 7,
    "documentCount": 142
  },
  "collections": {
    "configs/routingRules/rules": [
      {
        "id": "rule-abc123",
        "data": { "name": "vip-greeting", "enabled": true,
                  "createdAt": { "__type": "timestamp", "value": "2026-01-01T00:00:00.000Z" } },
        "subcollections": {}
      }
    ]
  }
}
```

### 5.2 Typed value encoding (round-tripping Firestore types)

`JSON.stringify` cannot represent Firestore-native types. v1 uses a small **typed-wrapper**
convention so export→import is lossless:

| Firestore type | JSON encoding |
|---|---|
| Timestamp | `{ "__type": "timestamp", "value": "<ISO-8601>" }` |
| GeoPoint | `{ "__type": "geopoint", "latitude": <n>, "longitude": <n> }` |
| DocumentReference | `{ "__type": "ref", "path": "collection/doc/..." }` |
| Bytes / Buffer | `{ "__type": "bytes", "value": "<base64>" }` |
| `null` / number / string / bool | native JSON |
| Map / Array | recurse |

A key (`__type`) collision with real user data is avoided by reserving the `__type` key and
escaping any literal map that legitimately contains it (`{ "__escaped": true, ... }`). The encoder
strips `undefined` (consistent with `stripUndefinedDeep` in `src/services/persistence/model.ts` and
`ignoreUndefinedProperties` in `firebase.ts`).

### 5.3 Document IDs & subcollections

- **Document IDs are preserved** (`id`) and re-applied on import via `.doc(id).set(...)`. This
  matters because some collections (e.g. `configs/routingRules/rules`) are created today with
  auto-IDs via `.add()`; preserving IDs keeps cross-references stable.
- Subcollections are stored under each document's `subcollections` map keyed by subcollection id,
  recursively, so nested config (e.g. `users/{id}/roles`, `configs/bot/roles`) round-trips.

## 6. CLI Surface

Consistent with existing brat conventions (`--env` / `BITBRAT_ENV`, `--project-id`, `--region`,
`--dry-run`, `--json`, exit codes via `exitCodeForError`).

```
brat backup list                       # print the config registry + rationale (no DB access)
brat backup export --env <name> [--project-id <id>] [--out <path>]
                   [--collections a,b] [--include-secrets] [--pretty] [--json]
brat backup import --in <path> --env <name> [--project-id <id>]
                   [--mode merge|overwrite|skip] [--collections a,b]
                   [--dry-run] [--confirm] [--include-secrets] [--json]
```

Dispatch is added to `main()` in `cli/index.ts` as a new `c1 === 'backup'` branch (with `c2` ∈
`{list, export, import}`), plus a `brat backup ...` block in `printHelp()`.

### 6.1 Export semantics
- Read-only. Walks the registry, applies `stripFields`, excludes `sensitive` unless
  `--include-secrets`, encodes typed values, and writes the envelope to `--out`
  (default `./bitbrat-config-backup-<projectId>-<timestamp>.json`) or stdout with `--json`.
- `--collections` narrows to a subset (each must be present in the registry).

### 6.2 Import semantics
- **`--dry-run` is the default behavior for safety**; a real write requires `--confirm`.
- Validates the envelope (`format`, `schemaVersion`) before any write; rejects on incompatible
  `schemaVersion` and warns on `registryVersion` mismatch.
- **Write modes:**
  - `merge` (default): `set(data, { merge: true })` — additive, safe for partially-populated targets.
  - `overwrite`: `set(data)` — replaces each document wholesale.
  - `skip`: only writes documents that do not already exist (ideal for "blank target" seeding).
- Writes use **`BulkWriter`/batched commits** (Firestore batch limit = 500 ops) and process
  subcollections after their parent. A dry-run prints a per-collection diff summary
  (creates / updates / skips) and the total op count.
- Re-applies the `FORBIDDEN_PREFIXES` guard on import too, so a hand-edited backup file cannot
  inject `events`/log data.

### 6.3 "Blank platform" restore (the core use case)
`brat backup import --in cfg.json --env prod --mode skip --confirm` against an empty database
recreates every config document with its original ID and nested subcollections, yielding a fully
configured-but-clean platform with no historical event/log data.

## 7. Cross-Cutting Concerns

### 7.1 Connection & multi-database
A new `tools/brat/src/providers/gcp/firestore.ts` mirrors `src/common/firebase.ts`: firebase-admin
+ ADC, project id from `--project-id`/`PROJECT_ID`/`GCLOUD_PROJECT`, database id via the same
`resolveDatabaseId()` semantics, and `FIRESTORE_EMULATOR_HOST` support for tests/local. Export and
import are explicitly scoped to a single (project, database) pair and **always log** the resolved
target (AGENTS.md §8) before any operation.

### 7.2 Safety rails
- Dry-run default on import; explicit `--confirm` required to write.
- Project/database is echoed and (for non-dry-run) must match `--env`/`--project-id` to avoid
  writing config into the wrong instance.
- The allowlist registry + `FORBIDDEN_PREFIXES` guard ensure logs are never touched in either direction.

### 7.3 Secrets
`gateways/api/tokens` (and any future `sensitive: true` entry) is **excluded by default**. Operators
must pass `--include-secrets` to export/import them; when omitted, the envelope records
`includeSecrets: false` so a reviewer knows secrets were not captured. Backup files containing
secrets must be treated as secret material (documented in the command help and the operator runbook).

### 7.4 Observability & errors
All filesystem and Firestore operations are logged through the brat logger
(`orchestration/logger`) with context, and errors use the existing `BratError` hierarchy
(`ConfigurationError`, `DependencyError`) with `exitCodeForError` for stable exit codes
(AGENTS.md §8/§9).

### 7.5 Idempotency
`merge`/`skip` modes + preserved document IDs make re-running an import idempotent. Repeated exports
of an unchanged database produce semantically identical envelopes (modulo `metadata.exportedAt`).

## 8. Testing Strategy (for the future implementation task)

- **Serializer round-trip unit tests:** every typed value (Timestamp, GeoPoint, DocumentReference,
  Bytes, nested maps/arrays, `undefined` stripping) survives encode→decode.
- **Exclusion guard tests (highest priority):** assert that `events`, `snapshots`, `mutation_log`,
  `state`, `summarization_runs`, `tool_usage`, `prompt_logs` are **never** present in an export,
  and that a registry entry matching `FORBIDDEN_PREFIXES` fails fast.
- **Emulator round-trip:** seed config + log data into the Firestore emulator
  (`FIRESTORE_EMULATOR_HOST`), export, wipe, import into a blank emulator DB, and assert config
  collections (with IDs + subcollections) match while log collections remain empty.
- **CLI tests:** dry-run default, `--confirm` gating, `--collections` narrowing, secrets opt-in.

These integrate into `validate_deliverable.sh` (Jest) for the implementation sprint task.

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| New log collection added later, accidentally exported | Allowlist registry + `FORBIDDEN_PREFIXES` guard + guard unit test. |
| Firestore types lost via naive JSON | Typed-wrapper encoding (§5.2) with round-trip tests. |
| Auto-ID collections lose referential integrity | Preserve and re-apply document IDs on import. |
| Importing into the wrong project/db | Dry-run default, `--confirm`, target echo + `--env`/`--project-id` match check. |
| Secret leakage in backup files | Secrets excluded by default; explicit `--include-secrets`; runbook treats files as secret. |
| Large config exceeding batch limits | `BulkWriter`/500-op batched commits; parents before subcollections. |

## 10. Out of Scope (v1)

- Full data dumps (events/logs), incremental/delta backups, scheduled/automated backups.
- Encryption-at-rest of backup files (handled by the operator's storage; runbook guidance only).
- Cross-schema migration/transformation (this is a faithful copy, not a migration tool).

## 11. Phased Rollout

1. **Task 1 (this doc):** approve the approach.
2. Implement the Firestore provider, registry, typed serializer, and `brat backup list/export/import`.
3. Add tests (serializer, exclusion guard, emulator round-trip) and wire `validate_deliverable.sh`.
4. Update `brat` help + an operator runbook; publish PR.

## 12. Traceability

- Sprint: `sprint-319-740b5b` — `planning/sprint-319-740b5b/`.
- Request: REQ-001 in `planning/sprint-319-740b5b/request-log.md`.
- Plan: `planning/sprint-319-740b5b/implementation-plan.md`.
