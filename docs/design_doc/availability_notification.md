# Availability Notification / Waitlist Feature

## Overview

Allow patients to sign up for notifications when appointment slots become available in their preferred time windows. This helps patients secure appointments when no suitable slots are currently available.

## User Experience

### Entry Points

**Always available** (Step 3 - Select Date & Time):
- **Always show notification button** regardless of slot availability
- Button text: "設定可用時段通知" (Set Availability Notification)
- Placement: Below time slots section (if slots exist) or in place of "no slots" message
- Rationale: Users may want different time windows even if slots are available

### Notification Signup Flow

1. User clicks notification button
2. Modal/sheet appears with:
   - **Date selection**: 
     - Default: Currently selected date (if any)
     - User can select multiple dates (date range picker or multi-select)
     - Shows calendar with checkboxes for date selection
     - Selected dates highlighted
   - Appointment type (pre-filled, read-only)
   - Practitioner preference (pre-filled: "不指定" or selected practitioner)
   - Time window selection (checkboxes, applies to all selected dates):
     - ☐ 上午 (08:00-12:00)
     - ☐ 下午 (12:00-18:00)
     - ☐ 晚上 (18:00-22:00)
   - Patient selection (if multiple patients)
   - Summary: "將為 {N} 個日期設定通知" (Will set notifications for N dates)
   - "確認設定" button

3. After confirmation:
   - Creates one notification record per selected date
   - Show success message: "已為 {N} 個日期設定通知，當有可用時段時會立即通知您"
   - Return to calendar view
   - Show indicator badges on all dates with notifications: "已設定通知"

### Notification Experience

When slots become available:
1. User receives LINE push notification:
   ```
   【可用時段通知】
   您關注的 2024/11/15 上午時段 現在有可用預約！
   
   立即預約 → [Button opens LIFF with mode=book]
   ```

2. User clicks notification → Opens LIFF app in booking mode
3. System auto-fills:
   - Date: The date with availability
   - Time window: Filters to show only slots in the requested window(s)
   - Appointment type: Pre-selected
   - Practitioner: Pre-selected (if was specified)

4. User completes booking → Notification automatically removed

### Managing Notifications

- In Step 3 calendar view: Dates with active notifications show badge
- In settings/patient management: Add "我的通知設定" section
  - List all active notifications
  - Allow cancellation
  - Show expiration date

## Edge Cases

### Notification Conflicts

1. **User already has appointment for that date/time**:
   - Don't send notification
   - Auto-cancel notification when appointment is created

2. **User already has notification for same date/window**:
   - When creating notification, check for duplicates
   - If duplicate exists: Show message "您已設定此日期的通知，是否要更新設定？"
   - Options: "更新設定" (replace existing) or "取消"
   - If updating: Replace existing notification with new time windows

3. **Multiple users want same slot**:
   - Send notification to ALL waitlisted users
   - First to book gets the slot
   - Others receive "時段已被預約" if they try to book after it's taken

4. **Slot becomes available but user doesn't respond**:
   - Notification remains active
   - User can still book if slot remains available
   - Notification expires after date passes

### Notification Expiration

- **Date-based expiration**: Notification expires at end of the requested date (23:59:59)
- **Auto-cleanup**: Background job removes expired notifications daily
- **User-initiated cancellation**: User can cancel anytime

### Appointment Type / Practitioner Changes

- If appointment type is deleted: Cancel all related notifications
- If practitioner is removed: Cancel notifications for that practitioner, keep "不指定" notifications
- If practitioner availability changes: Re-check and send notifications if slots become available

### Multiple Time Windows

- User can select multiple windows (e.g., 上午 + 下午)
- Notification sent when ANY selected window has availability
- Notification includes which window(s) have slots

### Notification Rate Limiting

- **Per date limit**: Max 1 notification per date per user (to avoid spam)
- **Cooldown**: If user receives notification, don't send another for same date/window for 1 hour (even if more slots open)
- **Daily limit**: Max 3 notifications per user per day

## Technical Design

### Database Schema

