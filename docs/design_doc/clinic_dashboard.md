# Clinic Dashboard

## Overview
A metrics dashboard page under the "診所管理" (clinic management) menu that provides key performance indicators and statistics for the clinic with time-based trends and comparisons.

## Current Implementation Status

**Database Tracking:**
- ❌ **Push messages (paid messages) are NOT currently tracked** - New `LinePushMessage` model needs to be created
- ⚠️ **AI reply messages** - Stored in `LineMessage` table but not specifically tracked for dashboard metrics (needs query logic)
- ✅ **Patient statistics** - Can be calculated from existing `Patient` and `Appointment` tables
- ✅ **Appointment statistics** - Can be calculated from existing `Appointment` and `CalendarEvent` tables

**What Needs to be Implemented:**
1. Create `LinePushMessage` model with flexible multi-label system (see Message Tracking section)
2. Update `LINEService.send_text_message()` to record push messages with labels
3. Update all notification service methods to pass labels when sending push messages
4. Implement query logic for aggregating message statistics by month
5. Create dashboard API endpoint and service methods

## User Flow
1. User navigates to "診所管理" → "診所儀表板" (Clinic Dashboard)
2. View aggregated metrics and statistics by month
3. View past 3 months + current month

## Features

### Patient Statistics Section
- **活躍病患** (Active Patients) - Patients with appointments in each month (non-cancelled only)
  - Definition: Patients who have at least one non-cancelled appointment in that month
  - Show monthly data: Past 3 months + current month
  - Display format: Vertical bar chart (time on horizontal axis)
  - Note: "當月數據可能仍會變動" (Current month data may still change)
- **新增病患** (New Patients) - Count of patients created in each calendar month
  - Baseline: Patients where `created_at` falls within the first day to last day of each month (Taiwan timezone)
  - Show monthly data: Past 3 months + current month
  - Display format: Vertical bar chart (time on horizontal axis)
  - Note: "當月數據可能仍會變動" (Current month data may still change)

### Appointment Statistics Section
- **本月預約數** (Appointments This Month) - Count of non-cancelled appointments
  - Show monthly data: Past 3 months + current month
  - Display format: Vertical bar chart (time on horizontal axis)
  - Styling: Use different styling (e.g., dashed border, lighter color) for current month
  - Note: "當月數據可能仍會變動" (Current month data may still change)
  
- **取消率** (Cancellation Rate) - Cancellation rate breakdown
  - Display format: Table view (time on horizontal axis)
  - Show monthly data: Past 3 months + current month
  - Rows: 診所取消 (Canceled by Clinic) | 病患取消 (Canceled by Patient) | 總取消 (Total Cancelled)
  - Columns: Month (Past 3 months + current month)
  - Each cell shows: Count(Percentage%) format (e.g., "5(4.2%)")
  - Note: "當月數據可能仍會變動" (Current month data may still change)
  
- **預約類型統計** (Appointment Type Statistics)
  - Display format: Table view (time on horizontal axis)
  - Show monthly data: Past 3 months + current month
  - Only count non-cancelled appointments
  - Rows: Each appointment type (show all appointment types)
  - Columns: Month (Past 3 months + current month)
  - Each cell shows: Count(Percentage%) format (e.g., "45(37.5%)")
  - Note: "當月數據可能仍會變動" (Current month data may still change)
  
- **治療師預約統計** (Practitioner Statistics)
  - Display format: Table view (time on horizontal axis)
  - Show monthly data: Past 3 months + current month
  - Only count non-cancelled appointments
  - Rows: Each practitioner name
  - Columns: Month (Past 3 months + current month)
  - Each cell shows: Count(Percentage%) format (e.g., "60(50.0%)")
  - Note: "當月數據可能仍會變動" (Current month data may still change)

