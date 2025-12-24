# Post-Appointment Follow-Up Messages - Design

## Overview

Allow clinic admins to configure automated follow-up messages that are sent to patients after their appointments. Each service item can have multiple follow-up messages, each with its own timing configuration and message template.

This feature uses a **generalized scheduled LINE message system** that can handle all asynchronous message sending (follow-ups, reminders, practitioner notifications, etc.). The system pre-schedules messages when appointments are created, enabling efficient delivery tracking and analytics.

## Requirements

### Core Features
1. **Per-service-item configuration** - Each appointment type can have its own follow-up message settings
2. **Multiple messages** - Clinic admin can add one or more follow-up messages per service item
3. **Flexible timing** - Two timing modes:
   - **Mode A**: X hours after appointment (x >= 0, relative to appointment end time)
   - **Mode B**: Specific time (e.g., 9pm) on or Y days after appointment (relative date, absolute time)
4. **Message templates** - Customizable message templates with placeholders (similar to existing confirmation/reminder messages)
5. **UI consistency** - Similar UX to existing appointment reminder and confirmation message settings

### Timing Modes

**Mode A: Hours After Appointment**
- Configuration: `hours_after: int` (x >= 0)
- Calculation: `send_time = appointment_end_time + timedelta(hours=x)`
- Example: "2 hours after appointment" → if appointment ends at 3pm, send at 5pm
- Use case: Immediate follow-up, same-day check-ins

**Mode B: Specific Time on Days After**
- Configuration: `days_after: int` (y >= 0), `time_of_day: time` (e.g., 21:00)
- Calculation: `send_date = appointment_date + timedelta(days=y)`, `send_time = time_of_day`
- Example: "9pm on 1 day after appointment" → if appointment is on Jan 15, send at 9pm on Jan 16
- Use case: Scheduled follow-ups at specific times (e.g., evening check-ins)

## Database Design

### Schema Changes

**New table: `follow_up_messages`** (Configuration)
```sql
CREATE TABLE follow_up_messages (
    id SERIAL PRIMARY KEY,
    appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    
    -- Timing configuration
    timing_mode VARCHAR(20) NOT NULL CHECK (timing_mode IN ('hours_after', 'specific_time')),
    hours_after INTEGER CHECK (hours_after >= 0),  -- For Mode A: hours after appointment end (x >= 0)
    days_after INTEGER CHECK (days_after >= 0),   -- For Mode B: days after appointment date (y >= 0)
    time_of_day TIME,     -- For Mode B: specific time (e.g., 21:00)
    
    -- Message configuration
    message_template TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    
    -- Ordering
    display_order INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT check_timing_mode_consistency CHECK (
        (timing_mode = 'hours_after' AND hours_after IS NOT NULL) OR
        (timing_mode = 'specific_time' AND days_after IS NOT NULL AND time_of_day IS NOT NULL)
    ),
    CONSTRAINT unique_appointment_type_order UNIQUE (appointment_type_id, display_order),
    
    -- Indexes
    INDEX idx_follow_up_appointment_type (appointment_type_id),
    INDEX idx_follow_up_clinic (clinic_id),
    INDEX idx_follow_up_enabled (is_enabled)
);
```

**New table: `scheduled_line_messages`** (Generalized Scheduling)
```sql
CREATE TABLE scheduled_line_messages (
    id SERIAL PRIMARY KEY,
    
    -- Recipient
    recipient_type VARCHAR(20) NOT NULL,  -- 'patient' | 'practitioner' | 'admin'
    recipient_line_user_id VARCHAR(255) NOT NULL,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    
    -- Message configuration
    message_type VARCHAR(50) NOT NULL,  -- 'appointment_reminder' | 'follow_up' | 'practitioner_daily' | etc.
    message_template TEXT NOT NULL,  -- Store template for audit trail and re-rendering
    message_context JSONB NOT NULL,  -- Context for rendering (appointment_id, follow_up_message_id, etc.)
    
    -- Scheduling
    scheduled_send_time TIMESTAMP WITH TIME ZONE NOT NULL,
    actual_send_time TIMESTAMP WITH TIME ZONE,
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'skipped' | 'failed'
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Indexes
    INDEX idx_scheduled_status_time (status, scheduled_send_time),
    INDEX idx_scheduled_status_time_clinic (status, scheduled_send_time, clinic_id),  -- Composite for cron job
    INDEX idx_scheduled_recipient (recipient_type, recipient_line_user_id),
    INDEX idx_scheduled_message_type (message_type),
    INDEX idx_scheduled_clinic (clinic_id)
);
```

