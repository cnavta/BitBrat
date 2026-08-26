# Execution Plan: Agent-Dev Environment Completion
## Sprint 26 (Proposed)

**Previous Sprint**: Sprint 25 - Agent-Dev Environment Stabilization
**Status**: Infrastructure inclusion ✅ COMPLETE | Full functionality ⏸️ INCOMPLETE
**Prepared**: 2026-08-26
**Estimated Effort**: 12-16 hours
**Priority**: P1 (Critical for developer experience)

---

## Executive Summary

Sprint 25 successfully resolved the critical blocker (infrastructure services missing from agent-dev compose files). However, testing revealed two significant issues that prevent agent-dev environments from being fully functional:

1. **NATS JetStream not enabled** - Infrastructure registry doesn't translate declarative config to Docker commands
2. **Environment variables missing** - .env.brat lacks required defaults, blocking service startup

This execution plan addresses these issues plus quality-of-life improvements to make agent-dev environments production-ready for developer use.

---

## Problem Statement

### Current State (Post-Sprint 25)
- ✅ Infrastructure services (nats, redis, postgres) included in compose files
- ✅ Infrastructure services start and reach healthy state
- ❌ Application services fail due to JetStream not enabled
- ❌ LLM-bot and event-router fail due to missing environment variables
- ❌ No integration tests to prevent regression
- ❌ No validation before startup
- ❌ Poor error messages when failures occur

### Desired State
- ✅ Full agent-dev stack starts successfully
- ✅ `!ping` command works end-to-end
- ✅ Environment variables properly defaulted
- ✅ JetStream automatically enabled based on architecture.yaml
- ✅ Integration tests prevent regression
- ✅ Clear error messages guide remediation
- ✅ Documented troubleshooting for common issues

---

## Goals & Success Criteria

### Primary Goals (Must Have)
1. **G1: NATS JetStream Auto-Configuration**
   - Architecture.yaml `config.jetstream: true` translates to Docker command flags
   - No manual intervention required for JetStream enablement
   - Success: Generated compose includes command section with `-js` flag

2. **G2: Environment Variable Defaults**
   - .env.brat generated with all required defaults
   - Platform variables (Slack, Discord, Twilio) documented as optional
   - Success: Docker Compose build produces zero warnings about unset variables

3. **G3: End-to-End Validation**
   - Full agent-dev stack starts successfully
   - `!ping` command works (ingress → router → llm-bot → egress)
   - Success: Test message returns expected response

### Secondary Goals (Should Have)
4. **G4: Regression Prevention**
   - Integration tests for compose generation
   - Integration tests for environment generation
   - Success: CI catches broken agent-dev configurations

5. **G5: Developer Experience**
   - Pre-flight validation catches issues before Docker startup
   - Clear error messages with remediation steps
   - Success: Developer can diagnose and fix issues without consulting docs

### Stretch Goals (Nice to Have)
6. **G6: Documentation**
   - Quick start guide
   - Troubleshooting guide
   - Architecture overview
   - Success: New developer can use agent-dev without assistance

7. **G7: Observability**
   - Real-time health check feedback during startup
   - Progress indicators for long operations
   - Success: Developer knows what's happening during startup

---

## Technical Approach

### Phase 1: NATS JetStream Auto-Configuration (G1)

**Problem**: Infrastructure registry reads `config.jetstream: true` but doesn't apply it.

**Root Cause**: Docker Compose generation uses raw service definitions from architecture.yaml without processing the `config` section.

**Solution**:
1. Update `generateDockerCompose()` to process infrastructure config
2. Add `buildCommandArgs()` function that translates config to Docker commands
3. For NATS: `config.jetstream: true` → `command: ["-js", "-sd", "/data", "-m", "8222"]`

