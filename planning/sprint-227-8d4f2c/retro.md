# Retro – sprint-227-8d4f2c

## What Worked
- Reusing existing delivery logic in `IngressEgressServer` minimized duplication.
- Flattened `InternalEventV2` structure made generic egress routing easier.
- `sharedBus` in integration tests effectively simulated the message bus behavior for multiple services in one process.

## Challenges
- Coordinating between multiple instances of API Gateway requires the generic topic to broadcast; verifying this locally needed a robust mock bus.
- Ensuring `EgressManager` correctly identified which events to ignore vs. which to fail was critical to avoid double-DLQing.

## Future Improvements
- Consider a dedicated "Egress Service" if the number of supported platforms grows significantly, rather than bundling them in `ingress-egress`.
- Shared state (e.g. Redis) for user connections could optimize API Gateway delivery by routing specifically to the instance where the user is connected, rather than broadcasting to all.