**Rationale:**
- `follow_up_messages`: Configuration table for follow-up message settings per appointment type
- `scheduled_line_messages`: Generalized table for all scheduled LINE messages (follow-ups, reminders, practitioner notifications, etc.)
- Template stored in `scheduled_line_messages` for audit trail and potential re-rendering
- Resolved text is tracked in `line_push_messages` table (existing) when message is sent
- Pre-calculated `scheduled_send_time` enables efficient querying
- Status tracking enables retry logic and debugging
- `message_context` JSONB stores flexible context data (appointment_id, follow_up_message_id, etc.)

### Data Model (SQLAlchemy)

```python
class FollowUpMessage(Base):
    __tablename__ = "follow_up_messages"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"), nullable=False)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), nullable=False)
    
    timing_mode: Mapped[str] = mapped_column(String(20), nullable=False)  # 'hours_after' | 'specific_time'
    hours_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Mode A
    days_after: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Mode B
    time_of_day: Mapped[Optional[time]] = mapped_column(Time, nullable=True)  # Mode B
    
    message_template: Mapped[str] = mapped_column(Text, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(default=True)
    display_order: Mapped[int] = mapped_column(default=0)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    
    appointment_type = relationship("AppointmentType", back_populates="follow_up_messages")
    clinic = relationship("Clinic")


class ScheduledLineMessage(Base):
    __tablename__ = "scheduled_line_messages"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    
    recipient_type: Mapped[str] = mapped_column(String(20), nullable=False)  # 'patient' | 'practitioner' | 'admin'
    recipient_line_user_id: Mapped[str] = mapped_column(String(255), nullable=False)
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id"), nullable=False)
    
    message_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'appointment_reminder' | 'follow_up' | etc.
    message_template: Mapped[str] = mapped_column(Text, nullable=False)  # Template stored for audit trail
    message_context: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)  # Context for rendering
    
    scheduled_send_time: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    actual_send_time: Mapped[Optional[datetime]] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    
    status: Mapped[str] = mapped_column(String(20), default='pending')  # 'pending' | 'sent' | 'skipped' | 'failed'
    retry_count: Mapped[int] = mapped_column(default=0)
    max_retries: Mapped[int] = mapped_column(default=3)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    
    clinic = relationship("Clinic")
```

**Note:** When a scheduled message is sent, it creates a `LinePushMessage` record (existing table) with resolved text and analytics labels.

## User Experience Design

### UI Location

**Service Item Edit Modal** - Add new section "追蹤訊息設定" (Follow-Up Message Settings)

Similar to existing "訊息設定" section with three collapsible sections (patient_confirmation, clinic_confirmation, reminder), add a fourth section for follow-up messages.

### UI Design

**Section Layout:**
```
┌─────────────────────────────────────┐
│ ▼ 追蹤訊息設定                       │
│                                     │
│ [新增追蹤訊息]                       │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 追蹤訊息 #1                      │ │
│ │ ☑ 啟用                            │ │
│ │                                   │ │
│ │ 發送時機：                         │ │
│ │ ○ 預約結束後 X 小時                │ │
│ │   [2] 小時                         │ │
│ │ ● 預約日期後 Y 天的特定時間          │ │
│ │   [1] 天後的 [21:00]               │ │
│ │                                   │ │
│ │ 訊息模板 *                         │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ {病患姓名}，感謝您今天的預約... │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                   │ │
│ │ [可用變數] [預覽訊息] [刪除]        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 追蹤訊息 #2                      │ │
│ │ ...                              │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Features:**
1. **Add button** - "新增追蹤訊息" to add new follow-up message
2. **Toggle** - Enable/disable each message
3. **Timing mode selection** - Radio buttons for Mode A vs Mode B
4. **Timing inputs**:
   - Mode A: Number input for hours (min: 0)
   - Mode B: Number input for days (min: 0) + time picker (HH:MM format)
5. **Message template** - Textarea with placeholder helper (same as existing messages)
6. **Preview button** - Preview rendered message
7. **Delete button** - Remove follow-up message
8. **Reordering** - Drag-and-drop or up/down arrows (optional, v1 can use display_order)

### Default Message Template

```text
{病患姓名}，感謝您今天的預約！

