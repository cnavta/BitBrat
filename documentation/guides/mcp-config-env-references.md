# MCP Server Config: Environment-Variable References

The `tool-gateway` connects to MCP servers using configuration stored in the Firestore
`mcp_servers` collection (see [MCP Auto-Discovery](../technical-architecture/mcp-auto-discovery.md)).
The `env` and `args` values of an MCP server configuration may now **reference environment
variables available to the tool-gateway container** instead of containing literal values.

The primary use case is **secret hygiene**: store a *reference* (e.g. `${OPENAI_API_KEY}`) in
Firestore rather than the secret itself. The tool-gateway substitutes the real value — drawn from
its own process environment / mounted secret — at connection time. References can also point at
non-secret runtime configuration (e.g. `${ENV}`, `${GCS_BUCKET_NAME}`).

## Supported Syntax

The feature reuses the platform's established interpolation syntax:

| Token                 | Resolves to                                                              |
|-----------------------|--------------------------------------------------------------------------|
| `${VAR}`              | The value of `VAR` from the tool-gateway's environment.                  |
| `${VAR:-default}`     | The value of `VAR`, or `default` when `VAR` is unset/empty.              |
| Literal text          | Returned unchanged. A config with no `${...}` tokens behaves exactly as before. |

References may appear anywhere inside a string and may be mixed with literal text
(e.g. `"Bearer ${AUTH_TOKEN}"`, `"--region=${REGION:-us-east1}"`).

## Where references are resolved

- **Source of values:** resolution draws **only** from the tool-gateway's own `process.env`.
  There are no Firestore lookups or remote secret fetches.
- **`env`** — every *value* in the `env` record is interpolated. Keys are left unchanged.
  - For `stdio` servers, the resolved `env` is merged into the child process environment
    (`{ ...process.env, ...resolvedEnv }`).
  - For `sse` servers, the resolved `env` is sent as the request headers.
- **`args`** — every element of the `args` array is interpolated (for `stdio` servers).
- The persisted Firestore document and the gateway's in-memory cache always retain the
  **unresolved** (safe-to-store) form. Resolution happens only when building the live transport.

### Example (Firestore `mcp_servers` document)

```json
{
  "name": "image-gen-mcp",
  "transport": "stdio",
  "command": "node",
  "args": ["dist/services/image-gen-mcp/index.js", "--region=${REGION:-us-east1}"],
  "env": {
    "OPENAI_API_KEY": "${OPENAI_API_KEY}"
  }
}
```

With `OPENAI_API_KEY` provided to the tool-gateway container (e.g. via a mounted secret), the
spawned MCP server receives the real key without it ever being stored in Firestore.

## Unresolved references

If a `${MISSING_VAR}` reference has **no value and no default**, it is substituted with an **empty
string** and a single structured warning is emitted listing the missing names:

```
mcp.config.env_ref.unresolved  { name: "<server>", unresolved: ["MISSING_VAR"] }
```

The connection still proceeds (it is not skipped or failed). Use `${VAR:-default}` when an explicit
fallback is preferred.

## Security / logging

Resolved values are **never logged**. The tool-gateway logs only the **names** of referenced and
unresolved variables:

```
mcp.config.env_ref.resolved    { name: "<server>", refsUsed: ["OPENAI_API_KEY"], unresolved: [] }
```

## Reconnect idempotency & secret rotation

The tool-gateway avoids churning healthy connections on benign Firestore rewrites by comparing a
*connection signature*. References are **resolved before** the signature is computed, so:

- An unchanged Firestore document **and** unchanged environment → **no reconnect** (idempotent).
- A **rotated** underlying value (the env var changes) → **exactly one reconnect** that picks up the
  new resolved value the next time `connectServer` runs for that server.

## Backward compatibility

Existing `mcp_servers` documents that use literal `env`/`args` values are unaffected — the resolver
is an identity transform on strings that contain no `${...}` tokens.
