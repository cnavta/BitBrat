# Key Learnings – sprint-165-b4e5f6

- **Routing Logic**: Custom operators in `jsonlogic-evaluator.ts` are powerful tools for matching complex event conditions.
- **Session Tagging**: `FIRST_SESSION_MESSAGE` is the standard tag for identifying the beginning of a user's activity session (respecting 24h inactivity).
- **Rule Documents**: Externalizing routing rules as JSON/YAML documents enables flexible configuration without service redeployment.