希望今天的服務對您有幫助。如有任何問題或需要協助，歡迎隨時聯繫我們。

期待下次為您服務！
```

## Scheduled Message System

### Architecture Overview

The system uses a **generalized scheduled LINE message mechanism** that pre-schedules all asynchronous messages when appointments are created. This approach:

1. **Pre-schedules messages** when appointments are created/confirmed
2. **Stores templates** in `scheduled_line_messages` for audit trail
3. **Renders and sends** messages via hourly cron job
4. **Tracks sent messages** in `line_push_messages` (existing table) with analytics labels

### Message Scheduling Flow

**When appointment is created/confirmed:**
```python
def schedule_follow_up_messages(db: Session, appointment: Appointment):
    """Schedule all follow-up messages for an appointment"""
    appointment_type = appointment.appointment_type
    follow_up_messages = db.query(FollowUpMessage).filter(
        FollowUpMessage.appointment_type_id == appointment_type.id,
        FollowUpMessage.is_enabled == True
    ).order_by(FollowUpMessage.display_order).all()
    
    # Calculate appointment end time: start_time + duration_minutes
    appointment_start = datetime.combine(
        appointment.calendar_event.date,
        appointment.calendar_event.start_time
    )
    appointment_end_time = appointment_start + timedelta(
        minutes=appointment_type.duration_minutes
    )
    
    patient = appointment.patient
    line_user = patient.line_user
    
    if not line_user:
        return  # No LINE user, skip scheduling
    
    for follow_up in follow_up_messages:
        scheduled_time = calculate_scheduled_time(
            appointment_end_time,
            follow_up.timing_mode,
            follow_up.hours_after,
            follow_up.days_after,
            follow_up.time_of_day
        )
        
        # Validate scheduled time is not in past (auto-adjust if needed)
        if scheduled_time < taiwan_now():
            if follow_up.timing_mode == 'specific_time' and follow_up.days_after == 0:
                # Auto-adjust to next day at same time
                scheduled_time = scheduled_time + timedelta(days=1)
                logger.info(
                    f"Auto-adjusted follow-up message {follow_up.id} to next day "
                    f"for appointment {appointment.calendar_event_id}"
                )
            else:
                # Skip scheduling if time is in past (shouldn't happen normally)
                logger.warning(
                    f"Skipping follow-up message {follow_up.id} - scheduled time in past"
                )
                continue
        
        # Create scheduled message record
        scheduled = ScheduledLineMessage(
            recipient_type='patient',
            recipient_line_user_id=line_user.line_user_id,
            clinic_id=appointment.patient.clinic_id,
            message_type='follow_up',
            message_template=follow_up.message_template,
            message_context={
                'appointment_id': appointment.calendar_event_id,
                'follow_up_message_id': follow_up.id
            },
            scheduled_send_time=scheduled_time,
            status='pending'
        )
        db.add(scheduled)
    db.commit()
