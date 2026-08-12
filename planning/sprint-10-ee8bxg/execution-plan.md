# Execution Plan: Twitch Integration Refactoring

**Sprint**: sprint-10-ee8bxg
**Role**: Lead Implementor
**Created**: 2026-08-11
**Status**: Ready for Execution

---

## Overview

This execution plan breaks down the Twitch integration refactoring into granular, accomplishable tasks organized by phase. Each phase has clear entry/exit criteria and validation checkpoints.

**Objective**: Refactor Twitch integration to use the standard connector adapter pattern established in Sprint 348 (Slack), preparing for future per-platform Bit separation while maintaining 100% backward compatibility.

---

## Execution Phases

### Phase 0: Pre-Implementation Setup
**Duration**: 15 minutes
**Objective**: Verify environment and baseline functionality

#### Entry Criteria
- [ ] Sprint worktree active and clean
- [ ] Dependencies installed (`npm ci`)
- [ ] Build passing (`npm run build`)
- [ ] All tests passing (`npm test`)

#### Tasks
1. Verify Twitch IRC client current functionality (baseline)
2. Document current ingress-egress integration points
3. Create feature parity test matrix
4. Set up test environment (if needed)

#### Exit Criteria
- [ ] Baseline functionality documented
- [ ] Test matrix created
- [ ] Environment ready

---

### Phase 1: Adapter Scaffold Creation
**Duration**: 1.5 hours
**Objective**: Create `TwitchConnectorAdapter` with complete interface compliance

#### Entry Criteria
- [ ] Phase 0 complete
- [ ] Slack connector adapter reviewed for reference

#### Tasks (Priority Order)

**1.1: Create connector-adapter.ts skeleton** (15 min)
- Create file: `src/services/ingress/twitch/connector-adapter.ts`
- Import required interfaces from `../core`
- Import `TwitchIrcClient` type
- Define class skeleton

**1.2: Implement IngressConnector interface** (30 min)
- Implement `start()` → delegate to client
- Implement `stop()` → delegate to client
- Implement `getSnapshot()` → delegate to client
- Add proper TypeScript types

**1.3: Implement EgressConnector methods** (20 min)
- Implement `sendText()` → delegate to client
- Add optional `sendWhisper()` → delegate to client
- Add optional `banUser()` → delegate to client
- Add error handling and logging

**1.4: Implement getMetadata()** (25 min)
- Define `ConnectorMetadata` return value
- Set platform: 'twitch'
- Define ingress capabilities (websocket/IRC)
- Define egress capabilities (chat, dm, no reactions)
- Define moderation capabilities (ban, timeout, delete)
- Set version and authMethod

#### Validation Checkpoint
- [ ] TypeScript compiles without errors
- [ ] All interface methods implemented
- [ ] Delegation to client correct
- [ ] No changes to `TwitchIrcClient` required
- [ ] Code review: matches Slack adapter pattern

#### Exit Criteria
- [ ] `connector-adapter.ts` created and complete
- [ ] All IngressConnector methods implemented
- [ ] `getMetadata()` returns accurate capabilities
- [ ] No TypeScript errors
- [ ] Manual review passed

---

### Phase 2: Module Integration
**Duration**: 30 minutes
**Objective**: Export adapter and integrate with ingress-egress service

#### Entry Criteria
- [ ] Phase 1 complete
- [ ] Adapter compiles successfully

#### Tasks (Priority Order)

**2.1: Update module exports** (5 min)
- Edit `src/services/ingress/twitch/index.ts`
- Add export: `export { TwitchConnectorAdapter } from './connector-adapter';`
- Verify no breaking changes to existing exports

**2.2: Import adapter in ingress-egress-service** (5 min)
- Edit `src/apps/ingress-egress-service.ts`
- Add import: `import { TwitchConnectorAdapter } from '../services/ingress/twitch';`

**2.3: Create adapter instance** (10 min)
- After creating `TwitchIrcClient`, create adapter instance
- Pass client and config to adapter constructor
- Keep existing client reference (dual support)

