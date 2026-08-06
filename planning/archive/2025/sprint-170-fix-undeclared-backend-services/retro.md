# Retro – sprint-170-fix-undeclared-backend-services

## What worked
- Quick identification of the root cause by comparing resource definitions with output references.
- Test-driven verification ensured the fix was correct and won't regress.

## What didn't work
- The previous sprint (169) introduced this regression while fixing hyphen/underscore naming consistency, by not accounting for the resource type difference between global and regional backends after the ID was transformed.