```python
class AvailabilityNotification(Base):
    __tablename__ = "availability_notifications"
    
    id = Column(Integer, primary_key=True)
    line_user_id = Column(Integer, ForeignKey("line_users.id"), nullable=False)
    clinic_id = Column(Integer, ForeignKey("clinics.id"), nullable=False)
    patient_id = Column(Integer, ForeignKey("patients.id"), nullable=False)
    appointment_type_id = Column(Integer, ForeignKey("appointment_types.id"), nullable=False)
    practitioner_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # None = "不指定"
    date = Column(Date, nullable=False)
    time_windows = Column(JSON, nullable=False)  # ["morning", "afternoon", "evening"]
    status = Column(String, default="active")  # "active", "fulfilled", "expired", "cancelled"
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)  # End of requested date
    last_notified_at = Column(DateTime, nullable=True)  # For rate limiting
    
    # Indexes
    __table_args__ = (
        Index("idx_notification_lookup", "clinic_id", "appointment_type_id", "date", "status"),
        Index("idx_notification_user", "line_user_id", "status"),
    )
```

### Time Window Definitions

```python
TIME_WINDOWS = {
    "morning": {"start": "08:00", "end": "12:00", "display": "上午"},
    "afternoon": {"start": "12:00", "end": "18:00", "display": "下午"},
    "evening": {"start": "18:00", "end": "22:00", "display": "晚上"},
}
```

### API Endpoints

#### POST /liff/availability-notifications
Create notification request(s). Supports single date or multiple dates.

**Request (single date):**
```json
{
  "patient_id": 123,
  "appointment_type_id": 1,
  "practitioner_id": 456,  // null for "不指定"
  "date": "2024-11-15",
  "time_windows": ["morning", "afternoon"]
}
```

**Request (multiple dates):**
```json
{
  "patient_id": 123,
  "appointment_type_id": 1,
  "practitioner_id": 456,  // null for "不指定"
  "dates": ["2024-11-15", "2024-11-16", "2024-11-17"],
  "time_windows": ["morning", "afternoon"]
}
```

**Response:**
```json
{
  "notifications_created": 3,
  "notifications_updated": 1,  // If duplicates were replaced
  "notification_ids": [789, 790, 791],
  "message": "已為 3 個日期設定通知"
}
```

**Validation:**
- Dates must be today or future (within 90 days)
- At least one date required
- At least one time window required
- Patient must belong to LINE user
- Check for duplicate notifications (same date/windows) - replace if exists

#### GET /liff/availability-notifications
List user's active notifications.

**Response:**
```json
{
  "notifications": [
    {
      "id": 789,
      "date": "2024-11-15",
      "appointment_type_name": "物理治療",
      "practitioner_name": "王醫師",
      "time_windows": ["morning", "afternoon"],
      "expires_at": "2024-11-15T23:59:59+08:00"
    }
  ]
}
```

#### DELETE /liff/availability-notifications/{id}
Cancel notification.

**Response:**
```json
{
  "success": true,
  "message": "已取消通知"
}
```

### Notification Service

```python
class AvailabilityNotificationService:
    @staticmethod
    def create_notification(
        db: Session,
        line_user_id: int,
        clinic_id: int,
        patient_id: int,
        appointment_type_id: int,
        date: date,
        time_windows: List[str],
        practitioner_id: Optional[int] = None
    ) -> AvailabilityNotification:
        """Create notification request with duplicate checking."""
        
    @staticmethod
    def check_and_notify(
        db: Session,
        clinic_id: int,
        appointment_type_id: int,
        date: date
    ) -> int:
        """Check for available slots and send notifications. Returns count of notifications sent."""
        
    @staticmethod
    def cancel_on_appointment_creation(
        db: Session,
        line_user_id: int,
        patient_id: int,
        date: date
    ) -> None:
        """Cancel notifications when user creates appointment for that date."""
```

### Background Job

**Trigger**: After appointment cancellation or calendar changes

**Process**:
1. When appointment is cancelled:
   - Get cancelled appointment details (date, type, practitioner)
   - Call `check_and_notify()` for that date/type/practitioner

2. When practitioner availability changes:
   - Check all active notifications for affected dates
   - Call `check_and_notify()` for each

