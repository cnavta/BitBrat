# Feature Parity Test Matrix

**Sprint**: sprint-10-ee8bxg
**Task**: P0-003
**Date**: 2026-08-11
**Purpose**: Comprehensive test matrix for verifying 100% feature parity during adapter enhancement

---

## Test Matrix Status

Track test results during Phase 3-4 execution.

**Legend**:
- ✅ PASS - Feature works identically via adapter
- ❌ FAIL - Regression detected
- ⏸️ PENDING - Not yet tested
- ⏭️ SKIPPED - Not applicable

---

## Core Functionality Tests (Phase 3)

### IRC Ingress - Message Handling

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-001 | Basic message reception | Send message in Twitch chat | Envelope published to internal.ingress.v1 | ⏸️ |  |
| C-002 | User metadata preservation | Verify envelope fields | userLogin, displayName, userId, badges present | ⏸️ |  |
| C-003 | Message text accuracy | Compare sent vs received | Text matches exactly | ⏸️ |  |
| C-004 | Channel metadata | Verify envelope fields | channel, roomId present | ⏸️ |  |
| C-005 | Correlation ID generation | Check envelope.correlationId | UUID generated | ⏸️ |  |

### Self-Message Filtering (Deduplication)

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-010 | Bot message filtering | Bot sends via sendText | Message NOT published to ingress | ⏸️ |  |
| C-011 | Bot userId matching | Verify userId comparison | Bot userId === message userId → filtered | ⏸️ |  |
| C-012 | Bot login matching | Verify login comparison | Bot login === message login → filtered | ⏸️ |  |

### Debug Mode (!debug command)

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-020 | Authorized user debug | Send `!debug test message` | qos.tracer = true | ⏸️ | Requires authorized user |
| C-021 | Debug prefix stripping | Verify message text | Text = "test message" (prefix removed) | ⏸️ |  |
| C-022 | Correlation ID in feedback | Check chat confirmation | Correlation ID displayed | ⏸️ |  |
| C-023 | Unauthorized user rejection | Send `!debug` as unauth user | qos.tracer = false (command ignored) | ⏸️ |  |
| C-024 | Debug feedback message | Verify chat response | "🔍 Debug mode ON" message sent | ⏸️ |  |

### Egress - sendText

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-030 | Basic message sending | `adapter.sendText('Hello', '#channel')` | Message appears in Twitch chat | ⏸️ |  |
| C-031 | Multi-line message handling | `adapter.sendText('Line1\nLine2', '#channel')` | Both lines sent separately | ⏸️ |  |
| C-032 | Channel formatting | `adapter.sendText('Hi', 'channel')` | `#` prefix added automatically | ⏸️ |  |
| C-033 | Error handling | `adapter.sendText('Hi', '#invalid')` | Error logged, exception thrown | ⏸️ |  |

### Egress - sendWhisper

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-040 | Basic whisper sending | `adapter.sendWhisper('Hello', 'userId')` | Whisper received by user | ⏸️ | Requires Helix API |
| C-041 | Platform prefix handling | `adapter.sendWhisper('Hi', 'twitch:userId')` | Prefix stripped, whisper sent | ⏸️ |  |
| C-042 | Error handling | `adapter.sendWhisper('Hi', 'invalid')` | Error logged, exception thrown | ⏸️ |  |

### Moderation - banUser

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| C-050 | Basic user ban | `adapter.banUser('userId', 'test ban')` | User banned in channel | ⏸️ | Requires mod permissions |
| C-051 | Ban reason | Verify ban message | Reason = "test ban" | ⏸️ |  |
| C-052 | Error handling | `adapter.banUser('invalid', 'test')` | Error logged, exception thrown | ⏸️ |  |

---

## Advanced Functionality Tests (Phase 4)

### OAuth Token Refresh

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| A-001 | Token expiration detection | Wait for token expiry | RefreshingAuthProvider triggers | ⏸️ | Difficult to test |
| A-002 | Token refresh | Verify refresh callback | saveRefreshedToken() called | ⏸️ |  |
| A-003 | Adapter non-interference | Check adapter behavior | No errors during refresh | ⏸️ |  |
| A-004 | Client reconnection | Verify connection after refresh | Client reconnects successfully | ⏸️ |  |
| A-005 | Message flow continuity | Send message after refresh | Messages still flow correctly | ⏸️ |  |

### Broadcaster Client Support

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| A-010 | Broadcaster client creation | Verify separate client | `this.twitchBroadcasterClient` exists | ⏸️ |  |
| A-011 | Broadcaster sendText | Send via broadcaster client | Message sent with broadcaster identity | ⏸️ |  |
| A-012 | Broadcaster adapter registration | Check manager | `manager.getConnector('twitch-broadcaster')` exists | ⏸️ |  |
| A-013 | Ingress disabled | Verify no message handling | Broadcaster client doesn't publish to ingress | ⏸️ |  |
| A-014 | No interference with main client | Test both clients | Both work independently | ⏸️ |  |

### Deduplication Behavior

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| A-020 | Self-message filtering | Bot sends message | Message filtered (not published) | ⏸️ | Duplicate of C-010 |
| A-021 | Bot ID detection | Verify bot_id field | Messages with bot_id filtered | ⏸️ |  |
| A-022 | User ID matching | Verify userId comparison | Bot userId matches → filtered | ⏸️ |  |

