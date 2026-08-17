# Retro - sprint-234-c1d2e3

## What Worked
- Automating `API_GATEWAY_HOST_PORT` was a simple but effective fix for the reported onboarding friction.
- Existing `updateYaml` utility made it easy to add the new configuration key.

## What Didn't Work
- Manual verification of `deploy-local.sh` still hits port collisions if services are already running or if multiple services claim the same default port (3001). However, `brat chat` is now correctly aligned with the default.

## Key Learnings
- Small automation steps in the `setup` command significantly improve the "first run" experience.
