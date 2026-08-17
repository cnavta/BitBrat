# Retro – sprint-144-b2e1a3

## What worked
- The existing code in `DiscordIngressClient` already handled the fallback logic, making the re-introduction purely a configuration and architecture task.
- Automated tests quickly confirmed that the fallback works as expected.

## What didn’t
- Initial assumption that code changes might be needed in the client was incorrect, which saved time but shows that pre-analysis is crucial.

## Improvements for next time
- Always check the implementation first before planning code changes; sometimes it's just a matter of enabling what's already there.
