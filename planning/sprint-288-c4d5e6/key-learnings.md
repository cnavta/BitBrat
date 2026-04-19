# Key Learnings – sprint-288-c4d5e6

## Prompt Assembly & History
- Always prefer saving the raw user input to history rather than the processed/combined prompt which may contain system instructions, task parameters, and other non-conversational context.
- Saving instructions to history leads to exponential growth and "massive repetition" as each turn adds a new copy of the instructions to the history section of the next prompt.

## Testing
- A simple multi-turn reproduction script is invaluable for identifying state-related issues like history repetition.
- Mocks should be kept as simple as possible to avoid compilation and configuration overhead.
