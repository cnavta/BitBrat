# Key Learnings – sprint-225-a1b2c3

- JsonLogic `cat` is often used to build command patterns dynamically.
- Matching commands with `text_contains` needs to be robust against trailing spaces if the user types just the command.
- Modifying the custom operator is better than asking users to change their rules if the user's intent is clear and the change is safe.
- Default routing behavior should be robust; empty `routingSlip` arrays should be handled gracefully by falling back to a safe default (like egress) when a rule matches.
