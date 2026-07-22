# Configuration Loading Reference

This document describes how BitBrat loads and merges configuration across execution contexts and services.

---

## Loading Algorithm

### 1. Execution Context Selection

Priority order (first match wins):

1. `--context <name>` CLI flag (highest priority)
2. `BITBRAT_CONTEXT` environment variable
3. `~/.bratrc` current context field
4. Default: `local`

**Example**:
```bash
# Uses 'staging' context (overrides ~/.bratrc)
npm run brat -- fleet list --context staging

# Uses context from ~/.bratrc
npm run brat -- fleet list

# Force local context via env var
BITBRAT_CONTEXT=local npm run brat -- chat
```

---

### 2. Environment File Loading

For a given execution context (e.g., `local`), files are loaded in this order:

```
env/{context}/
  ├── 1. global.yaml           ← Baseline for all services
  ├── 2. infra.yaml            ← Infrastructure (NATS, PostgreSQL, Firebase)
  ├── 3. {service}.yaml        ← Service-specific overrides
  └── 4. .secure.{context}     ← Secrets (never committed)
```

**Merge Behavior**: Later files **override** earlier files for the same key.

**Example**:

```yaml
# env/local/global.yaml
LOG_LEVEL: info
MESSAGE_BUS_DRIVER: nats

# env/local/llm-bot.yaml
LOG_LEVEL: debug

# Result for llm-bot service:
LOG_LEVEL: debug              # Overridden
MESSAGE_BUS_DRIVER: nats      # Inherited from global
```

---

### 3. File Discovery Patterns

Execution contexts define file patterns in `architecture.yaml`:

```yaml
executionContexts:
  local:
    runtime:
      envOverlay:
        path: env/local
        files:
          - global.yaml
          - infra.yaml
          - "{service}.yaml"
        secure: .secure.local
```

**Pattern Substitution**:
- `{service}` → Service name (e.g., `llm-bot`, `api-gateway`)
- Missing files are silently skipped (not an error)

---

### 4. Secret File Loading

Secret files (`.secure.local`, `.secure.staging`, etc.) are loaded **last** and take precedence over all other sources.

**Format**: Standard shell environment file (Bash-compatible)

```bash
# .secure.local
OPENAI_API_KEY=sk-your-key
TWITCH_CLIENT_ID=abc123
TWITCH_CLIENT_SECRET=xyz789
```

**Security**:
- ✅ Listed in `.gitignore` (never committed)
- ✅ Template provided: `.secure.local.example`
- ✅ Read at runtime, not baked into Docker images

---

## Environment Variable Interpolation

Configuration values can reference environment variables using `${VAR_NAME}` syntax.

### Interpolation Sources (priority order):

1. `.secure.{context}` file (highest priority)
2. Shell environment
3. Docker Compose `.env` file
4. Literal value (if no interpolation)

**Example**:

```yaml
# env/local/global.yaml
DATABASE_URL: ${DATABASE_URL}

# Resolved from (first match):
# 1. .secure.local: DATABASE_URL=postgresql://...
# 2. Shell: export DATABASE_URL=postgresql://...
# 3. Docker .env: DATABASE_URL=postgresql://...
```

### Unresolved Variables

If a variable cannot be resolved:
- **Required services**: Service startup fails with error
- **Optional services**: Warning logged, empty string used

---

## Override Precedence

Full precedence order (highest to lowest):

```
1. Runtime environment variables (e.g., LOG_LEVEL=debug npm run local)
2. .secure.{context}
3. env/{context}/{service}.yaml
4. env/{context}/infra.yaml
5. env/{context}/global.yaml
6. architecture.yaml service defaults
7. Code defaults (hardcoded in service)
```

---

## Context-Specific Behavior

### Local Context

**File**: `env/local/`

**Characteristics**:
- Platform-agnostic baseline (PostgreSQL + NATS)
- Minimal external dependencies
- Designed for newcomers
- All optional integrations disabled by default

**Docker Compose**:
```yaml
# .env file loaded automatically by Docker Compose
# Merged with env/local/*.yaml
DATABASE_URL=postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat
```

---

### Staging Context

**File**: `env/staging/`

**Characteristics**:
- Remote deployment on `bitbrat.lan` (SSH Docker host)
- Shared PostgreSQL instance
- Full integrations enabled (Twitch, Discord, OBS)

**Runtime Override**:
```bash
# Uses staging context + staging secrets
npm run brat -- fleet list --context staging
```

---

### Production Context

**File**: `env/prod/` (or cloud-specific: `env/gcp-prod/`)

**Characteristics**:
- Cloud Run / Kubernetes deployment
- Managed services (Cloud SQL, Pub/Sub)
- Secrets from cloud provider (Google Secret Manager, AWS Secrets Manager)
- High availability, autoscaling

**Secret Management**:
- Not `.secure.prod` file (insecure for production)
- Use cloud secret manager:
  ```yaml
  # architecture.yaml
  services:
    llm-bot:
      secrets:
        OPENAI_API_KEY:
          gcp: "projects/123/secrets/openai-api-key/versions/latest"
  ```

---

## Service-Specific Configuration

Each service can define its own configuration schema.

