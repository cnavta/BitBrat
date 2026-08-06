# Sprint Retro — sprint-224-b4f8d2

## What Worked
- Using the `mustache` library simplified the implementation significantly compared to a custom regex-based approach.
- The `EvalContext` already provided most of the necessary fields for interpolation, making integration straightforward.
- Merging metadata and event context was easy with the spread operator.
- Extending the context to include `BaseServer.config` was simple after refactoring `buildContext` to accept it.

## What Didn't Work
- Initial `npm install` command failed due to unquoted `^` in the version string, which was quickly resolved.
- Large output from `validate_deliverable.sh` made it difficult to find the final status, requiring targeted grep commands.
- The sprint had to be reopened multiple times to accommodate additional tasks, but the protocol handled it well.
- Implementation of Egress enrichment and Event Metadata was straightforward as it followed the same pattern as other enrichments.
- Refactoring `RouterEngine` to collect all matches required removing a short-circuit, which is slightly less performant but necessary for the requirement.

## What Didn't Work (Remediation)
- Enrichment data was being lost because `RuleLoader` was too strict with `annotations` and `candidates`, and completely ignored `egress`.
- Lack of defaults for enriched items meant that templates had to be fully formed `AnnotationV1`/`CandidateV1` objects, which is not user-friendly.
- A missing `egress.destination` field could crash the enrichment loop for a rule.

## Key Learnings (Remediation)
- When implementing templates for existing interfaces, remember to provide defaults for required fields in the implementation (RouterEngine) and loosen validation in the loader (RuleLoader).
- Robustness against missing template fields is critical to prevent one bad rule from breaking the pipeline or being skipped silently.

## Future Improvements
- Consider if we want to support custom Mustache delimiters in RuleDocs.
- Explore caching compiled templates for performance if the number of rules becomes very large.
