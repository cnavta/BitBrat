# Retro - sprint-282-qos-v1

## What Worked
- Clear architectural strategy provided a strong foundation for implementation.
- `BaseServer` integration effectively centralizes QOS enforcement across all microservices.
- Unit testing with mocked message-bus and real timers proved effective for validating timeout logic.

## What Didn't
- Initial confusion over field names (e.g., `ttl` vs `persistenceTtlSec`) in the codebase was resolved by aligning with the new `QOSV1` specification.
- OpenTelemetry sampling overrides were tricky to implement within the `ParentBasedSampler` without changing the global provider; used span attributes as a fallback hint.

## Next Steps
- Monitor tracer event verbosity in production to ensure log volume is manageable.
- Consider adding `maxResponseMs` to external documentation for platform developers.
