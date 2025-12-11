# Proactive LINE User Collection Plan

## Problem Statement

Currently, `LineUser` database entries are only created when users authenticate via LIFF (LINE Front-end Framework). This creates a limitation where:

1. Clinics cannot manage AI response settings for users who haven't used LIFF yet
2. Users who only interact via the chatbot (without LIFF) are not registered in the system
3. Clinics cannot proactively manage users who have added the official account but haven't interacted

## Current State

### How LINE Users Are Currently Created

1. **LIFF Login** (`/auth/liff-login` endpoint):
   - Creates `LineUser` when user authenticates via LIFF app
   - Updates display name if changed
   - This is the primary method currently

2. **Fallback in Patient Creation**:
   - `get_current_line_user_with_clinic` dependency has a fallback that creates `LineUser` if missing
   - This is described as "shouldn't happen in normal flow"
   - Only works if user has a valid JWT token (from LIFF login)

3. **Webhook Handler**:
   - Currently only processes `message` events
   - Does NOT create `LineUser` entries
   - Only uses `line_user_id` string from webhook payload

## Research Findings: LINE SDK Capabilities

### 1. Webhook Events

LINE Messaging API sends webhook events for various user interactions:

- **`follow` event**: Triggered when a user adds the LINE Official Account as a friend
- **`unfollow` event**: Triggered when a user blocks or removes the account
- **`message` event**: Triggered when a user sends a message (currently handled)
- **`postback` event**: Triggered when user taps a button in a template message
- **`accountLink` event**: Triggered when account linking is completed

**Webhook Event Structure:**
```json
{
  "destination": "U1234567890abcdef...",
  "events": [
    {
      "type": "follow",
      "timestamp": 1234567890123,
      "source": {
        "type": "user",
        "userId": "U4af4980629..."
      },
      "replyToken": "nHuyWiB7yP5Zw52FIkcQobQuGDXCTA"
    }
  ]
}
```

### 2. Followers API (GET /v2/bot/followers/ids)

**Endpoint**: `GET https://api.line.me/v2/bot/followers/ids`

**Capabilities:**
- Returns list of user IDs who have added the official account as a friend
- Supports pagination with `start` parameter
- Returns up to 300 user IDs per request

**Requirements:**
- ⚠️ **Only available for verified or premium LINE Official Accounts**
- Requires channel access token

**Response Format:**
```json
{
  "userIds": [
    "U4af4980629...",
    "U7c8f9e0d1c..."
  ],
  "next": "U7c8f9e0d1c..."  // For pagination
}
```

### 3. User Profile API (GET /v2/bot/profile/{userId})

**Endpoint**: `GET https://api.line.me/v2/bot/profile/{userId}`

**Capabilities:**
- Retrieves user's display name and profile picture URL
- Can only be called for users who have added the official account as a friend
- Requires channel access token

**Response Format:**
```json
{
  "displayName": "User Name",
  "userId": "U4af4980629...",
  "pictureUrl": "https://profile.line-scdn.net/...",
  "statusMessage": "User status message"
}
```

**Limitations:**
- Can only retrieve profile for users who have added the account
- Profile information may be limited if user has privacy settings enabled

## Proposed Solutions

### Approach 1: Webhook Event Handling (Recommended - Phase 1)

**Description**: Handle `follow` and `message` events in the webhook handler to create `LineUser` entries proactively.

**Implementation Steps:**

1. **Extend `LINEService.extract_message_data()` or create new method**:
   - Create `extract_event_data()` method that handles multiple event types
   - Extract `line_user_id` from `follow`, `unfollow`, and `message` events
   - Return event type along with user ID

2. **Create `LineUser` service method**:
   - `get_or_create_line_user(db, line_user_id, display_name=None)`
   - Fetches user profile from LINE API if `display_name` not provided
   - Creates or updates `LineUser` entry
   - Handles race conditions (multiple webhooks for same user)

3. **Update webhook handler**:
   - Process `follow` events: Create `LineUser` immediately
   - Process `message` events: Create `LineUser` if doesn't exist (even if chat disabled)
   - Process `unfollow` events: Optionally mark user as inactive (soft delete)

4. **Handle user profile fetching**:
   - When `follow` event received, fetch user profile from LINE API
   - Store display name and optionally profile picture URL
   - Handle API failures gracefully (create user with minimal info)

**Pros:**
- ✅ Real-time user registration
- ✅ Works for all LINE Official Accounts (no premium requirement)
- ✅ No additional API calls needed for message events (user ID already in webhook)
- ✅ Minimal changes to existing code
- ✅ Works even if chat feature is disabled

