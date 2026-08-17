## Retro - sprint-233-b1c2d3

### What went well
- Fast identification of the root cause by examining Docker Compose and CLI source code.
- Unit test successfully reproduced the issue and confirmed the fix.
- Manual verification confirmed that the compiled JS needs to be kept in sync with TS changes (rebuild was necessary).

### What didn't go well
- Initial manual test failed because I forgot to run `npm run build` after modifying the TS file. This is a reminder that the `brat` command runs from `dist/`.

### Key Learnings
- Always ensure `npm run build` is run when testing changes to the `brat` CLI locally, as the execution points to `dist/tools/brat/src/cli/index.js`.
