# Retro - sprint-147-3f8a1b

## What worked
- Quick identification of the regression root causes.
- Test fixes were straightforward and verified immediately.

## What didn't
- The regressions were introduced because tests were not run as part of the previous sprint's final validation (likely due to them being outside the `src/` directory or not being picked up by the broad filters used).

## Future Improvements
- Ensure `infrastructure/scripts/*.test.ts` and `tests/**/*.spec.ts` are included in the verification process for every sprint that modifies architecture or core event logic.
