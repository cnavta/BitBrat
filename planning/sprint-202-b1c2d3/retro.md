# Retro – sprint-202-b1c2d3

## What Worked
- Amending the sprint protocol allowed for quick integration of a critical dependency fix (Java 21).
- Using Adoptium repositories made the Java upgrade straightforward and reproducible in the Dockerfile.

## What Didn't Work
- Sprint 201's NATS JetStream changes introduced a regression in unit tests (missing mock for `jetstreamManager`) that was only caught during this sprint's validation. This highlights the importance of running the FULL test suite during every sprint validation.

## Improvements
- Ensure that any changes to shared common drivers (like NATS) are verified against all dependent unit tests before finishing the sprint.
