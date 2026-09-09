# Staging Deployment Guide - Sprint 21 Progress Messages Fix

**Sprint ID:** sprint-21-o1ihsj
**Date:** 2026-08-21
**Author:** Claude (Lead Implementor)
**Target Environment:** Staging

---

## Executive Summary

This guide provides step-by-step instructions for deploying the Sprint 21 progress messages fix to the staging environment. The fix resolves a critical bug where FeedbackMiddleware was ignoring the actual operation start time, causing progress messages to never appear despite proper configuration.

**Deployment Risk:** LOW
**Estimated Downtime:** None (rolling deployment)
**Rollback Time:** <5 minutes (configuration toggle)

---

## Pre-Deployment Checklist

### ✅ Code Review
- [x] Root cause analysis documented (root-cause-analysis.md)
- [x] Fix implemented and peer-reviewed (feedback-middleware.ts)
- [x] Unit tests added and passing (30/30 tests)
- [x] Build successful with no TypeScript errors
- [x] No breaking changes introduced

### ✅ Configuration Verification
- [x] Staging already has `PROGRESS_ENABLED: true`
- [x] Staging already has `PROGRESS_INITIAL_THRESHOLD_MS: 1000`
- [x] These variables are set in `env/staging/global.yaml` or equivalent

### ⏳ Documentation
- [x] Implementation summary created
- [x] Deployment guide created (this document)
- [x] Rollback plan documented

---

## Deployment Steps

### Phase 1: Merge to Main Branch

**Prerequisites:**
- All unit tests passing (30/30 progress tests)
- Code review approved
- Sprint branch ready: `feature/sprint-21-o1ihsj-progress-messages-investigatio`

**Steps:**

1. **Create Pull Request**
   ```bash
   # From sprint worktree
   cd /Users/christophernavta/IdeaProjects/BitBratPlatform/.worktrees/sprint-21-o1ihsj

   # Verify all changes committed
   git status

   # Push branch
   git push origin feature/sprint-21-o1ihsj-progress-messages-investigatio

   # Create PR via GitHub CLI or web interface
   gh pr create --title "Sprint 21: Fix progress messages timing bug" \
     --body "$(cat planning/sprint-21-o1ihsj/implementation-summary.md)"
   ```

2. **Merge PR**
   - Wait for CI checks to pass
   - Request approval from code owner
   - Merge to `main` branch

3. **Verify Merge**
   ```bash
   # Switch to main branch
   git checkout main
   git pull origin main

   # Verify changes present
   git log --oneline -5
   git diff HEAD~1 src/common/middleware/feedback-middleware.ts
   ```

---

### Phase 2: Build and Deploy to Staging

**Build Strategy:** Docker image with tag `staging-sprint-21-{timestamp}`

**Services to Deploy:**
- `llm-bot` (primary service using progress messages)
- `ingress-egress` (contains FeedbackMiddleware, used by llm-bot)

**Steps:**

1. **Set Execution Context**
   ```bash
   export BITBRAT_CONTEXT=staging
   # OR
   echo "staging" > ~/.bratrc
   ```

2. **Build Updated Services**
   ```bash
   # Build llm-bot service
   npm run brat -- bit build llm-bot --tag staging-sprint-21-$(date +%Y%m%d-%H%M%S)

   # Build ingress-egress service
   npm run brat -- bit build ingress-egress --tag staging-sprint-21-$(date +%Y%m%d-%H%M%S)
   ```

3. **Deploy to Staging**
   ```bash
   # Deploy llm-bot
   npm run brat -- bit deploy llm-bot --context staging

   # Deploy ingress-egress
   npm run brat -- bit deploy ingress-egress --context staging
   ```

4. **Monitor Deployment**
   ```bash
   # Check deployment status
   npm run brat -- fleet list --context staging

   # Verify services healthy
   npm run brat -- fleet health llm-bot --context staging
   npm run brat -- fleet health ingress-egress --context staging
   ```

**Expected Output:**
```
✓ llm-bot: healthy (revision: staging-sprint-21-20260821-170000)
✓ ingress-egress: healthy (revision: staging-sprint-21-20260821-170000)
```

---

### Phase 3: Configuration Verification

