# Retro – sprint-275-a5b6c7

## What worked
- Quick identification of the `reconnect` early-exit guard as the root cause of reconnection failure.
- Reproduction of the issue using `jest.useFakeTimers()` and `jest.advanceTimersByTimeAsync()` effectively.
- Correct analysis of the token resolution path in `DiscordAdapter`.

## What didn’t work
- Initial `jest.advanceTimersByTime()` calls were too short because of the 10s minimum interval in the production code.
- Initial test failed because `NODE_ENV` defaulted to `test`, which bypasses real Discord logic in the client.

## Improvements for next time
- Always check for hardcoded minimum intervals in polling logic before setting test timer values.
- Be aware of environment-based logic bypasses in unit tests.
