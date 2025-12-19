# Retro – sprint-148-9f1a2b

## What worked
- Using bash arrays for command assembly is a much cleaner and safer way to handle complex arguments than string concatenation and `eval`.
- Local verification script successfully mocked the Cloud Build environment to prove the fix.

## What didn't work
- The initial deployment logic was vulnerable to shell injection or parsing errors due to `eval` and improper quoting.

## Lessons for future sprints
- Avoid `eval` for command execution whenever possible, especially when handling user-provided or configuration-based data.
- Always prefer bash arrays for building CLI commands dynamically.
