# Key Learnings – sprint-282-qos-v1

- Twitch IRC provides both `userLogin` and `userId`. Using both for authorized user checks is more robust as users can change their login names.
- Case-insensitivity for command triggers and usernames is essential for chat-based commands.
- String trimming of configuration values (e.g., `debugUsers` list) prevents subtle bugs from whitespace in environment variables.
- Using Firestore TTL fields (`expireAt`) is the standard way to implement persistence TTL.
- Standardized `WebhookFormatter` regression test failures highlight the importance of preserving default behavioral fields (like `username`) in external-facing formatting logic.