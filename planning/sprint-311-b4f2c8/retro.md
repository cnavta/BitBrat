# Retro - sprint-311-b4f2c8

## What worked
- Quick identification of the schema mismatch between `setup.ts` and `rule-loader.ts`.
- `RuleLoader` already had some backward compatibility but fixing the source is better.

## What didn't work
- The initial implementation of `brat setup` didn't strictly follow the `RuleDoc` schema, leading to this bug.

## Improvements for next time
- Always check the corresponding loader/service schema when adding population logic for new collections.
