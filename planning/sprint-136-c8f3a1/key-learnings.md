# Key Learnings – sprint-136-c8f3a1

- Mapping “personalities” to Identity & Constraints clarifies responsibilities and keeps System Prompt immutable and concise.
- A strict adapter mapping (system = System+Identity+RequestingUser+Constraints; user = Task+Input) simplifies provider interoperability and tests.
- Injecting short‑term memory as fenced Input.context preserves formatting and avoids polluting system or task intent.
- Safe observability (meta + previews, no raw payloads) provides strong debugging signals without leaking secrets.
- A small CLI around the assembler is valuable for on-call and debugging flows.