**Implementation**:
```typescript
// tools/brat/src/context/generate-docker-compose.ts

function buildInfrastructureCommand(
  service: string,
  config: Record<string, unknown>
): string[] | undefined {
  if (service === 'nats' && config.jetstream === true) {
    return [
      '-js',                    // Enable JetStream
      '-sd', '/data',          // Store directory
      '-m', '8222',            // Monitoring port
    ];
  }

  if (service === 'redis' && config.appendonly === 'yes') {
    return [
      'redis-server',
      '--appendonly', 'yes',
      '--appendfsync', config.appendfsync || 'everysec',
      '--maxmemory', config.maxmemory || '512mb',
      '--maxmemory-policy', config.evictionPolicy || 'allkeys-lru',
    ];
  }

  return undefined;
}
```

**Files**:
- `tools/brat/src/context/generate-docker-compose.ts` (modify)
- `tools/brat/src/infrastructure/registry.ts` (modify)

**Validation**:
- Unit test: `buildInfrastructureCommand('nats', { jetstream: true })` returns correct flags
- Integration test: Generated compose includes command section
- E2E test: NATS container has JetStream enabled (check logs for "jetstream enabled")

**Estimated Effort**: 4-6 hours

---

### Phase 2: Environment Variable Defaults (G2)

**Problem**: .env.brat missing required variables, causing service startup failures.

**Root Cause**: Agent-dev provision hardcodes minimal set of variables, doesn't use template approach.

**Solution**:
1. Create `.env.agent-dev.template` with all required defaults
2. Update agent-dev provision to use template
3. Merge template + user overrides + context-specific values

**Template Strategy**:
```bash
# .env.agent-dev.template

# === REQUIRED PLATFORM VARIABLES ===
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_BOT_SYSTEM_PROMPT="You are a helpful assistant for a Twitch streamer."
REDIS_URL=redis://redis:6379
DATABASE_URL=postgresql://bitbrat:bitbrat@postgres:5432/bitbrat
NATS_URL=nats://nats:4222

# === OPTIONAL PLATFORM INTEGRATIONS (leave blank if not using) ===
# Slack
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
SLACK_SIGNING_SECRET=

# Discord
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# Twitch
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=

# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# === FEATURE FLAGS ===
API_GATEWAY_ALLOW_ANONYMOUS_WS=true
ENABLE_DEBUG_LOGGING=false

# === PERSISTENCE ===
PERSISTENCE_DRIVER=postgres
PERSISTENCE_SNAPSHOT_MODE=all
PERSISTENCE_INCLUDE_RAW_PAYLOADS=true
PERSISTENCE_TTL_DAYS=30
```

**Implementation**:
```typescript
// tools/brat/src/dev-mcp/agent-dev-context-manager.ts

async function generateEnvironmentFile(
  contextName: string,
  userOverrides: Record<string, string> = {}
): Promise<void> {
  // 1. Read template
  const templatePath = path.join(repoRoot, '.env.agent-dev.template');
  const template = fs.readFileSync(templatePath, 'utf-8');

  // 2. Parse template into key-value pairs
  const defaults = parseEnvFile(template);

  // 3. Merge: defaults + user overrides + context-specific
  const contextSpecific = {
    BITBRAT_CONTEXT: contextName,
    NODE_ENV: 'development',
    POSTGRES_PASSWORD: generatePassword(),
  };

  const merged = {
    ...defaults,
    ...userOverrides,
    ...contextSpecific,
  };

  // 4. Write .env.brat
  const envContent = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  fs.writeFileSync('.env.brat', envContent);
}
```

**Files**:
- `.env.agent-dev.template` (new)
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` (modify)
- `tools/brat/src/utils/env-parser.ts` (new - parse .env files)

**Validation**:
- Unit test: Template parsing preserves comments and structure
- Unit test: Merge strategy applies correct precedence
- Integration test: Generated .env.brat has all required variables
- E2E test: Docker Compose build produces zero warnings

**Estimated Effort**: 3-4 hours

---

### Phase 3: End-to-End Validation (G3)

**Problem**: No validation that agent-dev environments actually work.

**Solution**: Automated test that provisions, starts, sends !ping, verifies response.

**Implementation**:
```typescript
// tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts

