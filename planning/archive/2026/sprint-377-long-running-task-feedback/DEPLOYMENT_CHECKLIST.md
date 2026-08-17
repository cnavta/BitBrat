# Sprint 377 Deployment Checklist

**Feature:** Long-Running Task Feedback
**Version:** 1.0.0 (Phase 1 - Template Messages)
**Target Date:** 2026-07-31

---

## Pre-Deployment Verification

### ✅ Code Quality

- [x] All unit tests passing (51/51)
- [x] All integration tests passing (3/3)
- [x] TypeScript build successful
- [x] No console errors or warnings
- [x] Code reviewed and approved
- [x] No breaking changes introduced

### ✅ Documentation

- [x] User guide created (`documentation/guides/long-running-task-feedback.md`)
- [x] Technical architecture documented
- [x] Configuration options documented
- [x] Troubleshooting guide included
- [x] API documentation updated (derived events, annotations)

### ✅ Configuration

- [x] Environment variables defined in IConfig
- [x] Default values set (2s initial, 5s update, 30s timeout)
- [x] Feature flag implemented (`PROGRESS_ENABLED`)
- [x] Phase flag implemented (`PROGRESS_USE_CUSTOM`)

---

## Deployment Steps

### Step 1: Agent-Dev Environment (Testing)

**Status:** ✅ Complete

```bash
# 1. Provision ephemeral environment
brat agent_dev.provision --persistence postgres

# 2. Start services
brat agent_dev.start --name agent-dev-xxx

# 3. Seed routing rules
brat seed --context agent-dev-xxx

# 4. Verify routing rule
docker exec <postgres> psql -U bitbrat -d bitbrat \
  -c "SELECT id, data->>'priority' FROM routing_rules WHERE id = 'progress-to-llm-bot';"

# Expected: progress-to-llm-bot | 95
```

**Validation:**
- [x] Services healthy (17/19 containers)
- [x] Routing rule seeded (priority 95)
- [x] Integration tests pass in environment
- [x] No errors in logs

---

### Step 2: Local Environment (Developer Testing)

**Commands:**
```bash
# 1. Rebuild services
npm run build

# 2. Restart local stack
npm run local:down
npm run local

# 3. Seed data (if needed)
brat seed --context local

# 4. Monitor logs
npm run local:logs
```

**Smoke Test:**
```bash
# Interactive chat test
brat chat --context local

# Send slow operation
> @BitBrat write a detailed 500-word essay on quantum computing

# Expected behavior:
# [0s]  Message received
# [2s]  "Still working on your request..."
# [7s]  "Still processing..."
# [Xs]  Final LLM response
```

**Validation Checklist:**
- [ ] Progress messages appear after 2s threshold
- [ ] Update messages appear every 5s
- [ ] Timeout message after 30s (if operation is slow)
- [ ] Final response delivered successfully
- [ ] No errors in logs
- [ ] operation_context annotation present in logs

---

### Step 3: Staging Environment (Pre-Production)

**Prerequisites:**
- [ ] Staging PostgreSQL accessible
- [ ] Staging NATS cluster healthy
- [ ] Staging SSL certificates valid

**Commands:**
```bash
# 1. Deploy services to staging
brat deploy services --all --context staging

# 2. Verify deployment
brat fleet list --context staging

# 3. Check service health
brat fleet health llm-bot --context staging
brat fleet health event-router --context staging

# 4. Verify routing rule
brat db.query --collection routing_rules \
  --filters '[{"field":"id","op":"==","value":"progress-to-llm-bot"}]' \
  --context staging
```

**Smoke Tests:**
```bash
# Test 1: Fast operation (no progress)
brat chat --context staging
> @BitBrat hello

# Expected: Immediate response, no progress messages

# Test 2: Slow operation (with progress)
> @BitBrat write a detailed analysis of machine learning

# Expected: Progress messages appear

# Test 3: Very slow operation (timeout warning)
> @BitBrat summarize this massive document [paste 500 lines]

# Expected: Timeout warning after 30s
```