**2.4: Register with ConnectorManager** (10 min)
- Add: `this.connectorManager!.register('twitch', twitchAdapter);`
- Verify registration occurs before `start()` call
- Keep dual support: start via client directly for now

#### Validation Checkpoint
- [ ] TypeScript compiles
- [ ] No runtime errors during startup
- [ ] Adapter registered successfully
- [ ] Existing client still works (dual support)

#### Exit Criteria
- [ ] Adapter exported from module
- [ ] Adapter imported in ingress-egress
- [ ] Adapter registered with ConnectorManager
- [ ] No breaking changes
- [ ] Build passes

---

### Phase 3: Feature Parity Verification - Core Functionality
**Duration**: 2 hours
**Objective**: Verify all Twitch functionality works identically via adapter

#### Entry Criteria
- [ ] Phase 2 complete
- [ ] Service starts successfully
- [ ] Test environment available

#### Tasks (Priority Order)

**3.1: Verify IRC ingress (message handling)** (30 min)
- **Test**: Send message in Twitch chat
- **Verify**: Envelope published to `internal.ingress.v1`
- **Verify**: User metadata preserved (login, displayName, userId)
- **Verify**: Message text correct
- **Verify**: Self-message filtering works (bot messages ignored)

**3.2: Verify debug mode (!debug command)** (30 min)
- **Test**: Authorized user sends `!debug hello world`
- **Verify**: Tracer flag set (`qos.tracer: true`)
- **Verify**: Debug confirmation sent to chat
- **Verify**: Correlation ID generated
- **Verify**: Unauthorized user rejected

**3.3: Verify egress (sendText)** (20 min)
- **Test**: Send message via adapter: `adapter.sendText('test', '#channel')`
- **Verify**: Message appears in Twitch chat
- **Verify**: Multi-line messages work (newline splitting)
- **Verify**: Error handling works (invalid channel)

**3.4: Verify egress (sendWhisper)** (20 min)
- **Test**: Send whisper via adapter: `adapter.sendWhisper('test', 'userId')`
- **Verify**: Whisper received
- **Verify**: Platform prefix handling (`twitch:userId`)

**3.5: Verify moderation (banUser)** (20 min)
- **Test**: Ban user via adapter: `adapter.banUser('userId', 'reason')`
- **Verify**: User banned in channel
- **Verify**: Reason message correct

#### Validation Checkpoint
- [ ] All IRC ingress tests passed
- [ ] Debug mode works identically
- [ ] All egress tests passed
- [ ] All moderation tests passed
- [ ] Zero regressions identified

#### Exit Criteria
- [ ] Feature parity matrix: 100% pass
- [ ] All core functionality verified
- [ ] No regressions
- [ ] Documentation updated with test results

---

### Phase 4: Advanced Feature Verification
**Duration**: 1 hour
**Objective**: Verify edge cases and advanced features

#### Entry Criteria
- [ ] Phase 3 complete
- [ ] Core functionality verified

#### Tasks (Priority Order)

**4.1: Verify OAuth token refresh** (20 min)
- **Test**: Force token expiration (if possible)
- **Verify**: RefreshingAuthProvider refreshes token
- **Verify**: Adapter doesn't interfere with flow
- **Verify**: Client reconnects successfully

**4.2: Verify broadcaster client support** (20 min)
- **Test**: Send message via broadcaster client
- **Verify**: Message sent with broadcaster identity
- **Verify**: Separate broadcaster adapter works (if created)
- **Verify**: No interference with main client

**4.3: Verify deduplication** (10 min)
- **Test**: Verify self-messages filtered
- **Verify**: Bot messages ignored
- **Verify**: No duplicate processing

**4.4: Verify getSnapshot()** (10 min)
- **Test**: Call `adapter.getSnapshot()`
- **Verify**: Returns correct state (CONNECTED, DISCONNECTED, etc.)
- **Verify**: Joined channels listed
- **Verify**: Counters accurate (received, published, failed)

#### Validation Checkpoint
- [ ] Token refresh works
- [ ] Broadcaster client works
- [ ] Deduplication works
- [ ] Snapshot accurate

#### Exit Criteria
- [ ] All advanced features verified
- [ ] Edge cases handled
- [ ] Zero regressions

