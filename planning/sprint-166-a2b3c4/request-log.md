# Request Log – sprint-166-a2b3c4

- **2025-12-25 11:40**: Received issue report about missing 'VIP' roles.
- **2025-12-25 11:45**: Started Sprint 166.
- **2025-12-25 11:55**: Identified root cause: roles from email-matched documents were not passed to `ensureUserOnMessage`.
- **2025-12-25 12:05**: Created reproduction test `src/services/auth/__tests__/repro-vip-role.spec.ts`. Confirmed failure.
- **2025-12-25 12:15**: Applied fix to `src/services/auth/enrichment.ts` and `src/services/auth/user-repo.ts`.
- **2025-12-25 12:20**: Verified fix with tests.
