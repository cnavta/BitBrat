# Key Learnings - sprint-313-d3e4f5

- **Routing State Transitions**: In this platform, `routing.stage` at the `RuleDoc` level is the authoritative target stage for the resulting slip.
- **Redundant Attributes**: Avoid putting stage information in `RoutingStepRef` attributes if it's already defined at the top-level `routing` object, to prevent ambiguity.
