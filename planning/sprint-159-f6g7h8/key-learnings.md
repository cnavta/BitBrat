# Key Learnings – sprint-159-f6g7h8

- **Order of Operations**: In prompt engineering, especially when dealing with chat history, the order in which messages are added to the context and then rendered is critical. Always build the context summary from the state BEFORE the current turn is added if you want to avoid redundancy.
- **Git Merge Hygiene**: When working on fixes that might overlap with other active sprints, frequently pulling or merging those branches helps identify conflicts early and avoids double work.
- **Prompt Spec Isolation**: Using a typed `PromptSpec` makes it easier to test and reason about the final prompt structure without having to parse long strings.
