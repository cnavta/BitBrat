# EventSub Migration Guide: Hardcoded to YAML

**Safe, gradual migration from hardcoded EventSub subscriptions to YAML configuration.**

This guide provides a production-safe migration path from the legacy hardcoded EventSub implementation (4 events) to the new YAML-driven system (22 events). The migration is non-breaking with full rollback support.

**Sprint:** 16
**Target Audience:** Platform operators, DevOps
**Migration Time:** 1-2 weeks (gradual rollout)
**Risk Level:** LOW (backward compatible, gradual rollout, easy rollback)

---

## Overview

### What's Changing

| Aspect | Hardcoded (Legacy) | YAML (New) |
|--------|-------------------|------------|
| **Event Count** | 4 (follow, update, stream.online, stream.offline) | 22 (all Tier 1 + Tier 2 events) |
| **Configuration** | Code (`eventsub-client.ts`) | YAML file (`subscriptions.yaml`) |
| **Enable/Disable** | Code changes + redeploy | Config file edit + reload/restart |
| **Per-Channel Control** | Not supported | `channelOverrides` section |
| **Feature Flag** | N/A | `ENABLE_EVENTSUB_YAML_CONFIG` |
| **Default Behavior** | Active (if not explicitly disabled) | `ENABLE_EVENTSUB_YAML_CONFIG=false` (legacy mode) |

### Why Migrate?

✅ **Benefits:**
- Access to 22 event types (vs 4 hardcoded events)
- Per-channel event customization
- Runtime config changes (no redeploy for enable/disable)
- Easier event management (YAML vs code)
- Future-proof (new events added via YAML only)

⚠️ **Risks:**
- New dependency on YAML config file
- Different code path (may have unknown edge cases)
- Slightly higher complexity

### Migration Philosophy

**Gradual, reversible, validated.**

1. **No breaking changes**: Legacy mode remains default
2. **Gradual rollout**: Staging → dev → subset of production → full production
3. **Easy rollback**: Feature flag toggle, no data loss
4. **Validation at each step**: Logs, MCP tools, health checks

---

## Pre-Migration Checklist

Before starting migration:

- [ ] All 184+ Twitch tests passing
- [ ] `subscriptions.yaml` file exists and is valid
- [ ] 4 existing events enabled in YAML config (channel.follow, channel.update, stream.online, stream.offline)
- [ ] MCP tools tested (`twitch.eventsub.subscriptions.list`, `.status`, `.config.reload`)
- [ ] Health endpoint accessible (`GET /_debug/twitch/eventsub`)
- [ ] Monitoring/alerting in place for ingress-egress service
- [ ] Rollback procedure documented and tested

---

## Migration Phases

### Phase 0: Validation (No Changes)

**Goal:** Validate YAML config loads correctly without affecting production.

**Duration:** 1-2 days

#### Steps

1. **Ensure YAML config matches existing subscriptions**:
```yaml
# config/twitch-eventsub/subscriptions.yaml
subscriptions:
  channel.follow:
    enabled: true  # ✅ Matches hardcoded
  channel.update:
    enabled: true  # ✅ Matches hardcoded
  stream.online:
    enabled: true  # ✅ Matches hardcoded
  stream.offline:
    enabled: true  # ✅ Matches hardcoded

  # All other events
  channel.raid:
    enabled: false  # ❌ Disabled (new events opt-in)
  # ... etc
```

2. **Keep feature flag OFF** (default behavior):
```bash
# .env or deployment config
# ENABLE_EVENTSUB_YAML_CONFIG not set (defaults to false)
# OR explicitly:
ENABLE_EVENTSUB_YAML_CONFIG=false
```

3. **Deploy to staging**:
```bash
brat bit deploy ingress-egress --context staging
```

4. **Verify hardcoded path still active**:
```bash
# Check logs
brat fleet logs ingress-egress --context staging | grep eventsub

# Expected log:
[INFO] twitch.eventsub.using_hardcoded_subscriptions
```

5. **Verify 4 existing subscriptions created**:
```bash
# Via MCP tool (returns empty if YAML not enabled)
twitch.eventsub.subscriptions.list()

# Via health endpoint
curl https://staging.bitbrat.dev/_debug/twitch/eventsub
```

#### Success Criteria

- ✅ Service starts without errors
- ✅ Log shows `using_hardcoded_subscriptions`
- ✅ 4 existing subscriptions active
- ✅ No EventSub errors in logs for 24 hours

