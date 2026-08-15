# Execution Plan: Event Gateway Implementation
**Sprint**: sprint-13-eahhvf
**Role**: Lead Implementor
**Date**: 2026-08-14
**Status**: Ready for Approval

---

## Executive Summary

This execution plan transforms BitBrat's integration layer from a **simple message adapter** into a **full bidirectional event gateway** with exceptional developer experience.

**Original Sprint Goal**: Fix broken DM capabilities (Discord broken, Slack untested, Twitch orphaned)

**Evolved Scope**: Build comprehensive Event Gateway infrastructure that:
1. Makes DM support trivial to implement
2. Reduces integration development time from hours to minutes
3. Enables plugin architecture for community integrations
4. Provides runtime event subscription management

**Strategic Decision**: **Prioritize developer experience foundation FIRST** - this unblocks all subsequent work and makes the original DM fix far simpler.

---

## Vision & Goals

### North Star Metrics

| Metric | Current | Target | Impact |
|--------|---------|--------|--------|
| **Time to add new integration** | Several hours | 10 minutes | 90% reduction |
| **Code per event type** | 60-100 lines TypeScript | 5-10 lines YAML | 95% reduction |
| **Test without deploy** | Must deploy to staging | CLI validation | Instant feedback |
| **Integration packaging** | Fork entire repo | npm module | Community plugins |
| **Event type coverage** | 1-2 per platform | 10+ per platform | 5-10x increase |

### Success Criteria

**Phase 0 (DX Foundation)**:
- ✅ Single generic builder works for all platforms
- ✅ Config-based registry loads YAML successfully
- ✅ CLI validation catches all config errors
- ✅ Existing platforms work without code changes

**Phase 1 (DM Support)**:
- ✅ Discord DMs functional (send + receive)
- ✅ Slack DMs verified and tested
- ✅ Twitch whispers integrated with routing
- ✅ 90%+ test coverage for DM paths

**Phase 2-6**:
- Deferred to backlog (see prioritization section)

---

## Architecture Overview

### Component Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                   IntegrationBit                             │
│            (Existing - Enhanced via Composition)             │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  Connector   │  │   Webhook    │  │   Egress     │       │
│  │   Manager    │  │   Routing    │  │   Routing    │       │
│  │  (existing)  │  │  (existing)  │  │  (existing)  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Event Gateway Components (NEW)                │   │
│  │                                                        │   │
│  │  ┌───────────────┐  ┌────────────────┐  ┌──────────┐│   │
│  │  │ EventRegistry │  │TranslationEngine│  │  Scope   ││   │
│  │  │  (config)     │  │   (generic)     │  │Validator ││   │
│  │  └───────────────┘  └────────────────┘  └──────────┘│   │
│  │                                                        │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │       Generic Envelope Builder                  │  │   │
│  │  │  (replaces platform-specific builders)          │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┼───────────┐
                │           │           │
         ┌──────▼────┐ ┌────▼────┐ ┌───▼─────┐
         │  Discord  │ │  Slack  │ │ Twitch  │
         │ Connector │ │Connector│ │Connector│
         └───────────┘ └─────────┘ └─────────┘
