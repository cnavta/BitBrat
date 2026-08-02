# Future Sprint Backlog

This document tracks improvement items identified during sprint work that should be addressed in future sprints.

## Documentation Improvements

### Document PortManager and Port Discovery Mechanism

**Priority**: Medium
**Estimated Effort**: 4-6 hours
**Identified During**: Sprint 378 Day 3 (Bug #19 discovery)

#### Background

The `PortManager` class (`tools/brat/src/orchestration/docker/port-manager.ts`) provides automatic port conflict resolution for deployments but is poorly documented. During Sprint 378 validation, we discovered that:

1. The mechanism works perfectly for single-service deployments
2. It was not integrated into bulk deployments (Bug #19)
3. No documentation exists explaining how it works or when it's used
4. Developers were unaware of its existence

#### Current State

**What PortManager Does:**
- Discovers ports in use by running containers (local or remote)
- Reads explicit port assignments from environment variables (`*_HOST_PORT`)
- Auto-assigns unique ports for services without explicit configuration
- Starts from port 3001 and increments to find available ports
- Works across SSH for remote deployments

**Where It's Used:**
- ✅ Single-service deployments: `DockerOrchestrator.writeEnvFile()` (line 318)
- ❌ Bulk deployments: Missing integration (Bug #19)

**Existing Code Quality:**
- Well-structured with clear interfaces
- Good separation of concerns
- No inline documentation explaining purpose or usage

#### Documentation Needed

1. **Architecture Documentation** (`documentation/concepts/port-management.md`)
   - How PortManager fits into deployment flow
   - When automatic vs manual port assignment is used
   - How port discovery works (local vs remote)
   - Decision tree: when to set explicit ports vs rely on auto-assignment

2. **API Reference** (`documentation/reference/port-manager-api.md`)
   - `PortManager.resolvePorts()` - Parameters, return values, behavior
   - `PortManager.getEnvOverrides()` - How env overrides are generated
   - `PortAssignment` interface - What explicit flag means
   - Examples of common usage patterns

3. **Developer Guide** (`documentation/guides/deployment-port-configuration.md`)
   - When to set explicit ports in environment files
   - How to debug port conflicts
   - Best practices for service port defaults
   - Troubleshooting common issues

4. **Inline Code Documentation** (in `port-manager.ts`)
   - Add JSDoc comments to class and public methods
   - Document the "two-pass" algorithm (explicit first, then auto-assign)
   - Explain port discovery mechanism
   - Add usage examples in comments

#### Success Criteria

- [ ] All three documentation files created and reviewed
- [ ] JSDoc comments added to PortManager class
- [ ] Examples included showing typical usage patterns
- [ ] Cross-references added from deployment guides
- [ ] Mentioned in CLAUDE.md development patterns section
- [ ] Future developers can understand and use PortManager without reading source

#### Related Issues

- **Bug #19**: Bulk deployment missing PortManager integration
- **Future improvement**: Service compose files should have unique default ports

---

## Code Improvements

### Unique Default Ports in Service Compose Files

**Priority**: Low
**Estimated Effort**: 2-3 hours
**Identified During**: Sprint 378 Day 3 (Port conflict debugging)

#### Problem

Many service compose files use the same default host ports:
- 10 services default to port 3001
- 3 services default to port 8080
- 1 service defaults to port 3000

This causes conflicts when bulk deploying if PortManager isn't integrated (or if it fails).

#### Current Pattern

```yaml
# Multiple services use this same pattern
ports:
  - "${SERVICE_NAME_HOST_PORT:-3001}:${SERVICE_PORT:-3000}"
```

#### Proposed Pattern

Each service should have a **unique default port** to serve as a fallback:

```yaml
# tool-gateway.compose.yaml
ports:
  - "${TOOL_GATEWAY_HOST_PORT:-3013}:${SERVICE_PORT:-3000}"

# auth.compose.yaml
ports:
  - "${AUTH_HOST_PORT:-3004}:${SERVICE_PORT:-3000}"

# llm-bot.compose.yaml
ports:
  - "${LLM_BOT_HOST_PORT:-3006}:${SERVICE_PORT:-3000}"
```

#### Benefits

1. **Defense in depth**: Works even if PortManager integration is missing
2. **Explicit configuration**: Easier to see port assignments at a glance
3. **Better defaults**: Services work in bulk mode without environment config
4. **Debugging**: Easier to identify which service owns which port

#### Implementation

1. Assign unique default ports to all service compose files
2. Document port allocation strategy (e.g., 3000-3099 for core services, 3100-3199 for domain services)
3. Update compose file comments to explain port assignment
4. Add validation to prevent duplicate default ports in CI

#### Port Allocation Strategy (Proposed)

**Infrastructure Services** (3000-3009):
- context-pack: 3000
- event-router: 3003
- api-gateway: 3002

**Core Platform Services** (3010-3029):
- auth: 3004
- ingress-egress: 3005
- llm-bot: 3006
- oauth-flow: 3008
- persistence: 3009
- query-analyzer: 3010
- scheduler: 3011
- state-engine: 3012
- tool-gateway: 3013
- disposition-service: 3014
- reflex: 3015

**Domain/MCP Services** (3030-3099):
- story-engine-mcp: 3016
- image-gen-mcp: 3017
- obs-mcp: 3007

**Specialized Services** (8000+):
- stream-analyst-service: 8080

#### Success Criteria

- [ ] All service compose files have unique default ports
- [ ] Port allocation documented in architecture.yaml or README
- [ ] No duplicate defaults across all compose files
- [ ] CI validation added to prevent future duplicates
- [ ] CLAUDE.md updated with port assignment conventions

---

## Testing Improvements

### Integration Tests for Port Auto-Assignment

**Priority**: Medium
**Estimated Effort**: 6-8 hours
**Identified During**: Sprint 378 Day 3 (Bug #19 discovery)

#### Coverage Gaps

No integration tests currently validate:
1. Port auto-assignment when no explicit config exists
2. Port conflict detection from running containers
3. Mixed explicit/auto port scenarios
4. Remote (SSH) port discovery

#### Proposed Tests

**Test Suite**: `tools/brat/src/orchestration/docker/port-manager.test.ts`

1. **Auto-assignment with no running containers**
   - Deploy 3 services without explicit ports
   - Verify ports 3001, 3002, 3003 are assigned

2. **Auto-assignment with running containers**
   - Start container on port 3001
   - Deploy service without explicit port
   - Verify port 3002 is assigned (skips 3001)

3. **Mixed explicit/auto ports**
   - Set TOOL_GATEWAY_HOST_PORT=5000
   - Deploy 3 services
   - Verify: tool-gateway=5000, others get 3001-3002 (skip 5000)

4. **Remote port discovery**
   - Mock SSH execution
   - Simulate remote docker ps output
   - Verify ports are discovered correctly

5. **Port conflict detection**
   - Deploy with duplicate explicit ports
   - Verify error is thrown

#### Success Criteria

- [ ] 5+ integration tests added for PortManager
- [ ] Tests run in CI pipeline
- [ ] Mock SSH for remote scenarios
- [ ] Coverage > 90% for port-manager.ts

---

*This backlog is living documentation. Add items as they're discovered during sprint work.*
