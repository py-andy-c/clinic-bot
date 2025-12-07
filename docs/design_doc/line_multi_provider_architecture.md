# LINE Multi-Provider Architecture and Account Linking Design

## Overview

Comprehensive design document for LINE service providers managing multiple LINE Official Accounts across different providers. This document covers:

- **Multi-provider architecture** - Supporting clinics with their own LINE providers
- **User ID mapping** - Handling different user IDs from different providers
- **Account linking** - Connecting LIFF users with Messaging API users via profile matching
- **Duplicate prevention** - Ensuring data integrity across all edge cases
- **Migration strategy** - Gradual migration from single `line_user_id` to dual ID fields

Based on LINE's official documentation, industry best practices, and real-world constraints.

### Key Reality

**Most clinics (80-90%) create their own providers** under their clinic name and link their Official Account to it. As a service provider, you must:

1. **Support multi-provider architecture** - Most clinics have their own providers
2. **Integrate with existing providers** - Accounts cannot be transferred between providers
3. **Handle user ID mapping** - Same user has different IDs across different providers
4. **Work with clinic-owned accounts** - Clinics maintain control and ownership

---

## Key Concepts

### Provider
- Container for channels and services
- **Critical Constraint**: Channels **cannot be moved** between providers once created

### Channel
- Messaging API channel (for chatbot/messaging)
- LINE Login channel (for authentication and LIFF apps)

### LIFF App
- Web applications that run within LINE
- Must be associated with a LINE Login channel

### User ID
- LINE assigns a unique user ID **per provider**
- Same user has **same user ID** across all channels under the same provider
- Same user has **different user IDs** across different providers

---

## Recommended Architecture

### Shared LIFF App Strategy (Both Cases)

**For both single provider and multi-provider cases, use a shared LIFF app under your provider:**

```
Your Service Provider System
├── Your Provider
│   ├── Shared LINE Login Channel (one for all clinics)
│   └── Shared LIFF App (uses clinic_token in URL)
│
├── Single Provider Case (Rare - 10-20%)
│   └── Messaging API Channels under Your Provider
│       ├── Messaging API Channel 1 → Clinic A
│       └── Messaging API Channel 2 → Clinic B
│
└── Multi-Provider Case (Common - 80-90%)
    └── Messaging API Channels under Clinic's Providers
        ├── Clinic 3's Provider → Messaging API Channel → Clinic 3
        ├── Clinic 4's Provider → Messaging API Channel → Clinic 4
        └── Clinic 5's Provider → Messaging API Channel → Clinic 5
```

**Benefits**:
- ✅ Single codebase to maintain (shared LIFF app)
- ✅ Cost efficient (one LINE Login channel, one LIFF app)
- ✅ Consistent user experience across all clinics
- ✅ Works for both single and multi-provider cases

