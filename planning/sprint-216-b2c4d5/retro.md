# Retro – sprint-216-b2c4d5

## What worked
- Using a small standalone script (`test-path.js`) to test the library behavior directly saved a lot of time and allowed for rapid iteration to find the correct syntax.
- Targeted unit tests for the generator were fast and effective.

## What didn't work
- Previous assumptions about standard Express/path-to-regexp syntax were outdated. v8 is significantly stricter and has different syntax rules.

## Lessons Learned
- Always verify library versions and their specific requirements when encountering path matching errors.
- `path-to-regexp` v8+ uses `{ *path }` for unnamed wildcards, which is different from previous versions.