### Required vs. Optional Keys

**Required**: Service fails to start if missing
```yaml
# llm-bot.yaml
LLM_BOT_LLM_PROVIDER: openai  # Required
```

**Optional**: Uses default if missing
```yaml
# llm-bot.yaml
LLM_BOT_MEMORY_MAX_MESSAGES: 8  # Optional (has default)
```

### Validation

Services validate configuration on startup using Zod schemas (if defined).

**Example Error**:
```
Error: Invalid configuration for llm-bot
  - LLM_BOT_LLM_PROVIDER: Required
  - LLM_BOT_MEMORY_MAX_CHARS: Expected number, received string
```

---

## Advanced Patterns

### Cross-Service Configuration Sharing

**Problem**: Multiple services need the same value (e.g., `OPENAI_API_KEY`)

**Solution**: Define once in `global.yaml`, inherit everywhere

```yaml
# env/local/global.yaml
OPENAI_API_KEY: ${OPENAI_API_KEY}  # From .secure.local

# Services automatically inherit:
# - llm-bot
# - query-analyzer
# - context-pack (if using OpenAI embeddings)
```

---

### Per-Environment Model Selection

**Problem**: Use cheap model in dev, expensive model in prod

**Solution**: Override in context-specific `global.yaml`

```yaml
# env/local/global.yaml
LLM_BOT_LLM_MODEL: gpt-4.1-mini

# env/prod/global.yaml
LLM_BOT_LLM_MODEL: gpt-4.1
```

---

### Feature Flag Overrides

**Problem**: Enable feature in staging, disable in production

**Solution**: Context-specific service override

```yaml
# env/staging/llm-bot.yaml
LLM_BOT_BEHAVIORAL_GATING_ENABLED: false  # Disable safety checks in staging

# env/prod/llm-bot.yaml
LLM_BOT_BEHAVIORAL_GATING_ENABLED: true   # Enable safety checks in production
```

---

### Debug Logging for Specific Service

**Problem**: Too much noise in logs, need to focus on one service

**Solution**: Service-specific override

```yaml
# env/local/global.yaml
LOG_LEVEL: info

# env/local/event-router.yaml
LOG_LEVEL: debug  # Only event-router logs at debug level
```

---

## Troubleshooting

### Configuration Not Applied

**Symptom**: Changed config but service still uses old value

**Debug**:
```bash
# View resolved configuration
npm run brat -- config show

# View service-specific config
npm run brat -- fleet info <service>
```

**Common causes**:
1. Forgot to restart service after change
2. Override in wrong file (check precedence)
3. Typo in service name (`llm-bot` vs `llm_bot`)
4. Docker Compose cached env (run `npm run local:down && npm run local`)

---

### Secret Not Loaded

**Symptom**: Service fails with "Missing required secret"

**Debug**:
```bash
# Verify .secure.local exists and is readable
cat env/local/.secure.local

# Check file permissions
ls -la env/local/.secure.local

# Verify Docker Compose can access it
docker compose config
```

**Common causes**:
1. File doesn't exist (copy from `.secure.local.example`)
2. Wrong file name (`.secure.local` not `.secure-local`)
3. Not sourced in Docker Compose (check `docker-compose.yaml` env_file)

---

### Environment Variable Not Interpolated

**Symptom**: Literal `${VAR_NAME}` in logs instead of actual value

**Debug**:
```bash
# Check if variable is set
echo $VAR_NAME

# Check .secure.local
grep VAR_NAME env/local/.secure.local

# Check Docker Compose resolution
docker compose run --rm <service> printenv VAR_NAME
```

**Common causes**:
1. Variable not defined in any source
2. Typo in variable name
3. `.secure.local` not sourced (check Docker Compose `env_file`)

---

### Conflicting Configuration

**Symptom**: Unexpected value, unsure which file provided it

**Debug**:
```bash
# Trace configuration loading
DEBUG=config npm run brat -- config show

# Check architecture.yaml for service defaults
grep -A 20 "services:" architecture.yaml | grep -A 10 "<service-name>"
```

**Solution**: Follow precedence order (see "Override Precedence" above)

---

## Best Practices

### ✅ Do

- **Keep secrets in `.secure.{context}`** (never in YAML files)
- **Use `global.yaml` for shared config** (reduce duplication)
- **Document service-specific overrides** (add comments explaining why)
- **Use environment interpolation** for portability (`${DATABASE_URL}`)
- **Validate config on service startup** (fail fast on misconfiguration)

### ❌ Don't

- **Don't commit `.secure.*` files** (already in `.gitignore`)
- **Don't hardcode secrets in YAML** (use interpolation)
- **Don't duplicate config** (use `global.yaml` + service overrides)
- **Don't use production secrets in dev** (create separate `.secure.local`)
- **Don't skip `.secure.local.example`** (template helps newcomers)

---

## See Also

- [Quickstart Guide](../../env/local/README.md) - Simplified explanation for newcomers
- [Execution Contexts](../concepts/execution-contexts.md) - Context model and switching
- [Docker Compose Configuration](../guides/docker-compose.md) - How env files map to containers
- [Security Best Practices](../guides/security.md) - Secret management in production