**Channel Setup**:
- **LINE Login Channel**: One shared channel under your provider (for all clinics)
- **LIFF App**: One shared app associated with your LINE Login channel
- **Messaging API Channels**: One per Official Account (under clinic's provider or your provider)

---

## User ID Mapping Solution

### The Problem

When Messaging API is under clinic's provider but LIFF is under your provider:
- **LIFF authentication**: User ID from your provider = `U_your_provider_123`
- **Messaging API webhook**: User ID from clinic's provider = `U_clinic_provider_456`
- These are **different user IDs for the same person**

### Solution: Store Both User IDs

**Database Schema**:
```sql
line_users
├── id
├── clinic_id
├── messaging_api_user_id (from clinic's provider - used for sending messages)
├── liff_user_id (from your provider - used for LIFF authentication)
├── display_name
├── picture_url
└── ... (other fields)
```

**Key Design**:
- `messaging_api_user_id`: Primary identifier (used for sending messages via Messaging API)
- `liff_user_id`: Secondary identifier (used for LIFF authentication)
- `display_name`: Single field updated from both LIFF and Messaging API (latest value)
- `picture_url`: Single field updated from both LIFF and Messaging API (latest value)
- Both IDs nullable initially, populated as user interacts
- Unique constraints: `(clinic_id, messaging_api_user_id)` and `(clinic_id, liff_user_id)`

### Matching Strategy

**When user logs in via LIFF**:
1. Get `liff_user_id` from LIFF authentication (your provider)
2. Fetch latest LIFF profile: `liff.getProfile()` → `display_name`, `picture_url`
3. **Check for existing LineUser** (in order):
   - **First**: Query by `(clinic_id, liff_user_id)` - if found, update profile and return
   - **Second**: Query by `(clinic_id, messaging_api_user_id)` - if we have this ID from previous interactions (rare - user followed first)
   - **Third**: Query by `(clinic_id, display_name, picture_url)` - profile matching fallback (both must match exactly, both non-NULL)
4. If found: Update `liff_user_id` if missing, update profile to latest LIFF values
5. If not found: Create new `LineUser` with `liff_user_id` (will link later when webhook arrives)
6. **Duplicate prevention**: Database unique constraint on `(clinic_id, liff_user_id)` prevents duplicates

**When webhook arrives (follow event or regular message)**:
1. Get `messaging_api_user_id` from webhook (clinic's provider)
2. **Check for existing LineUser** (in order):
   - **First**: Query by `(clinic_id, messaging_api_user_id)` - if found, update profile and return
   - **Second**: Query by `(clinic_id, liff_user_id)` - if we have this ID from previous LIFF login (rare - user logged in via LIFF first)
   - **Third**: Fetch Messaging API profile and query by `(clinic_id, display_name, picture_url)` - profile matching fallback (both must match exactly, both non-NULL)
3. If found: Update `messaging_api_user_id` if missing, update profile to Messaging API values
4. If not found: Create new `LineUser` with `messaging_api_user_id` (will link later when LIFF login happens)
5. **Duplicate prevention**: Database unique constraint on `(clinic_id, messaging_api_user_id)` prevents duplicates

**When sending messages**:
- Always use `messaging_api_user_id` (this is the one valid for Messaging API channel)

### Account Linking Flow

**Problem**: When user creates appointment via LIFF but doesn't have `messaging_api_user_id`, we can't send confirmation messages.

**Solution**: Use `liff.sendMessages()` to trigger webhook and capture `messaging_api_user_id`.

**Flow**:

1. **User creates appointment via LIFF**:
   - Check if `messaging_api_user_id` exists
   - If yes: Send confirmation immediately
   - If no: Proceed to account linking

2. **Before sending "連結帳號" message**:
   - Get LineUser from JWT token context (user created appointment, so LineUser exists with `liff_user_id`)
   - Fetch latest LIFF profile: `liff.getProfile()` → `liff_display_name`, `liff_picture_url`
   - Update `LineUser.display_name` and `LineUser.picture_url` with LIFF values (latest from LIFF side)
   - **Critical**: This update must happen atomically before sending message, so profile matching will work when webhook arrives

3. **Send "連結帳號" message**:
   - Check LIFF context: `liff.getContext()` → must be `"utou"`, `"room"`, or `"group"` (chat context)
   - If valid context: Call `liff.sendMessages([{type: "text", text: "連結帳號"}])`
   - If invalid context or permission denied: Show prompt page (see below)

4. **When webhook arrives** (for "連結帳號" message):
   - Extract `messaging_api_user_id` from webhook `source.userId`
   - Get `clinic_id` from webhook `destination` (Official Account user ID)
   - Fetch Messaging API profile: `get_user_profile(messaging_api_user_id)` → `messaging_display_name`, `messaging_picture_url`
   - **CRITICAL: Use profile matching to find LineUser**:
     - Query: `LineUser` where `clinic_id = X` AND `display_name = messaging_display_name` AND `picture_url = messaging_picture_url`
     - **Matching rules**: Both `display_name` AND `picture_url` must match exactly (both non-NULL)
     - If found: This is the LineUser we're linking - update `messaging_api_user_id` and profile
   - **If profile matching finds multiple matches**:
     - Don't link automatically - log error and require manual intervention
     - This prevents wrong linking when multiple users have same profile
   - **If profile matching finds no match**:
     - Check if LineUser with `messaging_api_user_id` already exists (user sent message before)
     - If exists: Update `liff_user_id` if missing (reverse linking - user logged in via LIFF after sending message)
     - If not exists: Cannot match - log error and skip linking (profile may have changed or fetch failed)
     - **No retry prompt**: Don't show error or retry prompt to user - they can't fix profile matching issues. User will naturally retry when they interact with system again (e.g., make another appointment)
   - **After successful match**: Update `display_name` and `picture_url` to Messaging API values (source of truth for notifications)
   - **Note**: During account linking triggered by appointment creation, LineUser MUST exist (user created appointment via LIFF, LineUser is in JWT token context). If not found, it's an error condition.
   - **Idempotency**: If `messaging_api_user_id` is already set on LineUser, skip linking (already linked)

5. **Send confirmation**:
   - After successful linking, send appointment confirmation message
   - Use `messaging_api_user_id` for sending

**Special Message Handling**:

- Webhook recognizes "連結帳號" message (exact match)
- Skip AI processing for this message
- Respond with: "帳號連結成功，您將收到預約通知"
- Perform ID matching and send pending notifications

**`liff.sendMessages()` Constraints**:

- **Context requirement**: Only works when LIFF app is opened from a chat (one-on-one, group, or multi-person)
  - Check context: `liff.getContext().type` must be `"utou"`, `"room"`, or `"group"`
  - Not available in external browser or if opened via link/QR code outside chat
- **Permission requirement**: User must grant `chat_message.write` scope
  - If denied, returns `403` error: "user doesn't grant required permissions yet"
  - First-time users may see permission prompt
- **Message visibility**: Message sent via `liff.sendMessages()` is visible to user in chat
  - Use neutral/system message: "連結帳號" (user will see this)
- **Webhook trigger**: Sending message to official account triggers webhook event
  - Webhook contains `source.userId` = `messaging_api_user_id` (from clinic's provider)
  - Can match with `liff_user_id` via profile attributes

**Permission Denied Fallback**:

- If `liff.sendMessages()` fails due to missing `chat_message.write` permission:
  - Show page explaining account linking is needed to receive notifications
  - Provide copy button for "連結帳號" message
  - User can manually send message to link account
  - Note: Initial confirmation attempt will fail, but future notifications will work once linked

**When to Prompt User**:

- **Only when actually needed**: Show account linking prompt only when user creates appointment and `messaging_api_user_id` is missing
- **Avoid proactive prompts**: Don't prompt during LIFF login or other actions - only when appointment creation requires it
- **Proactive capture minimizes prompts**: Follow events capture `messaging_api_user_id` proactively, so most users won't need linking

**Proactive Capture**:

- **Follow events**: When user follows Official Account, webhook receives `follow` event
- Capture `messaging_api_user_id` from `source.userId` in webhook
- Create `LineUser` with `messaging_api_user_id` proactively
- This minimizes cases where `messaging_api_user_id` is missing at appointment time

**Profile Updates**:

- **On LIFF login**: Update `display_name` and `picture_url` from LIFF profile
- **On webhook message**: Update `display_name` and `picture_url` from Messaging API profile (if fetch succeeds)
- **During account linking**: Update from LIFF before linking, fetch from Messaging API when webhook arrives, compare for matching

### Edge Cases and Duplicate Prevention

**Critical Requirement**: Never create duplicate LineUser records for the same user under the same clinic.

**Database Constraints**:
- Unique constraint: `(clinic_id, messaging_api_user_id)` - prevents duplicates by messaging API ID
- Unique constraint: `(clinic_id, liff_user_id)` - prevents duplicates by LIFF ID
- Both constraints allow NULL values (PostgreSQL behavior)

**Matching Strategy (Order of Operations)**:

When creating or updating LineUser, always check in this order:

1. **Check by ID (most reliable)**:
   - If `messaging_api_user_id` provided: Query by `(clinic_id, messaging_api_user_id)`
   - If `liff_user_id` provided: Query by `(clinic_id, liff_user_id)`
   - If found: Update missing ID and profile, return existing record

2. **Check by profile matching (fallback)**:
   - Only if ID check fails AND we have profile data
   - Query by `(clinic_id, display_name, picture_url)` where both match exactly
   - **Matching rules**: Both `display_name` AND `picture_url` must match exactly (both non-NULL)
   - If found: Update missing ID and profile, return existing record
   - **If multiple matches found**: Don't link automatically - log error and require manual intervention
   - **Warning**: Profile matching is not 100% reliable (users can change profiles, multiple users can have same profile)

3. **Create new record**:
   - Only if both ID and profile checks fail
   - Use database unique constraints as final safeguard

**Edge Cases**:

1. **User only uses LIFF** (never sends messages):
   - LineUser has `liff_user_id` but no `messaging_api_user_id`
   - Cannot send messages until account linking succeeds
   - Use `liff.sendMessages()` to trigger webhook and capture `messaging_api_user_id`
   - **Duplicate prevention**: When webhook arrives, use profile matching to find LineUser by `(clinic_id, display_name, picture_url)` where both match exactly

2. **User only sends messages** (never uses LIFF):
   - LineUser has `messaging_api_user_id` but no `liff_user_id`
   - Follow event captures `messaging_api_user_id` proactively
   - Cannot authenticate via LIFF until LIFF login happens
   - **Duplicate prevention**: When LIFF login happens, check by `messaging_api_user_id` first (from profile matching), then by profile matching

3. **Profile matching fails** (different names/pictures or profile fetch fails):
   - If profile fetch fails: Cannot match → log error and skip linking
   - If profiles don't match: Cannot match → log error and skip linking (exact match required for both `display_name` and `picture_url`)
   - If either `display_name` or `picture_url` is NULL: Cannot match by profile → log error and skip linking
   - **No retry prompt**: Don't show error or retry prompt - user can't fix profile matching issues. User will naturally retry when they interact with system again
   - **Duplicate prevention**: If profile matching fails, we may create separate records temporarily, but database constraints prevent true duplicates

4. **Profile matching collision** (multiple users with same profile):
   - **Scenario**: Multiple LineUser records have same `display_name` and `picture_url`
   - **Prevention**: If profile matching query returns multiple results, don't link automatically
   - **Action**: Log error, require manual intervention to link correct records
   - **Safety**: Prevents wrong linking when multiple users have identical profiles

5. **Profile changes between updating from LIFF and webhook arriving**:
   - **Scenario**: User updates profile after we update LineUser from LIFF but before webhook arrives
   - **Prevention**: We update LineUser profile from LIFF right before sending "連結帳號" message (atomic operation)
   - When webhook arrives, we fetch latest Messaging API profile and compare with LineUser profile
   - **If profile changed**: Matching will fail - log error and skip linking (no retry prompt, user will naturally retry on next interaction)
   - **Timing window**: Small window between update and webhook (usually < 1 second)
   - **Duplicate prevention**: Database unique constraints prevent duplicates even if profile matching fails

6. **Race conditions** (multiple requests simultaneously):
   - **Scenario**: LIFF login and webhook arrive at same time
   - **Prevention**: Use database unique constraints + IntegrityError handling
   - If IntegrityError occurs: Rollback and re-query for existing record
   - **Example**: `get_or_create_line_user()` already handles this with try/except IntegrityError

7. **Account linking via "連結帳號" message**:
   - **Scenario**: User sends "連結帳號" message, webhook arrives with `messaging_api_user_id`
   - **Prevention**: Use profile matching - query by `(clinic_id, display_name, picture_url)` where both match exactly (both non-NULL)
   - **Critical**: Must update existing LineUser record, never create new one
   - **Profile matching rules**: Both `display_name` AND `picture_url` must match exactly
   - **Multiple matches**: If profile matching finds multiple LineUser records, don't link automatically - log error and require manual intervention

8. **Manual "連結帳號" message** (user sends manually, not via liff.sendMessages()):
   - **Scenario**: User sends "連結帳號" message manually (not triggered by appointment creation)
   - **Prevention**: Use profile matching - query by `(clinic_id, display_name, picture_url)` where both match exactly
   - **If LineUser with liff_user_id exists**: Update `messaging_api_user_id` (normal linking)
   - **If LineUser doesn't exist**: Create new LineUser with `messaging_api_user_id` only (will link later when LIFF login happens)
   - **Note**: This is consistent with follow event handling

9. **Follow event when LineUser with liff_user_id exists**:
   - **Scenario**: User already logged in via LIFF, then follows Official Account
   - **Prevention**: Use profile matching - query by `(clinic_id, display_name, picture_url)` where both match exactly
   - **Note**: We don't have `liff_user_id` in follow event context (only `messaging_api_user_id`), so profile matching is the primary method

10. **LIFF login when LineUser with messaging_api_user_id exists**:
   - **Scenario**: User followed account first (has `messaging_api_user_id`), then logs in via LIFF
   - **Prevention**: Use profile matching - query by `(clinic_id, display_name, picture_url)` where both match exactly
   - **Note**: We don't have `messaging_api_user_id` in LIFF context (only `liff_user_id`), so profile matching is the primary method

11. **Profile privacy settings**:
   - **Scenario**: User has private profile, profile fetch fails
   - **Prevention**: Cannot match by profile, but database unique constraints prevent duplicates by ID
   - **Fallback**: If both IDs available later, can link via ID matching

12. **Unfollow/refollow behavior**:
    - **Scenario**: User unfollows Official Account, then follows again
    - **Prevention**: Reuse existing LineUser (don't delete on unfollow)
    - **Action**: Update `messaging_api_user_id` if it changed (shouldn't, but handle gracefully)
    - **Note**: Historical data (patients, appointments) should be preserved

13. **Orphaned LineUser records**:
    - **Scenario**: Two LineUser records exist (one with `liff_user_id`, one with `messaging_api_user_id`) that haven't been linked
    - **Prevention**: Database constraints prevent duplicates, but orphaned records may exist temporarily
    - **Action**: Provide manual admin tool to review and merge orphaned records (don't auto-merge - safety first)
    - **Detection**: Query for LineUser records with only one ID populated, check if they can be linked via profile matching

14. **Single provider case** (both IDs are same):
    - Both fields will have same value
    - No special handling needed
    - Account linking still works but is simpler
    - **Duplicate prevention**: Database unique constraints ensure no duplicates even if both IDs are same

**Implementation Requirements**:

1. **Always check by ID first** (most reliable):
   ```python
   # If we have messaging_api_user_id, check by it
   if messaging_api_user_id:
       line_user = db.query(LineUser).filter_by(
           clinic_id=clinic_id,
           messaging_api_user_id=messaging_api_user_id
       ).first()
       if line_user:
           # Update liff_user_id if missing
           return line_user
   
   # If we have liff_user_id, check by it
   if liff_user_id:
       line_user = db.query(LineUser).filter_by(
           clinic_id=clinic_id,
           liff_user_id=liff_user_id
       ).first()
       if line_user:
           # Update messaging_api_user_id if missing
           return line_user
   ```

2. **Then check by profile matching** (fallback):
   ```python
   # Only if ID check fails AND we have profile data
   # Both display_name AND picture_url must be non-NULL for matching
   if display_name and picture_url:
       line_user = db.query(LineUser).filter_by(
           clinic_id=clinic_id,
           display_name=display_name,
           picture_url=picture_url
       ).first()
       if line_user:
           # Update missing ID
           return line_user
       # If multiple matches found, don't link automatically (safety)
       # Log error and require manual intervention
   ```

3. **Use database constraints as final safeguard**:
   - Unique constraints on `(clinic_id, messaging_api_user_id)` and `(clinic_id, liff_user_id)`
   - Handle IntegrityError gracefully (race condition)
   - Re-query for existing record if IntegrityError occurs

4. **Transaction safety**:
   - Use database transactions for all create/update operations
   - Handle IntegrityError with rollback and re-query
   - Never create record if IntegrityError suggests it already exists

**Key Principles**:

1. **ID matching is primary**: Always check by ID first (most reliable)
2. **Profile matching is fallback**: Only use when ID matching fails
3. **Database constraints are final safeguard**: Unique constraints prevent duplicates even if logic fails
4. **Always update, never duplicate**: If record exists, update it; never create duplicate
5. **Handle race conditions**: Use IntegrityError handling for concurrent requests

**Critical Implementation Checklist**:

- ✅ **Always check by ID first**: Query by `(clinic_id, messaging_api_user_id)` or `(clinic_id, liff_user_id)` before creating
- ✅ **Then check by profile**: Only if ID check fails, query by `(clinic_id, display_name, picture_url)`
- ✅ **Use database constraints**: Unique constraints on both ID fields prevent duplicates at database level
- ✅ **Handle IntegrityError**: If constraint violation occurs, rollback and re-query for existing record
- ✅ **Account linking is UPDATE, not CREATE**: When linking accounts, always update existing LineUser, never create new one
- ✅ **Transaction safety**: Use database transactions for all create/update operations
- ✅ **Race condition handling**: Multiple simultaneous requests must not create duplicates (IntegrityError handling)

---

## Migration Strategy for Existing `line_user_id` Field

### Current State

The system currently uses a single `line_user_id` field in the `LineUser` model, assuming both Messaging API and LIFF use the same user ID (single provider case).

### Migration Approach: Deprecate Gradually

**Strategy**: Keep `line_user_id` as a deprecated field during migration, then remove it after all code is updated.

### Migration Phases

**Phase 1: Add New Fields**
- Add `messaging_api_user_id` and `liff_user_id` columns
- Migrate existing data: Copy `line_user_id` to both new fields
- Make `line_user_id` nullable (for deprecation)
- Add indexes and unique constraints on new fields

**Phase 2: Update Code Gradually**
- **Webhook handling**: Use `messaging_api_user_id` for queries and creation
- **LIFF authentication**: Use `liff_user_id` for queries and JWT tokens
- **Message sending**: Use `messaging_api_user_id` (critical - this is what works with Messaging API)
- **API responses**: Use `liff_user_id` for frontend compatibility
- Keep `line_user_id` populated for backward compatibility during transition

**Phase 3: Remove Deprecated Field**
- After all code is migrated and tested
- Remove `line_user_id` column and all references
- Update any remaining queries

### Field Usage Guide

| Context | Use This Field | Reason |
|---------|---------------|--------|
| **LIFF authentication** | `liff_user_id` | User ID from your provider's LINE Login channel |
| **Webhook events** | `messaging_api_user_id` | User ID from clinic's provider's Messaging API channel |
| **Sending messages** | `messaging_api_user_id` | Required for Messaging API to work |
| **JWT token payload** | `liff_user_id` | JWT is created during LIFF login |
| **Querying LineUser (LIFF)** | `liff_user_id` | Match user from LIFF authentication |
| **Querying LineUser (webhook)** | `messaging_api_user_id` | Match user from webhook events |

### Code Changes Required

**Model Updates**:
- Add `messaging_api_user_id: Mapped[Optional[str]]`
- Add `liff_user_id: Mapped[Optional[str]]`
- Make `line_user_id: Mapped[Optional[str]]` (deprecated, nullable)

**Service Method Updates**:
- `LineUserService.get_or_create_line_user()`: Add `user_id_type` parameter
- Update queries to use appropriate field based on context

**Query Updates** (~75+ locations):
- LIFF authentication: `LineUser.liff_user_id == liff_user_id`
- Webhook handling: `LineUser.messaging_api_user_id == messaging_api_user_id`
- Message sending: `line_service.send_text_message(patient.line_user.messaging_api_user_id, ...)`
- JWT handling: Use `liff_user_id` in token payload

**Benefits of Gradual Migration**:
- ✅ Zero-downtime migration
- ✅ Backward compatible during transition
- ✅ Can test incrementally
- ✅ Easier rollback if issues arise

---

## Security Best Practices

### Channel Access Tokens
- ✅ Use short-lived tokens (30 days) with automatic renewal
- ✅ Never share tokens between channels
- ✅ Implement token rotation before expiration
- ✅ Store tokens securely (encrypted, not in code)

### Webhook Security
- ✅ Verify webhook signatures for all incoming requests
- ✅ Use unique webhook URLs per channel (or include channel ID in handler)
- ✅ Validate channel ID in webhook payload for correct routing

### LIFF Security
- ✅ Use HTTPS for all LIFF endpoints
- ✅ Validate clinic context from URL parameters (`clinic_token`)
- ✅ Verify JWT tokens contain correct clinic context
- ✅ Implement clinic isolation checks (URL clinic_token vs JWT clinic_token)

---

## Compliance

### Provider Page
- Required to link user data across services under same provider
- Must include privacy policy URL
- Informs users that multiple services are provided by same provider

### User Data Linking
- Can link user data across channels under **same provider** (with user consent)
- Cannot link user data across **different providers** (different user IDs)
- Must publish Provider Page and comply with LINE's terms

---

## Operational Best Practices

### Administrative Roles
- ✅ Assign multiple administrators per provider and channel
- ✅ Avoid single points of failure
- ✅ Use mailing list email (not personal email) for notifications

### Monitoring
- ✅ Monitor API usage per channel (rate limits, costs)
- ✅ Track webhook delivery success rates
- ✅ Alert on token expiration (before it happens)
- ✅ Monitor error rates per channel

### Documentation
- ✅ Document channel-to-clinic mapping
- ✅ Maintain list of all channels and their purposes
- ✅ Document LIFF app URLs and associations

---

## Summary

### Industry Reality

**Most Common Pattern** (80-90% of cases):
- Clinic creates their own provider under clinic name
- Clinic links Official Account to their own provider
- Service provider integrates with clinic's existing provider
- Service provider must support multi-provider architecture

**Less Common Pattern** (10-20% of cases):
- Clinic creates new Official Account under service provider's provider
- Service provider manages everything under their provider
- Better user ID consistency, but requires clinic to start fresh

### Recommended Approach

**Multi-Provider Architecture with Shared LIFF**:
- **Shared LIFF app** under your provider (for all clinics)
- **Shared LINE Login channel** under your provider (for all clinics)
- **Messaging API channels** under clinic's provider (most cases) or your provider (new clinics)
- **User ID mapping** via `messaging_api_user_id` and `liff_user_id` fields
- **Profile-based matching** for linking user IDs (display_name + picture_url)
- **Account linking** via `liff.sendMessages()` to trigger webhook and capture `messaging_api_user_id`
- **Proactive capture** from follow events to minimize missing `messaging_api_user_id` cases
- **No queue implementation** - acceptable to lose some messages for simplicity

### Key Takeaways

1. **Reality**: Most clinics have their own providers - this is standard
2. **Requirement**: Multi-provider support is essential, not optional
3. **Architecture**: Shared LIFF app under your provider works for both cases
4. **Solution**: Store both user IDs and match via profile attributes
5. **Constraint**: Accounts cannot be transferred between providers (permanent limitation)
