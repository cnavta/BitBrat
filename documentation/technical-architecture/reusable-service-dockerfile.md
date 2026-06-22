# Technical Architecture: Reusable Standard Service Dockerfile

## Status
- **Date:** 2026-06-22
- **Author:** DevOps Architect (@Junie)
- **Sprint:** sprint-318-c0c7c5
- **Status:** Proposed

## 1. Problem Statement

The repository currently follows a **dockerfile-per-service** strategy: there are 18 root-level
`Dockerfile.<service>` files (e.g. `Dockerfile.llm-bot`, `Dockerfile.event-router`,
`Dockerfile.persistence`, …). The overwhelming majority of these files are **near-identical**.

This duplication is a maintenance and security liability:

- **Drift:** A change to the base image, an OS patch, a hardening fix, or a build optimization must
  be hand-applied to ~18 files. In practice they have already diverged into two families (see §2),
  so the fleet is not built consistently.
- **Cost of change:** Adding a new service requires copy-pasting ~40 lines of boilerplate; bumping
  Node, adding a non-root user, or adding a `HEALTHCHECK` is an 18-file pull request.
- **Review burden:** Reviewers cannot easily tell whether a per-service Dockerfile contains an
  intentional difference or an accidental one.

### Goal
Re-use a **single, parametrized standard service Dockerfile** (plus a documented template for the
rare exceptions) so that every Node/TypeScript service is built the same way, with per-service
behavior supplied as **build/runtime parameters** rather than as a forked file.

## 2. Current State Analysis

A review of all 18 root Dockerfiles reveals exactly **two families**.

### 2.1 "Standard" family (15 services)
`api-gateway`, `auth`, `brat`, `event-router`, `image-gen-mcp`, `ingress-egress`, `llm-bot`,
`oauth-flow`, `obs-mcp`, `persistence`, `query-analyzer`, `scheduler`, `state-engine`,
`stream-analyst`, `tool-gateway`.

Canonical shape (multi-stage):

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS builder
WORKDIR /workspace
ENV DEBIAN_FRONTEND=noninteractive
RUN set -ex; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then rm -f /etc/apt/sources.list.d/debian.sources; fi && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm-updates main" >> /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian-security bookworm-security main" >> /etc/apt/sources.list && \
    apt-get update -o Acquire::Check-Valid-Until=false
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive
RUN set -ex; \
    ... (identical apt source fix) ... && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /workspace/dist ./dist
