# Execution Plan: Reflex Command Arguments

**Sprint 34** | **Role: Lead Implementor** | **Owner: navta3**

## Executive Summary

This execution plan breaks down the implementation of reflex command arguments into 5 phases with 18 discrete, testable tasks. The work follows a bottom-up approach: foundation (types) → core (pattern/template) → integration (threading) → testing → documentation/validation.

**Total Estimated Effort**: 16.5 hours (2-3 days)
**Critical Path**: Foundation → Core Implementation → Integration → Testing
**Risk Mitigation**: Comprehensive testing at each layer, backward compatibility validation

---

## Phase Breakdown

### Phase 1: Foundation (Type Definitions)
**Duration**: 0.5 hours | **Priority**: P0 (Blocking)

Establish type system foundation for captures. All subsequent work depends on these types.

**Tasks**:
1. Define `MatchCaptures` interface in `src/types/reflex.ts`
2. Define `MatchResult` interface in `src/types/reflex.ts`
3. Update `ReflexExecutionResult` to include optional `captures`

**Acceptance Criteria**:
- Types compile without errors
- JSDoc documentation complete with examples
- No breaking changes to existing code

**Dependencies**: None (blocking all other tasks)

---

### Phase 2: Core Implementation (Pattern Matching & Template Interpolation)
**Duration**: 5 hours | **Priority**: P0 (Blocking)

Implement the two core capabilities: extracting captures and interpolating them into templates.

#### 2A: Pattern Matcher Enhancement (2 hours)

**Tasks**:
4. Implement `matchRegexWithCaptures()` in `src/services/reflex/pattern-matcher.ts`
5. Implement `matchPatternWithCaptures()` wrapper function
6. Maintain backward-compatible `matchPattern()` boolean version
7. Add capture extraction for non-regex types (exact, contains, prefix, suffix)

**Acceptance Criteria**:
- `matchPatternWithCaptures()` returns `MatchResult` with captures
- Backward-compatible `matchPattern()` returns boolean (unchanged behavior)
- Regex captures extracted correctly (full match + groups)
- Non-regex types return captures[0] = matched portion
- Performance: <10ms per match (existing target maintained)

**Dependencies**: Phase 1 (types)

#### 2B: Template Interpolation Enhancement (3 hours)

**Tasks**:
8. Create `src/services/reflex/template-interpolator.ts` (new file)
9. Implement `interpolateTemplate()` with `${N}` and `$N` syntax support
10. Implement `interpolateParameterValue()` with type coercion
11. Implement `coerceType()` helper (string → number/boolean)
12. Add `stringifyValue()` helper for captures

**Acceptance Criteria**:
- `${0}`, `${1}`, `${N}` syntax replaced with captures
- `$1`, `$2`, `$N` shell syntax also supported
- Type coercion works: `"50"` → `50`, `"true"` → `true`
- Mixed strings keep type: `"Amount: ${1}"` → `"Amount: 50"` (string)
- Missing captures keep placeholder (graceful degradation)
- Escaped syntax preserved: `\${1}` → `${1}` (literal)

**Dependencies**: Phase 1 (types)

---

### Phase 3: Integration (Threading Captures Through Components)
**Duration**: 3 hours | **Priority**: P1

Thread captures through the execution pipeline from matcher → executor → builders → service.

**Tasks**:
13. Update `buildParameters()` in `parameter-builder.ts` (signature + implementation)
14. Update `buildCandidates()` in `candidate-builder.ts` (signature + implementation)
15. Update `executeReflex()` in `reflex-executor.ts` (thread captures through)
16. Update `matchReflex()` in `reflex-matcher.ts` (return captures with result)
17. Update reflex service message handler in `reflex-service.ts` (pass captures to executor)

**Acceptance Criteria**:
- All function signatures include optional `captures?: MatchCaptures` parameter
- Captures flow: matcher → executor → parameter builder → tool
- Captures flow: matcher → executor → candidate builder → template
- Backward compatibility: existing code works with `captures = undefined`
- No TypeScript compilation errors

