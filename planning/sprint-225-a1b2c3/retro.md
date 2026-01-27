# Retro – sprint-225-a1b2c3

## What worked
- Quick reproduction of the issue using a focused unit test.
- The `text_contains` operator was easily identifiable and extensible.
- The sprint protocol helped maintain structure.
- Successfully pivoted to address clarified requirement for empty routing slips.
- Migration to `BaseServer.next()` was straightforward and improved consistency.
- `BaseServer.next()`'s fallback to `egress.destination` worked well with our Sprint 225 empty-slip fix.

## What didn’t
- Initial confusion about why the rule included a trailing space, but it's common for matching commands with arguments.
- The default DLQ behavior for empty slips was non-intuitive for "matching but terminating" rules.
- Discovery that downstream services often rely on top-level `channel` attribute, which wasn't synced during `egress.destination` enrichment.
- Manual publishing in `event-router-service` was a legacy pattern that needed cleanup.

## Future Improvements
- Consider adding more "command-aware" operators that handle sigils and spaces automatically.
