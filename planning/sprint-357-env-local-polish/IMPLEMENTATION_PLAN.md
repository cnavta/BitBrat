# Sprint 357: Implementation Plan

**Sprint**: Environment Local Polish
**Lead Implementor**: Claude (Sonnet 4.5)
**Date**: 2026-07-22

---

## Overview

This sprint completes the env-local cleanup initiative with final polish and optimization tasks.

Building on Sprints 355-356 (data sanitization and simplification), we now focus on:
- Optimizing feature flag defaults
- Consolidating LLM configuration
- Reviewing persistence defaults
- Making Firebase emulator optional

---

## Tasks

### Task 1: BL-ENV-017 - Review Feature Flag Defaults

**Goal**: Ensure all feature flags have appropriate defaults and clear rationale

**Files to Review**:
- `env/local/global.yaml`
- `env/local/llm-bot.yaml`

**Feature Flags to Review**:
1. `FF_LLM_PROMPT_LOGGING: true` - Keep for local dev?
2. `ENABLE_EVENT_RESPONSES: true` - Essential or optional?
3. `LLM_BOT_BEHAVIORAL_GUIDANCE_ENABLED: true` - Core vs advanced?
4. `LLM_BOT_BEHAVIORAL_TOOL_FILTER_ENABLED: true`
5. `LLM_BOT_BEHAVIORAL_GATING_ENABLED: true`
6. `LLM_BOT_RISK_RESPONSE_MODE: refuse`
7. `LLM_BOT_TONE_STYLE_ENABLED: true`
8. `QUERY_ANALYZER_FF_LLM_PROMPT_LOGGING: true`

**Analysis Required**:
- Which flags are essential for platform operation?
- Which flags are useful for local development debugging?
- Which flags might confuse newcomers?

**Changes**:
- Add inline comments explaining each flag's purpose
- Document when to enable/disable
- Note if flag affects platform behavior vs. just logging

**Success Criteria**:
- ✅ All feature flags have inline comments
- ✅ Each comment explains: What does this do? Why this default?
- ✅ No changes to actual values (maintain backward compatibility)

---

### Task 2: BL-ENV-018 - Consolidate LLM Configuration

**Goal**: Reduce duplication between llm-bot and query-analyzer OR document why separate config is needed

**Current Duplication**:

```yaml
# llm-bot.yaml
LLM_BOT_LLM_PROVIDER: openai
LLM_BOT_LLM_MODEL: gpt-4.1-mini
OPENAI_MODEL: gpt-4.1-mini
OPENAI_TIMEOUT_MS: 300000
OPENAI_MAX_RETRIES: 3

# query-analyzer.yaml
QUERY_ANALYZER_LLM_PROVIDER: openai
QUERY_ANALYZER_LLM_MODEL: gpt-4.1-mini
QUERY_ANALYZER_FF_LLM_PROMPT_LOGGING: true
```

**Options**:

**Option A: Extract Common Settings to global.yaml**
```yaml
# global.yaml
DEFAULT_LLM_PROVIDER: openai
DEFAULT_LLM_MODEL: gpt-4.1-mini
OPENAI_TIMEOUT_MS: 300000
OPENAI_MAX_RETRIES: 3

# llm-bot.yaml (inherits from global, can override)
LLM_BOT_LLM_PROVIDER: ${DEFAULT_LLM_PROVIDER}
LLM_BOT_LLM_MODEL: gpt-4.1-mini  # Can use larger model

# query-analyzer.yaml (inherits from global)
QUERY_ANALYZER_LLM_PROVIDER: ${DEFAULT_LLM_PROVIDER}
QUERY_ANALYZER_LLM_MODEL: ${DEFAULT_LLM_MODEL}
```

**Option B: Keep Separate, Document Why**
- llm-bot uses more expensive models (conversational quality)
- query-analyzer uses cheap/fast models (routing hints only)
- Separation allows independent scaling and cost control

**Decision Criteria**:
- Do services ever need different providers?
- Do services ever need different models?
- Is separation valuable for production deployments?

