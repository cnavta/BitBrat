# Sprint Retro – sprint-106-7c9e12

## What worked
- Clear per-instance egress topic design simplified routing
- Test guards avoided real network connections; fast CI
- Contract-first approach made wiring straightforward

## What didn’t
- validate_deliverable.sh lacks automated healthchecks for Twitch egress path
- Publication automation depends on GitHub CLI auth in this environment

## Next time
- Add small in-memory bus integration test for egress consumer path
- Introduce counters/metrics for egress received/sent/error
- Set up CI secret for gh auth or use GitHub Actions workflow to auto-create PRs