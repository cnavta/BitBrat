# Key Learnings – Sprint 35

**Sprint**: sprint-35-2ib164
**Date**: 2026-08-31
**Focus**: Progress Middleware Timing Investigation

## 1. Question Integration Points, Not Just Implementation

### The Learning

When adding complex logic (Cases 1, 2, 3) to handle different scenarios, **question whether you're integrating at the wrong point in the lifecycle**.

### Example from Sprint 35

**Code Smell**:
```typescript
// Case 1: Fresh operation (< 2s elapsed) - schedule timers
// Case 2: In-progress (2-30s elapsed) - send immediate update
// Case 3: Very late (> 30s elapsed) - send immediate timeout
```

**The three cases exist BECAUSE** `beforeNext()` is called at the wrong time. If called at operation start, only Case 1 would exist.

### How to Apply

When you see branching logic like:
- "If early, do X"
- "If late, do Y"
- "If very late, do Z"

Ask: **"Why am I detecting 'early' vs 'late'?"**

If the answer is "because I'm called at the wrong time", fix the integration point instead of adding more cases.

### Red Flags
- Logic branches on "elapsed time" or "already done"
- Using `setImmediate()` to defer execution
- Comments like "// detected in-progress" (implies wrong invocation time)
- Complex state tracking to compensate for missing lifecycle hooks

---

## 2. User Domain Knowledge > AI Assumptions

### The Learning

When a user questions your analysis with "the intent was that...", **they're revealing a gap between their mental model and your implementation**.

This is **extremely valuable** - often more valuable than the code you're analyzing.

### Example from Sprint 35

**AI Analysis**: "Timer delay calculations are wrong, need to check if `delay > 0`"

**User Question**: "The intent was that the timer would be started as soon as an event is consumed, so as to handle long executions within that Bit."

**What This Revealed**: The entire approach was backwards - middleware invoked at END instead of START.

### How to Apply

1. **Listen for "intent" statements**: "the intent was...", "it's supposed to...", "the goal is..."
2. **Don't defend your analysis**: Investigate whether user's mental model reveals architectural issues
3. **Ask clarifying questions**: "When you say 'as soon as consumed', do you mean...?"

### Pattern

```
User: "But isn't it supposed to work like [X]?"
AI: [Defensive] "Well technically the code does [Y]..."

INSTEAD:

User: "But isn't it supposed to work like [X]?"
AI: [Curious] "You're right that [X] makes more sense. Let me check why it's actually doing [Y]..."
```

---

## 3. Production Events Are Superior Test Cases

### The Learning

A single production event trace (`254c7245-b14b-4eb9-ae21-e4581056d7b1`) provided:
- Exact timestamps across services
- Real timing behavior (41.4s operation)
- Actual middleware execution path (Case 3)
- Proof of symptom (messages out of order)

This was **far more valuable** than creating synthetic test scenarios.

### Example from Sprint 35

**Staging Event Trace**:
```
20:00:25.870 - operation_context added
20:01:07.311 - beforeNext() called (41.4s later)
20:01:07.312 - Case 3 detected
20:01:07.316 - Progress sent via setImmediate()
20:01:07.323 - Final response sent
```

This **proved**:
- Sprint 35's code WAS deployed (not a deployment issue)
- Case 3 logic WAS executing (not a code path issue)
- Timing WAS the problem (not event structure)

### How to Apply

When investigating production issues:

1. **Get correlation IDs first**: Before analyzing code, trace real events
2. **Timeline before code**: Build event timeline, THEN look at code to understand why
3. **Multi-service traces**: Follow event through all services (ingress → router → llm-bot → egress)
4. **Timestamp precision**: Milliseconds matter (8ms gap between completion and progress)

### Tools

```bash
# Get correlation ID from user
CORR_ID="254c7245-b14b-4eb9-ae21-e4581056d7b1"

# Trace across services
ssh root@bitbrat.lan "docker logs bitbrat-staging-llm-bot-1 2>&1 | grep '$CORR_ID' | head -20"
ssh root@bitbrat.lan "docker logs bitbrat-staging-ingress-egress-1 2>&1 | grep '$CORR_ID'"

# Build timeline with timestamps
docker logs ... | grep "$CORR_ID" | grep -E 'progress|complete|next' | sort
```

---

## 4. Symptom Suppression Accumulates Debt

### The Learning

**Symptom suppression** (skipping Cases 2 & 3) is faster than **root cause fix** (refactoring integration), but accumulates technical debt.

### Example from Sprint 35

**Before Sprint 35**:
- Original architecture: reactive detection in `beforeNext()`
- Problem: Only sees operations when completing

**Sprint 35 (earlier)**:
- Added: Timer-based tracking with Cases 1, 2, 3
- Problem: Still reactive, but tried to compensate

**This Sprint**:
- Added: Skip Cases 2 & 3 to prevent late messages
- Problem: Now operations > 30s have NO progress

**Each layer of compensation** makes the next fix harder.

### The Debt Curve

```
Technical Debt Over Time:

Original Issue → Quick Fix #1 → Quick Fix #2 → Quick Fix #3 → Rewrite Required
     ↓              ↓               ↓               ↓              ↓
 Integration   Timer-based    Skip late       More           Complete
   at wrong    compensation    messages    workarounds      refactor
     point                                                   needed
```

### How to Apply

