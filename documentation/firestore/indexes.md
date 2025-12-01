# Firestore Indexes — Command Processor

Date: 2025-12-01
Sprint: sprint-108-bc7a2d

Required queries for command lookup:
- commands where name == <commandName> limit 1
- commands where aliases array-contains <commandName> limit 1

Index requirements:
- Single-field index on name for equality is provided by Firestore by default.
- Array-contains on aliases is supported by Firestore without additional composite indexes.
- No composite indexes are required for these queries.

Notes:
- Documents use auto-generated IDs; the canonical command name is stored in the "name" field (lowercase).
- Keep aliases in lowercase for consistent lookups.