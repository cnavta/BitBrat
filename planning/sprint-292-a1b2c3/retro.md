# Sprint Retro - sprint-292-a1b2c3

## What worked well
- Quick identification of the regression cause (too aggressive guarding).
- Granular fixes using `evt.message` restored compatibility without losing the new features.
- Re-running the entire suite of related tests ensured no new regressions.

## What didn't work well
- Initial implementation in sprint-291 underestimated the prevalence of hybrid/legacy event shapes in the test suite.

## What to improve
- When introducing breaking changes to event processing, always check for "hybrid" shapes that might be common in tests even if not in production.
