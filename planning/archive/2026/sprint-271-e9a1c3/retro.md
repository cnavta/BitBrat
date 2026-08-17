# Retro – sprint-271-e9a1c3

## What worked
- Quick identification of mismatch between state generator and verifier
- Minimal, targeted fix with comprehensive tests
- Fast CI verification and PR creation

## What didn’t
- Prior regression allowed unsigned state back into generic routes

## Improvements
- Add a lint/test rule to forbid unsigned state usage anywhere