3. Daily cleanup job:
   - Mark expired notifications (date passed) as "expired"
   - Clean up old fulfilled/expired notifications (older than 30 days)

**Implementation**:
- Use existing APScheduler (AsyncIOScheduler) system
- See "Notification Sending: Sync vs Async" section below for implementation decision

### Notification Sending

**When to send**:
- Immediately after appointment cancellation
- When practitioner availability is updated
- When new availability slots are created

**Rate limiting logic**:
```python
def should_send_notification(notification: AvailabilityNotification) -> bool:
    # Don't send if already notified in last hour
    if notification.last_notified_at:
        if (taiwan_now() - notification.last_notified_at) < timedelta(hours=1):
            return False
    
    # Don't send if user already has appointment for that date
    if has_appointment_for_date(notification.patient_id, notification.date):
        return False
    
    return True
```

**Message format**:
```
【可用時段通知】
您關注的 {date} {time_window_display} 時段 現在有可用預約！

立即預約 → [LIFF URL with mode=book&date={date}&appointment_type_id={id}]
```

**LIFF URL parameters**:
- `mode=book`: Opens booking flow
- `date={date}`: Pre-selects date
- `appointment_type_id={id}`: Pre-selects type
- `practitioner_id={id}`: Pre-selects practitioner (if specified)
- `time_window={window}`: Filters available slots to that window

### Frontend Changes

#### Step3SelectDateTime.tsx

1. **Always show notification button** (regardless of slot availability):
   ```tsx
   <div className="mt-4">
     <button 
       onClick={handleOpenNotificationModal}
       className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200"
     >
       設定可用時段通知
     </button>
   </div>
   ```

2. **Date badge** (if notification exists):
   ```tsx
   {hasNotificationForDate(dateString) && (
     <span className="badge">已設定通知</span>
   )}
   ```

#### New Component: NotificationModal.tsx

- **Multi-date selection**:
  - Calendar view with checkboxes
  - User can select multiple dates
  - Selected dates highlighted
  - Shows count: "已選擇 {N} 個日期"
  - Date range helper: "選擇日期範圍" button (selects all dates in range)
- Time window checkboxes (applies to all selected dates)
- Patient selection (if multiple)
- Practitioner display (read-only)
- Appointment type display (read-only)
- Summary: "將為 {N} 個日期設定通知"
- Submit button: "確認設定 ({N} 個日期)"

#### Settings Page

Add "我的通知設定" section:
- List active notifications
- Show date, time windows, appointment type
- Cancel button for each
- Auto-refresh when notifications are cancelled

## Implementation Phases

### Phase 1: Core Functionality
1. Database model and migration
2. API endpoints (create, list, delete)
3. Frontend UI for signup
4. Basic notification sending (synchronous, after cancellation)

### Phase 2: Enhanced Features
1. Rate limiting
2. Auto-cancellation on appointment creation
3. Settings page for managing notifications
4. Date badges in calendar

### Phase 3: Optimization
1. Background job for cleanup
2. Batch notification checking
3. Analytics/metrics

## Open Questions

1. **Notification priority**: Should we notify users in order (first-come-first-served) or all at once?
   - **Decision**: Notify all simultaneously (simpler, fairer)

2. **Notification persistence**: Keep notification active after sending, or mark as fulfilled?
   - **Decision**: Keep active until date expires or user books (allows multiple notifications if more slots open)

3. **Cross-date notifications**: Should user be able to set notifications for date ranges?
   - **Decision**: Yes, allow multiple date selection in single signup (creates multiple notification records)

4. **Practitioner-specific notifications**: If user wants "不指定" but slot opens for specific practitioner, should we notify?
   - **Decision**: Yes, notify for "不指定" if any practitioner has availability

## Notification Sending: Sync vs Async Evaluation

### Synchronous (Immediate) Approach

**How it works:**
- When appointment is cancelled, immediately check for matching notifications and send them
- Block the cancellation response until notifications are sent
- Use try/except to handle notification failures gracefully