```

### Key Design Decisions

1. **Generic Builder Over Platform Builders**
   - ONE builder for ALL platforms
   - Platform differences isolated in YAML config
   - Eliminates 60-80 lines of boilerplate per platform

2. **Config-Based Registry Over Code Registry**
   - Event mappings in `config/` directory
   - Platform additions don't modify existing code
   - Enables plugin architecture

3. **Composition Over Inheritance**
   - IntegrationBit orchestrates new components
   - Preserves existing functionality
   - Clean separation of concerns

4. **Feature Flags for Gradual Rollout**
   - `ENABLE_CONFIG_REGISTRY=true` (default: false)
   - `ENABLE_GENERIC_BUILDER=true` (default: false)
   - Fallback to existing code paths if disabled

---

## Phase Breakdown

### Phase 0: Developer Experience Foundation (2 weeks) **CRITICAL PATH**

**Goal**: Build infrastructure that makes ALL subsequent work 10x faster

**Why First**:
- Unblocks all other phases
- Makes DM fix trivial (5 lines of YAML vs. days of debugging)
- Enables community contributions
- Reduces maintenance burden

**Major Deliverables**:

1. **Generic Envelope Builder** (3 days)
   - `src/services/ingress/core/generic-envelope-builder.ts`
   - Field extraction with fallback paths
   - Platform-agnostic construction
   - Unit tests (20+ test cases)

2. **Config-Based Event Registry** (4 days)
   - `src/services/ingress/core/config-registry.ts`
   - YAML loader with validation
   - JSONLogic filter compilation
   - Runtime reloading support
   - Migration tool for existing events

3. **CLI Validation Tools** (3 days)
   - `npm run brat -- integration validate`
   - `npm run brat -- integration test`
   - `npm run brat -- integration test-egress`
   - `npm run brat -- integration capture`
   - `npm run brat -- integration create`

4. **Platform Migration** (2 days)
   - Migrate Discord to YAML config
   - Migrate Slack to YAML config
   - Migrate Twitch to YAML config
   - Regression testing

**Estimated Effort**: 60-80 hours (1.5-2 sprints with 1 developer)

**Risk Level**: Medium
- **Risk**: Breaking existing integrations during migration
- **Mitigation**: Feature flags, comprehensive regression tests, phased rollout

**Success Gate**: All existing platforms work via config with zero code changes

---

### Phase 1: Bidirectional DM Support (1 week)

**Goal**: Fix original sprint objective using new infrastructure

**Why Second**:
- Validates generic builder works for complex use cases
- Solves actual user pain point
- Proves architecture decisions

**Major Deliverables**:

1. **Discord DM Fix** (1 day)
   - Add `config/platforms/discord/dm-message.v1.yaml`
   - Implement `sendDM()` in Discord client
   - Add DM detection filter
   - Integration tests

2. **Slack DM Verification** (1 day)
   - Add `config/platforms/slack/dm-message.v1.yaml`
   - Test with real Slack workspace
   - Document DM channel ID format
   - Integration tests

3. **Twitch Whisper Integration** (1 day)
   - Add `config/platforms/twitch/dm-message.v1.yaml`
   - Connect existing `sendWhisper()` to routing
   - Integration tests

4. **Egress Routing Enhancement** (1 day)
   - Update `IntegrationBit.processEgress()` to check event type
   - Route to `sendDM()` vs `sendText()` based on event type
   - Fallback logic for backward compatibility

**Estimated Effort**: 20-30 hours

**Risk Level**: Low (infrastructure already built in Phase 0)

**Success Gate**: All platforms can send and receive DMs

---

### Phase 2: Translation Engine Integration (1 week)

**Goal**: Replace hardcoded egress logic with declarative translation

**Major Deliverables**:
- Egress field mapping implementation
- Translation engine with bidirectional support
- Refactored `processEgress()` to use translator

**Estimated Effort**: 30-40 hours

**Dependencies**: Phase 0, Phase 1

---

### Phase 3: Reaction Support (1 week)

**Goal**: Add emoji reactions (Discord, Slack only - Twitch doesn't support)

**Major Deliverables**:
- `reaction.add.v1` event definition
- Platform implementations
- Bidirectional reaction support

**Estimated Effort**: 25-35 hours

**Dependencies**: Phase 2

---

### Phase 4: Thread Support (1 week)

**Goal**: Thread-aware messaging

**Estimated Effort**: 30-40 hours

**Dependencies**: Phase 2

---

### Phase 5: Subscription Manager (1.5 weeks)

**Goal**: Runtime subscription management

**Estimated Effort**: 50-60 hours

**Dependencies**: Phase 2

---

### Phase 6: Comprehensive Event Coverage (2 weeks)

**Goal**: Add remaining event types (presence, typing, moderation, etc.)

**Estimated Effort**: 60-80 hours

**Dependencies**: Phase 5

---

## Resource Requirements

### Team Composition

**Recommended**: 1-2 developers

**Phase 0 (Critical)**:
- 1 senior developer (familiar with TypeScript, event systems, YAML)
- Skills: Architecture, testing, CLI tooling

**Phase 1+**:
- Can parallelize with 2 developers
- Junior dev can handle platform-specific implementations
- Senior dev focuses on core infrastructure

### External Dependencies

**Required**:
- None (all work self-contained)

**Optional**:
- Test Slack workspace (for Slack DM verification)
- Test Discord server (for Discord DM verification)
- Test Twitch account (for whisper verification)

### Tools & Infrastructure

**Development**:
- Existing BitBrat dev environment
- Docker for local testing
- Jest for unit/integration tests

**New CLI Commands**:
```bash
npm run brat -- integration validate <platform>
npm run brat -- integration test <platform>
npm run brat -- integration create <platform>
```

---

## Risk Assessment

### High Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Breaking existing integrations** | High | Medium | Feature flags, regression tests, phased rollout |
| **YAML config errors** | Medium | High | JSON Schema validation, CLI validator, comprehensive examples |
| **Generic builder edge cases** | Medium | Medium | Extensive unit tests, escape hatch for custom builders |

### Medium Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Performance regression** | Medium | Low | Benchmarking, caching compiled configs |
| **Config file sprawl** | Low | High | Clear directory structure, documentation |
| **JSONLogic filter complexity** | Medium | Medium | Helper functions, filter library, examples |

### Low Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Developer adoption** | Low | Low | Excellent documentation, CLI tooling |
| **Platform API changes** | Medium | Low | Version event mappings, changelog |

---

## Testing Strategy

### Unit Tests

**Coverage Target**: 90%+

**Critical Components**:
- Generic envelope builder (30+ test cases)
- Config registry loader (20+ test cases)
- JSONLogic filter compiler (15+ test cases)
- Field extraction with fallbacks (25+ test cases)

### Integration Tests

**Per Platform**:
- Ingress normalization (fixture-based)
- Egress translation (fixture-based)
- End-to-end flow (mocked APIs)

**Test Matrix**:
```
Event Types × Platforms = Test Cases
- chat.message.v1 × 3 platforms = 3 tests
- dm.message.v1 × 3 platforms = 3 tests
- typing.start.v1 × 3 platforms = 3 tests
Total: 9+ integration tests minimum
```

### CLI Validation Tests

**Scenarios**:
- Valid config passes validation
- Invalid config caught with helpful errors
- Missing required fields detected
- Invalid field paths flagged
- Duplicate event mappings detected

### Regression Tests

**Before/After Comparison**:
- Existing Discord messages still work
- Existing Slack messages still work
- Existing Twitch messages still work
- Performance within 5% of baseline

---

## Rollout Strategy

### Phase 0 Rollout (DX Foundation)

**Week 1: Infrastructure**
- Build generic builder
- Build config registry
- Unit tests

**Week 2: Migration + Tooling**
- CLI tools
- Migrate platforms to YAML
- Integration tests

**Rollout Gate**: All regression tests pass

### Phase 1 Rollout (DM Support)

**Week 3: Implementation**
- Discord DM fix
- Slack DM verification
- Twitch whisper integration
- Egress routing

**Rollout Gate**: DM tests pass for all platforms

### Deployment Strategy

**Feature Flags**:
```bash
# Environment variables
ENABLE_CONFIG_REGISTRY=true    # Use YAML configs
ENABLE_GENERIC_BUILDER=true    # Use generic builder
ENABLE_DM_ROUTING=true          # Route DMs to sendDM()
```

**Phased Activation**:
1. Deploy with flags disabled (no behavior change)
2. Enable in dev environment, test for 2 days
3. Enable in staging, test for 1 week
4. Enable in production, monitor for 1 week
5. Remove feature flags (make default)

---

## Success Metrics

### Phase 0 Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| **Existing platforms working** | 100% | Regression tests pass |
| **YAML validation errors** | 0 | CLI validation clean |
| **Generic builder coverage** | 95%+ | Event types using generic builder |
| **Documentation completeness** | 100% | All CLI commands documented |

### Phase 1 Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| **DM send success rate** | 100% | Integration tests pass |
| **DM receive success rate** | 100% | Filter tests pass |
| **Test coverage** | 90%+ | Jest coverage report |
| **Breaking changes** | 0 | Regression tests pass |

### Long-term Success Metrics

| Metric | Target | Timeframe |
|--------|--------|-----------|
| **Community integrations** | 3+ | 6 months |
| **Event types per platform** | 10+ | 3 months |
| **Integration development time** | <1 hour | Immediate |
| **Support tickets (integration bugs)** | -50% | 3 months |

---

## Timeline

### Optimistic (1 developer, full-time)

- **Phase 0**: 2 weeks
- **Phase 1**: 1 week
- **Total for original sprint goal**: 3 weeks

### Realistic (1 developer, 50% allocation)

- **Phase 0**: 4 weeks
- **Phase 1**: 2 weeks
- **Total for original sprint goal**: 6 weeks

### Pessimistic (interruptions, blockers)

- **Phase 0**: 6 weeks
- **Phase 1**: 3 weeks
- **Total for original sprint goal**: 9 weeks

**Recommendation**: Plan for realistic timeline, aim for optimistic

---

## Go/No-Go Decision Points

### Before Phase 0

**Prerequisites**:
- [ ] Stakeholder approval of architecture
- [ ] Developer assigned to project
- [ ] Test environments configured

**Go Criteria**: All prerequisites met

### Before Phase 1

**Prerequisites**:
- [ ] Phase 0 complete (all tests passing)
- [ ] Zero regression failures
- [ ] CLI tools functional
- [ ] Documentation complete

**Go Criteria**: Phase 0 success gate passed

### Before Production Deployment

**Prerequisites**:
- [ ] All unit tests passing (90%+ coverage)
- [ ] All integration tests passing
- [ ] Staging environment stable for 1 week
- [ ] Performance benchmarks within 5% of baseline
- [ ] Rollback plan documented and tested

**Go Criteria**: All prerequisites met + stakeholder approval

---

## Appendix: Quick Wins

If timeline is compressed, these tasks can be deprioritized:

**Optional (Phase 0)**:
- CLI fixture generator (`integration capture`) - nice to have
- Runtime config reloading - can deploy to reload
- Integration scaffold generator - can copy existing platform

**Optional (Phase 1)**:
- Twitch whisper integration - already works, just not routed
- Extensive DM testing - can verify manually

**Must Have (Phase 0)**:
- Generic envelope builder - CRITICAL
- Config-based registry - CRITICAL
- Basic CLI validation - CRITICAL
- Platform migration - CRITICAL

**Must Have (Phase 1)**:
- Discord DM fix - ORIGINAL SPRINT GOAL
- Egress routing enhancement - REQUIRED FOR DM

---

## Document Version

**Version**: 1.0
**Last Updated**: 2026-08-14
**Next Review**: After Phase 0 completion
**Status**: Ready for Approval