**Objective:** Verify that staging environment has correct configuration for progress messages.

**Steps:**

1. **Verify Environment Variables**
   ```bash
   # Check llm-bot configuration
   npm run brat -- fleet config llm-bot --describe --context staging | grep PROGRESS
   ```

   **Expected Output:**
   ```
   PROGRESS_ENABLED: true (source: env/staging/global.yaml)
   PROGRESS_INITIAL_THRESHOLD_MS: 1000 (source: env/staging/global.yaml)
   PROGRESS_UPDATE_INTERVAL_MS: 5000 (source: env/staging/global.yaml, default)
   PROGRESS_TIMEOUT_THRESHOLD_MS: 30000 (source: env/staging/global.yaml, default)
   PROGRESS_USE_CUSTOM: false (source: env/staging/global.yaml, default)
   ```

2. **Verify Middleware Initialization**
   ```bash
   # Check logs for FeedbackMiddleware initialization
   npm run brat -- fleet logs llm-bot --context staging --since 5m | grep FeedbackMiddleware
   ```

   **Expected Output:**
   ```
   [INFO] FeedbackMiddleware initialized {
     config: {
       initialThresholdMs: 1000,
       updateIntervalMs: 5000,
       timeoutThresholdMs: 30000,
       enabled: true,
       useCustomMessages: false
     }
   }
   ```

---

### Phase 4: Smoke Testing

**Objective:** Trigger a long-running operation and verify progress message appears.

**Test Scenario:** Send a chat message that triggers an LLM request.

**Steps:**

1. **Trigger Test Request**

   Use the staging chat interface or API to send a message that will trigger llm-bot:

   ```
   User Message: "Write a detailed explanation of quantum computing"
   ```

   This request should take >1 second to process, triggering the progress message.

2. **Monitor Logs (Real-Time)**
   ```bash
   # Watch logs in real-time
   npm run brat -- fleet logs llm-bot --context staging --follow
   ```

3. **Expected Log Sequence**

   **T=0ms: Event Received**
   ```json
   [DEBUG] llm_bot.operation_context.added {
     operation: "llm_request",
     startedAt: 1724256000000,
     correlationId: "abc123-def456-ghi789"
   }
   ```

   **T=1000ms: Progress Message Triggered**
   ```json
   [DEBUG] Operation tracking started {
     correlationId: "abc123-def456-ghi789",
     operation: "llm_request",
     startedAt: "2026-08-21T17:00:00.000Z",
     startedAtSource: "annotation_ms"
   }

   [INFO] Sending template progress message {
     correlationId: "abc123-def456-ghi789",
     stage: "initial",
     elapsedMs: 1000,
     message: "🤔 Thinking about your request..."
   }
   ```

   **T=3000ms: Final Response**
   ```json
   [INFO] LLM request completed {
     correlationId: "abc123-def456-ghi789",
     elapsedMs: 3000,
     tokens: 450
   }
   ```

4. **Verify in User Interface**

   If staging has a UI (Discord, Twilio, etc.), verify that the user sees:
   - Initial message: "🤔 Thinking about your request..." (after ~1s)
   - Final response: "Quantum computing is..." (after ~3s)

---

### Phase 5: Validation Criteria

**Success Criteria:**

✅ **Deployment Successful:**
- llm-bot and ingress-egress deployed to staging
- Services report healthy status
- No errors in deployment logs

✅ **Configuration Correct:**
- `PROGRESS_ENABLED=true` confirmed
- `PROGRESS_INITIAL_THRESHOLD_MS=1000` confirmed
- FeedbackMiddleware initialized with correct config

✅ **Progress Messages Appear:**
- Log shows `operation_context.added` with `startedAt`
- Log shows `Operation tracking started` with `startedAtSource: annotation_ms`
- Log shows `Sending template progress message` after ~1s
- User receives progress message in chat interface

✅ **Timing Accurate:**
- Elapsed time in logs matches actual time (±500ms tolerance)
- Progress message appears within 1000ms threshold
- No progress message for fast operations (<1s)

**Failure Criteria (Rollback Required):**

❌ **Service Crashes:**
- llm-bot or ingress-egress fails to start
- Recurring errors in logs

