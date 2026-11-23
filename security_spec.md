# Security Specification & Payload-First TDD

## 1. Core Data Invariants
1. **Strict Hub-and-Spoke Client Isolation**: A regular authenticated client (`uid`) may only read and write their own `/users/{uid}` profile, their own `/threads/{uid}` header, and messages inside `/threads/{uid}/messages`. Clients can NEVER list `/users`, list `/threads`, or access another client's thread/messages.
2. **No Self-Assigned Admin Privileges**: Admin access is determined strictly by bootstrapped verified email (`jesank501@gmail.com` with `email_verified == true`) or membership in `/admins/{uid}`. Clients cannot write to `/admins` or inject `role`/`isAdmin` fields into `/users` or `/threads`.
3. **Atomic Thread Sync**: Creating a message in `/threads/{threadId}/messages/{messageId}` MUST atomically update `/threads/{threadId}` (`updatedAt == request.time`) in the same write batch (`getAfter`).
4. **Broadcast Integrity**: Only verified admins may create, update, or delete `/broadcasts/{broadcastId}`. Authenticated clients may read broadcasts, keeping O(1) broadcast delivery for 10k–100k+ users.
5. **Strict Key & Size Enforcement**: Every entity uses `hasAll` + `hasOnly` on create, `affectedKeys().hasOnly(...)` on update, strict `.size()` limits on all strings, and `request.time` validation for all timestamps.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with PERMISSION_DENIED)
1. **Cross-Client Thread Read**: Client A attempts `get(/threads/clientB)`.
2. **Thread Directory Scraping**: Client A attempts `list(/threads)` or `list(/users)` to see other clients.
3. **Cross-Client Message Injection**: Client A attempts `create(/threads/clientB/messages/msg1)` spoofing `senderId: clientA`.
4. **Sender Role Spoofing**: Client A sends a message in their own thread with `senderRole: "admin"`.
5. **Shadow Field Injection on Profile**: Client A creates `/users/clientA` with ghost field `isAdmin: true`.
6. **Privilege Escalation on Admins**: Client A attempts `create(/admins/clientA)`.
7. **Unauthorized Broadcast**: Client A attempts `create(/broadcasts/b1)` pretending to be the page owner.
8. **Settings Tampering**: Client A attempts `update(/settings/public)` to hijack the page name.
9. **Unverified Email Spoofing**: Attacker with `email: "jesank501@gmail.com"` and `email_verified: false` attempts admin `list(/threads)`.
10. **Denial-of-Wallet Oversized Message**: Client A sends a 10,000-character message (`text.size() > 2000`) or a 500-char document ID (`!isValidId(id)`).
11. **Timestamp Backdating**: Client A creates a message with `createdAt` set to a past client timestamp instead of `request.time`.
12. **Orphaned Message Write (Bypassing Thread Sync)**: Client A creates `/threads/clientA/messages/msg2` without atomically updating `/threads/clientA.updatedAt` in the same batch.
