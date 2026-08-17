# Implementation Roadmap: Architecture.yaml v2

**Total Timeline**: 10-12 weeks
**Team Size**: 2-3 engineers
**Dependencies**: Sprint 3 completion, architecture.yaml schema approval

## Overview

This roadmap breaks down the architecture.yaml v2 implementation into 5 phases, each deliverable and testable independently.

## Phase 1: Foundation (Weeks 1-2)

**Goal**: Establish schema, validation, and migration tooling

### Tasks

#### 1.1 JSON Schema Definition (3 days)
- Create `documentation/schemas/architecture.v2.json`
- Define complete JSON Schema for all new sections:
  - `platform.infrastructure`
  - `infrastructure.{provider}` (docker, gcp, aws, azure, k8s)
  - `services.*.dependencies.infrastructure`
  - `executionContexts.*.infrastructure`
- Add conditional validation rules (e.g., required infrastructure must have providers)
- Unit tests for schema validation

**Deliverables**:
- `documentation/schemas/architecture.v2.json`
- `tools/brat/src/validation/architecture-schema-v2.ts`
- Test coverage: 90%+

#### 1.2 Migration Validator (4 days)
- Create `brat config migrate` command
- Detect v1 vs v2 schema automatically
- Report breaking changes and migration steps
- Support `--dry-run` mode
- Generate migration report with warnings

**Deliverables**:
- `tools/brat/src/oclif-commands/config/migrate.ts`
- Migration report template
- Test coverage: 85%+

#### 1.3 Documentation (3 days)
- Complete schema proposal document (this file)
- Developer migration guide
- Infrastructure management guide
- Code examples for each provider

**Deliverables**:
- `planning/sprint-4-architecture-yaml-redesign/schema-proposal.md`
- `planning/sprint-4-architecture-yaml-redesign/migration-guide.md`
- `documentation/architecture/infrastructure-management.md`

### Exit Criteria

- [ ] JSON Schema validates all example configurations
- [ ] Migration validator identifies all v1 patterns
- [ ] Documentation reviewed and approved
- [ ] Team trained on new schema

---

## Phase 2: InfrastructureRegistry v2 (Weeks 3-4)

**Goal**: Centralize infrastructure knowledge, replace fragmented patterns

### Tasks

#### 2.1 Registry Core (5 days)
- Create `tools/brat/src/infrastructure/registry.ts`
- Load infrastructure from architecture.yaml (not hardcoded)
- Support provider selection based on execution context
- Implement configuration merging (platform → provider → context)
- Expose registry API:
  - `getRequiredInfrastructure(context: string): InfrastructureSpec[]`
  - `getInfrastructureByCapability(capability: string): InfrastructureSpec`
  - `validateDependencies(services: ServiceMetadata[]): ValidationResult`

**Deliverables**:
- `tools/brat/src/infrastructure/registry.ts`
- `tools/brat/src/infrastructure/types.ts`
- Test coverage: 95%+

#### 2.2 Health Gate Pattern (3 days)
- Create `tools/brat/src/infrastructure/health-gate.ts`
- Implement `waitForInfrastructure(specs: InfrastructureSpec[]): Promise<void>`
- Support parallel health checks with timeout
- Health check strategies per infrastructure type:
  - PostgreSQL: pg_isready + connection test
  - Redis: redis-cli ping
  - NATS: HTTP /healthz endpoint
- Detailed error messages on timeout

**Deliverables**:
- `tools/brat/src/infrastructure/health-gate.ts`
- Integration tests with real infrastructure
- Test coverage: 90%+

#### 2.3 Update parse-dependencies.ts (2 days)
- Replace hardcoded infrastructure lists with registry calls
- Remove `IDEMPOTENCY_SERVICES` constant
- Use `services.*.dependencies.infrastructure` declarations
- Update tests to use architecture.yaml fixtures

**Deliverables**:
- Updated `tools/brat/src/context/parse-dependencies.ts`
- Updated tests
- Test coverage maintained: 95%+

### Exit Criteria