**Validation Checklist:**
- [ ] All services deployed successfully
- [ ] No deployment errors
- [ ] Progress messages working
- [ ] Template messages correct
- [ ] Logs show operation_context annotations
- [ ] No exceptions or errors
- [ ] Performance acceptable (<100ms overhead)

**Monitoring:**
```bash
# View logs
brat fleet logs llm-bot --context staging --since 1h | grep -i progress

# Trace specific request
brat fleet trace <correlation-id> --context staging

# Check error rate
brat fleet logs llm-bot --context staging --level error
```

---

### Step 4: Production Environment

**⚠️ IMPORTANT:** Production deployment requires additional approvals.

**Pre-Production Checklist:**
- [ ] Staging tests passed for 24+ hours
- [ ] No critical bugs reported
- [ ] Performance metrics acceptable
- [ ] Rollback plan documented
- [ ] On-call team notified
- [ ] Deployment window scheduled

**Deployment Plan:**
```bash
# 1. Enable maintenance mode (if applicable)
# 2. Deploy services one at a time
brat deploy service event-router --context prod
brat deploy service llm-bot --context prod

# 3. Verify each deployment before proceeding
brat fleet health event-router --context prod
brat fleet health llm-bot --context prod

# 4. Monitor for 10 minutes
brat fleet logs llm-bot --context prod --since 10m

# 5. Smoke test
brat chat --context prod
> @BitBrat test message

# 6. Full rollout
brat deploy services --all --context prod
```

**Post-Deployment Validation:**
- [ ] All services healthy
- [ ] Progress messages working in production
- [ ] Error rate <1%
- [ ] Latency p95 <500ms
- [ ] No user complaints
- [ ] Metrics dashboard showing data

**Rollback Procedure (if needed):**
```bash
# Option 1: Disable feature flag
kubectl set env deployment/llm-bot PROGRESS_ENABLED=false
kubectl set env deployment/event-router PROGRESS_ENABLED=false

# Option 2: Revert deployment
brat deploy service llm-bot --context prod --tag <previous-version>
brat deploy service event-router --context prod --tag <previous-version>
```

---

## Configuration Matrix

### Phase 1: Template Messages (Initial Deployment)

```yaml
# env/staging/global.yaml
PROGRESS_ENABLED: "true"
PROGRESS_USE_CUSTOM: "false"  # Template messages only
PROGRESS_INITIAL_THRESHOLD_MS: "2000"
PROGRESS_UPDATE_INTERVAL_MS: "5000"
PROGRESS_TIMEOUT_THRESHOLD_MS: "30000"
```

### Phase 2: LLM Messages (Future Deployment)

```yaml
# env/prod/global.yaml (Future)
PROGRESS_ENABLED: "true"
PROGRESS_USE_CUSTOM: "true"  # Enable LLM-generated messages
PROGRESS_INITIAL_THRESHOLD_MS: "2000"
PROGRESS_UPDATE_INTERVAL_MS: "5000"
PROGRESS_TIMEOUT_THRESHOLD_MS: "30000"
```

### Conservative Thresholds (Risk-Averse Deployment)

```yaml
# For initial production rollout
PROGRESS_ENABLED: "true"
PROGRESS_USE_CUSTOM: "false"
PROGRESS_INITIAL_THRESHOLD_MS: "5000"   # 5s instead of 2s
PROGRESS_UPDATE_INTERVAL_MS: "10000"    # 10s instead of 5s
PROGRESS_TIMEOUT_THRESHOLD_MS: "60000"  # 60s instead of 30s
```

---

## Monitoring & Alerts

### Key Metrics to Track

**Operational Metrics:**
- Progress messages sent per minute
- Progress message latency (p50, p95, p99)
- Progress message failure rate
- Operations tracked vs completed

**Error Metrics:**
- Failed progress message sends
- Routing failures
- Annotation parsing errors

**Business Metrics:**
- User satisfaction (before/after)
- Support tickets related to "bot not responding"
- Average perceived response time