**Pros:**
- ✅ **Immediate delivery**: Users get notified instantly when slot opens
- ✅ **Simpler implementation**: No background job infrastructure needed
- ✅ **Guaranteed execution**: Notifications sent as part of cancellation flow
- ✅ **Easier debugging**: Errors appear in same request context
- ✅ **No additional infrastructure**: Works with existing FastAPI setup

**Cons:**
- ❌ **Slower API response**: Cancellation endpoint waits for notification sending
- ❌ **LINE API latency**: If LINE API is slow, user waits longer
- ❌ **Error handling complexity**: Need to handle notification failures without failing cancellation
- ❌ **No retry mechanism**: If notification fails, it's lost (unless we add retry logic)
- ❌ **Blocking**: Ties up request thread during notification sending

**Performance impact:**
- LINE API push_message typically takes 200-500ms
- With 10 notifications: ~2-5 seconds added to cancellation response
- Acceptable for MVP but may degrade UX with many waitlisted users

### Asynchronous (Background Job) Approach

**How it works:**
- When appointment is cancelled, enqueue notification check job
- Background worker (using APScheduler) processes jobs
- Can be immediate (triggered on event) or batched (periodic checks)

**Pros:**
- ✅ **Fast API response**: Cancellation returns immediately
- ✅ **Better scalability**: Can handle many notifications without blocking
- ✅ **Retry capability**: Failed notifications can be retried
- ✅ **Batching**: Can batch multiple notification checks efficiently
- ✅ **Non-blocking**: Doesn't tie up request threads
- ✅ **Resilience**: Can recover from temporary LINE API outages

**Cons:**
- ❌ **Slight delay**: Small delay between cancellation and notification (100-500ms typically)
- ❌ **More complex**: Requires background job infrastructure
- ❌ **Infrastructure overhead**: Need to manage job queue, workers, monitoring
- ❌ **Potential race conditions**: Need to handle concurrent cancellations
- ❌ **Job failure handling**: Need monitoring/alerting for failed jobs

**Implementation options:**

1. **Immediate async trigger** (recommended):
   ```python
   # In appointment cancellation endpoint
   await trigger_notification_check_async(
       clinic_id, appointment_type_id, date, practitioner_id
   )
   # Returns immediately, job runs in background
   ```
   - Uses APScheduler's `add_job()` with `run_date=now()`
   - Delay: ~100-200ms (job scheduling overhead)
   - Best balance of speed and reliability

2. **Periodic batch checking**:
   - Run every 1-5 minutes, check all active notifications
   - Simpler but higher latency (up to 5 minutes delay)
   - Less efficient (checks even when no changes)

3. **Event-driven with queue**:
   - Use message queue (Redis, RabbitMQ) for job queuing
   - Most scalable but most complex
   - Overkill for MVP

### Recommendation

**Phase 1 (MVP): Synchronous**
- Start with synchronous approach
- Simple, immediate, works well for low-to-medium volume
- Add timeout (5 seconds) to prevent hanging
- Log notification failures but don't fail cancellation

**Phase 2 (Scale): Asynchronous with immediate trigger**
- Migrate to async when notification volume increases
- Use APScheduler's immediate job trigger
- Keep synchronous as fallback if scheduler unavailable
- Add monitoring/alerting for failed notifications

**Hybrid approach** (best of both):
```python
async def check_and_notify_hybrid(...):
    try:
        # Try synchronous first (fast path)
        result = await check_and_notify_sync(...)
        return result
    except TimeoutError:
        # Fallback to async if sync times out
        await trigger_notification_check_async(...)
        return {"status": "queued"}
```

### Decision Matrix

| Factor | Sync | Async (Immediate) | Async (Batch) |
|--------|------|-------------------|---------------|
| **Latency** | 0ms | 100-200ms | 1-5 minutes |
| **Complexity** | Low | Medium | Low |
| **Scalability** | Limited | High | High |
| **Reliability** | Medium | High | High |
| **Implementation time** | 1 day | 2-3 days | 2 days |

**Final recommendation**: Start with **synchronous** for MVP, migrate to **async immediate trigger** when needed.

## Success Metrics

- Number of notifications created
- Notification-to-booking conversion rate
- Average time from notification to booking
- Notification delivery success rate
- User satisfaction (qualitative feedback)

