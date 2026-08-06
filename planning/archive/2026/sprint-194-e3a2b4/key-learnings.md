# Key Learnings – sprint-194-e3a2b4

- `BaseServer` is the key to standardization; it manages the V1->V2 shim and provides the `next()` routing helper.
- `egressDestination` is a critical piece of metadata that allows the distributed egress path to work correctly without hardcoding platform topics.
- The `routingSlip` makes the event lifecycle highly visible and traceable, especially when combined with OTel tracing.