**Recommended Approach**:
- **Keep separate** (Option B)
- **Document the rationale** clearly
- Add comments explaining the separation is intentional

**Changes**:
1. Add comment in `llm-bot.yaml`:
   ```yaml
   # LLM Bot uses conversational models (gpt-4.1-mini or better)
   # Optimized for quality and coherence in multi-turn conversations
   ```

2. Add comment in `query-analyzer.yaml`:
   ```yaml
   # Query Analyzer uses fast, cheap models (gpt-4.1-mini)
   # Optimized for speed in routing hint generation
   # Can use different provider/model than LLM Bot for cost control
   ```

3. Document in README.md why each service has separate LLM config

**Success Criteria**:
- ✅ Decision documented (consolidate OR keep separate)
- ✅ Rationale explained in comments
- ✅ README.md updated with "Common Customizations" section on LLM config

---

### Task 3: BL-ENV-019 - Review Persistence Configuration

**Goal**: Ensure persistence defaults are appropriate for newcomers

**Current Settings** (in `global.yaml`):
```yaml
PERSISTENCE_DRIVER: postgres
DATABASE_URL: "postgresql://bitbrat:bitbrat_dev_password@postgres:5432/bitbrat"
PERSISTENCE_SNAPSHOT_MODE: all
PERSISTENCE_INCLUDE_RAW_PAYLOADS: true
PERSISTENCE_MAX_SNAPSHOT_BYTES: 1048576
PERSISTENCE_TTL_DAYS: 7
```

**Review Questions**:
1. **PERSISTENCE_SNAPSHOT_MODE: all**
   - Appropriate for local dev?
   - Disk usage implications?
   - Alternative: `none`, `selective`

2. **PERSISTENCE_INCLUDE_RAW_PAYLOADS: true**
   - Useful for debugging?
   - Privacy implications (PII in payloads)?
   - Disk usage impact?

3. **PERSISTENCE_MAX_SNAPSHOT_BYTES: 1048576** (1 MB)
   - Appropriate limit?
   - What happens when exceeded?

4. **PERSISTENCE_TTL_DAYS: 7**
   - Good for local dev (auto-cleanup)?
   - Too short for testing?
   - Document how to disable cleanup?

**Recommended Defaults** (no changes, just document):
- `PERSISTENCE_SNAPSHOT_MODE: all` - Good for local debugging
- `PERSISTENCE_INCLUDE_RAW_PAYLOADS: true` - Helpful for understanding events
- `PERSISTENCE_TTL_DAYS: 7` - Prevents disk bloat in long-running local stacks

**Changes**:
1. Add comprehensive comment block explaining each setting
2. Document when to change each setting
3. Add examples for common scenarios

**Success Criteria**:
- ✅ All persistence settings have explanatory comments
- ✅ Disk usage implications documented
- ✅ Examples provided (debugging, production, privacy-sensitive)
- ✅ No changes to actual values (maintain backward compatibility)

---

### Task 4: BL-ENV-020 - Evaluate Infrastructure Emulator Dependencies

**Goal**: Make Firebase emulator optional for Postgres-only deployments

**Current State**:
- Firebase emulator is started in docker-compose.yaml
- Used only if `PERSISTENCE_DRIVER=firestore` (legacy, deprecated)
- Takes up resources even when not used

**Analysis Required**:
1. Which services still depend on Firebase emulator?
2. Can `PERSISTENCE_DRIVER=postgres` run without Firebase emulator?
3. Is Pub/Sub emulator still needed with `MESSAGE_BUS_DRIVER=nats`?

**Expected Findings**:
- Firestore emulator: NOT needed for Postgres
- Pub/Sub emulator: NOT needed for NATS
- Firebase emulator can be optional

**Changes**:

1. **Update `infra.yaml` comments**:
   ```yaml
   # ============================================================================
   # Infrastructure Configuration
   # ============================================================================
   # Platform-Agnostic Defaults:
   #   - Message Bus: NATS (no emulator needed)
   #   - Persistence: PostgreSQL (no emulator needed)
   #
   # Legacy Firebase Emulator (OPTIONAL - deprecated):
   #   Only needed if using legacy drivers:
   #   - PERSISTENCE_DRIVER=firestore (deprecated)
   #   - MESSAGE_BUS_DRIVER=pubsub (deprecated)
   #
   # To disable Firebase emulator:
   #   Comment out firebase-emulator service in docker-compose.yaml
   # ============================================================================
   ```

