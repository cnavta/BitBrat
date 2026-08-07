# Sprint 374: Secure File Deployment - Execution Plan

**Sprint**: 374
**Duration**: 7 days
**Role**: Lead Implementor
**Date**: 2026-07-29

## Sprint Goal

Implement platform-agnostic secure file deployment for Bits, enabling declarative configuration of credentials/certificates in architecture.yaml with automatic mounting across Docker Compose (local/remote) and Cloud Run deployments.

## Success Criteria

1. ✅ Developer can define `secureFiles` in architecture.yaml for any service
2. ✅ `brat bit deploy` automatically validates, transfers, and mounts secure files
3. ✅ Works identically on local Docker, remote Docker (SSH), and Cloud Run
4. ✅ Git-ignore validation prevents accidental secret commits
5. ✅ image-gen-mcp migrated from manual GCP credentials to automated secure files
6. ✅ Comprehensive test coverage (unit + integration)
7. ✅ Documentation updated with examples and migration guide

---

## Phase Breakdown

### Phase 1: Foundation (Days 1-2)
**Goal**: Define schema, types, and validation layer

**Tasks**:
1. Define TypeScript interfaces for SecureFile schema
2. Add `secureFiles` property to ServiceDefinition type
3. Implement SecureFilesValidator class with comprehensive validation
4. Write unit tests for validator (file exists, git-ignore, permissions, path security)
5. Update architecture.yaml with secureFiles examples

**Deliverables**:
- `tools/brat/src/config/types.ts` (SecureFile interface)
- `tools/brat/src/orchestration/deployment/secure-files-validator.ts`
- `tools/brat/src/orchestration/deployment/secure-files-validator.test.ts`
- Updated architecture.yaml with image-gen-mcp secureFiles example

**Risk**: Git-ignore validation may be slow for large repos
**Mitigation**: Cache git check-ignore results per file

---

### Phase 2: Docker Compose Strategy (Days 3-4)
**Goal**: Implement secure file mounting for local and remote Docker deployments

**Tasks**:
1. Extend DockerComposeStrategy.prepare() to process secure files
2. Implement local volume mount logic (direct host path mounting)
3. Implement remote scp transfer with permission setting
4. Inject volume mounts and env vars into docker-compose YAML
5. Add error handling for scp failures with retry logic
6. Write unit tests for volume mount injection
7. Write integration tests for local deployment
8. Write integration tests for remote deployment (mocked SSH)

**Deliverables**:
- Updated `tools/brat/src/orchestration/deployment/docker-compose-strategy.ts`
- `tools/brat/src/orchestration/deployment/docker-compose-strategy.test.ts` (new tests)
- Integration test: `tools/brat/src/orchestration/deployment/docker-compose-integration.test.ts`

**Risk**: Remote scp may fail on slow/unreliable networks
**Mitigation**: Implement retry logic with exponential backoff, checksum verification

---

### Phase 3: Cloud Run Strategy (Day 5)
**Goal**: Implement secure file deployment to GCP Secret Manager

**Tasks**:
1. Extend CloudRunStrategy.prepare() to upload files to Secret Manager
2. Implement ensureSecret() to create secrets if missing
3. Implement addSecretVersion() to upload file content
4. Generate --set-secrets flags for gcloud run deploy
5. Set environment variables for mounted secret paths
6. Write unit tests for Secret Manager operations (mocked gcloud)
7. Write integration tests with mocked GCP API

**Deliverables**:
- Updated `tools/brat/src/orchestration/deployment/cloud-run-strategy.ts`
- `tools/brat/src/orchestration/deployment/cloud-run-strategy.test.ts` (new tests)

**Risk**: Secret Manager quota limits on high-frequency deployments
**Mitigation**: Reuse secret versions when content unchanged (checksum comparison)

---

### Phase 4: Secure File Infrastructure (Day 6)
**Goal**: Set up secure file directories and migrate image-gen-mcp

**Tasks**:
1. Create .secure.local directory structure with .gitignore
2. Update root .gitignore to exclude .secure.* directories
3. Migrate image-gen-mcp architecture.yaml to use secureFiles
4. Create example secure files for local development
5. Update CLAUDE.md with secure file examples
6. Update deployment documentation
7. Create migration guide for existing services

**Deliverables**:
- `.secure.local/.gitkeep` (template directory)
- Updated `.gitignore`
- Updated `architecture.yaml` (image-gen-mcp with secureFiles)
- Updated `CLAUDE.md` (secure file section)
- `documentation/guides/secure-file-deployment.md`

**Risk**: Developers may forget to create .secure.* directories
**Mitigation**: Auto-create directories on `brat context create`, add to setup checklist

---

### Phase 5: End-to-End Validation (Day 7)
**Goal**: Comprehensive testing, performance validation, and polish