describe('Agent-Dev End-to-End', () => {
  let contextName: string;

  beforeAll(async () => {
    // Provision
    const result = await agentDevProvision({
      name: 'agent-dev-e2e-test',
      profile: 'dev',
      persistence: 'postgres',
    });
    contextName = result.context.name;

    // Start
    await agentDevStart({ name: contextName });

    // Wait for healthy
    await waitForHealthy(contextName, 60000);
  });

  afterAll(async () => {
    await agentDevDestroy({ name: contextName, confirm: true });
  });

  it('should respond to !ping', async () => {
    // Send message via WebSocket
    const ws = new WebSocket('ws://localhost:3004/ws/v1');
    await once(ws, 'open');

    const correlationId = randomUUID();
    ws.send(JSON.stringify({
      type: 'chat.message.v1',
      correlationId,
      message: { text: '!ping' },
      identity: { platform: 'test', userId: 'test-user' },
    }));

    // Wait for response
    const response = await waitForMessage(ws, correlationId, 5000);

    expect(response.message.text).toContain('pong');
  }, 120000); // 2 minute timeout
});
```

**Files**:
- `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts` (new)
- `tools/brat/src/dev-mcp/__tests__/helpers/websocket-client.ts` (new)

**Validation**:
- Test runs in CI
- Test catches broken configurations
- Test provides clear failure messages

**Estimated Effort**: 3-4 hours

---

### Phase 4: Regression Prevention (G4)

**Problem**: No automated tests prevent agent-dev breakage.

**Solution**: Unit and integration tests for critical paths.

**Test Coverage**:

1. **Compose Generation Tests**:
```typescript
describe('Agent-Dev Compose Generation', () => {
  it('includes infrastructure services', () => {
    const compose = generateAgentDevCompose(context);
    expect(compose.services).toHaveProperty('nats');
    expect(compose.services).toHaveProperty('redis');
    expect(compose.services).toHaveProperty('postgres');
  });

  it('enables JetStream when configured', () => {
    const compose = generateAgentDevCompose(context);
    expect(compose.services.nats.command).toContain('-js');
  });

  it('includes health checks', () => {
    const compose = generateAgentDevCompose(context);
    expect(compose.services.nats.healthcheck).toBeDefined();
    expect(compose.services.redis.healthcheck).toBeDefined();
    expect(compose.services.postgres.healthcheck).toBeDefined();
  });
});
```

2. **Environment Generation Tests**:
```typescript
describe('Agent-Dev Environment Generation', () => {
  it('includes all required variables', () => {
    const env = generateEnvironment(context);
    expect(env).toHaveProperty('LLM_PROVIDER');
    expect(env).toHaveProperty('LLM_MODEL');
    expect(env).toHaveProperty('REDIS_URL');
    expect(env).toHaveProperty('DATABASE_URL');
  });

  it('uses template defaults', () => {
    const env = generateEnvironment(context);
    expect(env.LLM_PROVIDER).toBe('openai');
    expect(env.LLM_MODEL).toBe('gpt-4o-mini');
  });
});
```

**Files**:
- `tools/brat/src/context/__tests__/compose-generation.test.ts` (new)
- `tools/brat/src/dev-mcp/__tests__/environment-generation.test.ts` (new)

**Estimated Effort**: 2-3 hours

---

### Phase 5: Developer Experience (G5)

**Problem**: Cryptic errors, no validation, poor feedback.

**Solution**: Pre-flight checks and improved error messages.

**Pre-Flight Validation**:
```typescript
// tools/brat/src/dev-mcp/agent-dev-validator.ts

