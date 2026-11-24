# Taygos APIs Firestore Security Specification

## 1. Data Invariants
1. **Strict Owner Isolation**: Every user's vault profile (`/users/{userId}`), access keys (`/users/{userId}/accessKeys/{keyId}`), upstream provider configs (`/users/{userId}/providers/{providerId}`), and routing configuration (`/users/{userId}/settings/{settingId}`) may only be read or mutated by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`).
2. **Master Gate Parent Integrity**: No `accessKeys`, `providers`, or `settings` document may be created or updated unless the parent `/users/{userId}` document exists and its `ownerId` matches `request.auth.uid`.
3. **Immutable Ownership, IDs & Creation Timestamps**: `ownerId`, `id`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must strictly match server `request.time` on writes.
4. **Zero-Trust Schema & Bounded Payloads**: Every write passes strict `keys().hasAll(...)` + `keys().hasOnly(...)`, explicit type checks, enum validation, bounded string/array `.size()` limits, and `isValidId()` regex validation (`^[a-zA-Z0-9_\-]+$`).
5. **No Blanket List or PII Exposure**: `/users` listing is disabled (`allow list: if false`), no PII fields (`email`, `phone`, `address`) are stored in documents, and subcollection `allow list` rules explicitly enforce `existing().ownerId == request.auth.uid` without `get()`/`exists()` lookups.

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read or write on `/users/uid1/accessKeys/key1`.
2. Verified user `uid2` attempting `get` or `list` on `/users/uid1/accessKeys`.
3. Unverified email user (`email_verified: false`) attempting `create` on `/users/uid1`.
4. Shadow field injection (`isAdmin: true`) during `create` on `/users/uid1/accessKeys/key1`.
5. Identity spoofing (`ownerId: "victim_uid"`) inside payload while authenticated as `"attacker_uid"`.
6. Orphaned subcollection write under `/users/uid1/providers/prov1` when `/users/uid1` parent does not exist.
7. Path ID poisoning (`keyId` > 128 chars or containing invalid characters) on `create`/`get`.
8. Client-spoofed timestamp (`createdAt` != `request.time`) during document creation.
9. Immortal field mutation (`ownerId` or `createdAt` altered) during an `update` on `/users/uid1/providers/prov1`.
10. Unlisted key mutation (`publicKey` altered in an `update` action only allowing metadata/status/secret rotation).
11. Unbounded string / array poisoning (`apiKey` > 512 chars or `scopes.size() > 8` or non-string element in `scopes[0]`).
12. Listing `/users` collection or reading `/test/connection` (blocked by default-deny catch-all).
