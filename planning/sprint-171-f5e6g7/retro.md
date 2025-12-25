# Retro – sprint-171-f5e6g7

## What worked
- Identified the root cause of the deployment errors quickly by analyzing the resource addresses in the error messages.
- Unit tests were already in place to catch discrepancies, though I had previously updated them to expect the "wrong" (underscored) names.

## What didn’t work
- Normalizing to underscores in Sprint 169/170 was a well-intentioned cleanup that broke compatibility with existing infrastructure state.

## Conclusion
- Consistency is good, but compatibility with existing deployments is paramount when managing infrastructure as code.
