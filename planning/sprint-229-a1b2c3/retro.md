# Retro – sprint-229-a1b2c3

## What Worked
- The separation of concerns between `brat chat` CLI and `api-gateway` made it clear where each change should go.
- ANSI colors were easy to implement without adding weight to the project.
- The `userId` override via query params is a clean way to support dynamic identities for certain session types.

## What Didn't Work / Challenges
- Identifying where the "assumed" User ID came from was a bit tricky as it wasn't hardcoded in the source, but likely tied to the specific token used in development.
- Manual verification of interactive CLI behavior is harder to automate.

## Improvements for Next Time
- Consider adding a small utility for ANSI colors to avoid repeating escape codes if more CLI tools are added.