#### Rollback

No rollback needed - no changes made.

---

### Phase 1: Enable YAML in Staging (Same 4 Events)

**Goal:** Validate YAML code path works identically to hardcoded path.

**Duration:** 2-3 days

#### Steps

1. **Enable feature flag in staging**:
```bash
# .env or deployment config (staging only)
ENABLE_EVENTSUB_YAML_CONFIG=true
```

2. **Deploy to staging**:
```bash
brat bit deploy ingress-egress --context staging
```

3. **Verify YAML path active**:
```bash
# Check logs
brat fleet logs ingress-egress --context staging | grep eventsub

# Expected logs:
[INFO] twitch.eventsub.using_yaml_config
[INFO] subscription_manager.subscribed { eventType: "channel.follow", channel: "..." }
[INFO] subscription_manager.subscribed { eventType: "channel.update", channel: "..." }
[INFO] subscription_manager.subscribed { eventType: "stream.online", channel: "..." }
[INFO] subscription_manager.subscribed { eventType: "stream.offline", channel: "..." }
```

4. **Verify via MCP tools**:
```typescript
// List config
twitch.eventsub.subscriptions.list()
// Expected: version=1, subscriptionCount=22, enabledCount=4

// Check status
twitch.eventsub.subscriptions.status()
// Expected: 4 subscriptions active, eventCount > 0 (after some time)
```

5. **Verify via health endpoint**:
```bash
curl https://staging.bitbrat.dev/_debug/twitch/eventsub
```

Expected response:
```json
{
  "enabled": true,
  "useYamlConfig": true,
  "subscriptionCount": 4,
  "activeSubscriptions": 4,
  "totalEvents": 123,
  "totalErrors": 0,
  "subscriptions": [...]
}
```

6. **Monitor for 48-72 hours**:
- No increase in errors
- Event counts match hardcoded baseline
- No EventSub reconnection issues

#### Success Criteria

- ✅ Service starts without errors
- ✅ Log shows `using_yaml_config`
- ✅ 4 subscriptions active (same as hardcoded)
- ✅ Event counts match hardcoded baseline (±5%)
- ✅ Zero `totalErrors` in health endpoint
- ✅ No EventSub errors in logs for 48 hours

#### Rollback

If issues occur:

1. **Disable feature flag**:
```bash
ENABLE_EVENTSUB_YAML_CONFIG=false
```

2. **Redeploy**:
```bash
brat bit deploy ingress-egress --context staging
```

3. **Verify hardcoded path restored**:
```bash
brat fleet logs ingress-egress --context staging | grep hardcoded_subscriptions
```

**No data loss** - IRC chat continues working, subscriptions recreated on restart.

---

### Phase 2: Enable Additional Events in Staging (Tier 1)

**Goal:** Test new event types before production rollout.

**Duration:** 3-5 days

#### Steps

1. **Enable 2-3 Tier 1 events in YAML** (start with low-volume events):
```yaml
# config/twitch-eventsub/subscriptions.yaml
subscriptions:
  # Existing 4 events (already enabled)
  # ...

  # NEW: Enable Tier 1 events (low volume first)
  channel.raid:
    enabled: true  # Low volume, high value

  channel.subscribe:
    enabled: true  # Low volume, high value

  channel.prediction.end:
    enabled: true  # Medium volume
```

2. **Reload config** (optional - test without restart):
```typescript
twitch.eventsub.config.reload()
// Returns: { success: true, note: "Requires service restart..." }
```

3. **Restart service** (required to create new subscriptions):
```bash
brat bit deploy ingress-egress --context staging
```

4. **Verify new subscriptions created**:
```typescript
twitch.eventsub.subscriptions.status()
// Expected: 7 subscriptions (4 existing + 3 new)
```

5. **Trigger test events** (if possible):
- Follow channel (channel.follow - existing)
- Raid channel (channel.raid - NEW)
- Subscribe to channel (channel.subscribe - NEW)

6. **Monitor logs for new events**:
```bash
brat fleet logs ingress-egress --context staging --level info | grep "system.twitch.raid\\|system.twitch.subscribe"
```

7. **Validate event structure**:
- Check NATS topic for published events
- Verify InternalEventV2 structure
- Confirm events reach downstream services (auth, llm-bot, etc.)

8. **Monitor for 48-72 hours**:
- Event counts reasonable (not zero, not excessive)
- No errors in health endpoint
- Downstream services handle new events correctly

