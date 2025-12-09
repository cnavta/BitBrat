Retro – sprint-1-e91381f

What worked
- Clear alignment to architecture.yaml ensured consistent topics/env and service structure.
- Iterative delivery: TA → backlog → initial implementation → tests → docs.
- Noop message bus and mocked agent enabled fast, deterministic tests.

What didn’t
- Cloud validation (build/deploy) could not be exercised without credentials during the sprint window.
- Publication status metadata was inconsistent initially (updated vs created).

Improvements
- Add a local "dry-run" target that validates container build without pushing.
- Automate publication.yaml updates as part of CI to avoid drift.