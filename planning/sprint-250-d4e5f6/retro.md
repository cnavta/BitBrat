# Retro – sprint-250-d4e5f6

## What went well
- Quick identification of the issue based on the error message.
- Mock update was straightforward and fixed all failing tests.
- Building the project confirmed that the mock change didn't affect compilation.

## What didn't go well
- Shell escaping in `printf` led to some issues with variables like `$text` being interpreted by the shell.
- Accidentally changed directory to root `/`, but recovered quickly.

## Future Improvements
- Use the `create` tool or more robust heredocs for multi-line file creation to avoid shell escaping issues.
