# Retro – sprint-143-e2f4a1

## What worked
- Extending the configuration framework was straightforward.
- `DiscordAdapter` already had a good structure for adding query parameters.

## What didn’t
- Calculating the exact bitmask manually can be error-prone; documented the bits in comments.

## Future Improvements
- Consider adding a `DiscordPermissions` enum or helper to calculate bitmasks from strings in the code.