- [ ] InfrastructureRegistry loads from architecture.yaml
- [ ] All hardcoded infrastructure lists removed from parse-dependencies.ts
- [ ] Health gate pattern functional for PostgreSQL, Redis, NATS
- [ ] Unit + integration tests passing

---

## Phase 3: Docker Compose Generation (Weeks 5-6)

**Goal**: Generate docker-compose files from architecture.yaml, eliminate manual compose files

### Tasks

#### 3.1 Compose Generator Rewrite (5 days)
- Rewrite `tools/brat/src/context/generate-docker-compose.ts`
- Read infrastructure from `infrastructure.docker` section
- Generate services, volumes, networks from schema
- Apply context-specific overrides from `executionContexts.*.infrastructure`
- Support conditional infrastructure (e.g., firebase-emulator if PERSISTENCE_DRIVER=firestore)

**Algorithm**:
```typescript
function generateDockerCompose(contextName: string): DockerComposeFile {
  const arch = loadArchitecture();
  const context = arch.executionContexts[contextName];
  const provider = context.infrastructure.provider; // 'docker'
  const infraSpecs = arch.infrastructure[provider];

  // 1. Load platform requirements
  const required = arch.platform.infrastructure;

  // 2. For each required capability, get provider implementation
  const services = {};
  for (const [capability, config] of Object.entries(required)) {
    if (config.required) {
      const spec = infraSpecs[capability];
      services[spec.service] = generateService(spec, context);
    }
  }

  // 3. Add application services
  for (const [name, svc] of Object.entries(arch.services)) {
    if (svc.active) {
      services[name] = generateApplicationService(svc, context);
    }
  }

  // 4. Generate volumes, networks
  const volumes = generateVolumes(infraSpecs, context);
  const networks = generateNetworks(context);

  return { services, volumes, networks };
}
```

**Deliverables**:
- Rewritten `tools/brat/src/context/generate-docker-compose.ts`
- Test coverage: 90%+
- Generated files validated with `docker-compose config`

#### 3.2 Deprecate docker-compose.local.yaml (2 days)
- Move infrastructure section to architecture.yaml
- Keep only top-level metadata (version, name)
- Update documentation
- Add deprecation warnings

**Deliverables**:
- Updated `infrastructure/docker-compose/docker-compose.local.yaml` (minimal)
- Migration script for existing contexts
- Documentation updates

#### 3.3 Integration with Orchestrator (3 days)
- Update `tools/brat/src/orchestration/docker/orchestrator.ts`
- Use InfrastructureRegistry for service list
- Remove hardcoded infrastructure from buildBaseImage()
- Support infrastructure-only deployments (`brat deploy infrastructure`)

**Deliverables**:
- Updated `tools/brat/src/orchestration/docker/orchestrator.ts`
- New command: `brat deploy infrastructure --context <name>`
- Test coverage: 85%+

### Exit Criteria

- [ ] Generated docker-compose files match schema
- [ ] docker-compose.local.yaml deprecated
- [ ] Infrastructure deployable independently from services
- [ ] Integration tests passing for local + staging contexts

---

## Phase 4: Production Migration (Weeks 7-8)

**Goal**: Migrate existing deployments to v2 schema without downtime

### Tasks

#### 4.1 Context Migration (3 days)
- Migrate `local` context to v2 schema
- Migrate `staging` context to v2 schema
- Migrate `prod` context to v2 schema (if applicable)
- Validate with `brat config validate --schema v2`

**Migration Checklist** (per context):
1. Add `platform.infrastructure` declarations
2. Add `infrastructure.docker` (or `gcp`, etc.) implementations
3. Add `services.*.dependencies.infrastructure`
4. Add `executionContexts.*.infrastructure`
5. Remove hardcoded infrastructure from code
6. Test deployment end-to-end
7. Verify all services healthy

**Deliverables**:
- Updated `architecture.yaml` with v2 schema
- Migration validation report
- Rollback plan (keep v1 branch)

