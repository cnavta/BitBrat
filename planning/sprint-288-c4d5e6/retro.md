# Retro – sprint-288-c4d5e6

## What Worked
- Reproduction scripts quickly identified both root causes:
    1. `combinedPrompt` (instructions) was being saved as the human message in history.
    2. Multiple ingress clients were independently publishing the same message with unique correlation IDs.
- Sprint protocol ensured clear documentation of the issues and fixes.
- Amending the active sprint allowed for a cohesive fix for related issues reported in quick succession.

## What Didn't
- Relying on random UUIDs for correlation IDs makes deduplication difficult if multiple clients receive the same event; it is better to ensure only one client handles ingress.

## Improvements
- Consider using a deterministic correlation ID based on the platform's message ID if possible, though disabling redundant ingress is the cleaner architectural fix.
