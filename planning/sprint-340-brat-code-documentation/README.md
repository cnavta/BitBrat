# Sprint 340: `brat code` Documentation Update

**Status:** Planning Complete ✅
**Created:** 2026-07-13
**Sprint Goal:** Comprehensively update BitBrat documentation to reflect the new `brat code` command and make it the recommended first interaction for new users exploring with AI assistance.

---

## Quick Summary

The `brat code` command was successfully delivered in Sprint 339 with full functionality:
- Auto-detects and launches 4 coding agents (Claude Code, Aider, Continue, OpenHands)
- Zero-config setup with automatic project context injection
- Comprehensive MCP auto-configuration for Claude Code
- First-run welcome experience
- 71 passing tests

**Problem:** The feature is invisible to users — not mentioned in README, Quickstart, or Evaluator's Guide.

**Solution:** This sprint updates all user-facing documentation to make `brat code` discoverable and the recommended exploration path for new users.

---

## Sprint Artifacts

| Document | Description | Location |
|----------|-------------|----------|
| **Execution Plan** | Comprehensive implementation plan with 3 phases, 14 tasks | `execution-plan.md` |
| **Backlog** | Trackable YAML backlog with priorities, dependencies, acceptance criteria | `backlog.yaml` |
| **This README** | Sprint overview and quick reference | `README.md` |

---

## Sprint Overview