### getSnapshot() Accuracy

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| A-030 | State accuracy | `adapter.getSnapshot()` | state = 'CONNECTED' when connected | ⏸️ |  |
| A-031 | Joined channels list | Verify joinedChannels field | Channels list accurate | ⏸️ |  |
| A-032 | Counters accuracy | Send messages, check counters | received, published, failed increment | ⏸️ |  |
| A-033 | lastMessageAt timestamp | Send message, check timestamp | Timestamp updated | ⏸️ |  |
| A-034 | State mapping | Test all states | CONNECTING, CONNECTED, DISCONNECTED, ERROR map correctly | ⏸️ |  |

---

## Egress Handler Migration Tests (Phase 5)

### ConnectorManager Routing

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| E-001 | Manager retrieval | `manager.getConnector('twitch')` | Returns TwitchConnectorAdapter instance | ⏸️ |  |
| E-002 | Egress event routing | Publish egress event | Message routed via ConnectorManager | ⏸️ |  |
| E-003 | sendText via manager | `connector.sendText(...)` | Message sent to Twitch | ⏸️ |  |
| E-004 | Error feedback egress | Trigger error feedback | Error message sent via manager | ⏸️ | Line 838-841 migration |
| E-005 | Connector not found handling | Unregister connector, test egress | Error logged, no crash | ⏸️ |  |

---

## Adapter Enhancement Verification (Phase 1)

### New Methods Added

| Test ID | Feature | Test Method | Expected Behavior | Status | Notes |
|---------|---------|-------------|-------------------|--------|-------|
| M-001 | sendText() delegation | Unit test with mock client | client.sendText() called | ⏸️ |  |
| M-002 | sendWhisper() delegation | Unit test with mock client | client.sendWhisper() called | ⏸️ |  |
| M-003 | getMetadata() implementation | Call getMetadata() | Returns ConnectorMetadata | ⏸️ |  |
| M-004 | getMetadata() platform | Check metadata.platform | platform = 'twitch' | ⏸️ |  |
| M-005 | getMetadata() capabilities | Check capabilities object | ingress, egress, moderation correct | ⏸️ |  |

---

## Summary Statistics

### Total Tests

| Category | Test Count | Status |
|----------|------------|--------|
| Core Functionality (C-xxx) | 18 tests | ⏸️ Pending |
| Advanced Functionality (A-xxx) | 15 tests | ⏸️ Pending |
| Egress Migration (E-xxx) | 5 tests | ⏸️ Pending |
| Adapter Enhancement (M-xxx) | 5 tests | ⏸️ Pending |
| **TOTAL** | **43 tests** | **0% complete** |

### Pass/Fail Tracking

**Update this section as tests are executed**:

- ✅ **PASS**: 0 / 43 (0%)
- ❌ **FAIL**: 0 / 43 (0%)
- ⏸️ **PENDING**: 43 / 43 (100%)
- ⏭️ **SKIPPED**: 0 / 43 (0%)

**Target**: 100% PASS rate required to proceed to Phase 7

---

## Test Execution Schedule

### Phase 3: Core Functionality
- **C-001 to C-005**: IRC Ingress (5 tests)
- **C-010 to C-012**: Self-Message Filtering (3 tests)
- **C-020 to C-024**: Debug Mode (5 tests)
- **C-030 to C-033**: Egress sendText (4 tests)
- **C-040 to C-042**: Egress sendWhisper (3 tests)
- **C-050 to C-052**: Moderation banUser (3 tests)

**Estimated Time**: 2 hours

### Phase 4: Advanced Functionality
- **A-001 to A-005**: OAuth Token Refresh (5 tests)
- **A-010 to A-014**: Broadcaster Client (5 tests)
- **A-020 to A-022**: Deduplication (3 tests)
- **A-030 to A-034**: getSnapshot Accuracy (5 tests)

**Estimated Time**: 1 hour

### Phase 5: Egress Migration
- **E-001 to E-005**: ConnectorManager Routing (5 tests)

**Estimated Time**: 45 minutes

---

## Regression Criteria

**PASS Criteria**:
- All Core Functionality tests (C-xxx) = 100% PASS
- All Advanced Functionality tests (A-xxx) >= 95% PASS (token refresh may be difficult)
- All Egress Migration tests (E-xxx) = 100% PASS
- All Adapter Enhancement tests (M-xxx) = 100% PASS

**FAIL Criteria** (Triggers Rollback):
- Any Core Functionality test fails → Immediate investigation
- IRC ingress broken → Immediate rollback
- Debug mode broken → Partial rollback
- Egress sendText broken → Immediate rollback

---

## Notes

1. **OAuth Token Refresh (A-001 to A-005)**: These tests may be difficult to execute without forcing token expiration. If not testable, document as "VERIFIED VIA LOGS" instead of manual test.

2. **Broadcaster Client (A-010 to A-014)**: Requires broadcaster OAuth credentials configured. If not available in test environment, mark as SKIPPED with justification.

3. **Debug Mode (C-020 to C-024)**: Requires authorized user configured in `DEBUG_USERS` environment variable. Ensure test user ID is authorized before testing.

4. **Moderation (C-050 to C-052)**: Requires bot to have moderator permissions in test channel. Set up test channel with bot as moderator.

5. **Egress sendWhisper (C-040 to C-042)**: Requires `user:manage:whispers` scope in OAuth token. Verify scope before testing.

---

**Status**: ✅ Feature Parity Test Matrix Created
**Next**: Execute Phase 1 adapter enhancement tasks
