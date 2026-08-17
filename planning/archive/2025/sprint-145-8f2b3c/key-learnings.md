# Key Learnings – sprint-145-8f2b3c

## Technical
- The `InternalEventV2`'s `source` field is the authoritative way to identify the origin platform for egress routing.
- `discord.js` `Client` needs to be in `CONNECTED` state for egress to work; checking the snapshot state is a good safety measure.
- Always check for existing stubs/placeholders when implementing new features (found `DiscordEgressConnector` stub).

## Process
- Validating the project with `npm run build` early catches import issues that might be missed by simple `jest` runs if only running specific files.
- Documenting the "Why" in `request-log.md` helps keep track of decisions like moving tests.
