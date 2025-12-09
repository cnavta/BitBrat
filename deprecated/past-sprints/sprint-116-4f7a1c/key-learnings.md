# Key Learnings – sprint-116-4f7a1c

- BaseServer.onMessage/onHTTPRequest provide consistent logging and error handling across services; migrations should preserve existing ack/nack semantics.
- Tests may rely on MESSAGE_BUS_DISABLE_SUBSCRIBE; ensure migration maintains test toggles.
- Debug endpoints should prefer BaseServer.onHTTPRequest for uniform registration and observability.
- End-to-end deploy observability is crucial: echoing effective parameters in Cloud Build prevents ambiguity during incident response.
- Scaling defaults precedence (service > defaults.services > deploymentDefaults.cloud-run) should be codified in tests to prevent regressions.