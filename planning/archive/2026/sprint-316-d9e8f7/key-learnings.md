# Key Learnings – sprint-316-d9e8f7

- **Platform Complexity**: The platform separates event routing logic (Event Router) from state-based reactivity (State Engine). Documentation must clearly distinguish between these two layers so users know where to place their logic.
- **Brat Tooling**: The `brat` tool is the central entry point for users. It should be the primary focus of the "Getting Started" experience.
- **Seed Data Importance**: Users need a concrete starting point. Documenting how to load initial rules (like the !lurk command) is as important as documenting the code itself.
