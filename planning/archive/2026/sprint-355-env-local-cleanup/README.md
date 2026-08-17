# Sprint 355: Environment Local Cleanup

**Sprint Goal**: Sanitize and simplify `env/local` configuration to be generic, minimal, and newcomer-friendly baseline example.

**Duration**: 1 sprint (focus on Phase 1: Data Sanitization)

**Lead Implementor**: Claude (Sonnet 4.5)

---

## Objectives

1. **Remove all user-specific data** from `env/local` directory
2. **Create secrets template** (`.secure.local.example`)
3. **Sanitize configurations** to use placeholders instead of actual credentials
4. **Document** what was changed and why

---

## Scope

### In Scope (Phase 1: Data Sanitization)
- BL-ENV-001: Sanitize Twitch Configuration
- BL-ENV-002: Sanitize Discord Configuration
- BL-ENV-003: Remove Debug Users
- BL-ENV-004: Sanitize OBS MCP Configuration
- BL-ENV-005: Neutralize LLM Bot Persona
- BL-ENV-006: Remove Internal Network References
- BL-ENV-007: Neutralize Bot Name
- BL-ENV-011: Create .secure.local.example
- BL-ENV-012: Fix Typos and Formatting

### Out of Scope (Future Sprints)
- Phase 2: Simplification (BL-ENV-008 through BL-ENV-016)
- Phase 3: Polish (BL-ENV-017 through BL-ENV-020)

---

## Success Criteria

✅ No personal credentials, IDs, or network hostnames in `env/local/*.yaml`
✅ `.secure.local.example` template created with clear instructions
✅ All configs use placeholders or generic defaults
✅ No typos or formatting issues
✅ Build and tests pass
✅ Local stack can start (with proper `.secure.local` setup)

---

## Implementation Plan

See: `IMPLEMENTATION_PLAN.md`

---

## Verification

See: `VERIFICATION_REPORT.md` (created post-implementation)

---

## Related Documents

- Source Backlog: `planning/env-local-cleanup-backlog.md`
- Architecture: `architecture.yaml` (executionContexts.local)
- Environment Guide: `documentation/guides/environment-configuration.md` (TBD)
