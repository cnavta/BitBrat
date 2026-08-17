# Retro – sprint-245-b1a2c3

## What worked
- Measuring processing time was straightforward using `Date.now()`.
- Mocking Firestore and the AI SDK in unit tests allowed for precise verification of the logged values.

## What didn't work
- The `validate_deliverable.sh` script is very noisy when running all tests, making it hard to see results without grep.

## Summary
The sprint successfully added the requested observability feature to track LLM performance across different platforms and models.
