# Bug Reports

This directory contains detailed bug reports for issues discovered during development and deployment.

## Active Bugs

| ID | Date | Title | Severity | Status | Sprint |
|----|------|-------|----------|--------|--------|
| BUG-2026-11-09-002 | 2026-11-09 | Single-Service Deployment Fails Due to Missing Infrastructure Dependencies | Medium | Open | Sprint 57 |
| BUG-2026-11-09-003 | 2026-11-09 | `brat bit create` Generates Outdated Infrastructure Configuration | High | Open | Sprint 57 |

## Resolved Bugs

| ID | Date | Title | Severity | Status | Sprint |
|----|------|-------|----------|--------|--------|
| BUG-2026-11-09-001 | 2026-11-09 | tool-orchestrator Incorrectly Depends on Deprecated firebase-emulator | High | ✅ Fixed | Sprint 57 |

## Bug Report Format

Each bug report should include:

1. **Summary**: Brief description of the issue
2. **Environment**: Context where bug was discovered
3. **Problem Description**: Detailed explanation with error messages
4. **Root Cause**: Why the bug occurred
5. **Steps to Reproduce**: How to trigger the bug
6. **Expected vs Actual Behavior**: What should happen vs what does happen
7. **Impact**: Severity and scope of the issue
8. **Fix Applied**: Solution implemented (if resolved)
9. **Prevention Recommendations**: How to prevent similar issues
10. **Verification**: How to verify the fix works

## Severity Levels

- **Critical**: System down, data loss, security vulnerability
- **High**: Feature broken, deployment blocked, significant user impact
- **Medium**: Feature degraded, workaround available, limited user impact
- **Low**: Minor issue, cosmetic, minimal impact

## Status Values

- **Open**: Bug reported, not yet fixed
- **In Progress**: Fix being developed
- **✅ Fixed**: Fix applied and verified
- **Won't Fix**: Issue acknowledged but not planned to fix
- **Duplicate**: Same as another bug report
- **Invalid**: Not actually a bug