**Tasks**:
1. End-to-end test: Deploy image-gen-mcp to local Docker with secure file
2. End-to-end test: Deploy image-gen-mcp to remote Docker (staging) with secure file
3. End-to-end test: Deploy to Cloud Run with Secret Manager (dry-run)
4. Performance benchmarking (deployment time with/without secure files)
5. Error message polish and user experience improvements
6. Audit logging enhancements
7. Security review (permissions, path validation, git-ignore)
8. Documentation review and polish

**Deliverables**:
- `tests/e2e/secure-file-deployment.test.ts`
- Performance benchmark report
- Security review checklist
- Polished error messages

**Risk**: Performance degradation on remote deployments
**Mitigation**: Implement parallel file transfer, compression, incremental sync

---

## Dependencies

### External Dependencies
- `js-yaml` - Already installed (for compose file parsing)
- `@google-cloud/secret-manager` - **New dependency** for Cloud Run integration

### Internal Dependencies
- Existing deployment strategies (DockerComposeStrategy, CloudRunStrategy)
- Existing DockerOrchestrator (for local/remote docker operations)
- Existing ContextResolver (for execution context)
- Existing validation patterns from Sprint 372

### Filesystem Dependencies
- `.secure.local/` directory for local secure files
- `.secure.staging/` directory for staging secure files
- Write permissions on remote Docker hosts

---

## Testing Strategy

### Unit Tests (Target: 95%+ coverage)
1. **SecureFilesValidator**:
   - File existence validation
   - Git-ignore validation
   - Permission validation (0400, not world-readable)
   - Target path validation (must be under allowed directories)
   - Path traversal rejection (../, ~, symlinks)

2. **DockerComposeStrategy**:
   - Volume mount injection
   - Env var injection
   - Remote file transfer (mocked scp)
   - Compose file YAML modification
   - Error handling for missing files

3. **CloudRunStrategy**:
   - Secret creation (mocked gcloud)
   - Version upload (mocked gcloud)
   - --set-secrets flag generation
   - Env var setting
   - Error handling for quota limits

### Integration Tests
1. **Local Docker Deployment**:
   - Deploy service with secureFiles
   - Verify file mounted at correct path
   - Verify correct permissions (0400)
   - Verify env var set correctly

2. **Remote Docker Deployment**:
   - Mock scp transfer
   - Verify remote directory creation
   - Verify file transfer
   - Verify chmod 400 execution
   - Verify volume mount in compose file

3. **Cloud Run Deployment**:
   - Mock Secret Manager API
   - Verify secret creation
   - Verify version upload
   - Verify --set-secrets in deploy command

### End-to-End Tests
1. **image-gen-mcp local deployment**:
   - Deploy with GCP credentials
   - Verify service can read credentials
   - Verify storage driver initialization

2. **image-gen-mcp staging deployment**:
   - Deploy to remote Docker host
   - Verify credentials transferred
   - Verify service functionality

---

## Risk Assessment

### High Priority Risks

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| Accidental git commit of secrets | CRITICAL | Medium | Auto-validation in prepare(), pre-commit hook | Lead Implementor |
| Remote scp failures | High | Medium | Retry logic, detailed error messages | Lead Implementor |
| Secret Manager quota exhaustion | High | Low | Version reuse, batch operations | Lead Implementor |
| Breaking existing deployments | High | Low | Backward compatibility tests | Lead Implementor |

### Medium Priority Risks

| Risk | Impact | Probability | Mitigation | Owner |
|------|--------|-------------|------------|-------|
| Performance degradation | Medium | Medium | Parallel transfer, incremental sync | Lead Implementor |
| File permissions too permissive | Medium | Low | Enforce 0400 default, validation | Lead Implementor |
| Unclear error messages | Medium | Medium | User testing, polish in Phase 5 | Lead Implementor |

---

## Implementation Sequence

### Day 1: Foundation - Types & Validator
```
[Morning]
- Define SecureFile TypeScript interface
- Update ServiceDefinition type
- Create SecureFilesValidator skeleton

[Afternoon]
- Implement validation methods (file exists, git-ignore, permissions)
- Write comprehensive unit tests
- Code review and refactor
```

### Day 2: Foundation - Integration
```
[Morning]
- Integrate validator into deployment strategy base
- Update architecture.yaml schema
- Add validation to prepare() phase

[Afternoon]
- Test validator with real files
- Add error message polish
- Documentation for SecureFile schema
```

### Day 3: Docker Compose - Local
```
[Morning]
- Extend DockerComposeStrategy for secureFiles
- Implement local volume mount logic
- Implement compose file YAML injection

[Afternoon]
- Write unit tests for local mounting
- Integration test for local deployment
- Error handling for missing files
```

### Day 4: Docker Compose - Remote
```
[Morning]
- Implement remote scp transfer logic
- Add chmod 400 after transfer
- Implement retry logic for scp failures

[Afternoon]
- Write integration tests for remote transfer (mocked)
- Test with actual remote Docker host (staging)
- Performance optimization (parallel transfer)
```

