# Standard Service Dockerfile — Usage & Template

- **Sprint:** sprint-318-c0c7c5
- **Source of truth:** `documentation/technical-architecture/reusable-service-dockerfile.md`
- **Artifact:** `Dockerfile.service` (repo root)

## What it is

`Dockerfile.service` is the single, parametrized **standard service Dockerfile** used to build every
standard Node/TypeScript BitBrat service. Per-service behavior is supplied as **build arguments**
instead of a forked per-service Dockerfile.

## Build arguments

| `ARG`           | Default                 | Meaning                                                   |
|-----------------|-------------------------|----------------------------------------------------------|
| `NODE_IMAGE`    | `node:24-bookworm-slim` | Base image for both stages (single point of upgrade).    |
| `SERVICE_NAME`  | *(required)*            | Logical service name; also exported as `ENV SERVICE_NAME`.|
| `SERVICE_ENTRY` | *(required)*            | Compiled entry path, e.g. `dist/apps/llm-bot-service.js`. |
| `SERVICE_PORT`  | `3000`                  | Listen port; `EXPOSE`d and exported as `ENV SERVICE_PORT`.|

## Deriving `SERVICE_ENTRY` from `architecture.yaml`

`SERVICE_ENTRY` is **not** a new source of truth. It is derived deterministically from each service's
`services.<name>.entry` field in `architecture.yaml`:

```
src/<path>.ts   ->   dist/<path>.js
```

i.e. strip the leading `src/`, prepend `dist/`, and swap the `.ts` extension for `.js` (the standard
`tsconfig.json` `outDir: dist` layout, where the build context only contains `src/`).

Examples:

| `architecture.yaml` `entry:`        | Derived `SERVICE_ENTRY`              |
|-------------------------------------|-------------------------------------|
| `src/apps/llm-bot-service.ts`       | `dist/apps/llm-bot-service.js`      |
| `src/apps/oauth-service.ts`         | `dist/apps/oauth-service.js`        |
| `src/services/image-gen-mcp/index.ts` | `dist/services/image-gen-mcp/index.js` |

The derivation is implemented in `infrastructure/scripts/extract-config.js` (emits `SERVICE_ENTRY`),
consumed by `infrastructure/deploy-cloud.sh`, and forwarded to Cloud Build as `_SERVICE_ENTRY`.

## Local build example

```bash
docker build -f Dockerfile.service \
  --build-arg SERVICE_NAME=llm-bot \
  --build-arg SERVICE_ENTRY=dist/apps/llm-bot-service.js \
  --build-arg SERVICE_PORT=3000 \
  -t llm-bot:latest .

# boot + health check
docker run -d --rm -p 3000:3000 --name llm-bot llm-bot:latest
curl -fsS http://localhost:3000/healthz   # or the service's documented health path
docker stop llm-bot
```

## Escape hatch — the "wherever possible" clause (§3.4)

A service may still ship its own `Dockerfile.<service>` when it genuinely needs something the standard
image cannot express (extra OS packages, native build deps, a different base image, GPU, a non-`src/`
build layout, etc.).

**Resolution order (implemented in `deploy-cloud.sh`):**

1. If `Dockerfile.<service>` exists → use it (explicit override).
2. Otherwise → use `Dockerfile.service` with derived build args (the default path).

This preserves backward compatibility and gives a clean, documented exception mechanism instead of
silent forks. Example of a current escape-hatch service: `brat` (builds from `tools/`, which is
outside the standard `src/`-only build context).