**Cons:**
- ❌ Only captures users who interact (follow or send message)
- ❌ Doesn't capture existing friends who haven't interacted yet

**Code Changes Required:**
- `backend/src/services/line_service.py`: Add event extraction methods
- `backend/src/services/line_user_service.py`: New service for LINE user management
- `backend/src/api/line_webhook.py`: Handle follow/unfollow events
- `backend/src/models/line_user.py`: Potentially add `is_active` field for unfollow tracking

### Approach 2: Followers API Integration (Phase 2 - Optional)

**Description**: Periodically fetch all followers using the Followers API and create `LineUser` entries for any missing users.

**Implementation Steps:**

1. **Create background job/scheduled task**:
   - Run periodically (e.g., daily or hourly)
   - For each clinic with verified/premium account
   - Fetch all follower IDs using pagination

2. **Create/update LINE users**:
   - For each follower ID, check if `LineUser` exists
   - If not, fetch profile and create entry
   - Update display names for existing users

3. **Handle rate limits**:
   - LINE API has rate limits (check documentation)
   - Implement exponential backoff
   - Batch processing with delays

4. **Admin UI for manual trigger**:
   - Add button in admin panel to manually sync followers
   - Show sync status and last sync time
   - Display count of new users found

**Pros:**
- ✅ Captures ALL friends of the official account
- ✅ Works for users who haven't interacted yet
- ✅ Can sync existing friends retroactively
- ✅ Provides complete user list for clinic management

**Cons:**
- ❌ Only works for verified/premium accounts
- ❌ Requires additional API calls (rate limits)
- ❌ More complex implementation
- ❌ May create users who never interact (data bloat)

**Code Changes Required:**
- `backend/src/services/line_followers_sync_service.py`: New service for syncing followers
- `backend/src/api/clinic.py`: Add endpoint to trigger sync manually
- `backend/src/api/system.py` or scheduler: Periodic sync job
- Frontend: Add sync button in LineUsersPage

### Approach 3: Hybrid Approach (Recommended)

**Description**: Combine webhook event handling (Approach 1) with optional Followers API sync (Approach 2).

**Implementation Strategy:**

1. **Phase 1: Webhook Events (Immediate)**
   - Implement Approach 1 first
   - This solves the immediate problem
   - Works for all accounts

2. **Phase 2: Followers API (Optional Enhancement)**
   - Add Followers API sync as optional feature
   - Only enable for verified/premium accounts
   - Provide manual sync option in admin UI
   - Can be run on-demand or scheduled

## Recommended Implementation Plan

### Phase 1: Webhook Event Handling (Priority: High)

#### Step 1: Create LINE User Service

**File**: `backend/src/services/line_user_service.py`

```python
class LineUserService:
    @staticmethod
    def get_or_create_line_user(
        db: Session,
        line_user_id: str,
        line_service: LINEService,
        display_name: Optional[str] = None
    ) -> LineUser:
        """
        Get or create LINE user, fetching profile if needed.
        
        Thread-safe: Uses database-level locking to prevent race conditions.
        """
        # Check if exists
        line_user = db.query(LineUser).filter_by(
            line_user_id=line_user_id
        ).first()
        
        if line_user:
            # Update display name if provided and different
            if display_name and line_user.display_name != display_name:
                line_user.display_name = display_name
                db.commit()
            return line_user
        
        # Fetch profile from LINE API if display_name not provided
        if not display_name:
            try:
                profile = line_service.get_user_profile(line_user_id)
                display_name = profile.get('displayName') if profile else None
            except Exception as e:
                logger.warning(f"Failed to fetch profile for {line_user_id}: {e}")
        
        # Create new user (with database lock to prevent duplicates)
        try:
            line_user = LineUser(
                line_user_id=line_user_id,
                display_name=display_name
            )
            db.add(line_user)
            db.commit()
            db.refresh(line_user)
            logger.info(f"Created new LineUser: {line_user_id}")
        except IntegrityError:
            # Race condition: another request created it
            db.rollback()
            line_user = db.query(LineUser).filter_by(
                line_user_id=line_user_id
            ).first()
        
        return line_user
```

#### Step 2: Extend LINEService

**File**: `backend/src/services/line_service.py`

Add methods:
- `extract_event_data(payload)`: Extract event type and user ID from any event
- `get_user_profile(line_user_id)`: Fetch user profile from LINE API

#### Step 3: Update Webhook Handler