#### 4.2 Docker Compose Strategy Update (3 days)
- Update `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- Replace hardcoded `infrastructureServices` with registry lookup
- Use same code path for single-service and bulk deployments
- Fix #11 permanently (infrastructure included automatically)

**Deliverables**:
- Updated `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- Integration tests for bulk deployment
- Test coverage: 90%+

#### 4.3 Validation Suite (4 days)
- Create comprehensive validation suite
- Test all contexts (local, staging, prod)
- Test all providers (docker, gcp if available)
- Verify infrastructure dependencies resolve correctly
- Verify health gates work for all infrastructure

**Deliverables**:
- `tools/brat/src/validation/infrastructure-suite.test.ts`
- End-to-end integration tests
- CI/CD pipeline integration

### Exit Criteria

- [ ] All existing contexts migrated to v2
- [ ] No hardcoded infrastructure lists remain
- [ ] Bulk and single-service deployments use same code path
- [ ] Zero downtime migration verified
- [ ] All tests passing (unit, integration, e2e)

---

## Phase 5: Ecosystem Expansion (Weeks 9-12+)

**Goal**: Implement additional cloud providers, expand platform support

### Tasks (Optional, Incremental)

#### 5.1 AWS Provider (2-3 weeks)
- Implement `infrastructure.aws` schema
- Support SQS+SNS for messaging
- Support ElastiCache for Redis
- Support RDS for PostgreSQL
- Create AWS deployment strategy (ECS, Fargate)
- Documentation and examples

#### 5.2 Azure Provider (2-3 weeks)
- Implement `infrastructure.azure` schema
- Support Service Bus for messaging
- Support Azure Cache for Redis
- Support Azure Database for PostgreSQL
- Create Azure deployment strategy (Container Instances, AKS)
- Documentation and examples

#### 5.3 Kubernetes Provider (3-4 weeks)
- Implement `infrastructure.k8s` schema
- Support Helm charts for NATS, Redis, PostgreSQL
- Generate Kubernetes manifests from architecture.yaml
- Support kustomize overlays per context
- Create K8s deployment strategy
- Documentation and examples

#### 5.4 Provider Plugin System (Optional)
- Design provider plugin interface
- Support community-contributed providers
- Plugin discovery and validation
- Example: DigitalOcean, Render, Railway

### Exit Criteria (per provider)

- [ ] Provider schema defined and documented
- [ ] Deployment strategy implemented
- [ ] Example context created and tested
- [ ] Documentation complete
- [ ] At least one production deployment validated

---

## Rollout Strategy

### Week 1-2: Internal Development
- Phase 1 complete
- Schema and migration tools available
- Team training

### Week 3-4: Controlled Testing
- Phase 2 complete
- InfrastructureRegistry deployed to local contexts only
- Limited team dogfooding

### Week 5-6: Staging Deployment
- Phase 3 complete
- Deploy to staging context
- Monitor for issues
- Gather feedback

### Week 7-8: Production Migration
- Phase 4 complete
- Blue/green deployment to production
- Rollback plan ready
- 24-hour monitoring

### Week 9+: Ecosystem Expansion
- Phase 5 incremental
- Add providers as needed
- Community contributions welcome

---

## Risk Mitigation

### High-Risk Areas

1. **Breaking Changes in Production**
   - Mitigation: Blue/green deployment, instant rollback capability
   - Testing: Comprehensive validation suite, staging environment identical to prod

2. **Infrastructure Dependency Loops**
   - Mitigation: Topological sort in InfrastructureRegistry, cycle detection
   - Testing: Graph validation tests with various dependency patterns

3. **Provider Implementation Bugs**
   - Mitigation: Start with Docker (most tested), add cloud providers incrementally
   - Testing: Provider-specific integration tests with real infrastructure

4. **Migration Data Loss**
   - Mitigation: `--dry-run` mode required before migration, backup architecture.yaml
   - Testing: Migration validation suite, roundtrip testing (v1→v2→validate)

### Contingency Plans

- **Plan A**: Rollback to v1 schema (keep v1 branch, feature flag for v2)
- **Plan B**: Hybrid mode (v2 for new contexts, v1 for existing)
- **Plan C**: Manual intervention (on-call engineer validates deployments)

