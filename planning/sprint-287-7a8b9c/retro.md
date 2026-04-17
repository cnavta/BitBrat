# Sprint Retro – sprint-287-7a8b9c

## What Worked
- **Clear Architectural Guidance:** Creating the `architecture-basic-tooling.md` early helped structure the implementation.
- **Test-First Approach:** Mocking `Date` in the unit tests ensured reliable and repeatable verification.
- **Registry Pattern:** Reusing the existing `ToolRegistry` and `BitBratTool` interface for basic tools made integration into `llm-bot` straightforward.

## What Didn't
- Nothing significant. The task was well-defined and fit well into the existing architecture.

## Improvements for Next Time
- For future basic tools (e.g., math utilities), we might consider building a single "math" tool that takes an expression, rather than many tiny tools.
- Monitor the number of registered tools to ensure `llm-bot` prompt window doesn't get cluttered.
