# Firestore Indexes for Command Matching (vNext)

This document captures the composite index requirements for the simplified command matching data model.

Collection: commands (configurable via commandsCollection; default: "commands")

Primary lookup – classic command by term:
- Query shape:
  - where("matchType.kind", "==", "command")
  - where("matchType.values", "array-contains", <term>)
  - orderBy("matchType.priority", "asc")
  - limit(1)

Required composite index:
- Collection: commands
- Query scope: collection
- Fields (in order):
  1) matchType.kind Ascending
  2) matchType.values Array contains
  3) matchType.priority Ascending

Regex loader – cache ordering:
- Query shape:
  - where("matchType.kind", "==", "regex")
  - orderBy("matchType.priority", "asc")

Required index (single-field is typically sufficient):
- If Firestore prompts for a composite index, create:
  1) matchType.kind Ascending
  2) matchType.priority Ascending

Notes:
- These indexes should be created in all environments before enabling traffic to the Command Processor service.
- If your collection name differs, adjust accordingly. Firestore console will also offer a direct creation link if missing.