### Day 5: Cloud Run Integration
```
[Morning]
- Implement Secret Manager upload logic
- Add ensureSecret() and addSecretVersion() methods
- Generate --set-secrets flags

[Afternoon]
- Write unit tests (mocked gcloud)
- Integration test with mocked API
- Error handling for quota limits
```

### Day 6: Migration & Documentation
```
[Morning]
- Create .secure.local directory structure
- Update .gitignore
- Migrate image-gen-mcp to secureFiles

[Afternoon]
- Update CLAUDE.md with examples
- Write deployment guide
- Create migration documentation
```

### Day 7: Validation & Polish
```
[Morning]
- End-to-end test: local deployment
- End-to-end test: remote deployment
- Performance benchmarking

[Afternoon]
- Error message polish
- Security review
- Documentation final review
- Sprint completion report
```

---

## Acceptance Criteria

### Functional Requirements
- [ ] SecureFile interface defined in TypeScript
- [ ] Validator successfully blocks git-tracked files
- [ ] Validator enforces secure target paths (/var/secrets, /run/secrets)
- [ ] Validator checks file permissions (not world-readable)
- [ ] Docker Compose (local): Files mounted via volume mounts
- [ ] Docker Compose (remote): Files transferred via scp with chmod 400
- [ ] Cloud Run: Files uploaded to Secret Manager and mounted
- [ ] Env vars automatically set when specified
- [ ] image-gen-mcp successfully migrated and deployed
- [ ] No breaking changes to existing deployments

### Non-Functional Requirements
- [ ] Unit test coverage ≥ 95%
- [ ] Integration tests for all three deployment modes
- [ ] Deployment time increase < 10% for 1 secure file
- [ ] Deployment time increase < 20% for 5 secure files
- [ ] Clear error messages for all failure modes
- [ ] Audit logs show file operations
- [ ] Documentation complete and reviewed

### Security Requirements
- [ ] Files never committed to git (enforced)
- [ ] Default permissions 0400 (owner read-only)
- [ ] No world-readable files allowed
- [ ] Path traversal attacks blocked
- [ ] Encrypted transfer (SSH for remote, TLS for Cloud Run)
- [ ] Secrets stored outside repository

---

## Rollback Plan

### If Critical Issues Arise

**Scenario 1: Git-ignore validation breaks deployments**
- Rollback: Make git-ignore validation optional (warning instead of error)
- Fix: Improve git check-ignore performance

**Scenario 2: Remote scp fails frequently**
- Rollback: Document manual file transfer as workaround
- Fix: Implement more robust retry logic with exponential backoff

**Scenario 3: Secret Manager quota exceeded**
- Rollback: Disable Cloud Run secure files temporarily
- Fix: Implement version reuse and cleanup of old versions

**Scenario 4: Performance unacceptable**
- Rollback: Make secureFiles optional per-service
- Fix: Implement parallel transfer and incremental sync

### Feature Flag
Not applicable - secureFiles is opt-in via architecture.yaml configuration.

---

## Post-Sprint Tasks

### Documentation
- [ ] Update README with secure file examples
- [ ] Create video walkthrough of secure file deployment
- [ ] Add troubleshooting guide
- [ ] Update architecture.yaml JSON schema

### Future Enhancements (Not in Scope)
- Automatic credential rotation (requires integration with secret management services)
- Binary file support optimization (currently supports all files)
- Multi-file bundle support (tar.gz of multiple files)
- Encrypted at-rest storage for local Docker (requires additional tooling)

---

## Communication Plan

### Stakeholder Updates
- **Daily**: Commit messages with progress
- **Mid-sprint** (Day 4): Progress report on backlog completion
- **End-sprint** (Day 7): Sprint completion report with metrics

### Documentation Updates
- CLAUDE.md updated with secure file workflow
- deployment guide updated with new examples
- architecture.yaml examples updated

### Team Coordination
Not applicable - solo sprint execution by Lead Implementor (AI agent).

---

## Metrics & KPIs

### Development Metrics
- **Velocity**: 40 story points (estimated)
- **Code coverage**: Target 95%+
- **Bug count**: Target 0 critical, < 5 minor
- **Documentation pages**: 3 new, 5 updated

### Performance Metrics
- **Local deployment**: < +1s overhead per file
- **Remote deployment**: < +5s overhead per file
- **Cloud Run deployment**: < +10s overhead per file
- **File transfer speed**: > 1MB/s for remote scp

### Adoption Metrics
- **Services using secureFiles**: 1 (image-gen-mcp) by end of sprint
- **Secure files deployed**: ≥ 1 (GCP credentials)
- **Zero git commits of secrets**: Enforced by validator

---

## References

- [Sprint 374 Technical Architecture](./technical-architecture.md)
- [Sprint 372: Unified Bit Deploy](../sprint-372-unified-bit-deploy/technical-architecture.md)
- [Docker Compose File Specification](https://docs.docker.com/compose/compose-file/)
- [GCP Secret Manager - Mounting Files](https://cloud.google.com/run/docs/configuring/secrets#mounting_secrets_as_files)
