# Retro – sprint-155-a8c2d4

## What worked
- Quick identification of the interface mismatch in `EnvelopeBuilder`.
- Renaming the record property in `EventDocV1` resolved the extension conflict while keeping the schema clean.
- full build check confirmed all related services are still compiling.

## What didn't
- Property collision was not caught during the initial refactoring phase.

## Future Improvements
- Be more mindful of property shadowing when extending shared event types in persistence models.