When choosing between symptom suppression and root fix:

**Ask**:
1. Does this fix address the architectural issue?
2. Will this make the next fix easier or harder?
3. Can I document the proper fix for next sprint?

**Choose Suppression When**:
- Time-critical (production down)
- Root fix requires extensive testing
- User needs immediate relief

**But ALWAYS**:
- Document the root cause
- Create follow-up ticket/sprint
- Explain the trade-off to user

---

## 5. Git Worktree Path Confusion

### The Learning

When working in git worktrees, **muscle memory for absolute paths** points to main repo instead of worktree.

### Example from Sprint 35

```bash
# Working directory
pwd
# /Users/.../BitBratPlatform/.worktrees/sprint-35-2ib164

# But accidentally read from main repo
Read('/Users/.../BitBratPlatform/src/common/middleware/feedback-middleware.ts')
# ❌ This is main repo version, NOT Sprint 35 worktree version!

# Should have used relative path
Read('./src/common/middleware/feedback-middleware.ts')
# ✅ This resolves relative to current directory (worktree)
```

### How to Apply

**When in worktrees**:
- Use **relative paths**: `./src/...`, `./planning/...`
- Verify location: `pwd && git branch --show-current`
- Check file: `git log -1 --oneline <file>` to see recent commit

**Tool Setup**:
- Set shell prompt to show git branch
- Add worktree indicator to prompt
- Use `git worktree list` regularly

### Quick Check

```bash
# Where am I?
git worktree list | grep "$(pwd)"

# What version is this file?
git log -1 --oneline src/common/middleware/feedback-middleware.ts
```

---

## 6. Test Names Should Describe Reality, Not Justify Behavior

### The Learning

Test names that justify behavior ("SHOULD send immediate update") hide architectural issues.

### Example from Sprint 35

**Before**:
```typescript
it('should send ONE immediate "update" message (operation detected in-progress)', ...)
```

**This name implies**: Detecting operations "in-progress" and sending updates is CORRECT behavior.

**Reality**: If `beforeNext()` is called, operation is COMPLETING, not in-progress.

**After**:
```typescript
it('should NOT send any progress message (operation already finishing)', ...)
```

**This name implies**: Operation is finishing (which is true), so skipping progress is correct.

### How to Apply

**Bad Test Names** (justify behavior):
- "should handle edge case by doing X"
- "should work around Y by doing Z"
- "should detect late operations and compensate"

**Good Test Names** (describe reality):
- "should skip progress when operation completing"
- "should throw error when configuration invalid"
- "should cleanup timers after operation ends"

**Pattern**: If your test name needs to EXPLAIN WHY, it's probably hiding an architectural issue.

---

## 7. Comprehensive Documentation Enables Future Sprints

### The Learning

Spending time on detailed documentation (`progress-middleware-architectural-issue.md`) makes next sprint **dramatically faster**.

### What We Documented

1. **Problem statement** with production evidence
2. **Timeline comparison** (current vs. correct)
3. **Implementation plan** with code examples
4. **Testing strategy** (unit, integration, agent-dev)
5. **Migration options** (breaking vs. graceful)
6. **Success criteria** (checklist)

### Impact

Next sprint can:
- Start coding immediately (no investigation needed)
- Reference exact integration points (file:line references)
- Copy-paste code examples
- Use testing checklist
- Understand trade-offs (breaking vs. graceful deprecation)

### How to Apply

**When investigating issues**:
1. **Document AS YOU GO**: Don't wait until end
2. **Include evidence**: Correlation IDs, timestamps, log excerpts
3. **Show comparisons**: "Current architecture" vs. "Correct architecture"
4. **Provide code examples**: Not just descriptions
5. **Answer "what's next?"**: Implementation plan, testing, deployment

**Template**:
```markdown
# Problem
- What's wrong (with evidence)

# Root Cause
- Why it's wrong (architecture diagram)

# Solution
- How to fix (code examples)

# Testing
- How to validate (specific steps)

# Migration
- How to deploy (options + trade-offs)
```

---

## Sprint 35 In One Sentence

**When complex branching logic compensates for architectural limitations, question the integration point before adding more branches.**

---

## Recommended Reading for Future Sprints

1. "Symptoms vs. Root Causes" - This sprint
2. Event lifecycle integration patterns
3. Git worktree best practices
4. Production debugging with correlation IDs

---

## Questions These Learnings Answer

- **Why do I keep adding special cases?** → Wrong integration point
- **Why doesn't user agree with my fix?** → Mental model mismatch
- **How do I debug production issues?** → Start with event traces
- **Should I fix quickly or fix properly?** → Document the trade-off
- **Why did I analyze the wrong code?** → Worktree path confusion
- **Why don't tests catch architectural issues?** → Test names hide them
- **How do I help future sprints?** → Comprehensive documentation

---

## Action Items from These Learnings

For **next sprint**:
- [ ] Implement two-phase integration (`startTracking` + `completeOperation`)
- [ ] Remove Case 2 & 3 logic entirely
- [ ] Add integration test with real async operation timing
- [ ] Deploy to agent-dev and validate with production-like scenarios

For **future sprints**:
- [ ] Add "question integration points" to architecture review checklist
- [ ] Create event tracing workflow documentation
- [ ] Establish symptom vs. root cause decision framework
- [ ] Add git worktree path verification to shell prompt