---

### Phase 5: Egress Handler Migration
**Duration**: 45 minutes
**Objective**: Migrate egress handler to use ConnectorManager

#### Entry Criteria
- [ ] Phase 4 complete
- [ ] All feature parity verified

#### Tasks (Priority Order)

**5.1: Locate egress handler code** (10 min)
- Find egress message subscription in `ingress-egress-service.ts`
- Document current direct client usage
- Identify all Twitch-specific egress calls

**5.2: Update egress handler to use ConnectorManager** (20 min)
- Replace: `this.twitchClient.sendText()` with `manager.getConnector('twitch').sendText()`
- Handle connector not found gracefully
- Add logging for connector retrieval
- Preserve error handling

**5.3: Test egress routing** (15 min)
- **Test**: Send egress event targeted to Twitch
- **Verify**: Message routed via ConnectorManager
- **Verify**: Message appears in Twitch chat
- **Verify**: Error handling works (connector not found)

#### Validation Checkpoint
- [ ] Egress handler uses ConnectorManager
- [ ] Messages route correctly
- [ ] Error handling works
- [ ] No regressions in egress flow

#### Exit Criteria
- [ ] Egress handler migrated
- [ ] All egress routing tests passed
- [ ] Code reviewed

---

### Phase 6: Testing & Documentation
**Duration**: 1.5 hours
**Objective**: Add comprehensive tests and update documentation

#### Entry Criteria
- [ ] Phase 5 complete
- [ ] All functionality verified

#### Tasks (Priority Order)

**6.1: Create adapter unit tests** (45 min)
- Create file: `src/services/ingress/twitch/__tests__/connector-adapter.test.ts`
- Test: `start()` delegates to client
- Test: `stop()` delegates to client
- Test: `getSnapshot()` delegates to client
- Test: `sendText()` delegates to client
- Test: `sendWhisper()` delegates to client
- Test: `banUser()` delegates to client
- Test: `getMetadata()` returns correct capabilities
- Mock `TwitchIrcClient` for isolation

**6.2: Run full test suite** (15 min)
- Run: `npm test`
- Verify all existing tests pass
- Verify new adapter tests pass
- Fix any failures

**6.3: Update documentation** (30 min)
- Update `CLAUDE.md`: Add Twitch connector example
- Update `src/services/ingress/twitch/README.md`: Document adapter pattern
- Update `documentation/guides/adding-ingress-platform.md`: Reference Twitch
- Document connector capabilities in module README

#### Validation Checkpoint
- [ ] All tests pass (existing + new)
- [ ] Test coverage maintained or improved
- [ ] Documentation updated
- [ ] Examples accurate

#### Exit Criteria
- [ ] Adapter unit tests created (7+ tests)
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Code examples added

---

### Phase 7: Build Verification & Final Checks
**Duration**: 30 minutes
**Objective**: Final validation before completion

#### Entry Criteria
- [ ] Phase 6 complete
- [ ] All tests passing

#### Tasks (Priority Order)

**7.1: Run full build** (5 min)
- Run: `npm run build`
- Verify TypeScript compiles
- Verify no errors or warnings

**7.2: Run linting** (5 min)
- Run: `npm run lint`
- Fix any linting errors
- Verify code style compliance

**7.3: Final feature parity check** (10 min)
- Re-run feature parity test matrix
- Verify 100% pass rate
- Document any edge cases

**7.4: Code review preparation** (10 min)
- Review all changed files
- Verify no debug code left
- Verify no commented-out code
- Verify proper error handling everywhere

#### Validation Checkpoint
- [ ] Build passes
- [ ] Lint passes
- [ ] Feature parity: 100%
- [ ] Code review ready

#### Exit Criteria
- [ ] All checks passed
- [ ] Code clean and production-ready
- [ ] Ready for PR creation

---

## Rollback Strategy

If critical regressions discovered at any phase:

### Immediate Rollback (< 5 min)
1. **DO NOT** commit adapter changes
2. Remove adapter registration from `ConnectorManager`
3. Keep direct client usage
4. Investigate issue offline