#### Success Criteria

- ✅ 7 subscriptions active (4 existing + 3 new)
- ✅ New events publishing to NATS
- ✅ `totalErrors` remains 0
- ✅ Downstream services handle new event types without errors
- ✅ No EventSub errors in logs for 48 hours

#### Rollback

If issues occur with specific events:

1. **Disable problematic event in YAML**:
```yaml
channel.raid:
  enabled: false  # Disable if causing issues
```

2. **Restart service**:
```bash
brat bit deploy ingress-egress --context staging
```

**OR disable all new events:**

```bash
ENABLE_EVENTSUB_YAML_CONFIG=false  # Revert to hardcoded 4 events
```

---

### Phase 3: Production Rollout (Gradual)

**Goal:** Roll out YAML config to production channels gradually.

**Duration:** 7-10 days

#### Step 3.1: Deploy Config (Flag OFF)

1. **Deploy YAML config to production** (feature flag still OFF):
```bash
# Copy staging config to production
cp config/twitch-eventsub/subscriptions.yaml env/prod/config/twitch-eventsub/

# Deploy (flag still OFF, so no behavior change)
brat bit deploy ingress-egress --context prod
```

2. **Verify hardcoded path still active**:
```bash
brat fleet logs ingress-egress --context prod | grep hardcoded_subscriptions
```

#### Step 3.2: Enable for 1-2 Channels (Canary)

1. **Enable feature flag for specific channels** (if per-channel env vars supported):

**Option A: Environment variables (if supported)**:
```bash
# Per-channel feature flag (if infrastructure supports)
ENABLE_EVENTSUB_YAML_CONFIG_CHANNELS="bitbrat,testchannel"
```

**Option B: Global enable + channel overrides (recommended)**:
```yaml
# Enable globally
ENABLE_EVENTSUB_YAML_CONFIG=true

# Disable for most channels via channelOverrides
channelOverrides:
  # Canary channels (enable all events)
  bitbrat:
    channel.raid:
      enabled: true
    channel.subscribe:
      enabled: true

  # Other channels - disable new events (only 4 core events)
  otherchannel:
    channel.raid:
      enabled: false
    channel.subscribe:
      enabled: false
```

2. **Deploy**:
```bash
brat bit deploy ingress-egress --context prod
```

3. **Monitor canary channels for 48-72 hours**:
```typescript
twitch.eventsub.subscriptions.status({ channel: "bitbrat" })
```

4. **Verify**:
- Canary channels: 7+ subscriptions (4 core + Tier 1)
- Other channels: 4 subscriptions (core only)

#### Step 3.3: Expand to 50% of Channels

1. **Update channelOverrides** (enable for 50% of channels):
```yaml
channelOverrides:
  channel1: { channel.raid: { enabled: true }, ... }
  channel2: { channel.raid: { enabled: true }, ... }
  channel3: { channel.raid: { enabled: true }, ... }
  # ... etc
```

2. **Deploy + monitor for 48 hours**:
```bash
brat bit deploy ingress-egress --context prod
```

#### Step 3.4: Full Production Rollout

1. **Remove channelOverrides** (all channels use global config):
```yaml
channelOverrides: {}
```

2. **Enable desired Tier 1 events globally**:
```yaml
subscriptions:
  # Core events
  channel.follow:
    enabled: true
  # ... other core events

  # Tier 1 events (enable desired events)
  channel.raid:
    enabled: true
  channel.subscribe:
    enabled: true
  # ... other desired events (leave most false for opt-in)
```

3. **Deploy + monitor for 1 week**:
```bash
brat bit deploy ingress-egress --context prod
```

4. **Final validation**:
```typescript
// Check all channels
twitch.eventsub.subscriptions.status()

// Health check
curl https://api.bitbrat.dev/_debug/twitch/eventsub
```

#### Success Criteria

- ✅ All production channels subscribed via YAML
- ✅ `totalErrors` remains 0 across all channels
- ✅ Event rates match expected baseline
- ✅ No increase in NATS errors or backpressure
- ✅ Downstream services handle new events correctly
- ✅ No customer complaints or issues

#### Rollback (Production)

If major issues occur:

1. **Immediate: Disable feature flag**:
```bash
ENABLE_EVENTSUB_YAML_CONFIG=false
```

2. **Redeploy**:
```bash
brat bit deploy ingress-egress --context prod
```

