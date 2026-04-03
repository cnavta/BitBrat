# Key Learnings – sprint-265-7283d4

- Prompt assembly became more reliable once structured user metadata and behavioral state stopped flowing through the same generic task-annotation combiner.
- Regression coverage needs to exercise both direct prompt shape assertions and downstream legacy expectations, because prompt-placement fixes can preserve semantics while still breaking established formatting contracts.
- Disposition/user-context data belongs to user-oriented prompt sections, while only actionable instructions should feed the `Task` section.