```

**Hourly cron job:**
```python
async def send_pending_scheduled_messages():
    """Send all pending scheduled messages"""
    with get_db_context() as db:
        # Use SELECT FOR UPDATE SKIP LOCKED for concurrent scheduler support
        # Process in batches to avoid long-running transactions
        batch_size = 100
        current_time = taiwan_now()
        
        while True:
            pending = db.query(ScheduledLineMessage).filter(
                ScheduledLineMessage.status == 'pending',
                ScheduledLineMessage.scheduled_send_time <= current_time
            ).with_for_update(skip_locked=True).limit(batch_size).all()
            
            if not pending:
                break
            
            for scheduled in pending:
                try:
                    # Validate appointment still exists and is confirmed
                    if not validate_appointment_for_message(db, scheduled):
                        scheduled.status = 'skipped'
                        scheduled.error_message = 'Appointment no longer valid'
                        db.commit()
                        continue
                    
                    # Build context and render message
                    context = build_message_context(db, scheduled)
                    resolved_text = MessageTemplateService.render_message(
                        scheduled.message_template,
                        context
                    )
                    
                    # Build analytics labels
                    labels = build_labels_for_message_type(scheduled.message_type, context)
                    
                    # Send message (creates LinePushMessage record)
                    line_service = get_line_service_for_clinic(scheduled.clinic_id)
                    line_service.send_text_message(
                        line_user_id=scheduled.recipient_line_user_id,
                        text=resolved_text,
                        labels=labels,
                        db=db,
                        clinic_id=scheduled.clinic_id
                    )
                    
                    # Update status
                    scheduled.status = 'sent'
                    scheduled.actual_send_time = taiwan_now()
                    
                except Exception as e:
                    scheduled.status = 'failed'
                    scheduled.error_message = str(e)
                    scheduled.retry_count += 1
                    
                    # Retry logic (max 3 retries)
                    # Use exponential backoff: 1 hour, 2 hours, 4 hours
                    if scheduled.retry_count < scheduled.max_retries:
                        backoff_hours = 2 ** (scheduled.retry_count - 1)
                        scheduled.scheduled_send_time = taiwan_now() + timedelta(hours=backoff_hours)
                        scheduled.status = 'pending'
                    else:
                        # Max retries exceeded - mark as permanently failed
                        # TODO: Add monitoring/alerting for permanently failed messages
                        logger.error(
                            f"Message {scheduled.id} failed after {scheduled.max_retries} retries: {e}"
                        )
                
                db.commit()
```

**Note:** `validate_appointment_for_message()` checks:
- Appointment exists and is not deleted
- Appointment status is 'confirmed' (not canceled)
- Patient has LINE user
- Follow-up message is still enabled (if applicable)

### Message Type to Labels Mapping

**Labels structure for analytics:**
```python
def build_labels_for_message_type(message_type: str, context: dict) -> dict:
    """Convert message_type to analytics labels for LinePushMessage"""
    base_labels = {
        'recipient_type': context.get('recipient_type', 'patient'),
        'trigger_source': 'system_triggered',  # All scheduled messages are system_triggered
    }
    
    if message_type == 'appointment_reminder':
        base_labels['event_type'] = 'appointment_reminder'
    elif message_type == 'follow_up':
        base_labels['event_type'] = 'appointment_follow_up'
    elif message_type == 'practitioner_daily':
        base_labels['event_type'] = 'practitioner_daily_notification'
        base_labels['recipient_type'] = 'practitioner'
    # ... other message types
    
    return base_labels