**Dependencies**: Phase 2 (pattern matcher + template interpolator)

---

### Phase 4: Testing (Unit & Integration)
**Duration**: 5 hours | **Priority**: P1

Comprehensive test coverage for all new functionality.

#### 4A: Unit Tests (3 hours)

**Tasks**:
18. Create `pattern-matcher-captures.test.ts` (pattern matching with captures)
19. Create `template-interpolator-captures.test.ts` (${N} interpolation)
20. Create `parameter-type-coercion.test.ts` (type coercion logic)

**Test Coverage**:
- Pattern matcher: single capture, multiple captures, no captures, optional captures
- Template interpolator: `${N}` syntax, `$N` syntax, mixed with event/result data
- Type coercion: numbers, booleans, strings, edge cases (hex, scientific notation)
- Error cases: missing captures, malformed placeholders, invalid types

**Acceptance Criteria**:
- 95%+ code coverage for new code
- All tests pass
- Edge cases covered (empty string, undefined, null, etc.)

#### 4B: Integration Tests (2 hours)

**Tasks**:
21. Create `reflex-executor-captures.test.ts` (end-to-end execution with captures)
22. Update existing reflex tests to verify backward compatibility

**Test Coverage**:
- Full execution flow: match → extract → interpolate → execute
- Captures passed to MCP tool correctly
- Candidates generated with captures
- Type coercion works in real tool invocation
- Backward compatibility: existing reflexes work unchanged

**Acceptance Criteria**:
- Integration tests pass
- No regressions in existing tests
- Real-world scenarios validated (!bid, !timer examples)

**Dependencies**: Phase 3 (integration complete)

---

### Phase 5: Documentation & Validation
**Duration**: 3 hours | **Priority**: P2

Document the feature and validate in agent-dev environment.

#### 5A: Documentation Updates (2 hours)

**Tasks**:
23. Update `documentation/tutorials/creating-a-reflex.md` (add "Step 9: Using Command Arguments")
24. Update `documentation/reference/reflex-mcp-tools.md` (document `${N}` syntax)
25. Create `documentation/guides/reflex-command-arguments.md` (comprehensive guide)
26. Update `README.md` (add command arguments to features)
27. Update JSDoc in `src/types/reflex.ts` (MatchCaptures examples)

**Documentation Checklist**:
- [ ] Regex capture groups primer
- [ ] `${N}` vs `$N` syntax comparison
- [ ] Type coercion rules table
- [ ] 4+ real-world examples (!bid, !timer, !raid, !volume)
- [ ] Best practices (performance, UX, validation)
- [ ] Common patterns library
- [ ] Migration guide (existing reflexes unaffected)

**Dependencies**: Phase 4 (testing complete)

#### 5B: Agent-Dev Validation (1 hour)

**Tasks**:
28. Create test reflex with arguments in agent-dev context
29. Deploy reflex service to agent-dev
30. Test !bid, !timer commands end-to-end
31. Verify type coercion, candidate generation, tool invocation
32. Performance profiling (<5ms overhead, <150ms total)

**Validation Checklist**:
- [ ] Reflex service starts without errors
- [ ] Pattern matching extracts captures correctly
- [ ] Template interpolation works (parameters + candidates)
- [ ] Type coercion functions (numeric strings → numbers)
- [ ] End-to-end latency within target (<150ms)
- [ ] No regressions (existing reflexes work)

**Dependencies**: Phase 4 (testing complete)

---

## Dependency Graph

```
Phase 1: Foundation (Types)
    ↓
Phase 2: Core Implementation
    ├── 2A: Pattern Matcher (depends on Phase 1)
    └── 2B: Template Interpolator (depends on Phase 1)
    ↓
Phase 3: Integration (depends on Phase 2A + 2B)
    ↓
Phase 4: Testing (depends on Phase 3)
    ├── 4A: Unit Tests
    └── 4B: Integration Tests
    ↓
Phase 5: Documentation & Validation (depends on Phase 4)
    ├── 5A: Documentation
    └── 5B: Agent-Dev Validation
```