**File**: `backend/src/api/line_webhook.py`

Modify `line_webhook()` function to:
1. Extract event type from payload
2. Handle `follow` events: Create `LineUser` immediately
3. Handle `message` events: Create `LineUser` if missing (before processing message)
4. Handle `unfollow` events: Optionally mark user as inactive

#### Step 4: Update Message Processing

Ensure `LineUser` is created before processing any message, even if:
- Chat feature is disabled
- User is opted out
- AI is disabled for user

This allows clinics to manage settings for all users.

### Phase 2: Followers API Sync (Priority: Medium - Optional)

#### Step 1: Create Followers Sync Service

**File**: `backend/src/services/line_followers_sync_service.py`

```python
class LineFollowersSyncService:
    @staticmethod
    def sync_followers(
        db: Session,
        clinic: Clinic,
        line_service: LINEService
    ) -> Dict[str, Any]:
        """
        Sync all followers from LINE API.
        
        Returns:
            Dict with stats: {'total': int, 'new': int, 'updated': int, 'errors': int}
        """
        # Check if account supports followers API
        # (Would need to check account type or handle API error)
        
        # Fetch all follower IDs with pagination
        # For each ID, create/update LineUser
        # Return statistics
```

#### Step 2: Add Admin Endpoint

**File**: `backend/src/api/clinic.py`

Add endpoint:
- `POST /clinic/line-users/sync-followers`: Manually trigger sync
- `GET /clinic/line-users/sync-status`: Get last sync time and status

#### Step 3: Optional Scheduled Job

Add periodic sync job (e.g., daily) for clinics with verified/premium accounts.

## Technical Considerations

### 1. Race Conditions

When handling webhook events, multiple events for the same user might arrive simultaneously. Use database-level constraints and handle `IntegrityError` gracefully.

### 2. API Rate Limits

LINE API has rate limits. When fetching user profiles:
- Implement exponential backoff
- Cache profile data
- Batch requests when possible

### 3. Privacy and Data Collection

- Only collect data for users who have added the official account
- Respect user privacy settings
- Comply with data protection regulations
- Consider adding privacy notice

### 4. Database Schema

Consider adding fields to `LineUser` model:
- `is_active`: Boolean flag for unfollow tracking
- `followed_at`: Timestamp when user followed
- `unfollowed_at`: Timestamp when user unfollowed
- `last_interaction_at`: Timestamp of last message/webhook event
- `profile_picture_url`: Optional profile picture URL

### 5. Error Handling

- Handle LINE API failures gracefully
- Log errors for debugging
- Don't fail webhook processing if profile fetch fails
- Create user with minimal info if profile unavailable

### 6. Performance

- Use database indexes on `line_user_id`
- Consider caching user profiles
- Batch database operations when possible
- Use async/await for API calls

## Testing Strategy

### Unit Tests
- Test `LineUserService.get_or_create_line_user()` with various scenarios
- Test race condition handling
- Test profile fetching with API failures

### Integration Tests
- Test webhook handler with `follow` events
- Test webhook handler with `message` events for new users
- Test Followers API sync (if implemented)
- Test error handling and edge cases

### Manual Testing
- Send test webhook events using LINE webhook simulator
- Verify `LineUser` creation in database
- Test admin UI for Followers API sync (if implemented)

## Migration Strategy

1. **No Breaking Changes**: All changes are additive
2. **Backward Compatible**: Existing LIFF login flow continues to work
3. **Gradual Rollout**: Can enable webhook event handling first, then add Followers API sync later

## Success Metrics

- Number of `LineUser` entries created via webhook events
- Time to register new users (should be immediate)
- Clinic ability to manage AI settings for all users
- Reduction in "user not found" scenarios

## Future Enhancements

1. **User Activity Tracking**: Track when users last interacted
2. **Segmentation**: Group users by activity level
3. **Analytics**: Dashboard showing user growth and engagement
4. **Bulk Operations**: Admin UI for bulk AI enable/disable
5. **User Import/Export**: Export user list for external analysis

## References

- [LINE Messaging API Webhook Events](https://developers.line.biz/en/reference/messaging-api/#webhook-event-object)
- [LINE Messaging API Get Follower IDs](https://developers.line.biz/en/reference/messaging-api/#get-follower-ids)
- [LINE Messaging API Get User Profile](https://developers.line.biz/en/reference/messaging-api/#get-profile)
- [LINE Official Account Types](https://developers.line.biz/en/docs/messaging-api/account-type/)

