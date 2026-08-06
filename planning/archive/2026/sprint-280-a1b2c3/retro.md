# Retro – sprint-280-a1b2c3

## What worked
- Quick identification of the path issue.
- Fixing the relative paths resolved the test suite failure immediately.

## What didn't work
- The test was moved in the previous sprint without careful verification of relative paths within the `jest.mock()` calls.

## Lessons learned
- When moving test files, pay extra attention to string-based relative paths in `jest.mock()` and `jest.requireActual()`, as IDEs might not always update them automatically if they are not standard imports.