❌ **Progress Messages Missing:**
- No progress messages appear for operations >1s
- Logs show `startedAtSource: current_time_no_annotation` (indicates annotation not found)

❌ **Incorrect Timing:**
- Progress messages appear immediately (elapsed ~0ms)
- Progress messages never appear despite long operations

---

## Monitoring & Observability

### Key Log Patterns to Monitor

**Success Indicators:**
```bash
# Monitor for successful progress messages
npm run brat -- fleet logs llm-bot --context staging \
  | grep -E "(operation_context.added|Operation tracking started|Sending template progress message)"
```

**Expected Patterns:**
```
[DEBUG] llm_bot.operation_context.added { operation: 'llm_request', startedAt: <timestamp> }
[DEBUG] Operation tracking started { startedAtSource: 'annotation_ms', ... }
[INFO] Sending template progress message { stage: 'initial', elapsedMs: <time> }
```

**Error Indicators:**
```bash
# Monitor for errors or warnings
npm run brat -- fleet logs llm-bot --context staging --level warn,error
```

**Warning Patterns (Investigate if Seen):**
```
[WARN] Invalid startedAt format in operation_context
[ERROR] Failed to send progress message
[DEBUG] Operation tracking started { startedAtSource: 'current_time_no_annotation' }
```

### Metrics to Track

**If Prometheus/Grafana Available:**
- `progress_messages_sent_total` (counter) - should increase for slow operations
- `llm_request_duration_seconds` (histogram) - verify operations actually take >1s
- `feedback_middleware_errors_total` (counter) - should remain 0

**Manual Verification:**
```bash
# Count progress messages sent in last hour
npm run brat -- fleet logs llm-bot --context staging --since 1h \
  | grep "Sending template progress message" | wc -l

# Expected: >0 if there were slow operations
```

---

## Rollback Plan

**If issues occur, rollback is NON-DESTRUCTIVE and IMMEDIATE.**

### Option 1: Disable via Configuration (RECOMMENDED)

**No code changes required. Toggle feature off via environment variable.**

**Steps:**

1. **Update Configuration**
   ```bash
   # Edit env/staging/global.yaml
   PROGRESS_ENABLED: "false"
   ```

2. **Redeploy Services**
   ```bash
   npm run brat -- bit deploy llm-bot --context staging
   npm run brat -- bit deploy ingress-egress --context staging
   ```

3. **Verify Disabled**
   ```bash
   # Check logs
   npm run brat -- fleet logs llm-bot --context staging | grep FeedbackMiddleware
   ```

   **Expected Output:**
   ```
   [DEBUG] FeedbackMiddleware.beforeNext called { enabled: false }
   ```

**Impact:**
- Progress messages stop appearing
- No other functionality affected
- Users revert to pre-Sprint 21 experience (no feedback during slow operations)

**Rollback Time:** <5 minutes

---

### Option 2: Revert to Previous Image (If Service Crashes)

**Only needed if llm-bot/ingress-egress fails to start.**

**Steps:**

1. **Identify Previous Working Image**
   ```bash
   # List recent deployments
   npm run brat -- fleet info llm-bot --context staging --history
   ```

2. **Redeploy Previous Image**
   ```bash
   npm run brat -- bit deploy llm-bot --tag <previous-tag> --context staging
   ```

3. **Verify Deployment**
   ```bash
   npm run brat -- fleet health llm-bot --context staging
   ```

**Rollback Time:** <10 minutes

---

## Post-Deployment Monitoring

### First 24 Hours

**Hourly Checks:**

1. **Service Health**
   ```bash
   npm run brat -- fleet health llm-bot --context staging
   ```

2. **Error Rate**
   ```bash
   npm run brat -- fleet logs llm-bot --context staging --since 1h --level error | wc -l
   ```

3. **Progress Message Count**
   ```bash
   npm run brat -- fleet logs llm-bot --context staging --since 1h \
     | grep "Sending template progress message" | wc -l
   ```

### Week 1 Monitoring

**Daily Summary:**

1. **Total Progress Messages Sent**
2. **Average Elapsed Time at Progress Trigger**
3. **User Feedback** (if available via support tickets, Discord feedback)
4. **Error Count** (should be 0)

