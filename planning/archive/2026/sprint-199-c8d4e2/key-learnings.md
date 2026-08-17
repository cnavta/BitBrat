# Key Learnings – sprint-199-c8d4e2

- **Docker Compose Dependency Management**: Always use `service_healthy` instead of simple `depends_on` for infrastructure components that require significant boot time (like Firebase Emulators) to avoid "Connection Refused" errors in dependent services.
- **Healthcheck Robustness**: Infrastructure healthchecks (e.g., NATS `/varz` or Firebase UI port) must be reliable and accurately reflect when the service is ready to accept connections from other containers.
- **Modular Compose Benefits**: Keeping service definitions in separate `.compose.yaml` files allows for granular control and cleaner `depends_on` logic when services are scaled or updated individually.
