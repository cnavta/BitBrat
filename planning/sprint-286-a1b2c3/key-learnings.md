# Key Learnings – sprint-286-a1b2c3

- **Lesson 1:** Neglected services often hide significant concurrency issues that aren't apparent from simple health-check tests.
- **Lesson 2:** The `cron-parser` library should be used with more robust error handling to avoid silent failures when cron expressions are invalid.
- **Lesson 3:** Always check for timezone assumptions early in the design of scheduling systems.