### Partial Rollback (< 15 min)
1. Keep adapter created and registered
2. Revert egress handler to direct client usage
3. Adapter remains passive (registered but not used)
4. Investigate and fix

### Full Rollback (< 30 min)
1. Delete `connector-adapter.ts`
2. Revert all changes to `ingress-egress-service.ts`
3. Revert module exports
4. Return to baseline

**Rollback Decision Matrix**:
- **Phase 1-2 issues**: Delete adapter, no harm done
- **Phase 3-4 regressions**: Keep adapter, revert usage
- **Phase 5-7 issues**: Partial rollback, fix incrementally

---

## Success Metrics

### Functional Metrics
- [ ] IRC ingress: 100% feature parity
- [ ] Egress: 100% feature parity
- [ ] Debug mode: Works identically
- [ ] Moderation: Works identically
- [ ] OAuth token refresh: No interference
- [ ] Broadcaster client: No interference

### Quality Metrics
- [ ] Test coverage: Maintained or improved
- [ ] TypeScript: Zero errors
- [ ] Linting: Zero errors
- [ ] Build: Success
- [ ] Documentation: Updated

### Architecture Metrics
- [ ] Adapter implements `IngressConnector`
- [ ] Adapter registered with `ConnectorManager`
- [ ] `getMetadata()` implemented
- [ ] Delegation pattern correct
- [ ] Future-ready for per-platform Bit separation

---

## Risk Mitigation

### High-Risk Areas
1. **OAuth Token Refresh**: Test thoroughly, verify no interference
2. **Debug Mode RBAC**: Verify authorized users only
3. **Broadcaster Client**: Ensure separate client unaffected
4. **Egress Routing**: Verify ConnectorManager routing works

### Testing Strategy
- **Unit Tests**: Adapter delegation logic
- **Integration Tests**: Adapter + real client (mocked Twurple)
- **Manual Tests**: IRC ingress, egress, debug mode in staging
- **Regression Tests**: Full feature parity matrix

### Validation Checkpoints
Each phase has validation checkpoint before proceeding:
- ✅ Pass: Continue to next phase
- ⚠️ Issues: Fix before continuing
- 🔴 Critical: Rollback and investigate

---

## Timeline Summary

| Phase | Duration | Cumulative |
|-------|----------|------------|
| 0. Pre-Implementation Setup | 15 min | 15 min |
| 1. Adapter Scaffold Creation | 1.5 hours | 1h 45m |
| 2. Module Integration | 30 min | 2h 15m |
| 3. Feature Parity - Core | 2 hours | 4h 15m |
| 4. Feature Parity - Advanced | 1 hour | 5h 15m |
| 5. Egress Handler Migration | 45 min | 6 hours |
| 6. Testing & Documentation | 1.5 hours | 7h 30m |
| 7. Build Verification | 30 min | **8 hours** |

**Total Estimated Time**: 8 hours (1 full work day)
**Buffer**: 2 hours for unforeseen issues
**Recommended Sprint Duration**: 1.5 days

---

## Dependencies

### External Dependencies
- None (all work contained within codebase)

### Internal Dependencies
- `TwitchIrcClient` (unchanged)
- `ConnectorManager` (already exists)
- `IngressConnector` interface (already defined)
- Slack connector adapter (reference implementation)

### Blockers
- None identified

---

## Communication Plan

### Status Updates
- End of each phase: Update request log
- Critical issues: Immediate notification
- Phase validation failures: Document and propose solution

### Review Points
- Phase 1 complete: Code review adapter scaffold
- Phase 5 complete: Code review egress migration
- Phase 7 complete: Final code review before PR

---

## Completion Criteria

**Sprint marked COMPLETE when**:
- [ ] All 7 phases completed
- [ ] All validation checkpoints passed
- [ ] All success metrics met
- [ ] Zero regressions identified
- [ ] Documentation updated
- [ ] Tests passing
- [ ] Build passing
- [ ] Code reviewed
- [ ] PR created (if applicable)

---

**Execution Plan Status**: ✅ Ready for Execution
**Next Action**: Begin Phase 0 - Pre-Implementation Setup