---

## Critical Path

**Total Duration**: 16.5 hours

1. **Phase 1: Foundation** → 0.5 hours (must complete first)
2. **Phase 2A: Pattern Matcher** → 2 hours (depends on Phase 1)
3. **Phase 2B: Template Interpolator** → 3 hours (depends on Phase 1, parallel with 2A)
4. **Phase 3: Integration** → 3 hours (depends on 2A + 2B)
5. **Phase 4A: Unit Tests** → 3 hours (depends on Phase 3)
6. **Phase 4B: Integration Tests** → 2 hours (depends on Phase 3, parallel with 4A)
7. **Phase 5A: Documentation** → 2 hours (depends on Phase 4)
8. **Phase 5B: Validation** → 1 hour (depends on Phase 4, parallel with 5A)

**Parallelization Opportunities**:
- Phase 2A and 2B can run in parallel (both depend only on Phase 1)
- Phase 4A and 4B can run in parallel (both depend on Phase 3)
- Phase 5A and 5B can run in parallel (both depend on Phase 4)

**Realistic Timeline**:
- **Day 1** (8 hours): Phase 1 + Phase 2 + Phase 3 (6.5 hours) + Start Phase 4 (1.5 hours)
- **Day 2** (8 hours): Finish Phase 4 (3.5 hours) + Phase 5 (3 hours) + Buffer (1.5 hours)

---

## Risk Mitigation Strategies

### Risk 1: Breaking Changes to Existing Code
**Mitigation**:
- Maintain backward-compatible function signatures (captures optional)
- Run full test suite after each phase
- Explicit regression testing in Phase 4B

### Risk 2: Performance Degradation
**Mitigation**:
- Profile pattern matching in Phase 2A (ensure <10ms maintained)
- Profile template interpolation in Phase 2B (measure overhead)
- End-to-end profiling in Phase 5B (<5ms overhead target)

### Risk 3: Type Coercion Edge Cases
**Mitigation**:
- Comprehensive unit tests in Phase 4A (numbers, booleans, strings, edge cases)
- Fail-safe defaults (keep as string if coercion ambiguous)
- Clear logging for coercion failures

### Risk 4: Regex Capture Complexity
**Mitigation**:
- Use existing safe-regex validation (ReDoS protection)
- Clear error messages for invalid patterns
- Extensive testing with real-world regex patterns

---

## Quality Gates

Each phase must pass quality gates before proceeding:

### Phase 1: Foundation
- [ ] Types compile without errors
- [ ] No TypeScript warnings
- [ ] JSDoc complete

### Phase 2: Core Implementation
- [ ] Pattern matcher tests pass (manual verification)
- [ ] Template interpolator tests pass (manual verification)
- [ ] Performance within targets (<10ms pattern match)

### Phase 3: Integration
- [ ] TypeScript compilation succeeds (no errors)
- [ ] All existing tests pass (no regressions)
- [ ] Captures flow through all components

### Phase 4: Testing
- [ ] 95%+ code coverage for new code
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Zero regressions in existing tests

### Phase 5: Documentation & Validation
- [ ] Documentation complete and reviewed
- [ ] Agent-dev validation passes all checks
- [ ] Performance targets met (<150ms end-to-end)

---

## Success Criteria

### Functional Success
- ✅ Regex captures extracted correctly (full match + groups)
- ✅ Template interpolation works (`${N}` and `$N` syntax)
- ✅ Type coercion functions (string → number/boolean)
- ✅ Captures thread through full execution pipeline
- ✅ Existing reflexes work unchanged (100% backward compatible)

### Performance Success
- ✅ Pattern matching overhead: <5ms
- ✅ Template interpolation overhead: <3ms
- ✅ End-to-end reflex execution: <150ms (unchanged from current)

