# Technical Architecture — Platform User Data Enrichment

## 1. Objective
Ensure the BitBrat platform captures and maps all relevant user data from source platforms (Twitch, Discord) when users are created or updated via the `auth` service. This data includes usernames, moderator status, and subscriber status.

## 2. Platform Capabilities

### 2.1 Twitch
Twitch provides rich user metadata via IRC tags and EventSub.

| Property | Platform Source | Mapping to User Doc | Notes |
|----------|-----------------|---------------------|-------|
| Username | `user-login` (IRC) / `user_login` (EventSub) | `profile.username` | Always lowercase, unique identifier. |
| Display Name | `display-name` (IRC/EventSub) | `displayName` | User-friendly casing/characters. |
| Moderator | `mod` tag (IRC) / `is_moderator` (EventSub) | `rolesMeta.twitch: ["moderator"]` | Per-channel status. |
| Subscriber | `subscriber` tag (IRC) / `is_subscriber` (EventSub) | `rolesMeta.twitch: ["subscriber"]` | Per-channel status. |
| VIP | `badges` tag (IRC) | `rolesMeta.twitch: ["vip"]` | Per-channel status. |
| Broadcaster | `badges` tag (IRC) | `rolesMeta.twitch: ["broadcaster"]` | Per-channel status. |

### 2.2 Discord
Discord provides user and member data via its API and Gateway events.

| Property | Platform Source | Mapping to User Doc | Notes |
|----------|-----------------|---------------------|-------|
| Username | `author.username` | `profile.username` | The unique handle. |
| Global Name | `author.globalName` | `displayName` (fallback) | Global display name. |
| Nickname | `member.nick` | `displayName` (preferred) | Server-specific nickname. |
| Roles | `member.roles` | `rolesMeta.discord: ["<role_id>", ...]` | List of role IDs. |
| Owner | `guild.ownerId == author.id` | `rolesMeta.discord: ["owner"]` | Server owner status. |

#### Mapping Discord Roles to Normalized Roles
Discord doesn't have a single "Moderator" flag. We will implement a configurable mapping (initially via environment variables or Firestore config) that maps Discord Role IDs or Names to normalized roles.
- Default mapping candidates: Roles named "Moderator", "Admin", "Staff".

## 3. Data Model Changes

### 3.1 `AuthUserDoc` (in `user-repo.ts`)
We will expand `AuthUserDoc` to include the `profile` object and `rolesMeta` for platform-specific raw roles.

```typescript
export interface AuthUserDoc {
  id: string; // "provider:platformUserId"
  email?: string;
  displayName?: string;
  status?: string;
  
  // New Fields
  profile?: {
    username: string;
    description?: string;
    avatarUrl?: string;
    updatedAt: string;
  };
  
  roles: string[]; // Normalized roles: ["broadcaster", "moderator", "subscriber", "vip"]
  
  rolesMeta?: {
    twitch?: string[]; // Raw badges/flags: ["moderator", "subscriber", "founder", "vip"]
    discord?: string[]; // Raw role IDs or names
  };

  // Existing state tracking...
  firstSeenAt?: string;
  lastSeenAt?: string;
  // ...
}
```

## 4. Enrichment Logic (in `enrichment.ts`)

The `enrichEvent` function will be updated to:
1. Extract platform-specific flags from `event.message.rawPlatformPayload`.
2. Map these flags to normalized roles.
3. Pass the enriched data to `repo.ensureUserOnMessage`.

### 4.1 Twitch Mapping Logic
- If `payload.isMod` -> Add `moderator` to `roles`.
- If `payload.isSubscriber` -> Add `subscriber` to `roles`.
- If `payload.badges` contains `broadcaster` -> Add `broadcaster` to `roles`.
- If `payload.badges` contains `vip` -> Add `vip` to `roles`.

### 4.2 Discord Mapping Logic
- Extract `roles` from `payload`.
- Match against a configurable "Moderator Role List".
- If matched -> Add `moderator` to `roles`.

## 5. Implementation Strategy

1. **Schema Update**: Update `AuthUserDoc` and `UserRepo.ensureUserOnMessage` signature to accept the new fields.
2. **Repository Update**: Update `FirestoreUserRepo` to persist the new fields, ensuring we merge rather than overwrite platform-specific roles if a user uses multiple platforms.
3. **Enrichment Update**: Update `enrichment.ts` to extract and normalize the data from both Twitch and Discord payloads.
4. **Configuration**: Add `DISCORD_MOD_ROLES` environment variable to support Discord moderator mapping.

## 6. Verification Plan
- **Unit Tests**: Update `enrichment.spec.ts` with mocks for Twitch and Discord events containing the new flags.
- **Integration Tests**: Verify Firestore document updates via `user-repo.test.ts`.
- **Manual Verification**: Observe `internal.user.enriched.v1` events in logs to ensure `user` object contains the new properties.