### Scope
- **Phase 1 (P0):** High-visibility docs (README, Quickstart, Evaluator's Guide, brat.md, new guide) - 8 hours
- **Phase 2 (P1):** Developer docs (CLAUDE.md, plugin guide, MCP docs, installation) - 6 hours
- **Phase 3 (P1/P2):** Supporting materials (troubleshooting, CHANGELOG, cross-references) - 4 hours

**Total Effort:** ~18 hours (2-3 day sprint)

### Key Deliverables

**New Documentation:**
1. `documentation/guides/coding-with-brat-code.md` - Comprehensive guide (8 sections)
2. `documentation/guides/coding-agent-plugins.md` - Plugin development guide

**Updated Documentation:**
1. README.md - 3 sections (Getting Started, CLI, Prerequisites)
2. documentation/getting-started/quickstart.md
3. documentation/getting-started/evaluating-bitbrat.md
4. documentation/tools/brat.md - Complete `brat code` reference
5. CLAUDE.md - LLM guidance
6. CHANGELOG.md

---

## Task Summary

| Phase | Tasks | Effort | Priority |
|-------|-------|--------|----------|
| Phase 1: High-Visibility Docs | 7 | 8h | P0 |
| Phase 2: Developer Docs | 4 | 6h | P1 |
| Phase 3: Supporting Materials | 3 | 4h | P1/P2 |
| **Total** | **14** | **18h** | - |

### Critical Path
1. DOC-101: Update README Getting Started
2. DOC-107: Create dedicated guide (coding-with-brat-code.md)
3. DOC-203: Document MCP auto-configuration
4. DOC-301: Create troubleshooting guide
5. DOC-303: Cross-reference audit
6. DOC-302: Update CHANGELOG

### Parallel Opportunities
- All README updates (DOC-101, DOC-102, DOC-103) can be done in parallel
- Quickstart (DOC-104) and Evaluator's Guide (DOC-105) in parallel
- brat.md (DOC-106) and CLAUDE.md (DOC-201) in parallel
- Plugin guide (DOC-202) and installation guide (DOC-204) in parallel

---

## Success Criteria

### Documentation Completeness ✅
- [ ] `brat code` appears in README Getting Started (before platform setup)
- [ ] `brat code` fully documented in CLI reference
- [ ] Dedicated guide created (coding-with-brat-code.md)
- [ ] Plugin development guide created
- [ ] All 4 agent plugins documented
- [ ] Prerequisites section updated
- [ ] Quickstart includes `brat code`
- [ ] Evaluator's guide includes `brat code`
- [ ] CLAUDE.md updated
- [ ] CHANGELOG.md updated

### Quality Metrics ✅
- [ ] 100% of internal links functional
- [ ] All code examples tested
- [ ] Terminology consistent across docs
- [ ] No broken references
- [ ] Cross-reference audit clean

### User Experience ✅
- [ ] New user discovers `brat code` within 30 seconds of reading README
- [ ] Clear when to use `brat code` vs `brat chat` vs direct IDE
- [ ] Installation instructions clear for all agents
- [ ] Troubleshooting guidance comprehensive

---

## Task IDs & Priorities

| ID | Title | Priority | Effort | Phase |
|----|-------|----------|--------|-------|
| **DOC-101** | Update README Getting Started | P0 | 1.5h | 1 |
| **DOC-102** | Update README CLI section | P0 | 1.5h | 1 |
| **DOC-103** | Update README Prerequisites | P0 | 0.5h | 1 |
| **DOC-104** | Update Quickstart | P0 | 1.0h | 1 |
| **DOC-105** | Update Evaluator's Guide | P0 | 0.5h | 1 |
| **DOC-106** | Update brat.md reference | P0 | 2.0h | 1 |
| **DOC-107** | Create coding-with-brat-code.md | P0 | 3.0h | 1 |
| **DOC-201** | Expand CLAUDE.md | P1 | 1.0h | 2 |
| **DOC-202** | Create plugin development guide | P1 | 3.0h | 2 |
| **DOC-203** | Document MCP auto-config | P1 | 1.5h | 2 |
| **DOC-204** | Document agent installation | P1 | 1.0h | 2 |
| **DOC-301** | Create troubleshooting guide | P1 | 1.5h | 3 |
| **DOC-302** | Update CHANGELOG | P1 | 0.5h | 3 |
| **DOC-303** | Cross-reference audit | P1 | 1.5h | 3 |
| **DOC-304** | Create decision guide | P2 | 0.5h | 3 |

---

## Dependencies

### External
None - Sprint 339 implementation complete and stable

### Internal
- Sprint 339 verification report ✅
- Sprint 339 retro ✅
- Existing documentation structure ✅

---

## Risks & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep | Medium | Medium | Document only Sprint 339 deliverables; use verification report as authority |
| Breaking changes to `brat code` | Low | High | Coordinate with dev team; freeze changes during sprint |
| Inconsistent terminology | Low | Medium | Use Sprint 339 docs as authority; audit in Task 3.3 |
| Link rot | Medium | Low | Use relative paths; audit in Task 3.3; add CI validation (future) |

---

## How to Use This Sprint Plan

### For Technical Writers
1. Read `execution-plan.md` for detailed task descriptions
2. Reference `backlog.yaml` for acceptance criteria and validation
3. Follow the critical path or work on parallel tasks
4. Mark tasks complete in backlog as you finish them

### For Reviewers
1. Check acceptance criteria in `backlog.yaml`
2. Verify all examples are tested
3. Run link validation
4. Perform fresh-eyes review (Task 3.3)

### For Project Managers
1. Track progress via task IDs (DOC-101 to DOC-304)
2. Monitor critical path for blockers
3. Review metrics in `backlog.yaml`
4. Validate success criteria before sprint completion

---

## Reference Materials

### Sprint 339 Artifacts
- Execution Plan: `planning/sprint-339-brat-code-command/execution-plan.md`
- Verification Report: `planning/sprint-339-brat-code-command/verification-report.md`
- Retro: `planning/sprint-339-brat-code-command/retro.md`
- Key Learnings: `planning/sprint-339-brat-code-command/key-learnings.md`

### Implementation Reference
- Source: `tools/brat/src/cli/code/code-command.ts`
- Plugins: `tools/brat/src/cli/code/plugins/*.ts`
- Tests: `tools/brat/src/cli/code/__tests__/*.test.ts`

### Existing Documentation
- README.md
- CLAUDE.md
- documentation/getting-started/
- documentation/tools/brat.md

---

## Post-Sprint

### Validation Checklist
- [ ] Fresh reader test (developer unfamiliar with `brat code`)
- [ ] Link validation (all internal links work)
- [ ] Example verification (all commands tested)
- [ ] Terminology consistency check

### Future Enhancements (Backlog)
- Video tutorial for `brat code`
- Advanced plugin customization guide
- Multi-agent workflow documentation
- Agent performance comparison guide
- Windows/WSL specific documentation

---

## Contact & Questions

For questions about this sprint plan:
- Review `execution-plan.md` for detailed rationale
- Check `backlog.yaml` for acceptance criteria
- Reference Sprint 339 artifacts for implementation details

---

**Sprint Planning Complete** ✅
**Ready for Execution** ✅
**Estimated Duration:** 2-3 days
**Total Effort:** 18 hours
