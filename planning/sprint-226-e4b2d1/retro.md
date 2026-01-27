# Retro – sprint-226-e4b2d1

## What Worked
- Systematic identification of artifacts using `grep` and `find`.
- Moving all related files to a dedicated `deprecated/services/command-processor/` structure kept the project clean.
- Updating `jest.config.js` to ignore `deprecated/` ensured that the validation flow remained robust even with "broken" historical tests.

## What Didn't Work
- Initial attempt to create multiple directories in one `mkdir` failed due to shell restrictions in the tool, but was easily fixed by combining them correctly.
- Some tests in `brat` tool initially failed because of missing `architecture.yaml` in `dist/` but this was a separate build issue, not directly related to the deprecation changes.

## Lessons Learned
- When deprecating a service, it's important to check if its configuration fields are leaked into other services (like `event-router` logic using `config.commandSigil`).
- `BaseServer.next()` and `InternalEventV2` routing slip pattern made it easy to see that `command-processor` was just one step in a chain that could be removed.
