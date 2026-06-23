# Operator Runbook — `brat backup` (Firestore config export / import)

> Companion to the Technical Architecture: `documentation/technical-architecture/brat-firestore-config-backup.md`.
> Sprint: `sprint-319-740b5b`.

`brat backup` exports and imports JSON backups of the platform's **core configuration** Firestore
collections so a known-good configuration can be transferred to a **blank** instance. The `events`
collection and all other **log/event** collections are **never** included (enforced by an allowlist
registry + a `FORBIDDEN_PREFIXES` guard applied on both export and import).

## Commands

```
brat backup list [--json]
brat backup export [--project-id <id> | --target <name>] [--out <path>] \
                   [--collections a,b] [--include-secrets] [--pretty] [--json]
brat backup import --in <path> [--project-id <id> | --target <name>] \
                   [--mode merge|overwrite|skip] [--collections a,b] \
                   [--include-secrets] [--dry-run] [--confirm] [--json]
```

- `brat backup list` — print the config collection registry + rationale (no DB access).
- `brat backup export` — read-only; writes a versioned envelope (default
  `./bitbrat-config-backup-<projectId>-<timestamp>.json`, or stdout with `--json`).
- `brat backup import` — **dry-run by default**; a real write requires `--confirm`.

## What is / isn't backed up

Run `brat backup list` for the authoritative list. Included (config): `users` (+ `roles`),
`stories`, `configs` (+ nested e.g. `routingRules/rules`, `bot/roles`), `stream_observers`,
`mcp_servers`, `schedules`, `sources` (volatile status fields stripped), and `gateways/api/tokens`
(sensitive — opt-in). **Never** exported: `events`, `mutation_log`, `state`, `summarization_runs`,
`tool_usage`, `prompt_logs`.

## "Blank platform" restore (the core use case)

```
brat backup import --in cfg.json --project-id <dest> --mode skip --confirm
```

`skip` only writes documents that do not already exist — ideal for seeding an empty database.
Document IDs and nested subcollections are preserved, so cross-references stay stable.

Modes:
- `merge` (default) — `set(data, { merge: true })`; additive, safe for partially-populated targets.
- `overwrite` — replaces each document wholesale.
- `skip` — only creates missing documents.

## Targeting a destination

- **Real GCP database:** `--project-id <id>` (resolved via ADC; `--database`/`FIRESTORE_DATABASE_ID`
  for a named multi-database). A non-dry-run GCP import **requires** an explicit `--project-id` as a
  safety check so config is never written into the wrong instance.
- **Local/remote docker stack (Firestore emulator):** `--target <name>` reads `deploymentTargets`
  from `architecture.yaml`:
  - `--target local` → the published emulator at `localhost:8080` (project `bitbrat-local`).
  - `--target staging` → an **SSH tunnel** to the remote published `8080` (preferred), falling back
    to `bitbrat.lan:8080` if the tunnel can't be established. The engine is already addressed over
    SSH (`ssh://root@bitbrat.lan`), so the tunnel needs no extra firewall openings.

The resolved target (project/database or emulator host:port) is always echoed and logged before any
operation.

## Secrets handling

`gateways/api/tokens` is **sensitive** and **excluded by default**. The envelope records
`metadata.includeSecrets: false` so a reviewer knows secrets were not captured. To include them, pass
`--include-secrets` on **both** export and import. **Treat any backup file produced with
`--include-secrets` as secret material** — store it encrypted / access-controlled and delete it when
no longer needed.

## ⚠️ Emulator durability caveat

The docker-stack Firestore **emulator** is not managed Firestore. Its data lives in the
`firebase-data-v2` docker volume and is **wiped by `docker compose down -v`** (and by
`brat docker down` if it removes volumes). Backups created from / restored into an emulator are for
seeding and local/staging workflows — not a durable system of record.

## Safety summary

- Import is dry-run by default; `--confirm` required to write.
- Allowlist registry + `FORBIDDEN_PREFIXES` guard ensure log/event data is never exported or
  imported, even from a hand-edited backup file.
- Resolved target echoed before any operation; explicit `--project-id` required for real GCP writes.
- Errors use the brat `BratError` hierarchy with stable exit codes (`exitCodeForError`).
