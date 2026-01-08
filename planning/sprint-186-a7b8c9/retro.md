# Sprint Retro – sprint-186-a7b8c9

## What Worked
- The combination of Firestore for state and Cloud Scheduler for triggering provides a robust and scalable solution.
- Using MCP tools allows the LLM to manage schedules dynamically.
- Flattening the InternalEventV2 in the scheduler makes it easy to produce events that look like they came from an ingress.

## What Didn't
- TypeScript strictness in tests required some casting when mocking `jest.fn()`.
- Initial `npm install` failure due to missing `@types` for some packages, but easily resolved.

## Process Improvements
- Ensure all new dependencies are installed and audited early in the sprint.
