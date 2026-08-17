# Key Learnings – sprint-225-a1b2c3

- JsonLogic `cat` is often used to build command patterns dynamically.
- Matching commands with `text_contains` needs to be robust against trailing spaces if the user types just the command.
- Modifying the custom operator is better than asking users to change their rules if the user's intent is clear and the change is safe.
- Enrichment of `egress.destination` must always sync with the top-level `channel` field to ensure downstream services (and message bus attributes) stay in sync.
- Using `BaseServer.next()` instead of manual publishers ensures that the routing slip is advanced correctly and that system-wide routing conventions (like egress fallback) are consistently applied.
