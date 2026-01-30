# Retro – sprint-237-f1g2h3

## What Worked
- Investigation into service source code (`auth.ts` and `rule-loader.ts`) quickly revealed the discrepancies in paths and field names.
- Unit tests were easily updated to prevent regression.

## What Didn't Work
- The initial implementation of `brat setup` made assumptions about schema that were not validated against the consumer services.

## Future Improvements
- Consider adding a shared types or configuration package that defines common Firestore paths and schemas to avoid drift between services and tools.