**Success Metrics:**
- Progress messages appearing for >80% of slow operations (>1s)
- Timing accuracy within ±500ms
- No user complaints about missing progress feedback
- No errors in logs related to FeedbackMiddleware

---

## Troubleshooting

### Issue: Progress Messages Still Not Appearing

**Diagnosis:**

1. **Check Logs for Annotation**
   ```bash
   npm run brat -- fleet logs llm-bot --context staging \
     | grep "operation_context.added"
   ```

   - **If Missing:** llm-bot is not adding the annotation. Verify code deployed correctly.
   - **If Present:** Continue to next step.

2. **Check Middleware Initialization**
   ```bash
   npm run brat -- fleet logs llm-bot --context staging \
     | grep "Operation tracking started"
   ```

   - **If `startedAtSource: current_time_no_annotation`:** Annotation is present but middleware can't find `startedAt`. Check annotation format.
   - **If `startedAtSource: annotation_ms`:** Timing extraction is working. Check elapsed time calculation.

3. **Check Elapsed Time**
   ```bash
   npm run brat -- fleet logs llm-bot --context staging \
     | grep -A2 "Operation tracking started"
   ```

   Look for log entries showing elapsed time. If elapsed < 1000ms, progress won't trigger.

**Resolution:**

- If annotation missing: Redeploy llm-bot service
- If format wrong: Review llm-bot-service.ts:204 (should use `Date.now()`)
- If timing wrong: Review feedback-middleware.ts:260-324 (timestamp extraction)

---

### Issue: Timing Inaccurate

**Diagnosis:**

Compare logged elapsed time with actual operation duration:

```bash
# Find a single request and trace timing
npm run brat -- fleet logs llm-bot --context staging --correlationId <correlation-id>
```

**Expected:**
- `operation_context.added` at T=0
- `Operation tracking started` at T=X (when next() called)
- `elapsedMs` should match X

**If `elapsedMs` ~0ms:**
- Middleware still creating new timestamp. Verify fix deployed.

**If `elapsedMs` too large:**
- Check for clock skew between services. Verify timestamps use same source.

---

### Issue: Service Crashes After Deployment

**Diagnosis:**

```bash
npm run brat -- fleet logs llm-bot --context staging --level error --since 10m
```

**Common Errors:**

1. **TypeError: Cannot read property 'startedAt'**
   - Null/undefined `operationContext`
   - Check annotation extraction logic

2. **Invalid Date Error**
   - Malformed timestamp in annotation
   - Verify llm-bot uses `Date.now()` (number format)

**Resolution:**

Roll back immediately using Option 2 (Revert to Previous Image).

---

## Sign-Off Checklist

Before considering deployment complete:

- [ ] Services deployed successfully
- [ ] All services report healthy status
- [ ] Configuration verified (PROGRESS_ENABLED=true)
- [ ] Smoke test completed successfully
- [ ] Progress message appeared in logs
- [ ] Progress message appeared in user interface
- [ ] Timing accuracy validated (±500ms)
- [ ] No errors in logs (past 1 hour)
- [ ] Monitoring dashboards configured (if applicable)
- [ ] Team notified of deployment
- [ ] Rollback plan tested and ready

---

## Next Steps (Post-Staging Validation)

**If Staging Successful (>7 Days Stable):**

1. Plan production deployment
2. Create production deployment guide
3. Schedule deployment window
4. Notify stakeholders

**If Staging Fails:**

1. Document failure mode
2. Create GitHub issue with details
3. Roll back to previous state
4. Investigate root cause
5. Plan remediation sprint

---

## Contact & Support

**Sprint Lead:** Claude (Lead Implementor)
**Documentation:** planning/sprint-21-o1ihsj/
**Code Changes:** src/common/middleware/feedback-middleware.ts
**Test Coverage:** src/common/middleware/feedback-middleware.test.ts

**Related Documents:**
- Root Cause Analysis: planning/sprint-21-o1ihsj/root-cause-analysis.md
- Implementation Summary: planning/sprint-21-o1ihsj/implementation-summary.md
- Investigation Report: planning/sprint-21-o1ihsj/progress-messages-investigation.md

---

**End of Staging Deployment Guide**