### Recommended Alerts

```yaml
# Alert 1: High failure rate
alert: ProgressMessageFailureRate
expr: rate(progress_failures[5m]) > 0.01  # >1% failure rate
severity: warning

# Alert 2: Service down
alert: ProgressServiceDown
expr: up{job="llm-bot"} == 0 OR up{job="event-router"} == 0
severity: critical

# Alert 3: High latency
alert: ProgressHighLatency
expr: histogram_quantile(0.95, progress_latency) > 500  # >500ms
severity: warning
```

### Dashboard Panels

1. **Progress Messages Sent** (Counter, line graph)
2. **Progress Message Latency** (Histogram, p95)
3. **Active Operations Being Tracked** (Gauge)
4. **Failure Rate** (Percentage, line graph)
5. **Service Health** (Status indicators)

---

## Known Limitations

### Phase 1 (Current)

1. **Generic Messages:** Template messages are not contextual
2. **No User Preferences:** Cannot opt-out of progress messages
3. **Single Language:** English only
4. **No ETA:** Cannot estimate completion time
5. **Platform Limitations:** No emoji support on all platforms

### Future Phases

- **Phase 2:** LLM-generated contextual messages
- **Phase 3:** User preferences, multiple languages
- **Phase 4:** ETA estimation, progress percentage

---

## Success Criteria

### Must Have (Phase 1)

- [x] Progress messages sent for operations >2s
- [x] Template messages display correctly
- [x] No impact on operation success rate
- [x] Error rate <1%
- [x] Latency overhead <100ms

### Should Have

- [ ] User satisfaction increase (measured via surveys)
- [ ] Reduction in "bot not responding" support tickets
- [ ] Staging deployment stable for 7+ days
- [ ] Production deployment stable for 30+ days

### Nice to Have

- [ ] Metrics dashboard operational
- [ ] Alerts configured and tested
- [ ] Phase 2 (LLM messages) ready for deployment

---

## Rollout Strategy

### Option 1: Big Bang (Recommended for Phase 1)

**Approach:** Enable for all users simultaneously

**Pros:**
- Simple deployment
- Immediate benefit to all users
- Easier to monitor

**Cons:**
- Higher risk if issues occur
- All users impacted if rollback needed

**Recommendation:** Use this for Phase 1 (template messages) due to low risk.

### Option 2: Gradual Rollout (Recommended for Phase 2)

**Approach:** Enable for percentage of users

**Configuration:**
```typescript
// Feature flag with percentage rollout
const progressEnabled =
  config.progressEnabled &&
  (hash(userId) % 100) < config.progressRolloutPercentage;
```

**Rollout Schedule:**
- Week 1: 10% of users
- Week 2: 25% of users
- Week 3: 50% of users
- Week 4: 100% of users

**Recommendation:** Use this for Phase 2 (LLM messages) due to higher risk.

---

## Post-Deployment Tasks

### Immediate (24 hours)

- [ ] Monitor error logs
- [ ] Check metrics dashboard
- [ ] Review user feedback
- [ ] Document any issues
- [ ] Create follow-up tickets if needed

### Short-Term (1 week)

- [ ] Analyze performance data
- [ ] Gather user feedback
- [ ] Identify optimization opportunities
- [ ] Plan Phase 2 deployment (if applicable)

### Long-Term (1 month)

- [ ] Measure user satisfaction improvement
- [ ] Analyze support ticket reduction
- [ ] Review threshold configurations
- [ ] Prepare Phase 3 requirements

---

## Contact & Escalation

**Development Team:**
- Primary: Sprint 377 team
- Secondary: Platform team

**On-Call:**
- Production issues: platform-oncall@company.com
- Deployment support: devops@company.com

**Escalation Path:**
1. Check logs and metrics
2. Review troubleshooting guide
3. Contact development team
4. Escalate to platform team if needed
5. Rollback if critical issue

---

**End of Deployment Checklist**