3. **Verify hardcoded path restored**:
```bash
brat fleet logs ingress-egress --context prod | grep hardcoded_subscriptions
```

4. **Monitor for 15-30 minutes**:
- Verify 4 core subscriptions active
- Verify event flow restored

**No data loss** - IRC chat independent, subscriptions recreated on restart.

---

## Post-Migration

### Phase 4: Cleanup (Optional, Future Sprint)

After 1-2 months of stable YAML operation:

1. **Remove hardcoded subscription code**:
- Delete `subscribeHardcoded()` method in `eventsub-client.ts`
- Remove feature flag check
- Make YAML config required

2. **Update documentation**:
- Mark hardcoded approach as deprecated
- Update all guides to reference YAML only

3. **Update tests**:
- Remove hardcoded subscription tests
- Focus tests on YAML config path

**Timeline:** 2-3 months after Phase 3 completion (not urgent)

---

## Monitoring & Validation

### Key Metrics to Monitor

| Metric | Source | Normal Range | Alert Threshold |
|--------|--------|--------------|-----------------|
| **Total Subscriptions** | Health endpoint | 4-22 per channel | < 4 (missing core events) |
| **Active Subscriptions** | Health endpoint | Same as total | < subscriptionCount |
| **Total Events** | Health endpoint | 100-1000/hour per channel | 0 (no events flowing) |
| **Total Errors** | Health endpoint | 0 | > 0 |
| **Event Latency** | Logs | < 100ms (P95) | > 500ms (P95) |
| **NATS Publish Errors** | Logs | 0 | > 0 |

### Monitoring Commands

```bash
# Health check
curl https://api.bitbrat.dev/_debug/twitch/eventsub

# MCP tools
twitch.eventsub.subscriptions.status()
twitch.eventsub.subscriptions.list()

# Logs
brat fleet logs ingress-egress --context prod --level error | grep eventsub
brat fleet logs ingress-egress --context prod --level info | grep "subscription_manager.subscribed"
```

### Alerting

Set up alerts for:

- `totalErrors > 0` (immediate)
- `activeSubscriptions < subscriptionCount` (15 minutes)
- `totalEvents == 0` for > 1 hour (possible Twitch API issue)
- EventSub reconnection loops (> 3 reconnects in 10 minutes)

---

## Troubleshooting

### Issue: Subscriptions Not Created

**Symptom:** Health endpoint shows `subscriptionCount: 0` or missing events

**Causes:**
1. Feature flag not set: `ENABLE_EVENTSUB_YAML_CONFIG` not `true`
2. YAML config invalid or not loaded
3. Missing OAuth scopes
4. Builder not registered

**Fix:**
```bash
# 1. Check feature flag
echo $ENABLE_EVENTSUB_YAML_CONFIG  # Should be "true"

# 2. Validate YAML
npm run brat -- config validate config/twitch-eventsub/subscriptions.yaml

# 3. Check logs for errors
brat fleet logs ingress-egress --level error | grep eventsub

# 4. Verify subscriptions loaded
twitch.eventsub.subscriptions.list()
```

### Issue: Events Not Publishing

**Symptom:** `eventCount` remains 0 in health endpoint

**Causes:**
1. Twitch not sending events (API issue)
2. OAuth scope missing
3. Event builder throwing errors
4. NATS publish failures

**Fix:**
```bash
# 1. Check subscription status
twitch.eventsub.subscriptions.status()
# Look for errorCount > 0, lastErrorAt

# 2. Check OAuth scopes
# Compare required scopes in YAML with actual token scopes

# 3. Check logs for builder errors
brat fleet logs ingress-egress --level error | grep "event_builder\\|publisher"

# 4. Trigger test event (if possible)
# E.g., follow channel, raid channel, etc.
```

### Issue: High Error Count

**Symptom:** `totalErrors > 0` or `errorCount > 0` for specific subscription

**Causes:**
1. Event builder throwing errors (malformed event data)
2. NATS publish failures
3. Invalid InternalEventV2 structure

**Fix:**
```bash
# 1. Check error logs
brat fleet logs ingress-egress --level error | grep eventsub

# 2. Check subscription status for specific event
twitch.eventsub.subscriptions.status()
# Look for lastErrorAt timestamp and errorCount

# 3. Disable problematic event
# Edit subscriptions.yaml:
channel.problematic.event:
  enabled: false

# 4. Restart service
brat bit deploy ingress-egress
```

### Issue: Rollback Not Working

