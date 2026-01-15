# Retro – sprint-188-c9d0e1

## What worked
- Quick identification of the schema issue based on the error message.
- Temporary test successfully reproduced and verified the fix.

## What didn't
- TypeScript's "excessively deep" type instantiation error continues to be a nuisance when using `zodToJsonSchema` on complex nested objects.

## Key Learnings
- Always ensure arrays in Zod schemas for MCP tools have an explicit item type (even if it's just `z.record(z.any())`) to avoid missing `items` in the generated JSON schema.
