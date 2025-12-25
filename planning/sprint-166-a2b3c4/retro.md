# Retro – sprint-166-a2b3c4

## What worked
- Quick reproduction of the issue with a targeted test case.
- Hypothesis about email-match vs composite ID was correct.

## What didn't work
- Initial mock in the first test attempt was too optimistic and didn't reflect the actual data flow correctly.

## Lessons learned
- When dealing with multiple lookup keys (ID, Email), always ensure that data from the first match is fully propagated if a second (canonical) document is created/updated.