**Symptom:** Disabling feature flag doesn't restore hardcoded subscriptions

**Causes:**
1. Environment variable not unset correctly
2. Service not restarted after env change
3. Cached config still loading

**Fix:**
```bash
# 1. Explicitly set flag to false
ENABLE_EVENTSUB_YAML_CONFIG=false

# 2. Restart service (force restart)
brat bit deploy ingress-egress --force

# 3. Verify hardcoded path active
brat fleet logs ingress-egress | grep "using_hardcoded_subscriptions"

# 4. Verify 4 subscriptions created
curl https://api.bitbrat.dev/_debug/twitch/eventsub
# Should show subscriptionCount: 4
```

---

## Migration Timeline

**Recommended timeline for risk-averse production rollout:**

| Phase | Duration | Cumulative |
|-------|----------|------------|
| Phase 0: Validation | 1-2 days | 2 days |
| Phase 1: Staging (same 4 events) | 2-3 days | 5 days |
| Phase 2: Staging (new events) | 3-5 days | 10 days |
| Phase 3.1: Prod config (flag OFF) | 1 day | 11 days |
| Phase 3.2: Prod canary (1-2 channels) | 2-3 days | 14 days |
| Phase 3.3: Prod 50% rollout | 2-3 days | 17 days |
| Phase 3.4: Prod full rollout | 3-5 days | 22 days |

**Total:** ~3 weeks for cautious rollout

**Accelerated timeline** (for lower-risk environments):
- Skip Phase 0 (validation only)
- Reduce monitoring periods to 24 hours
- **Total:** ~1 week

---

## FAQ

### Q: Can I migrate only some channels?

**A:** Yes, use `channelOverrides` in `subscriptions.yaml`:

```yaml
channelOverrides:
  channel1:
    # Enable new events for this channel
    channel.raid:
      enabled: true

  channel2:
    # Keep only core events for this channel
    channel.raid:
      enabled: false
```

### Q: What happens to in-flight events during restart?

**A:** EventSub client reconnects, Twitch resends missed events (within retention window). NATS ensures at-least-once delivery. No event loss expected.

### Q: Can I test YAML config without restarting?

**A:** Partial. Use `twitch.eventsub.config.reload()` to validate YAML syntax and reload in-memory config. However, subscriptions are NOT recreated until service restart.

### Q: How do I know which events to enable?

**A:** Start with:
- **Always enabled**: Core 4 events (follow, update, stream.online, stream.offline)
- **High value, low volume**: channel.raid, channel.subscribe, channel.subscription.gift
- **Medium value**: Polls, predictions, hype train.begin/end
- **Avoid (high volume)**: channel.hype_train.progress, channel.moderate, channel.chat.message

### Q: Do I need to update OAuth scopes?

**A:** Only if enabling events that require new scopes. Check YAML config `scope` field for each event. If scope missing, subscription will be skipped with warning log.

### Q: What if Twitch adds new event types?

**A:** Add to YAML config only (no code changes needed). Follow [Adding EventSub Events Guide](../../documentation/guides/adding-eventsub-events.md).

---

## Conclusion

The hardcoded → YAML migration is designed to be safe, gradual, and reversible. The feature flag provides an easy rollback mechanism, and the phased approach ensures issues are caught early before impacting production.

**Key Takeaways:**
- ✅ Backward compatible (feature flag defaults to legacy mode)
- ✅ Easy rollback (toggle feature flag, no data loss)
- ✅ Gradual rollout (staging → canary → 50% → full production)
- ✅ Comprehensive monitoring (MCP tools, health endpoint, logs)
- ✅ Access to 22 event types (vs 4 hardcoded)

**Next Steps:**
1. Follow Phase 0 (Validation) to ensure readiness
2. Proceed through phases at comfortable pace
3. Monitor metrics at each phase
4. Roll back immediately if issues occur

---

## Related Documentation

- [EventSub Config Guide](../../documentation/guides/twitch-eventsub-config.md)
- [Adding EventSub Events](../../documentation/guides/adding-eventsub-events.md)
- [EventSub Event Catalog](../../documentation/reference/twitch-eventsub-catalog.md)
- [MCP Tools Reference](../../documentation/reference/mcp-tools-twitch.md)
- [Milestone 5 Review](./milestone-5-review.md)

---

**Migration Support:** `planning/sprint-16-aalwmj/`
**Sprint:** 16
**Status:** Production-ready
