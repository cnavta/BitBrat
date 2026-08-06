# Key Learnings – sprint-146-7e2a4c

- **Source Preservation**: Event-driven systems must carefully preserve the original source of an event throughout the pipeline to ensure correct routing at the edge (egress).
- **Dual-Path Identification**: When an event can have multiple versions (V1/V2), egress handlers should check all possible locations for critical routing fields (e.g. `source`).
- **Annotation as Fallback**: Using custom annotations to carry metadata (like original platform) provides a robust secondary signal if the primary envelope is mutated.
