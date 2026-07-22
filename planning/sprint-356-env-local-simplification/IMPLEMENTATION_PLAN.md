# Sprint 356: Implementation Plan

**Sprint**: Environment Local Simplification
**Lead Implementor**: Claude (Sonnet 4.5)
**Date**: 2026-07-22

---

## Overview

This sprint implements Phase 2 of the env-local cleanup initiative: **Simplification**.

Building on Sprint 355's data sanitization, we now focus on making `env/local` **newcomer-friendly** by:
- Disabling optional integrations by default
- Consolidating duplicate configuration
- Simplifying complex configs to essentials
- Creating comprehensive documentation

---

## Tasks

### Task 1: BL-ENV-008 - Create Minimal Platform-Only Defaults

**Goal**: Disable optional integrations by default (Discord, Twilio, RAG)

**Files to Modify**:
- `env/local/global.yaml`
- `env/local/context-pack.yaml` (if exists)
- `env/local/ingress-egress.yaml`

**Changes**:
1. Set `RAG_CONTEXT_ENABLED: false` (requires vector DB setup)
2. Verify `DISCORD_ENABLED: "false"` (already done in Sprint 355)
3. Add comments explaining how to enable each integration
4. Document prerequisites for each optional feature

**Success Criteria**:
- ✅ RAG disabled by default
- ✅ Discord disabled by default (verified)
- ✅ Twilio disabled by default (verified via empty channels)
- ✅ Clear enable instructions in comments

---

### Task 2: BL-ENV-009 - Consolidate Duplicate Configuration

**Goal**: Remove duplicate Twitch credential references across files

**Files to Audit**:
- `env/local/auth.yaml`
- `env/local/oauth-flow.yaml`
- `env/local/ingress-egress.yaml`
- `.secure.local.example`

**Analysis Required**:
1. Map all Twitch credential references (CLIENT_ID, CLIENT_SECRET, etc.)
2. Identify canonical location for each credential
3. Remove duplicates, add cross-references

**Changes**:
1. Keep credentials in `.secure.local` only
2. Keep configuration (channels, username) in `ingress-egress.yaml`
3. Remove redundant credential placeholders from `auth.yaml`, `oauth-flow.yaml`
4. Add comments pointing to canonical locations

**Success Criteria**:
- ✅ Each credential defined in exactly one file
- ✅ Clear cross-references where needed
- ✅ No conflicting or duplicate placeholders

---

### Task 3: BL-ENV-010 - Simplify LLM Bot Configuration

**Goal**: Reduce `llm-bot.yaml` to essential settings only

**File**: `env/local/llm-bot.yaml`

**Current State Analysis**:
- Count total configuration keys
- Identify which are essential vs. advanced
- Determine safe defaults for advanced settings

**Changes**:
1. Move advanced settings to comments with defaults
2. Keep only essentials visible:
   - `LLM_BOT_PROVIDER`
   - `LLM_BOT_MODEL`
   - `LLM_BOT_MEMORY_MAX_CHARS`
   - `LLM_BOT_MAX_RESPONSE_TOKENS`
3. Add "Advanced Configuration" section in comments
4. Document what each essential setting does

**Success Criteria**:
- ✅ ≤6 visible configuration keys
- ✅ All advanced settings documented in comments
- ✅ Clear inline documentation for each visible setting

---

### Task 4: BL-ENV-013 - Remove or Populate Empty Files

**Goal**: Either remove empty YAML files or document why they exist

**Files to Check**:
- `env/local/persistence.yaml` (likely empty)
- `env/local/scheduler.yaml` (likely empty)
- Any other minimal/empty service configs

**Decision Tree**:
```
Is file empty?
├─ Yes → Does service require ANY config?
│         ├─ No → DELETE file
│         └─ Yes → ADD explanatory comment
└─ No → Keep as-is
```

**Actions**:
1. Audit all `env/local/*.yaml` files for content
2. For empty files:
   - If service has NO configurable options → DELETE
   - If service CAN be configured → ADD header comment explaining defaults
3. Document decision rationale

**Success Criteria**:
- ✅ No unexplained empty files
- ✅ Files with only comments explain why they exist
- ✅ Unnecessary files deleted

---

### Task 5: BL-ENV-014 - Clarify Minimal Service Files

**Goal**: Add purpose comments to minimal service configuration files

**Files**:
- `env/local/api-gateway.yaml`
- `env/local/event-router.yaml`
- `env/local/reflex.yaml`
- Any other minimal files with <5 settings

**Template**:
```yaml
# ============================================================================
# [Service Name] Configuration
# ============================================================================
#
# Purpose: [1-2 sentence description of what this service does]
# Required: [Yes/No - is this service required for basic platform operation?]
# Dependencies: [List any required external services]
#
# This file contains minimal defaults. Most users won't need to modify this.
# See documentation/reference/[service]-config.md for advanced options.
# ============================================================================

[existing config...]
```

**Success Criteria**:
- ✅ All minimal service files have headers
- ✅ Purpose clearly stated
- ✅ Dependencies documented
- ✅ Advanced config pointer provided

---

### Task 6: BL-ENV-015 - Create Quickstart Guide

**Goal**: Create `env/local/README.md` with newcomer-focused quickstart

**File**: `env/local/README.md` (NEW)