### Message Statistics Section
- **LINE 訊息統計** (LINE Message Statistics)
  - **付費訊息** (Paid Messages - Push Messages)
    - Display format: Table view (time on horizontal axis)
    - Show monthly data: Past 3 months + current month
    - Breakdown by recipient type and event type:
      
      **To Patients (發送給病患):**
      - 預約確認 (Appointment Confirmation) - When appointment is created/confirmed
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered' (for future regrouping)
      - 預約取消 (Appointment Cancellation) - When appointment is canceled (by clinic or patient)
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered'
      - 預約調整 (Appointment Edit) - When appointment time/practitioner is changed
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered'
      - 預約提醒 (Appointment Reminder) - Automated reminder before appointment
        - Tracked with `trigger_source`: 'system_triggered'
      - 空檔通知 (Availability Notification) - When new availability slots are available
        - Tracked with `trigger_source`: 'system_triggered'
      
      **To Practitioners (發送給治療師):**
      - 新預約通知 (New Appointment Notification) - When new appointment is assigned
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered'
      - 預約取消通知 (Appointment Cancellation Notification) - When appointment is canceled
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered'
      - 預約調整通知 (Appointment Edit Notification) - When appointment is reassigned/edited
        - Tracked with `trigger_source`: 'clinic_triggered' or 'patient_triggered'
      - 每日預約提醒 (Daily Appointment Reminder) - Daily notification of upcoming appointments
        - Tracked with `trigger_source`: 'system_triggered'
      
      **To Admins (發送給管理員):**
      - 待審核預約通知 (Auto-Assigned Appointment Notification) - Daily notification of pending auto-assigned appointments
        - Tracked with `trigger_source`: 'system_triggered'
      
    - Table structure:
      - Rows: Each event type (grouped by recipient type), with subtotal rows for each recipient type, and grand total row
      - Columns: Month (Past 3 months + current month)
      - Each cell shows: Count(Percentage%) format (e.g., "120(46%)")
      - Percentage is calculated relative to total paid messages for that month (grand total across all event types)
      - Subtotals show percentage relative to grand total (not 100% of their group)
      - **Note:** `trigger_source` is tracked but not displayed in current dashboard (available for future regrouping features)
    - Info icon next to "付費訊息" title: Explain that this is the LINE message quota (not charged by our platform)
    - Note: "當月數據可能仍會變動" (Current month data may still change)
    - Note: Each event type will be toggleable in future settings (for cost-sensitive clinics)
    - **Future Feature:** Regroup by `trigger_source` (e.g., clinic-triggered vs patient-triggered) without losing historical data
    
  - **AI 回覆訊息** (AI Reply Messages)
    - Display format: Table view (time on horizontal axis)
    - Show monthly data: Past 3 months + current month
    - Table structure:
      - Rows: "AI 回覆訊息" (AI Reply Messages)
      - Columns: Month (Past 3 months + current month) | Count for each month
    - Info icon next to "AI 回覆訊息" title: Explain that AI replies do not consume the LINE message quota
    - Note: "當月數據可能仍會變動" (Current month data may still change)


## Technical Design

### Frontend

#### Route
- Path: `/admin/clinic/dashboard`
- Component: `ClinicDashboardPage.tsx`
- Add route in `App.tsx` under ClinicLayout routes
- Add menu item in `ClinicLayout.tsx` under "診所管理" group

#### Components
- `ClinicDashboardPage.tsx` - Main page component
- `PatientStatsSection.tsx` - Patient statistics display (bar charts)
- `AppointmentStatsSection.tsx` - Appointment statistics display (bar chart + table views)
- `MessageStatsSection.tsx` - Message statistics display (table view)
- Use Recharts for bar charts (`BarChart`, `Bar`, `Cell`, `XAxis`, `YAxis`, `ResponsiveContainer`, `Label`)
- Use existing `BaseModal` component from `frontend/src/components/shared/BaseModal.tsx` for info modals
- Use existing info icon pattern (SVG icon) for info buttons

#### API Integration
- `GET /clinic/dashboard/metrics` - Get all dashboard metrics
  - No query params needed - always returns past 3 months + current month
  - Returns: `ClinicDashboardMetricsResponse`

