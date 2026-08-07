# Retro – sprint-141-f8a12b

## What worked
- Identified the root cause: generic routes were using unsigned state, but verifying it with a signed state check.
- Reproduction test correctly highlighted the failure after fixing the mock provider.
- Signed state generation from Twitch-specific helpers was reusable for all providers.

## What didn’t
- Initial test mock used 's' instead of 'state' for the URL query parameter, which led to a false failure.

## Future
- Standardized OAuth state utilities should be moved to a common area to avoid depending on `twitch-oauth.ts` for all providers.