2. **Update README.md**:
   - Add section: "Running Without Firebase Emulator"
   - Explain when Firebase is needed vs. not needed
   - Provide docker-compose override example

3. **Document docker-compose override** (in README.md):
   ```bash
   # Create docker-compose.override.yaml to disable firebase-emulator:
   services:
     firebase-emulator:
       profiles:
         - legacy  # Only start with: docker compose --profile legacy up
   ```

**No Changes to docker-compose.yaml**:
- Keep firebase-emulator in default compose (backward compatibility)
- Document how to disable it
- Consider future sprint to make it profile-based by default

**Success Criteria**:
- ✅ Documented which drivers need Firebase emulator
- ✅ Documented how to run without Firebase emulator
- ✅ README.md updated with docker-compose override example
- ✅ Platform-agnostic path (NATS + Postgres) clearly documented
- ✅ No breaking changes to existing docker-compose.yaml

---

## Verification Steps

After completing all tasks:

1. **Build Test**:
   ```bash
   npm run build
   ```
   Expected: ✅ Success

2. **Configuration Validation**:
   ```bash
   npm run brat -- config validate
   ```
   Expected: ✅ No errors

3. **Comment Coverage**:
   - All feature flags have explanatory comments
   - All persistence settings have explanatory comments
   - LLM configuration separation explained

4. **Documentation Check**:
   - README.md updated with LLM config guidance
   - README.md updated with Firebase emulator optionality
   - Cross-references correct

5. **Backward Compatibility**:
   - No configuration values changed
   - Existing local stacks continue to work
   - All defaults remain the same

---

## Timeline

**Estimated Duration**: 1-2 hours

1. **BL-ENV-017**: 20 minutes (review flags, add comments)
2. **BL-ENV-018**: 15 minutes (document LLM config rationale)
3. **BL-ENV-019**: 15 minutes (document persistence settings)
4. **BL-ENV-020**: 20 minutes (document Firebase optionality)

**Buffer**: 10 minutes for verification and adjustments

---

## Dependencies

**Prerequisite**: Sprints 355-356 completed (data sanitization + simplification done)

**Blocks**: None (final cleanup sprint)

**No External Dependencies**

---

## Deliverables

### Modified Files
- `env/local/global.yaml` (enhanced comments)
- `env/local/llm-bot.yaml` (enhanced comments)
- `env/local/query-analyzer.yaml` (enhanced comments)
- `env/local/infra.yaml` (enhanced comments)
- `env/local/README.md` (LLM config + Firebase sections)

### New Files
- None (documentation only sprint)

### Sprint Artifacts
- `planning/sprint-357-env-local-polish/VERIFICATION_REPORT.md`

### Git Deliverables
- Commit on `fix/env-cleanup` branch
- Ready for PR to `main`

---

## Success Criteria (Sprint-Level)

| Criterion | Target | Verification |
|-----------|--------|--------------|
| All feature flags documented | 100% | grep "^FF_\\|^LLM_BOT_.*ENABLED" + comment check |
| LLM config rationale documented | ✅ | Check llm-bot.yaml + query-analyzer.yaml headers |
| Persistence settings documented | 100% | grep "^PERSISTENCE_" + comment check |
| Firebase optionality documented | ✅ | Check README.md + infra.yaml |
| Build passes | Exit 0 | npm run build |
| Config validates | Exit 0 | brat config validate |
| No value changes | 0 changes | git diff (only comments/docs) |

---

## Notes

- This sprint is **documentation-focused** - no value changes
- Goal: Make existing defaults **understandable** to newcomers
- Rationale: Newcomers should understand **why** each setting exists
- All changes are **non-breaking** (additive comments only)

---

**Ready to Begin**: ✅

All tasks defined. Proceeding with execution.
