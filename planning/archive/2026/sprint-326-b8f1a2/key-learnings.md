# Key Learnings – sprint-326-b8f1a2 (Integrated Version Handling)

1. **One source of truth, mechanically enforced.** `architecture.yaml project.version` is the canonical
   version (AGENTS.md §0 + runtime via `src/common/base-server.ts`). `package.json`/`package-lock.json`
   mirror it. The new tool reads architecture.yaml, writes all three, asserts they agree, and re-validates
   architecture.yaml — eliminating the manual reconciliation that sprint-323 had to do by hand.

2. **Law #2 compliance is a write strategy, not just intent.** Editing architecture.yaml safely means a
   line-targeted, comment-preserving value replace (regex on the `project:` block) + a post-write re-parse —
   never a full YAML re-serialize. A test asserting "exactly one line differs" locks this in.

3. **Make dry-run a real code path.** Threading `dryRun` into every writer (true no-op) gives a CI-safe,
   idempotent `release:dry` that `validate_deliverable.sh` can run on every sprint, proving a bump is
   mechanically possible without touching the tree (proven via pre/post content hash).

4. **The bump type must be an explicit argument.** Pre-1.0 SemVer: `patch|minor|major|x.y.z`, never guessed.
   Invalid input fails closed (non-zero exit, clear message, no files touched).

5. **Brat CLI extension pattern.** New groups slot into the flat router in `tools/brat/src/cli/index.ts`
   (`if (c1 === 'release') require('./release')`), add a `printHelp` entry, log via the pino facade, and ship
   a co-located `__tests__` spec — mirroring `fleet`/`backup`.

6. **Environment pin.** System `node` is v14; this repo needs the nvm v22 toolchain on PATH. Future sprints
   should not assume the default `node`.

7. **Reusable hook for future releases.** AGENTS.md §2.8 now documents cutting a version during Publish via
   `npm run release -- <bump>` (logged as a request ID) — so versioning is traceable, not ad-hoc.