COPY architecture.yaml ./architecture.yaml
EXPOSE 3000
ENV SERVICE_NAME=<service>
ENV SERVICE_PORT=3000
CMD ["node", "dist/apps/<entry>.js"]
```

**The only differences between these 15 files are three values:**

| Variable          | Example                                   | Source of truth                          |
|-------------------|-------------------------------------------|------------------------------------------|
| `SERVICE_NAME`    | `llm-bot`                                  | service key in `architecture.yaml`       |
| Port              | `3000` (all except `stream-analyst`=`3010`) | `architecture.yaml` deployment knobs     |
| CMD entry path    | `dist/apps/llm-bot-service.js`            | `architecture.yaml` `entry:` (compiled)  |

Everything else (base image, apt source fix, two-stage layout, `npm ci` / `npm ci --omit=dev`,
`curl` install for health checks, copying `dist/` and `architecture.yaml`) is byte-for-byte common.

### 2.2 "Legacy" family (3 services)
`disposition-service`, `story-engine-mcp`, `stream-analyst-service`.

These predate the standard pattern and differ structurally:

- `FROM node:24-slim` (not `bookworm-slim`), no apt source fix, no `curl`.
- `WORKDIR /app` (not `/workspace`).
- `RUN npm ci --production` (vs. `npm ci --omit=dev`).
- `COPY . .` in the builder (copies the whole context, not just `src` + `tsconfig.json`).
- `CMD ["node", "dist/src/apps/<entry>.js"]` — note the extra `src/` segment vs. the standard
  family's `dist/apps/...`.

These are **functionally equivalent** to the standard family but inconsistent. They are candidates
to be **normalized onto the standard Dockerfile** during migration (see §6), which also resolves the
`dist/src/...` vs `dist/apps/...` output-path discrepancy.

> **Note — `stream-analyst` vs `stream-analyst-service`:** there are two Dockerfiles with overlapping
> CMDs (`dist/apps/...` vs `dist/src/apps/stream-analyst-service.js`). Migration will reconcile these
> against the single `stream-analyst` service defined in `architecture.yaml`.

### 2.3 Build tooling already supports parametrization
Crucially, the migration does **not** require inventing a new build mechanism — the tooling is
already parameter-driven:

- `cloudbuild.oauth-flow.yaml` builds with `docker build -f '${_DOCKERFILE}' …` and passes
  `_SERVICE_NAME` and `_PORT` substitutions; `_DOCKERFILE` defaults to `Dockerfile.oauth-flow` but
  is a substitution, so it can point at a shared file.
- `infrastructure/deploy-cloud.sh` resolves a Dockerfile per service
  (`Dockerfile.<service>` / `Dockerfile.<service-kebab>`), reads port/cpu/memory/instances from
  `architecture.yaml`, and forwards `_DOCKERFILE`, `_SERVICE_NAME`, `_PORT` into Cloud Build.
- `architecture.yaml` already encodes everything per-service that varies:
  - `services.<name>.entry` → e.g. `src/apps/llm-bot-service.ts` (the single source of truth for the
    startup module).
  - `deploymentDefaults.cloud-run` → port/cpu/memory/min/max instances.

This means a parametrized Dockerfile can be driven entirely from **existing** configuration.

## 3. Proposed Approach

Introduce one canonical, parametrized **`Dockerfile.service`** at the repo root (the "standard
service Dockerfile"), plus a short **template/usage doc**. All standard-family services build from
it by passing build arguments. Per-service Dockerfiles are deleted once migrated.

### 3.1 Parametrization model
The standard Dockerfile exposes a small, closed set of `ARG`s with sensible defaults:

| `ARG`             | Default                | Meaning                                                      |
|-------------------|------------------------|--------------------------------------------------------------|
| `NODE_IMAGE`      | `node:24-bookworm-slim`| Base image for both stages (single point of upgrade).        |
| `SERVICE_NAME`    | *(required)*           | Logical service name; also set as `ENV SERVICE_NAME`.        |
| `SERVICE_ENTRY`   | *(required)*           | Compiled entry path, e.g. `dist/apps/llm-bot-service.js`.    |
| `SERVICE_PORT`    | `3000`                 | Listen port; `EXPOSE`d and set as `ENV SERVICE_PORT`.        |

`SERVICE_ENTRY` is **derived deterministically** from `architecture.yaml`'s `entry:` field
(`src/apps/<x>.ts` → `dist/apps/<x>.js` under the standard `tsconfig` output layout), so it does not
introduce a new source of truth.

### 3.2 Reference reusable Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
# Reusable standard service Dockerfile for all Node/TypeScript BitBrat services.
# Per-service behavior is supplied via --build-arg; nothing here is service-specific.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- builder ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /workspace
ENV DEBIAN_FRONTEND=noninteractive
RUN set -ex; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then rm -f /etc/apt/sources.list.d/debian.sources; fi && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm-updates main" >> /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian-security bookworm-security main" >> /etc/apt/sources.list && \
    apt-get update -o Acquire::Check-Valid-Until=false
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- runner ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /workspace
ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive
RUN set -ex; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then rm -f /etc/apt/sources.list.d/debian.sources; fi && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm main" > /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian bookworm-updates main" >> /etc/apt/sources.list && \
    echo "deb [trusted=yes] http://deb.debian.org/debian-security bookworm-security main" >> /etc/apt/sources.list && \
    apt-get update -o Acquire::Check-Valid-Until=false && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /workspace/dist ./dist
COPY architecture.yaml ./architecture.yaml

# --- service-specific parameters ---
ARG SERVICE_NAME
ARG SERVICE_ENTRY
ARG SERVICE_PORT=3000
ENV SERVICE_NAME=${SERVICE_NAME}
ENV SERVICE_PORT=${SERVICE_PORT}
ENV SERVICE_ENTRY=${SERVICE_ENTRY}
EXPOSE ${SERVICE_PORT}

# Use the shell form so ${SERVICE_ENTRY} is expanded at runtime from ENV.
CMD ["sh", "-c", "exec node \"$SERVICE_ENTRY\""]
```

Build example (matches the existing Cloud Build invocation shape):

```bash
docker build -f Dockerfile.service \
  --build-arg SERVICE_NAME=llm-bot \
  --build-arg SERVICE_ENTRY=dist/apps/llm-bot-service.js \
  --build-arg SERVICE_PORT=3000 \
  -t llm-bot:latest .
```

### 3.3 How build tooling consumes it
- **Cloud Build:** the existing `_DOCKERFILE` substitution is set to `Dockerfile.service`, and a new
  `_SERVICE_ENTRY` substitution (derived from `architecture.yaml`) is forwarded as a `--build-arg`.
  `_SERVICE_NAME` and `_PORT` already exist and map directly.
- **`deploy-cloud.sh`:** the Dockerfile-resolution step changes from "require
  `Dockerfile.<service>`" to "use `Dockerfile.service` and derive `SERVICE_ENTRY`/`SERVICE_PORT`
  from `architecture.yaml`", with the per-service file used only as an **override** when present
  (see §3.4).
- **Local (`infrastructure/docker-compose`):** compose `build.args` provide the same three values.

