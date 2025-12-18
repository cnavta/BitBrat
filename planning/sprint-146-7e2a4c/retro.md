# Retro – sprint-146-7e2a4c

## What worked
- Identified the root cause by investigating how services handle the `source` field.
- Reproducing the issue with a targeted test case proved the hypothesis.
- Defense-in-depth in `ingress-egress` makes the system more resilient to future changes in other services.

## What didn’t
- Initial test run was confusing because I had swapped expectations in an attempt to "reproduce" by matching current buggy behavior instead of writing a new test case first.

## Key Learnings
- Always preserve original event metadata unless there is a very strong reason to overwrite it.
- `BaseServer.next()` overwrites Pub/Sub attributes, so we must rely on the payload for "original" information.