### Quality Success
- ✅ 95%+ code coverage for new code
- ✅ Zero failing tests
- ✅ Zero TypeScript errors
- ✅ Documentation complete

### User Success
- ✅ Clear examples in documentation
- ✅ Error messages helpful (missing captures, coercion failures)
- ✅ Graceful degradation (missing captures → keep placeholder)

---

## Rollback Plan

If critical issues arise during implementation:

1. **Phase 1-2**: Revert type changes, remove new files
2. **Phase 3**: Revert function signature changes, restore original implementations
3. **Phase 4**: Skip to Phase 5B (validation) if tests fail systematically
4. **Phase 5**: Deploy without documentation, add post-sprint

**Critical Decision Point**: End of Phase 3
- If integration fails or breaks existing code, STOP and reassess
- Run full test suite to verify backward compatibility
- If >5 existing tests fail, rollback and redesign

---

## Post-Sprint Activities

### Immediate (Within 1 Week)
1. Monitor reflex execution logs for capture-related errors
2. Gather user feedback on `${N}` syntax clarity
3. Identify common regex patterns for pattern library

### Short-Term (Within 1 Month)
1. Create video tutorial demonstrating command arguments
2. Add more examples to documentation (community-sourced)
3. Performance tuning if overhead exceeds targets

### Future Enhancements (Phase 2)
1. Named capture groups: `(?<amount>\d+)` → `${amount}`
2. Default values: `${1:100}` (fallback syntax)
3. Type validation: `${1:number}` (assertions)
4. Capture transformations: `${1:upper}`, `${2:trim}`

---

## Communication Plan

### Daily Standups
- **Day 1 AM**: Phase 1 + 2A progress
- **Day 1 PM**: Phase 2B + 3 progress
- **Day 2 AM**: Phase 4 progress
- **Day 2 PM**: Phase 5 completion

### Status Updates
- End of each phase: Commit code + update sprint manifest
- Phase 4 completion: Demo to team (show !bid example)
- Phase 5 completion: Sprint retrospective

### Blockers Escalation
- TypeScript compilation errors → Immediate escalation
- Test failures (>3) → Pause and reassess
- Performance degradation (>10ms overhead) → Redesign approach

---

## Appendix: Task-File Mapping

| Task # | File(s) Modified/Created | Est. Hours |
|--------|--------------------------|------------|
| 1-3 | src/types/reflex.ts | 0.5 |
| 4-7 | src/services/reflex/pattern-matcher.ts | 2.0 |
| 8-12 | src/services/reflex/template-interpolator.ts (new) | 3.0 |
| 13 | src/services/reflex/parameter-builder.ts | 0.5 |
| 14 | src/services/reflex/candidate-builder.ts | 0.5 |
| 15 | src/services/reflex/reflex-executor.ts | 0.75 |
| 16 | src/services/reflex/reflex-matcher.ts | 0.75 |
| 17 | src/apps/reflex-service.ts | 0.5 |
| 18-20 | src/services/reflex/__tests__/* (3 new test files) | 3.0 |
| 21-22 | src/services/reflex/__tests__/* (integration tests) | 2.0 |
| 23-27 | documentation/* (4 updates + 1 new guide) | 2.0 |
| 28-32 | Agent-dev validation (no files) | 1.0 |

**Total**: 16.5 hours

---

## Conclusion

This execution plan provides a systematic, low-risk approach to implementing reflex command arguments. The bottom-up strategy (types → core → integration → testing → docs) ensures each layer is solid before building on it. Comprehensive testing and backward compatibility validation at each phase minimize regression risk.

**Key Success Factors**:
1. Maintain backward compatibility (captures optional)
2. Test at every layer (unit → integration → e2e)
3. Performance profiling at each phase
4. Clear documentation with examples
5. Agent-dev validation before completion

**Estimated Completion**: 2-3 days with buffer for testing and validation.