### 3.4 Escape hatch (the "wherever possible" clause)
A service may still ship its own `Dockerfile.<service>` when it genuinely needs something the
standard image cannot express (extra OS packages, native build deps, a different base image, GPU,
etc.). Resolution order:

1. If `Dockerfile.<service>` exists → use it (explicit override).
2. Otherwise → use `Dockerfile.service` with derived build args (the default path).

This preserves backward compatibility and gives a clean, documented exception mechanism instead of
silent forks.

## 4. Architecture Decisions & Rationale

- **Single `Dockerfile.service` + build args** over Docker `ONBUILD`/Bake/external generator:
  lowest cognitive load, no new tooling, and it slots directly into the existing `_DOCKERFILE`
  substitution. Docker Bake is noted as a future option (§7) but is not required.
- **`SERVICE_ENTRY` as a build arg derived from `architecture.yaml` `entry:`** rather than a new
  per-service env file: keeps `architecture.yaml` the canonical source of truth (precedence rule)
  and avoids a second place to update.
- **Keep the apt source-list fix and `curl`** in the standard image: these already exist fleet-wide
  in the standard family and are relied upon for Cloud Run health checks; the reuse effort must be
  behavior-preserving, not a hardening project (hardening is tracked separately in §7).
- **Normalize legacy services onto the standard image** rather than keep a second template: the
  legacy differences (`/app`, `--production`, `dist/src/...`) carry no functional benefit.

## 5. Impact on `architecture.yaml` (precedence)
This change is **consistent with** and **driven by** `architecture.yaml`; it does not contradict it.
Recommended (non-breaking) clarifications to add during implementation:

- Document under `infrastructure` (or a new `build:` block) that the canonical build artifact is
  `Dockerfile.service`, and that `services.<name>.entry` maps to the compiled
  `dist/apps/<name>.js` `SERVICE_ENTRY`.
- Optionally add an explicit per-service `port` where a service deviates from the `3000` default
  (e.g. `stream-analyst` = `3010`) so the build arg derivation is unambiguous.

Any such edit will be proposed with justification per AGENTS.md §1.2.

## 6. Migration Strategy (low-risk, reversible)
Executed in **future sprint tasks** (out of scope for this document):

1. **Add** `Dockerfile.service` and this template; do not delete anything yet.
2. **Pilot** one standard service (e.g. `llm-bot`) by pointing its Cloud Build `_DOCKERFILE` at
   `Dockerfile.service`; verify identical image behavior (build, boot, health check).
3. **Roll out** to the remaining standard-family services in batches; delete each
   `Dockerfile.<service>` only after its build is green on the shared file.
4. **Normalize legacy services** (`disposition-service`, `story-engine-mcp`,
   `stream-analyst-service`) onto `Dockerfile.service`, fixing the `dist/src/...` entry path.
5. **Update tooling defaults** (`deploy-cloud.sh`, `cloudbuild.*`) so new services need *no*
   Dockerfile at all.
6. **Reconcile** the duplicate `stream-analyst` / `stream-analyst-service` Dockerfiles.

## 7. Risks & Mitigations

| Risk                                                              | Mitigation                                                                 |
|-------------------------------------------------------------------|----------------------------------------------------------------------------|
| Wrong/empty `SERVICE_ENTRY` → container starts then exits         | Derive from `architecture.yaml`; CI builds a representative service and boots it; fail fast in build script if empty. |
| Per-service hidden differences not captured by the 3 args         | Audit each Dockerfile against the standard during migration; use the §3.4 escape hatch for true exceptions. |
| Legacy `dist/src/...` vs `dist/apps/...` path mismatch            | Confirm compiled output path per service during normalization; pilot before bulk migration. |
| Big-bang migration breaks the fleet                               | Incremental rollout (§6), per-service green build gate, easy revert (per-service Dockerfile can be restored from git). |
| `architecture.yaml` lacks an explicit port for non-3000 services  | Add explicit `port` for deviators (e.g. `stream-analyst`) before migrating them. |

### Rollback
Because migration is incremental and the override mechanism (§3.4) is retained, rolling a single
service back is "restore its `Dockerfile.<service>`" — the shared file and all other services are
unaffected.

## 8. Out of Scope / Future Work
- Container hardening (non-root `USER`, distroless/`gcr.io/distroless`, explicit `HEALTHCHECK`,
  pinned base-image digests) — worth a dedicated sprint once the single Dockerfile exists, since it
  then becomes a one-file change.
- Docker Bake / build matrix for parallel multi-service builds.
- Build-cache optimization (BuildKit cache mounts for `npm ci`).

## 9. Definition of Done (this document)
- [x] Current state accurately characterized (standard vs legacy families, exact varying values).
- [x] Concrete parametrized reusable Dockerfile design driven by existing inputs.
- [x] Build-tooling integration, migration, risks, and rollback defined.
- [x] Consistent with `architecture.yaml` precedence and AGENTS.md.