**Structure**:
```markdown
# BitBrat Local Development Environment

[1-paragraph overview of what this directory is]

## Quick Start (5 Minutes)

1. Copy secrets template
2. Add OpenAI API key
3. Start local stack
4. Verify platform is running

## Configuration Files

[Table of all YAML files with purpose and "Required?" column]

## Enabling Optional Integrations

### Discord Integration
[Step-by-step with prerequisites]

### Twitch Integration
[Step-by-step with prerequisites]

### RAG (Vector Search)
[Step-by-step with prerequisites]

### OBS Studio Integration
[Step-by-step with prerequisites]

## Configuration Inheritance

[Explain how env/local/*.yaml files are loaded and merged]

## Troubleshooting

[Common issues and solutions]

## See Also

[Links to relevant documentation]
```

**Success Criteria**:
- ✅ Clear 5-minute quickstart path
- ✅ All config files documented in table
- ✅ Step-by-step guides for each optional integration
- ✅ Troubleshooting section addresses common issues
- ✅ Newcomer can get platform running without reading other docs

---

### Task 7: BL-ENV-016 - Document Configuration Inheritance

**Goal**: Document how configuration files are loaded and merged

**Locations**:
1. `env/local/README.md` (quickstart-level explanation)
2. `documentation/reference/configuration-loading.md` (detailed reference - NEW)

**Content Required**:

**In README.md** (simplified):
```markdown
## Configuration Inheritance

Configuration is loaded in this order (later files override earlier):

1. `global.yaml` - Baseline settings for all services
2. `infra.yaml` - Infrastructure (NATS, PostgreSQL)
3. `{service}.yaml` - Service-specific overrides
4. `.secure.local` - Secrets (never committed)

Example: If `global.yaml` sets `LOG_LEVEL: info` and `llm-bot.yaml`
sets `LOG_LEVEL: debug`, the llm-bot service will use `debug`.
```

**In configuration-loading.md** (detailed):
- Full loading algorithm
- Precedence rules
- Environment variable interpolation (`${VAR}`)
- Examples of override scenarios
- Execution context specifics

**Success Criteria**:
- ✅ Loading order clearly documented
- ✅ Override precedence explained with examples
- ✅ Both quickstart and detailed reference created
- ✅ Examples demonstrate common override scenarios

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

3. **File Audit**:
   - No empty unexplained files
   - All files have clear purpose
   - No duplicate configuration

4. **Newcomer Test** (simulation):
   - Read `env/local/README.md` only
   - Can user understand what to do?
   - Can user start platform in <5 minutes?

5. **Documentation Cross-Check**:
   - All referenced files exist
   - No broken links
   - Consistent terminology

---

## Timeline

**Estimated Duration**: 2-3 hours

1. **BL-ENV-008**: 15 minutes (disable RAG, add comments)
2. **BL-ENV-009**: 30 minutes (audit duplicates, consolidate)
3. **BL-ENV-010**: 20 minutes (simplify llm-bot.yaml)
4. **BL-ENV-013**: 20 minutes (audit empty files)
5. **BL-ENV-014**: 30 minutes (add headers to minimal files)
6. **BL-ENV-015**: 60 minutes (create comprehensive README)
7. **BL-ENV-016**: 30 minutes (document inheritance)

**Buffer**: 15 minutes for verification and adjustments

---

## Dependencies

**Prerequisite**: Sprint 355 completed (data sanitization done)

**Blocks**: Sprint 357 (Phase 3: Polish)

**No External Dependencies**

---

## Deliverables

### Modified Files
- `env/local/global.yaml`
- `env/local/ingress-egress.yaml`
- `env/local/llm-bot.yaml`
- `env/local/api-gateway.yaml`
- `env/local/event-router.yaml`
- `env/local/reflex.yaml`
- `env/local/auth.yaml`
- `env/local/oauth-flow.yaml`
- Potentially deleted: `env/local/persistence.yaml`, `env/local/scheduler.yaml`

### New Files
- `env/local/README.md`
- `documentation/reference/configuration-loading.md`

### Sprint Artifacts
- `planning/sprint-356-env-local-simplification/VERIFICATION_REPORT.md`
- `planning/sprint-356-env-local-simplification/REQUEST_LOG.md`

### Git Deliverables
- Feature branch: `feature/env-local-simplification`
- Commit: "feat(sprint-356): Simplify env/local for newcomers"
- Pull request to `main`

---

## Success Criteria (Sprint-Level)

| Criterion | Target | Verification |
|-----------|--------|--------------|
| RAG disabled by default | `RAG_CONTEXT_ENABLED: false` | grep global.yaml |
| No duplicate config | 0 duplicates | Manual audit |
| LLM bot simplified | ≤6 visible keys | wc -l llm-bot.yaml |
| No unexplained empty files | 0 files | ls -la \| audit |
| All minimal files documented | 100% | grep "Purpose:" */yaml |
| Quickstart guide created | README.md exists | ls README.md |
| Inheritance documented | 2 locations | Check README + reference |
| Build passes | Exit 0 | npm run build |
| Config validates | Exit 0 | brat config validate |

---

## Notes

- This sprint focuses on **user experience** for newcomers
- No code changes to services - pure configuration cleanup
- Documentation is as important as config changes
- Test from newcomer perspective: "Can I understand this?"

---

**Ready to Begin**: ✅

All tasks defined. Proceeding with execution.
