# Retro – sprint-218-c4d5e6

## What Worked
- The fix was straightforward: Docker Compose network aliases provide the exact DNS mechanism needed for services to discover each other via arbitrary hostnames on the same network.
- Bootstrapping automation made it easy to propagate the change to all services.

## What Didn't Work
- Initial thought about load balancer rules was correct but adding aliases to individual containers is the most direct solution for local Docker Compose without a complex DNS server or proxy.

## Improvements
- Consider if the `internal-load-balancer` configuration in `architecture.yaml` should be more tightly coupled with the `bootstrap-service.js` logic to handle custom hostnames if they deviate from the default service name.
