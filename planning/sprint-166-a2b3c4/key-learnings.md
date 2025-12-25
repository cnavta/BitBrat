# Key Learnings – sprint-166-a2b3c4

- **User Enrichment Data Flow**: When the `auth` service enriches an event, it might find a user by email first. If it then creates or updates a platform-specific document (e.g., `twitch:<id>`), it MUST include any existing roles or metadata from the email-matched document to avoid data loss.
- **Set-based Merging**: Using `Set` is effective for merging role arrays to ensure uniqueness while preserving legacy and new roles.
- **Provider Metadata Hardening**: Provider-specific metadata (`rolesMeta`) should also follow merging patterns instead of overwrite patterns to allow manual augmentation of user data in Firestore.