---

## Success Metrics

### Technical Metrics

- **Code Reduction**: Remove 500+ lines of hardcoded infrastructure
- **Test Coverage**: Maintain 90%+ coverage across all modules
- **Build Time**: No regression in build/deploy times
- **Reliability**: Zero infrastructure deployment bugs for 2+ sprints

### Developer Experience Metrics

- **Context Creation Time**: < 2 minutes for new execution context
- **Infrastructure Debugging Time**: < 10 minutes to identify infrastructure issues
- **Onboarding Time**: < 1 hour for new developers to understand infrastructure model

### Business Metrics

- **Multi-Cloud Support**: 3+ cloud providers supported (Docker, GCP, AWS)
- **Deployment Flexibility**: Deploy to any platform without code changes
- **Community Adoption**: 5+ community-contributed providers (if plugin system implemented)

---

## Dependencies

### External Dependencies

- Docker >= 20.10
- docker-compose >= 2.0
- NATS >= 2.10
- Redis >= 7.0
- PostgreSQL >= 15

### Internal Dependencies

- Sprint 3 completion (all 11 fixes merged)
- architecture.yaml schema approval
- Team training on new patterns

---

## Team Assignments

### Phase 1-2: Foundation + Registry (Weeks 1-4)
- **Engineer 1**: JSON Schema, validation tools
- **Engineer 2**: InfrastructureRegistry, health gate pattern
- **Tech Writer**: Documentation (schema, migration guide, developer guide)

### Phase 3: Docker Compose Generation (Weeks 5-6)
- **Engineer 1**: Compose generator rewrite
- **Engineer 2**: Orchestrator integration, testing

### Phase 4: Production Migration (Weeks 7-8)
- **Engineer 1**: Context migration, validation suite
- **Engineer 2**: Docker compose strategy update, deployment
- **DevOps**: Staging/production deployment, monitoring

### Phase 5: Ecosystem Expansion (Weeks 9+)
- **Engineer 1**: AWS provider
- **Engineer 2**: Azure provider
- **Community**: Additional providers (plugin system)

---

## Checkpoints

### Checkpoint 1: Week 2
- Schema approved and validated
- Migration tools functional
- Team trained

**Go/No-Go Decision**: Proceed to Phase 2 if schema complete and validated

### Checkpoint 2: Week 4
- InfrastructureRegistry deployed to local contexts
- Hardcoded infrastructure removed from parse-dependencies.ts
- Health gate pattern functional

**Go/No-Go Decision**: Proceed to Phase 3 if registry functional and tested

### Checkpoint 3: Week 6
- Docker Compose generation working for local + staging
- Infrastructure deployable independently
- Integration tests passing

**Go/No-Go Decision**: Proceed to Phase 4 if generation stable and tested

### Checkpoint 4: Week 8
- All contexts migrated to v2
- Production deployment successful
- No infrastructure bugs for 1 week

**Go/No-Go Decision**: Declare v2 stable, proceed to Phase 5 (optional)

---

## Post-Implementation

### Deprecation Timeline

- **Week 8**: Mark v1 patterns as deprecated (warnings in CLI)
- **Sprint +1**: Remove v1 compatibility shims
- **Sprint +2**: Remove deprecated code entirely

### Continuous Improvement

- Monitor infrastructure deployment metrics
- Gather developer feedback
- Iterate on schema based on real-world usage
- Expand provider ecosystem

### Long-Term Vision

- **Q1 2027**: Multi-cloud deployments (AWS + GCP hybrid)
- **Q2 2027**: Kubernetes support for scale-out workloads
- **Q3 2027**: Provider plugin marketplace
- **Q4 2027**: Infrastructure-as-Code generation (Terraform, Pulumi)

---

## References

- [README.md](./README.md) - Proposal overview
- [schema-proposal.md](./schema-proposal.md) - Complete schema definition
- [migration-guide.md](./migration-guide.md) - Step-by-step migration instructions
