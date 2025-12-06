# Key Learnings – sprint-116-4f7a1c

- BaseServer.onMessage/onHTTPRequest provide consistent logging and error handling across services; migrations should preserve existing ack/nack semantics.
- Tests may rely on MESSAGE_BUS_DISABLE_SUBSCRIBE; ensure migration maintains test toggles.
- Debug endpoints should prefer BaseServer.onHTTPRequest for uniform registration and observability.