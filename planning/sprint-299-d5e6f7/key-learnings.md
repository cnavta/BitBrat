# Key Learnings – sprint-299-d5e6f7

- **Poller Robustness**: Using `system.timer.v1` as an external heartbeat simplifies service logic and shifts the "when to run" responsibility to a dedicated scheduler, making the service more scalable.
- **Data Normalization**: Creating a "virtual" schema for disparate data sources (like `prompt_logs` vs `events`) early in the pipeline significantly simplifies downstream analysis logic.
- **Idempotency**: Rounding time to the nearest window boundary is a reliable way to generate idempotency keys for periodic reporting tasks.