```

**Note:** Labels are kept minimal - only `event_type` is needed for dashboard grouping. Detailed timing configuration is stored in source tables (`follow_up_messages`, etc.) and can be queried separately if needed.

### Migration Path

**Phase 1: New system for follow-ups**
- Create `scheduled_line_messages` table
- Use for follow-up messages (new feature)
- Keep existing reminder system running

**Phase 2: Migrate reminders**
- Update reminder service to pre-schedule messages in `scheduled_line_messages`
- Update reminder cron job to query `scheduled_line_messages` instead of appointments
- Keep `reminder_sent_at` field for backward compatibility (can deprecate later)

**Phase 3: Migrate other message types**
- Practitioner daily notifications
- Admin notifications
- Any other scheduled messages

## Edge Cases & Questions

### 1. Appointment Cancellations

**Scenario:** Appointment is canceled after follow-up messages are scheduled

**Proposed Solution:**
- When appointment is canceled, mark all pending scheduled messages as 'skipped'
- Query: `UPDATE scheduled_line_messages SET status='skipped' WHERE message_context->>'appointment_id'=? AND status='pending'`
- If appointment is re-activated (canceled → confirmed), reschedule messages
- Validation in cron job checks appointment status before sending

### 2. Appointment Edits (Time Changes)

**Scenario:** Appointment time is changed after follow-up messages are scheduled

**Proposed Solution:**
- Cancel all pending messages: `UPDATE scheduled_line_messages SET status='skipped' WHERE message_context->>'appointment_id'=? AND status='pending'`
- Reschedule all follow-up messages with new appointment time
- Simple and clear approach

### 3. Multiple Messages with Same Timing

**Scenario:** Two follow-up messages configured for "2 hours after appointment"

**Proposed Solution:**
- Allow multiple messages with same timing
- Send them in `display_order` sequence
- Small delay between sends (e.g., 1 second) to avoid rate limiting

### 4. Mode B: Time in Past

**Scenario:** Appointment ends at 10pm, follow-up configured for "9pm on same day" (days_after=0, but 9pm is before 10pm)

**Proposed Solution:**
- **UI validation:** Show warning if `days_after=0` and `time_of_day < appointment_end_time` (doesn't block save)
- **API validation:** Validate timing mode consistency (Mode A requires `hours_after`, Mode B requires `days_after` and `time_of_day`)
- **Backend auto-adjustment:** If calculated `scheduled_send_time` is in past, auto-adjust to next day at same time
- **Logging:** Log auto-adjustment for admin visibility

### 5. Appointment Type Deleted

**Scenario:** Appointment type is soft-deleted but has active appointments with scheduled follow-up messages

**Proposed Solution:**
- Follow-up messages are also soft-deleted (or disabled)
- Pending messages for appointments of deleted types are skipped
- Query: `JOIN appointment_types WHERE is_deleted=false` when sending

### 6. Follow-Up Message Disabled After Scheduling

**Scenario:** Admin disables a follow-up message after it's scheduled but before it's sent

**Proposed Solution:**
- Check `is_enabled` flag when sending: Join `follow_up_messages` table and check `is_enabled=true`
- Skip messages that are disabled, mark as 'skipped' in `scheduled_line_messages`

### 7. Appointment Ends at Midnight

**Scenario:** Appointment ends at 00:00 (midnight), Mode A with 2 hours = 02:00 next day

**Proposed Solution:**
- Standard datetime arithmetic handles this correctly
- No special handling needed

### 8. Mode B: Daylight Saving Time (if applicable)

**Scenario:** Taiwan doesn't have DST, but if system supports other timezones

**Proposed Solution:**
- Use Taiwan timezone (`TAIWAN_TZ`) for all calculations
- Store `scheduled_send_time` in UTC, convert to Taiwan time when displaying

### 9. Very Long Delays

**Scenario:** Follow-up message configured for "30 days after appointment at 9pm"

**Proposed Solution:**
- No limit on `days_after` (admin can configure any delay)
- Consider adding max limit (e.g., 365 days) to prevent abuse
- **Question:** Should we enforce a maximum delay? **Proposed:** No hard limit, but show warning if > 90 days

### 10. Appointment Rescheduled Multiple Times

**Scenario:** Appointment is edited multiple times, each time canceling and rescheduling follow-up messages

**Proposed Solution:**
- Each edit cancels pending messages and reschedules
- Log table preserves history (shows skipped messages from previous schedules)
- No performance issue (only pending messages are queried)

### 11. Concurrent Sends

**Scenario:** Multiple scheduler instances running (if load-balanced)

**Proposed Solution:**
- Use database-level locking: `SELECT ... FOR UPDATE SKIP LOCKED`
- Or use `max_instances=1` in scheduler (current pattern)
- **Question:** Should we support multiple instances? **Proposed:** Use `max_instances=1` for now (matches existing pattern)

### 12. Failed Sends

**Scenario:** LINE API fails when sending follow-up message

**Proposed Solution:**
- Mark as 'failed' in `scheduled_line_messages` table
- Store error message
- Retry with exponential backoff: 1 hour, 2 hours, 4 hours (max 3 retries)
- After max retries: Mark as permanently failed, log error for monitoring
- **Future:** Add admin notification/alerting for permanently failed messages

### 13. Placeholder Availability

**Scenario:** Follow-up messages use same placeholders as confirmation/reminder messages

**Proposed Solution:**
- Reuse existing `MessageTemplateService` and placeholder system
- Same placeholders available: `{病患姓名}`, `{服務項目}`, `{預約時間}`, `{治療師姓名}`, `{診所名稱}`, etc.
- Add `{預約結束時間}` placeholder for follow-up messages (shows appointment end time)

### 14. Preview Functionality

**Scenario:** Admin wants to preview follow-up message before saving

**Proposed Solution:**
- Reuse existing preview modal pattern
- Use sample appointment data (tomorrow's appointment, sample patient)
- Show calculated send time based on timing mode

### 15. Migration Strategy

**Scenario:** Existing appointments when feature is deployed

**Proposed Solution:**
- Only schedule follow-up messages for new appointments (created after deployment)
- Existing appointments don't get follow-up messages (backward compatible)
- No backfill for existing appointments (simpler, avoids unexpected messages)

### 16. Appointment No-Shows

**Scenario:** Patient doesn't show up for appointment

**Proposed Solution:**
- Follow-up messages still send (no-show status not currently tracked)
- **Future consideration:** Add appointment status tracking (completed, no-show) and conditionally send follow-ups

### 17. Patient Opt-Out

**Scenario:** Patient doesn't want to receive follow-up messages

**Proposed Solution:**
- **Future consideration:** Add patient preferences for message types
- For v1: All patients receive follow-up messages if configured
- Can be addressed in future enhancement

### 18. Rate Limiting

**Scenario:** LINE API rate limits when sending multiple messages

**Proposed Solution:**
- Process messages in batches (100 per batch)
- Add small delay between batches (e.g., 1 second) to avoid rate limiting
- Monitor LINE API errors and adjust batch size if needed

### 19. Message Context Validation

**Scenario:** `message_context` JSONB contains invalid or missing required fields

**Proposed Solution:**
- Validate `message_context` schema per `message_type`:
  - `follow_up`: Requires `appointment_id`, `follow_up_message_id`
  - `appointment_reminder`: Requires `appointment_id`
- Add validation function that checks required fields before rendering
- Skip message if context is invalid, mark as 'skipped' with error message

### 20. Appointment Hard Deletion

**Scenario:** Appointment is hard-deleted (not soft-deleted) but scheduled messages reference it

**Proposed Solution:**
- Use CASCADE delete: `appointments.calendar_event_id ON DELETE CASCADE` in foreign key
- Or: Check appointment exists in validation function, mark as 'skipped' if not found
- Prefer soft-delete pattern to preserve audit trail

## API Endpoints

### Get Follow-Up Messages
```
GET /api/clinic/appointment-types/{id}/follow-up-messages
Response: { follow_up_messages: [...] }
```

### Create/Update Follow-Up Message
```
POST /api/clinic/appointment-types/{id}/follow-up-messages
PUT /api/clinic/appointment-types/{id}/follow-up-messages/{message_id}
Request: {
  timing_mode: 'hours_after' | 'specific_time',
  hours_after?: number,  // Required if timing_mode='hours_after', must be >= 0
  days_after?: number,   // Required if timing_mode='specific_time', must be >= 0
  time_of_day?: string,  // Required if timing_mode='specific_time', format: "HH:MM"
  message_template: string,  // Required, max 3500 chars
  is_enabled: boolean,
  display_order: number
}

