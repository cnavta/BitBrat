# Key Learnings – sprint-328-c4312d

1. **Generate docs/context from exported runtime arrays, not types.** TS types erase at runtime; promoting the
   well-known values to `const ... as const` arrays (and deriving the type from them) gives both a compile-time
   type and a runtime source the generator + drift guard can read. Pattern reusable for any "self-documenting"
   surface.

2. **Make registration the same source as documentation.** Refactoring `registerOperatorsOnce` to iterate
   `CUSTOM_OPERATORS` means a new operator is automatically documented and drift-checked — there is no second
   place to forget to update.

3. **Additive event fields must be omitted-when-empty.** Advertising `payload.context` only when non-empty keeps
   older consumers' parse path byte-for-byte unchanged and makes back-compat trivially testable.

4. **Provide a resolution seam, don't force a layer.** When the orchestration layer (gateway) doesn't own prompt
   assembly, expose a `resolve...()` method the real prompt-build can call later. Keeps the sprint
   behavior-preserving while enabling JIT injection.

5. **Add minimal public introspection for testability** (`listToolDescriptors`, `listResourceDescriptors`,
   `readRegisteredResource`) instead of casting to `any` to reach privates — clearer intent and stable tests.

6. **Environment note:** node/npm are only available via nvm here; sprint scripts should source `~/.nvm/nvm.sh`
   and select Node 20 so they run in non-interactive shells.