export async function validateBeforeStart(
  contextName: string
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Compose file exists and is valid
  const composePath = getComposePath(contextName);
  if (!fs.existsSync(composePath)) {
    errors.push(`Compose file not found: ${composePath}`);
    return { valid: false, errors, warnings };
  }

  // 2. Parse compose and check for undefined service references
  const compose = yaml.parse(fs.readFileSync(composePath, 'utf-8'));
  for (const [name, service] of Object.entries(compose.services)) {
    if (service.depends_on) {
      for (const dep of Object.keys(service.depends_on)) {
        if (!compose.services[dep]) {
          errors.push(
            `Service '${name}' depends on undefined service '${dep}'.\n` +
            `This usually means infrastructure services are missing.\n` +
            `Try re-provisioning: agent_dev.destroy + agent_dev.provision`
          );
        }
      }
    }
  }

  // 3. Check for port conflicts
  const usedPorts = await getUsedPorts();
  const requiredPorts = getRequiredPorts(compose);
  const conflicts = requiredPorts.filter(p => usedPorts.includes(p));
  if (conflicts.length > 0) {
    errors.push(
      `Port conflicts detected: ${conflicts.join(', ')}\n` +
      `Stop conflicting services: docker ps | grep ${conflicts[0]}`
    );
  }

  // 4. Check .env.brat has required variables
  const env = parseEnvFile('.env.brat');
  const requiredVars = ['LLM_PROVIDER', 'REDIS_URL', 'DATABASE_URL'];
  const missing = requiredVars.filter(v => !env[v]);
  if (missing.length > 0) {
    errors.push(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Re-provision context or manually edit .env.brat`
    );
  }

  // 5. Warnings for optional variables
  const optionalVars = ['OPENAI_API_KEY', 'SLACK_BOT_TOKEN'];
  const missingOptional = optionalVars.filter(v => !env[v]);
  if (missingOptional.length > 0) {
    warnings.push(
      `Optional integrations not configured: ${missingOptional.join(', ')}\n` +
      `Some features may not work. See .env.agent-dev.template for setup.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
```

**Improved Error Messages**:
```typescript
// Wrap Docker Compose errors with context
try {
  await dockerComposeUp(contextName);
} catch (error) {
  const parsed = parseDockerError(error);

  if (parsed.type === 'undefined_service') {
    throw new Error(
      `❌ Infrastructure services missing from compose file.\n\n` +
      `Root Cause: ${parsed.service} depends on ${parsed.missing}\n` +
      `Solution: Re-provision the context:\n` +
      `  1. agent_dev.destroy({ name: "${contextName}", confirm: true })\n` +
      `  2. agent_dev.provision({ name: "${contextName}" })\n` +
      `  3. agent_dev.start({ name: "${contextName}" })\n\n` +
      `This is a known issue fixed in Sprint 25.`
    );
  }

  if (parsed.type === 'port_conflict') {
    throw new Error(
      `❌ Port ${parsed.port} is already in use.\n\n` +
      `Find conflicting container: docker ps | grep ${parsed.port}\n` +
      `Stop it: docker stop <container-id>\n` +
      `Or use different port: ${contextName.toUpperCase()}_HOST_PORT=<port>`
    );
  }

  // Default: show original error
  throw error;
}
```

**Files**:
- `tools/brat/src/dev-mcp/agent-dev-validator.ts` (new)
- `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` (modify to use validator)
- `tools/brat/src/utils/docker-error-parser.ts` (new)

**Estimated Effort**: 3-4 hours

---

### Phase 6: Documentation (G6) - OPTIONAL

**Deliverables**:
1. **Quick Start Guide** (`documentation/guides/agent-dev-quick-start.md`)
2. **Troubleshooting Guide** (`documentation/guides/agent-dev-troubleshooting.md`)
3. **Architecture Overview** (update `documentation/guides/agent-dev-contexts.md`)

**Content**:
- Prerequisites (Docker, disk space, ports)
- Common workflows (test new service, validate changes, debug issues)
- Troubleshooting checklist (services won't start, tests fail, ports conflict)
- FAQ (When to use agent-dev? How to share contexts? How to debug?)

**Estimated Effort**: 2-3 hours

---

### Phase 7: Observability (G7) - OPTIONAL

**Real-Time Health Feedback**:
```typescript
async function startWithFeedback(contextName: string): Promise<void> {
  console.log('Starting agent-dev environment...');

  const services = getServicesFromCompose(contextName);
  const status = new Map<string, string>();

  // Start Docker Compose in background
  dockerComposeUpAsync(contextName);

  // Poll for health status
  const interval = setInterval(async () => {
    for (const service of services) {
      const health = await getHealthStatus(contextName, service);

      if (status.get(service) !== health) {
        status.set(service, health);

        const icon = health === 'healthy' ? '✓' :
                     health === 'unhealthy' ? '✗' : '⋯';
        console.log(`  ${icon} ${service}: ${health}`);
      }
    }

    // Stop when all healthy or any failed
    const allHealthy = [...status.values()].every(h => h === 'healthy');
    const anyFailed = [...status.values()].some(h => h === 'unhealthy');

    if (allHealthy || anyFailed) {
      clearInterval(interval);

      if (allHealthy) {
        console.log('\n✅ All services started successfully');
      } else {
        throw new Error('Some services failed to start. Check logs.');
      }
    }
  }, 2000);
}
```

**Estimated Effort**: 2-3 hours

---

## Implementation Sequence

### Week 1: Core Functionality
**Days 1-2**: Phase 1 (JetStream) + Phase 2 (Environment Variables)
- Implement command translation in compose generation
- Create .env.agent-dev.template
- Update provision to use template
- Manual testing with fresh agent-dev context

**Days 3-4**: Phase 3 (E2E Validation)
- Implement E2E test
- Validate !ping works end-to-end
- Fix any issues discovered

### Week 2: Quality & Polish
**Day 5**: Phase 4 (Regression Tests)
- Write unit tests for compose generation
- Write unit tests for environment generation
- Add to CI pipeline

**Day 6**: Phase 5 (Developer Experience)
- Implement pre-flight validation
- Improve error messages
- Manual testing with various failure scenarios

**Day 7** (Optional): Phase 6 (Documentation) + Phase 7 (Observability)
- Write documentation
- Add real-time feedback (if time permits)

---

## Risk Assessment

### High-Risk Items
1. **JetStream command translation complexity**
   - Risk: Edge cases in config → command mapping
   - Mitigation: Start with NATS only, generalize later
   - Fallback: Hardcode NATS commands for agent-dev contexts

2. **Environment variable template maintenance**
   - Risk: Template gets out of sync with architecture.yaml
   - Mitigation: Generate template from architecture.yaml (future)
   - Fallback: Document required variables, accept manual sync

### Medium-Risk Items
3. **E2E test flakiness**
   - Risk: Timeouts, race conditions, resource constraints
   - Mitigation: Generous timeouts, retry logic, cleanup
   - Fallback: Manual testing checklist

4. **Port conflict detection**
   - Risk: False positives, platform-specific behavior
   - Mitigation: Test on macOS/Linux, provide override
   - Fallback: Clear error messages guide manual resolution

### Low-Risk Items
5. **Documentation lag**
   - Risk: Docs don't reflect latest changes
   - Mitigation: Update docs in same PR as code changes
   - Fallback: Mark docs as "in progress"

---

## Success Metrics

### Quantitative
- ✅ Zero "undefined service" errors in agent-dev
- ✅ Zero environment variable warnings during Docker Compose build
- ✅ 100% of E2E tests pass (target: !ping response < 5 seconds)
- ✅ 90%+ code coverage for agent-dev modules
- ✅ CI passes with agent-dev smoke test

### Qualitative
- ✅ Developer can provision and start agent-dev without errors
- ✅ Error messages provide clear remediation steps
- ✅ Documentation answers common questions without Slack/GitHub issues
- ✅ Agent-dev environments match local environment behavior

---

## Dependencies

### External Dependencies
- Docker Compose V2 (already required)
- NATS 2.10+ with JetStream support (already used)
- PostgreSQL 15+ (already used)

### Internal Dependencies
- Sprint 25 fixes merged to main
- Architecture.yaml infrastructure definitions stable
- Bit base class supports agent-dev contexts

### Blocking Issues
None - all dependencies satisfied

---

## Rollback Plan

### If JetStream Fix Fails
- **Option 1**: Hardcode NATS command in agent-dev compose generation
- **Option 2**: Document manual step to edit compose file
- **Option 3**: Defer to future sprint, use workaround

### If Environment Variable Fix Fails
- **Option 1**: Provide checklist of required variables
- **Option 2**: Script to validate .env.brat completeness
- **Option 3**: Pre-populate with working examples

### If E2E Test Fails
- **Option 1**: Manual testing checklist
- **Option 2**: Document known issues
- **Option 3**: Mark test as flaky, investigate separately

---

## Post-Sprint Validation

### Acceptance Tests
1. Fresh agent-dev provision and start (< 2 minutes)
2. !ping command returns pong (< 5 seconds)
3. All infrastructure services healthy
4. No errors/warnings in Docker Compose output
5. Integration tests pass in CI
6. Documentation reviewed by peer

### Performance Benchmarks
- Provision time: < 30 seconds
- Start time: < 90 seconds (all services healthy)
- !ping latency: < 1 second (p99)
- Memory usage: < 2GB (full stack)
- Disk usage: < 5GB (with volumes)

### Regression Tests
- Existing local development unaffected
- Agent-dev contexts isolated from each other
- Multiple concurrent agent-dev contexts work
- Cleanup removes all resources

---

## Next Steps After Completion

### Immediate (Sprint 27)
1. Add agent-dev smoke test to CI
2. Monitor for issues in production use
3. Gather feedback from developers

### Short-term (2-3 sprints)
1. Auto-generate .env template from architecture.yaml
2. Support custom infrastructure overrides
3. Add agent-dev context sharing (export/import)

### Long-term (Backlog)
1. Remote agent-dev contexts (deploy to cloud for testing)
2. Agent-dev context snapshots (save/restore state)
3. Performance profiling in agent-dev
4. Integration with CI/CD pipelines

---

## Appendix: File Manifest

### New Files (9)
1. `.env.agent-dev.template` - Environment variable template
2. `tools/brat/src/utils/env-parser.ts` - Parse .env files
3. `tools/brat/src/dev-mcp/agent-dev-validator.ts` - Pre-flight validation
4. `tools/brat/src/utils/docker-error-parser.ts` - Error message parsing
5. `tools/brat/src/dev-mcp/__tests__/agent-dev-e2e.test.ts` - E2E tests
6. `tools/brat/src/dev-mcp/__tests__/helpers/websocket-client.ts` - Test helpers
7. `tools/brat/src/context/__tests__/compose-generation.test.ts` - Unit tests
8. `tools/brat/src/dev-mcp/__tests__/environment-generation.test.ts` - Unit tests
9. `documentation/guides/agent-dev-troubleshooting.md` - Troubleshooting guide

### Modified Files (3)
1. `tools/brat/src/context/generate-docker-compose.ts` - Add command translation
2. `tools/brat/src/infrastructure/registry.ts` - Process config section
3. `tools/brat/src/dev-mcp/agent-dev-context-manager.ts` - Use template + validator

### Total: 12 files (9 new, 3 modified)

---

## Conclusion

This execution plan builds on Sprint 25's success to deliver fully functional agent-dev environments. The approach is incremental, testable, and focused on developer experience. Each phase delivers value independently, allowing for flexible sprint scoping based on available time and priorities.

**Recommended Sprint Scope**: Phases 1-5 (core functionality + quality)
**Optional**: Phases 6-7 (documentation + observability)
**Estimated Total Effort**: 12-16 hours (1-2 weeks)
