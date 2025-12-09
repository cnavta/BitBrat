# Key Learnings – sprint-104-f0bef1b

- Establishing clear event subject constants (e.g., INTERNAL_USER_ENRICHED_V1) simplifies coordinated changes across services and tests.
- Default topic selection should always be environment-overridable to support staged rollouts and blue/green testing.
- Separating Technical Architecture from runtime implementation helps validate contracts early and reduces rework.
- A lightweight, logically passable validate_deliverable.sh accelerates verification and keeps sprints auditable.
- For services that depend on Firestore, documenting multi-database (databaseId) early avoids confusion during local and multi-tenant setups.