#### State Management
- Use React Query for data fetching
- Cache for 1-2 minutes (metrics don't need real-time updates)
- Optional: Auto-refresh every 5 minutes

### Backend

#### New API Endpoint

**GET /clinic/dashboard/metrics**
- Returns aggregated metrics for the clinic by month
- Access: All clinic members (read-only users can view)
- Always returns: Past 3 months + current month
- Response: `ClinicDashboardMetricsResponse`

#### Response Schema
```python
class ClinicDashboardMetricsResponse(BaseModel):
    # Month info
    months: List[MonthInfo]  # Past 3 months + current month
    
    # Patient metrics (by month)
    active_patients_by_month: List[MonthlyPatientStat]  # Active patients for each month (patients with appointments in that month, non-cancelled)
    new_patients_by_month: List[MonthlyPatientStat]  # New patients for each month
    
    # Appointment metrics (by month)
    appointments_by_month: List[MonthlyAppointmentStat]  # Non-cancelled appointments for each month
    cancellation_rate_by_month: List[MonthlyCancellationStat]  # Cancellation breakdown for each month
    appointment_type_stats_by_month: List[MonthlyAppointmentTypeStat]  # By month
    practitioner_stats_by_month: List[MonthlyPractitionerStat]  # By month
    
    # Message metrics (by month)
    paid_messages_by_month: List[MonthlyMessageStat]  # Paid messages breakdown by event type for each month
    ai_reply_messages_by_month: List[MonthlyMessageStat]  # AI replies for each month

class MonthInfo(BaseModel):
    """Month information"""
    year: int
    month: int  # 1-12
    display_name: str  # e.g., "2024年1月"
    is_current: bool

class MonthlyPatientStat(BaseModel):
    """New patients for a specific month"""
    month: MonthInfo
    count: int

class MonthlyAppointmentStat(BaseModel):
    """Non-cancelled appointments for a specific month"""
    month: MonthInfo
    count: int

class MonthlyCancellationStat(BaseModel):
    """Cancellation breakdown for a specific month"""
    month: MonthInfo
    canceled_by_clinic_count: int
    canceled_by_clinic_percentage: float
    canceled_by_patient_count: int
    canceled_by_patient_percentage: float
    total_canceled_count: int
    total_cancellation_rate: float

class MonthlyAppointmentTypeStat(BaseModel):
    """Appointment type statistics for a specific month"""
    month: MonthInfo
    appointment_type_id: int
    appointment_type_name: str
    count: int  # Non-cancelled only
    percentage: float

class MonthlyPractitionerStat(BaseModel):
    """Practitioner statistics for a specific month"""
    month: MonthInfo
    user_id: int
    practitioner_name: str
    count: int  # Non-cancelled only
    percentage: float

class MonthlyMessageStat(BaseModel):
    """Message statistics for a specific month"""
    month: MonthInfo
    recipient_type: Optional[str]  # 'patient', 'practitioner', 'admin', None for AI replies
    event_type: Optional[str]  # Event type code, None for AI replies
    event_display_name: str  # Display name for the event (e.g., "預約確認")
    trigger_source: Optional[str]  # 'clinic_triggered', 'patient_triggered', 'system_triggered', None for AI replies
    count: int
    # Note: For dashboard display, we group by recipient_type and event_type
    # trigger_source is available for future regrouping features

# Message event types (for reference):
# To Patients:
# - 'appointment_confirmation' - 預約確認 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'appointment_cancellation' - 預約取消 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'appointment_edit' - 預約調整 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'appointment_reminder' - 預約提醒 (trigger_source: 'system_triggered')
# - 'availability_notification' - 空檔通知 (trigger_source: 'system_triggered')
# To Practitioners:
# - 'new_appointment_notification' - 新預約通知 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'appointment_cancellation_notification' - 預約取消通知 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'appointment_edit_notification' - 預約調整通知 (trigger_source: 'clinic_triggered' or 'patient_triggered')
# - 'daily_appointment_reminder' - 每日預約提醒 (trigger_source: 'system_triggered')
# To Admins:
# - 'auto_assigned_notification' - 待審核預約通知 (trigger_source: 'system_triggered')
#
# Note: The flexible label system allows regrouping by trigger_source in the future
# (e.g., all clinic-triggered vs patient-triggered messages) without losing historical data.

```

#### Service Layer
- Create `DashboardService` with:
  - `get_clinic_metrics(db, clinic_id) -> ClinicDashboardMetricsResponse`
- Use existing services:
  - `PatientService` for patient counts and active patient queries
  - `AppointmentService` for appointment queries and status breakdowns
  - `LineMessageService` for message statistics
- New methods needed:
  - `get_active_patients_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyPatientStat]` - Patients with appointments in each month (non-cancelled only)
  - `get_new_patients_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyPatientStat]` - Patients created in each month
  - `get_appointments_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyAppointmentStat]` - Non-cancelled appointments for each month
  - `get_cancellation_rate_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyCancellationStat]` - Cancellation breakdown for each month
  - `get_appointment_type_stats_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyAppointmentTypeStat]` - Appointment type stats for each month (all types)
  - `get_practitioner_stats_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyPractitionerStat]` - Practitioner stats for each month
  - `get_paid_messages_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyMessageStat]` - Paid messages breakdown by event type for each month
  - `get_ai_reply_messages_by_month(db, clinic_id, months: List[MonthInfo]) -> List[MonthlyMessageStat]` - AI replies for each month
  
  **Note:** All service methods return `List[...]` format (by month) to match the response schema. The API layer will transform this data into the appropriate format for the response. For table views, the frontend will transpose the data as needed (rows = types/practitioners, columns = months).

#### Current Database Tracking Status

**Currently NOT tracked:**
- ❌ Push messages (paid messages) are NOT currently tracked in the database
- ❌ Message counts for dashboard metrics are NOT currently tracked
- ✅ AI reply messages are stored in `LineMessage` table (`is_from_user=False`) but not specifically tracked for dashboard metrics

**What needs to be implemented:**
- New `LinePushMessage` model to track all push messages
- Update `LINEService.send_text_message()` to record push messages
- Query logic for aggregating message statistics by month

#### Message Tracking

- **Paid Messages (Push Messages):**
  - **Current State:** Push messages are NOT currently tracked in the database. This is a new feature that needs to be implemented.
  - **Implementation:** Track when `LINEService.send_text_message()` is called without `reply_token` (push messages)
  - **Model Design:** Create `LinePushMessage` model with flexible multi-label system (see below)
  - **Migration Strategy:**
    - No historical data exists (push messages were never tracked)
    - Start tracking from implementation date (no backfill needed)
    - Existing clinics will have no historical message statistics until they send new messages
    - This is acceptable for MVP - historical data would require LINE API integration to retrieve past messages

- **AI Reply Messages (Free):**
  - **Current State:** AI reply messages are stored in `LineMessage` table (`is_from_user=False`) but not specifically tracked for dashboard metrics
  - **Implementation:** Query `LineMessage` table where `is_from_user=False` and filter by `created_at` within period
  - These are reply messages (free) sent via `reply_token`

#### LinePushMessage Model Design

**Flexible Multi-Label System:**

To support future regrouping and extensibility, we use a hybrid approach with both indexed columns and flexible labels:

```python
class LinePushMessage(Base):
    """
    Track LINE push messages (paid messages) for dashboard metrics.
    
    Uses a flexible multi-label system to support:
    - Current grouping needs (recipient type, event type, trigger source)
    - Future regrouping without losing history
    - Extensibility for new event types and labels
    """
    
    __tablename__ = "line_push_messages"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    """Unique identifier for the push message record."""
    
    line_user_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    """Recipient LINE user ID."""
    
    clinic_id: Mapped[int] = mapped_column(ForeignKey("clinics.id", ondelete="CASCADE"), nullable=False, index=True)
    """Clinic ID."""
    
    line_message_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    """LINE message ID from LINE API response (for correlation with LineMessage if needed)."""
    
    # Core indexed labels for efficient querying
    recipient_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    """Recipient type: 'patient', 'practitioner', or 'admin'."""
    
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    """Event type: 'appointment_confirmation', 'appointment_cancellation', etc."""
    
    trigger_source: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    """Trigger source: 'clinic_triggered', 'patient_triggered', or 'system_triggered'."""
    
    # Flexible labels for future extensibility (JSONB)
    labels: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    """
    Flexible labels dictionary for additional metadata.
    
    Examples:
    - {'appointment_context': 'new_appointment'}  # For appointment-related messages
    - {'priority': 'high'}  # For future priority-based grouping
    - {'campaign_id': 'summer_2024'}  # For future campaign tracking
    - {'message_category': 'notification'}  # For future categorization
    
    This allows regrouping messages in the future without losing historical data.
    """
    
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True
    )
    """Timestamp when the message was sent."""
    
    # Composite index for efficient dashboard queries
    __table_args__ = (
        Index('idx_push_messages_clinic_created', 'clinic_id', 'created_at'),
        Index('idx_push_messages_labels', 'clinic_id', 'recipient_type', 'event_type', 'trigger_source'),
    )
```

**Label System Design:**

1. **Core Labels (Indexed Columns):**
   - `recipient_type`: 'patient', 'practitioner', 'admin'
   - `event_type`: Specific event code (see Event Types below)
   - `trigger_source`: 'clinic_triggered', 'patient_triggered', 'system_triggered'

2. **Flexible Labels (JSONB):**
   - `appointment_context`: 'new_appointment', 'existing_appointment', 'reschedule', 'cancellation' (for appointment-related messages)
   - Future labels can be added without schema changes (e.g., 'priority', 'campaign_id', 'message_category')

3. **Event Types:**
   - `appointment_confirmation` - Appointment created/confirmed
   - `appointment_cancellation` - Appointment canceled
   - `appointment_edit` - Appointment time/practitioner changed
   - `appointment_reminder` - Automated reminder before appointment
   - `availability_notification` - New availability slots available
   - `new_appointment_notification` - New appointment assigned to practitioner
   - `appointment_cancellation_notification` - Appointment canceled (to practitioner)
   - `appointment_edit_notification` - Appointment edited/reassigned (to practitioner)
   - `daily_appointment_reminder` - Daily notification of upcoming appointments (to practitioner)
   - `auto_assigned_notification` - Daily notification of pending auto-assigned appointments (to admin)

**Benefits of This Design:**
- ✅ **Efficient Querying:** Core labels are indexed for fast dashboard queries
- ✅ **Future-Proof:** JSONB labels allow adding new dimensions without schema changes
- ✅ **Regrouping:** Can regroup messages by any combination of labels (e.g., all clinic-triggered vs patient-triggered)
- ✅ **No Data Loss:** Historical messages retain all labels, enabling retrospective analysis
- ✅ **Extensible:** New event types can be added by simply using new `event_type` values

**Implementation:**

1. Modify `LINEService.send_text_message()` to accept optional `labels` parameter:
   ```python
   def send_text_message(
       self, 
       line_user_id: str, 
       text: str, 
       reply_token: Optional[str] = None,
       labels: Optional[Dict[str, str]] = None  # New parameter
   ) -> Optional[str]:
   ```

2. When `reply_token` is None (push message), create `LinePushMessage` record **only after successful LINE API call**:
   ```python
   if reply_token is None:
       # Send push message via LINE API
       response = self.api.push_message(request)
       message_id = extract_message_id(response)
       
       # Only track if LINE API call succeeded and labels provided
       if message_id and labels:
           # Create LinePushMessage record
           push_message = LinePushMessage(
               line_user_id=line_user_id,
               clinic_id=clinic_id,
               line_message_id=message_id,
               recipient_type=labels.get('recipient_type'),
               event_type=labels.get('event_type'),
               trigger_source=labels.get('trigger_source'),
               labels=labels  # Store all labels including flexible ones
           )
           db.add(push_message)
           db.commit()  # Commit after successful send
   ```
   
   **Error Handling:**
   - Only create `LinePushMessage` record if LINE API call succeeds
   - If LINE API fails, do not create tracking record (message wasn't sent)
   - Use database transaction to ensure atomicity: if commit fails, rollback
   - Consider: If LINE API succeeds but database commit fails, message is sent but not tracked (acceptable for MVP)

3. Update all call sites to pass labels:
   - `NotificationService.send_appointment_confirmation()` → 
     ```python
     labels = {
         'recipient_type': 'patient',
         'event_type': 'appointment_confirmation',
         'trigger_source': 'clinic_triggered' if from_clinic else 'patient_triggered',
         'appointment_context': 'new_appointment'
     }
     ```
   - Similar pattern for all other notification methods

**Querying Examples:**

- Group by recipient type and event type (current dashboard):
  ```sql
  SELECT recipient_type, event_type, COUNT(*) 
  FROM line_push_messages 
  WHERE clinic_id = ? AND created_at >= ? AND created_at < ?
  GROUP BY recipient_type, event_type
  ```

- Regroup by trigger source (future feature):
  ```sql
  SELECT trigger_source, COUNT(*) 
  FROM line_push_messages 
  WHERE clinic_id = ? AND created_at >= ? AND created_at < ?
  GROUP BY trigger_source
  ```

- Filter by flexible labels (future feature):
  ```sql
  SELECT * FROM line_push_messages 
  WHERE clinic_id = ? 
    AND labels->>'appointment_context' = 'new_appointment'
    AND trigger_source = 'patient_triggered'
  ```

#### Database Queries
- Optimize with proper indexes (already exist for most queries)
- Use aggregation queries (COUNT, GROUP BY) for efficiency
- For trend data, use date-based GROUP BY queries
- Cache expensive calculations if needed (e.g., monthly stats)
- Consider materialized views for complex aggregations if performance becomes an issue

## Permissions
- **View dashboard:** All clinic members (admin, practitioner, read-only)

## UI/UX Considerations
- Clean, section-based layout
- **Table views:**
  - Use clear table headers
  - Highlight current month (e.g., different background color or border)
  - Show note for current month: "當月數據可能仍會變動"
  - Make tables responsive (horizontal scroll on mobile)
- **Bar chart (Appointments):**
  - Use different styling (e.g., dashed border, lighter color, pattern fill) for current month
  - Show note: "當月數據可能仍會變動"
  - Make chart interactive (hover for details)
  - Responsive chart (mobile-friendly)
- **Active Patients note:**
  - Display via info icon with modal (use existing info icon pattern and `BaseModal` component)
  - Modal content: "活躍病患定義：該月有預約的病患（不含已取消）" (Active patients: Patients with appointments in that month, excluding cancelled)
  - Follow existing pattern from `ChatSettings`, `CompactScheduleSettings`, etc.
- **Message section:**
  - Clearly label paid vs free messages
  - Show "免費" (Free) badge on AI reply messages section
  - Group event types by recipient type in table
  - Show totals for each recipient type and grand total
- Loading states for data fetching
- Error handling with retry option
- Responsive design (mobile-friendly)
- Optional: Refresh button for manual refresh
- Optional: Export metrics as CSV/PDF

## Implementation Plan - Incremental PRs

### PR 1: Database Model for Push Message Tracking ⏳ IN PROGRESS
**Scope:** Create `LinePushMessage` model and database migration
- Create `LinePushMessage` model with flexible multi-label system
  - Core indexed columns: `recipient_type`, `event_type`, `trigger_source`
  - Flexible JSONB `labels` column
  - Composite indexes for efficient queries
- Create Alembic migration
- Add model to `models/__init__.py`
- **Testing:** Unit tests for model creation and validation

### PR 2: Update LINEService to Track Push Messages ⏳ IN PROGRESS
**Scope:** Modify `LINEService.send_text_message()` to record push messages
- Update `LINEService.send_text_message()` to accept optional `labels` parameter
- Create `LinePushMessage` record only after successful LINE API call (when `reply_token` is None)
- Add error handling: only track if LINE API succeeds
- **Testing:** Unit tests for message tracking logic, error handling

### PR 3: Update Notification Services to Pass Labels
**Scope:** Update all notification service methods to pass labels when sending push messages
- Update `NotificationService.send_appointment_confirmation()` - detect trigger source (clinic vs patient)
- Update `NotificationService.send_appointment_cancellation()` - pass trigger source
- Update `NotificationService.send_appointment_edit_notification()` - pass trigger source
- Update `ReminderService._send_reminder_for_appointment()` - pass system_triggered
- Update `AvailabilityNotificationService._send_notification()` - pass system_triggered
- Update `NotificationService.send_practitioner_appointment_notification()` - pass trigger source
- Update `NotificationService.send_practitioner_cancellation_notification()` - pass trigger source
- Update `NotificationService.send_practitioner_edit_notification()` - pass trigger source
- Update `PractitionerDailyNotificationService._send_notification_for_practitioner()` - pass system_triggered
- Update `AdminAutoAssignedNotificationService._send_notification_for_admin()` - pass system_triggered
- **Testing:** Integration tests to verify labels are correctly passed and stored

### PR 4: Backend - Patient and Appointment Statistics Service ✅ COMPLETED
**Scope:** Implement service methods for patient and appointment statistics
- Create `DashboardService` class
- Implement `get_active_patients_by_month()` - patients with appointments in each month (non-cancelled)
- Implement `get_new_patients_by_month()` - patients created in each calendar month
- Implement `get_appointments_by_month()` - non-cancelled appointments for each month
- Implement `get_cancellation_rate_by_month()` - cancellation breakdown by clinic/patient
- Implement `get_appointment_type_stats_by_month()` - appointment type stats (all types)
- Implement `get_practitioner_stats_by_month()` - practitioner stats
- **Testing:** Unit tests for each service method with various data scenarios

### PR 5: Backend - Message Statistics Service
**Scope:** Implement service methods for message statistics
- Implement `get_paid_messages_by_month()` - paid messages breakdown by event type
- Implement `get_ai_reply_messages_by_month()` - AI replies from `LineMessage` table
- Query logic for aggregating by month, recipient type, and event type
- **Testing:** Unit tests for message aggregation logic

### PR 6: Backend - Dashboard API Endpoint
**Scope:** Create API endpoint that aggregates all metrics
- Create `GET /clinic/dashboard/metrics` endpoint
- Implement `get_clinic_metrics()` method that calls all service methods
- Return `ClinicDashboardMetricsResponse` with all metrics
- Add route to `App.tsx` (backend routing)
- **Testing:** Integration tests for API endpoint, verify response schema

### PR 7: Frontend - Patient Statistics Section
**Scope:** Implement patient statistics UI with bar charts
- Create `PatientStatsSection.tsx` component
- Use Recharts for bar charts (`BarChart`, `Bar`, `Cell`, `XAxis`, `YAxis`, `ResponsiveContainer`, `Label`)
- Implement "活躍病患" bar chart (active patients by month)
- Implement "新增病患" bar chart (new patients by month)
- Add info icon with modal for active patients definition (use existing `BaseModal` pattern)
- Conditional styling for current month (different color/opacity using `Cell` component)
- Labels above bars showing values
- **Testing:** Component tests, visual regression tests

### PR 8: Frontend - Appointment Statistics Section
**Scope:** Implement appointment statistics UI with bar chart and tables
- Create `AppointmentStatsSection.tsx` component
- Implement "本月預約數" bar chart (appointments by month)
- Implement "取消率" table (cancellation rate breakdown)
- Implement "預約類型統計" table (appointment type stats)
- Implement "治療師預約統計" table (practitioner stats)
- Use Recharts for bar chart, HTML tables for data tables
- Conditional styling for current month in bar chart
- Sticky left column for table row headers
- **Testing:** Component tests, table rendering tests

### PR 9: Frontend - Message Statistics Section
**Scope:** Implement message statistics UI with tables
- Create `MessageStatsSection.tsx` component
- Implement "付費訊息" table (paid messages breakdown by recipient type and event type)
- Implement "AI 回覆訊息" table (AI reply messages)
- Add info icons with modals for paid messages and AI replies (use existing `BaseModal` pattern)
- Sticky left column for group headers ("發送給病患", "發送給治療師", "發送給管理員")
- Show subtotals and grand totals
- Percentage calculations relative to grand total
- **Testing:** Component tests, table rendering tests

### PR 10: Frontend - Dashboard Page Integration
**Scope:** Create main dashboard page and integrate with navigation
- Create `ClinicDashboardPage.tsx` main component
- Integrate all sections (PatientStatsSection, AppointmentStatsSection, MessageStatsSection)
- Add route in `App.tsx` under ClinicLayout routes
- Add menu item in `ClinicLayout.tsx` under "診所管理" group
- Implement data fetching using React Query (`useApiData` hook)
- Add loading states and error handling
- Responsive design (mobile-friendly)
- **Testing:** Integration tests, E2E tests for full dashboard flow

## Decisions
- **Tracking Unit:** Consistently use month as the tracking unit for all statistics (patient, appointment, message)
- **Time Range:** Always show past 3 months + current month
- **Time on Horizontal Axis:** All charts and tables use time (months) on the horizontal axis for consistency
- **Bar Charts:** Use vertical bar charts (bars go up) with time on horizontal axis
- **Active Patients:** Defined as patients who have at least one non-cancelled appointment in that month (changed from "last 60 days"). This can share the same DB query result as appointments.
- **New Patients:** Count patients where `created_at` falls within each calendar month (first day to last day, Taiwan timezone). Renamed from "本月新增病患" to "新增病患".
- **Appointments:** Only count non-cancelled appointments for appointment counts and statistics
- **Cancellation Rate:** Show both percentage and count in same cell format "Count(Percentage%)", with breakdown by 診所取消 (canceled by clinic) vs 病患取消 (canceled by patient). Table format: rows = cancellation types, columns = months.
- **Appointment Types:** Show all appointment types (not just top 5). Table format: rows = appointment types, columns = months. Each cell shows "Count(Percentage%)".
- **Practitioners:** Table format: rows = practitioners, columns = months. Each cell shows "Count(Percentage%)".
- **Table Views:** Use table views for cancellation rate, appointment type stats, practitioner stats, and message stats. All tables have time (months) on horizontal axis.
- **Message Statistics:** Show all event types from design doc. Each cell shows "Count(Percentage%)" format. Include subtotals by recipient type and grand total.
- **Current Month Notes:** Always show note that current month data may still change
- **Message Tracking:**
  - Create `LinePushMessage` model to track paid push messages with flexible multi-label system (`recipient_type`, `event_type`, `trigger_source`, and flexible JSONB `labels`)
  - Track all event types separately to enable future per-event-type toggle functionality
  - Query `LineMessage` table for free AI replies (`is_from_user=False`)
  - Clearly distinguish paid vs free in UI
  - Show breakdown by recipient type and event type for cost visibility
  - `trigger_source` is tracked but not displayed in current dashboard (available for future regrouping)
  - No comparison vs last month
  - No estimated cost display
- **Real-time vs cached:** Cache metrics for 1-2 minutes (balance between freshness and performance)
- **Layout:** Show detailed metrics within each section using tables and charts
- **Chart Library:** Use Recharts for bar charts
  - Automatic scaling based on max value
  - Responsive design with `ResponsiveContainer`
  - Conditional styling for current month using `Cell` component (different color/opacity to differentiate from past months)
  - Labels above bars using `Label` component
  - Vertical bar charts with time on horizontal axis
  - Easy to implement and maintain
- **Info Icons and Modals:** Use existing info icon pattern and `BaseModal` component from the clinic admin platform
  - Info icon: SVG icon with standard info circle pattern (used in `ChatSettings`, `CompactScheduleSettings`, etc.)
  - Modal: Use `BaseModal` from `frontend/src/components/shared/BaseModal.tsx`
  - Follow existing pattern: button with info icon opens modal with explanation

