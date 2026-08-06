# Key Learnings – sprint-323-49faff

1. **A shipped schema is only useful if it's enforced.** Wiring `brat config validate` to both the Zod
   schema and the new published JSON schema turned "we have a schema" into a real gate — and immediately
   caught a pre-existing defect (the `firestore` resource missing from the Zod union). Validation must
   actually run against the canonical file, not just exist.

2. **Documentation claims must be grounded in code, not the evaluation.** The external review asserted
   `AGENTS.md` existed; it did not. Always verify referenced files are in the working tree before linking
   them, and let an automated link-check enforce it.

3. **Report dependency-security progress by severity, not totals.** `npm audit fix` cleared all criticals
   and nearly all highs while total/moderate counts shifted — the meaningful win is the severity-weighted
   delta. Capture before/after by severity.

4. **Runtime vs. dev dependency placement matters for CLIs run from `dist`.** A tool that imports a library
   at runtime needs it in `dependencies`, even if it "worked" locally as a devDependency.

5. **Offline reproducibility should be exercised.** Confirming the Ollama provider instantiates with no API
   key against compiled output is far stronger evidence than asserting it in prose.

6. **Honor explicit user decisions over plans-of-record.** The version target (0.7.0) and the
   delete-and-gitignore choice came from the user's answers and superseded the planning defaults; the
   request-log captured the override for traceability.