Validation:
- If timing_mode='hours_after': hours_after is required and >= 0
- If timing_mode='specific_time': days_after and time_of_day are required, days_after >= 0
- message_template: required, non-empty, max 3500 characters
- display_order: must be unique per appointment_type_id

Error Responses:
- 400: Validation error (missing required fields, invalid timing mode consistency)
- 404: Appointment type not found
- 409: display_order conflict
```

### Delete Follow-Up Message
```
DELETE /api/clinic/appointment-types/{id}/follow-up-messages/{message_id}
Response: 204 No Content
```

### Preview Follow-Up Message
```
GET /api/clinic/follow-up-message-preview?appointment_type_id={id}&timing_mode={mode}&...
POST /api/clinic/follow-up-message-preview  // Alternative: POST for complex params
Request: {
  appointment_type_id: number,
  timing_mode: 'hours_after' | 'specific_time',
  hours_after?: number,
  days_after?: number,
  time_of_day?: string,
  message_template: string,
  sample_appointment_end_time?: string  // Optional: for preview calculation
}
Response: {
  preview_message: string,
  calculated_send_time: string,  // Formatted send time
  used_placeholders: [...],
  completeness_warnings?: [...]  // If placeholders reference missing data
}
```

## Implementation Phases

### Phase 1: Database & Models
- Create migration for `follow_up_messages` and `scheduled_line_messages` tables
- Add SQLAlchemy models
- Add relationships to `AppointmentType`

### Phase 2: Backend API
- CRUD endpoints for follow-up messages
- Preview endpoint
- Message scheduling logic (when appointments are created)
- Message sending logic with label mapping

### Phase 3: Cron Job
- Implement generalized scheduled message scheduler
- Handle appointment edits/cancellations
- Error handling and retry logic (max 3 retries)

### Phase 4: Frontend UI
- Add "追蹤訊息設定" section to ServiceItemEditModal
- Follow-up message list with add/edit/delete
- Timing mode selection and inputs
- Message template editor with placeholder helper
- Preview functionality

### Phase 5: Testing & Edge Cases
- **Timing calculations:**
  - Mode A: Test hours_after=0, hours_after=24, crossing midnight
  - Mode B: Test days_after=0, days_after=7, time_of_day edge cases (00:00, 23:59)
  - Timezone edge cases: appointment at 23:00 with 2-hour follow-up crossing midnight
- **Appointment lifecycle:**
  - Test appointment edits (time changes, cancellation, re-activation)
  - Test multiple reschedules (ensure no duplicate messages)
- **Message sending:**
  - Test multiple messages per appointment (same timing, different timing)
  - Test concurrent scheduler instances (SELECT FOR UPDATE SKIP LOCKED)
  - Test failed sends and retry logic (exponential backoff)
  - Test max retries exceeded (permanently failed)
- **Validation:**
  - Test timing mode consistency validation
  - Test message_context schema validation
  - Test appointment validation before sending
- **Performance:**
  - Load testing: cron job with 1000+ pending messages
  - Batch processing: verify no long-running transactions
- **Analytics:**
  - Test labels creation for LinePushMessage
  - Verify dashboard grouping by event_type

### Phase 6: Migration (Future)
- Migrate existing reminder system to use `scheduled_line_messages`
- Migrate practitioner daily notifications
- Migrate admin notifications

## Design Decisions

1. **Template storage:** Store template in `scheduled_line_messages` for audit trail. Resolved text is tracked in `line_push_messages` when sent.

2. **Labels for analytics:** Keep minimal - only `event_type='appointment_follow_up'` needed. Detailed timing config stored in source tables.

3. **Appointment edit handling:** Cancel all pending messages and reschedule (simpler than recalculating).

4. **Backfill existing appointments:** No - only schedule for new appointments created after deployment.

5. **Concurrent scheduler instances:** Use `SELECT ... FOR UPDATE SKIP LOCKED` for database-level locking, supports multiple instances safely.

6. **Retry logic:** Retry failed sends up to 3 times with exponential backoff (1h, 2h, 4h). After max retries, mark as permanently failed.

7. **Time validation:** For Mode B with `days_after=0`, auto-adjust to next day if `time_of_day < appointment_end_time`. Log auto-adjustments.

8. **Maximum delay:** No hard limit, but show UI warning if > 90 days.

9. **Database constraints:** Add CHECK constraints for timing mode consistency and non-negative values. Unique constraint on `(appointment_type_id, display_order)`.

10. **Performance:** Process messages in batches (100 per batch) to avoid long-running transactions. Use composite index on `(status, scheduled_send_time, clinic_id)`.

11. **Validation:** API-level validation for timing mode consistency. Validate `message_context` schema per message type.

12. **Error handling:** Log permanently failed messages for monitoring. Future: Add admin notifications for repeated failures.

## Summary

This design provides:
- **Flexible timing configuration** - Hours after or specific time on days after appointment
- **Multiple messages per service item** - Clinic admins can configure multiple follow-up messages
- **Generalized scheduling system** - `scheduled_line_messages` table handles all asynchronous LINE messages (follow-ups, reminders, practitioner notifications, etc.)
- **Efficient delivery** - Pre-scheduled messages with indexed queries for fast processing
- **Analytics integration** - Messages tracked in `line_push_messages` with minimal labels for dashboard grouping
- **Consistent UI** - Similar UX to existing message settings
- **Comprehensive edge case handling** - Appointment edits, cancellations, retries, etc.
- **Clear migration path** - Can migrate existing reminder system to use same mechanism

The generalized scheduled message system provides a scalable foundation for all asynchronous LINE messaging needs.

