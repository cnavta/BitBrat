# Retro – sprint-236-e1f2g3

## What Worked
- Investigation quickly identified the discrepancy between `.bitbrat.json` (used by chat directly as a fallback) and `.env.local` (populated from `.secure.local` and used as a primary source via `process.env`).
- Re-using existing `updateEnv` and `replacePlaceholders` utilities made the fix straightforward.

## What Didn't
- Initial implementation had a block-scoped variable usage error because I tried to update `.secure.local` before the token was generated.

## Lessons
- Always check where `process.env` is being populated from in CLI tools.
