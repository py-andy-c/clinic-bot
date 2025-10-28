# Practitioner Calendar & Availability Management

## Overview

This document outlines the design for practitioner availability management in the Clinic Bot system. The design prioritizes user experience by following familiar patterns from Google Calendar while providing flexibility for healthcare-specific needs.

> **Note**: Time zone handling is not addressed in this design. All times are assumed to be in the clinic's local timezone. Time zone support can be added in future iterations.

## Design Principles

### **1. Practitioner-Centric Approach**
- Each practitioner manages their own availability
- No clinic-wide "business hours" - practitioners set their own schedules
- Flexible scheduling that accommodates part-time, different shifts, and personal preferences

### **2. Google Calendar-like UX**
- **Settings Form**: For default weekly schedule patterns
- **Calendar UI**: For exceptions and appointments
- **Familiar Interactions**: Tap to navigate, simple gestures

### **3. Multiple Time Intervals**
- Support for multiple working periods per day (e.g., 9am-12pm, 2pm-6pm)
- Common in healthcare where practitioners have morning and afternoon sessions
- Simple list-based interface for adding/removing intervals

## User Experience Design

### **Default Schedule Management (Settings Form)**

#### **Weekly Schedule Interface**
```
┌─────────────────────────────────────────────────────────────┐
│ Default Working Hours                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Monday                                                      │
│ • 09:00 - 12:00  [Remove]                                  │
│ • 14:00 - 18:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Tuesday                                                     │
│ • 09:00 - 17:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Wednesday                                                   │
│ • 09:00 - 12:00  [Remove]                                  │
│ • 14:00 - 18:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Thursday                                                    │
│ • 09:00 - 17:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Friday                                                      │
│ • 09:00 - 17:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Saturday                                                    │
│ • 10:00 - 14:00  [Remove]                                  │
│ [+ Add Interval]                                            │
│                                                             │
│ Sunday                                                      │
│ [+ Add Interval]                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Add Interval Flow**
1. **Click "+ Add Interval"** → Time picker appears
2. **Select start time** → "09:00"
3. **Select end time** → "12:00"
4. **Click "Add"** → Interval appears in list
5. **Repeat** for additional intervals

#### **Default Availability Change Flow**
1. **Modify intervals** → Add/remove time intervals
2. **System validates** → Prevents overlapping intervals
3. **System checks** → Scans future appointments for conflicts
4. **If conflicts exist** → Show warning message with affected appointments
5. **User confirms** → Changes saved, appointments remain outside hours
6. **Visual indicators** → Affected appointments marked as "outside hours"

#### **Add Exception Flow**
1. **Tap time slot in daily view** → Time picker appears
2. **Select start time** → "14:00" (or leave blank for all-day)
3. **Select end time** → "18:00" (or leave blank for all-day)
4. **System checks** → Scans for appointment conflicts
5. **If conflicts exist** → Show warning message with affected appointments (similar to Default Availability Change Flow)
6. **User confirms** → Exception created, appointments remain valid but marked as "outside hours"
7. **Click "Save"** → Exception saved to database
8. **Return to daily view** → Exception visible as red block, conflicting appointments marked as "outside hours"

### **Calendar UI (Google Calendar Mobile Style)**

> **Note**: The user experience should be as close to Google Calendar mobile app as possible. The illustrations below are simplified representations - the actual UI should follow Google Calendar's exact interaction patterns, visual design, and user flows.

#### **Monthly Calendar View**
```
┌─────────────────────────────────────────────────────────────┐
│ Dr. Chen's Schedule - January 2025                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [<] January 2025 [>]                                       │
│                                                             │
│  Mon  Tue  Wed  Thu  Fri  Sat  Sun                         │
│   1    2    3    4    5    6    7                          │
│  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐                       │
│  │2│  │1│  │3│  │2│  │1│  │1│  │ │                        │
│  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘                       │
│                                                             │
│   8    9   10   11   12   13   14                          │
│  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐                       │
│  │1│  │2│  │ │  │3│  │1│  │2│  │ │                        │
│  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘                       │
│                                                             │
│  15   16   17   18   19   20   21                          │
│  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐                       │
│  │1│  │2│  │2│  │1│  │3│  │1│  │ │                        │
│  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘                       │
│                                                             │
│  22   23   24   25   26   27   28                          │
│  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐  ┌─┐                       │
│  │2│  │1│  │3│  │1│  │2│  │1│  │ │                        │
│  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘  └─┘                       │
│                                                             │
│  29   30   31                                               │
│  ┌─┐  ┌─┐  ┌─┐                                             │
│  │1│  │2│  │ │                                             │
│  └─┘  └─┘  └─┘                                             │
│                                                             │
│  Legend:                                                    │
│  Number = Appointments                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Daily View (Time-based Schedule)**
```
┌─────────────────────────────────────────────────────────────┐
│ Dr. Chen's Schedule - Monday, Jan 15                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 08:00 ────────── 09:00  (Grayed Out)                     │
│ 09:00 ────────── 12:00  (Default Availability)          │
│ 10:00 ────────── 11:00  [陳小姐 - 初診評估]                │
│ 11:00 ────────── 12:00  (Default Availability)          │
│ 12:00 ────────── 14:00  (Grayed Out)                     │
│ 14:00 ────────── 15:00  (Default Availability)           │
│ 15:00 ────────── 16:00  [王先生 - 一般複診] (Outside Hours) │
│ 16:00 ────────── 17:00  (Default Availability)           │
│ 17:00 ────────── 18:00  [🔴 Unavailable]                   │
│ 18:00 ────────── 19:00  [🔴 Unavailable]                   │
│ 19:00 ────────── 20:00  [🔴 Unavailable]                   │
│ 20:00 ────────── 22:00  (Grayed Out)                     │
│                                                             │
│ [Tap event to edit]                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### **Calendar Interactions**

> **Note**: Follow Google Calendar mobile app patterns exactly - tap for navigation/selection.

#### **Navigation Flow**
1. **Settings Access**: Tap practitioner name/profile → "Availability Settings" → Weekly Schedule Interface
2. **Monthly → Daily**: Tap any day in monthly view → Navigate to daily view for that date
3. **Daily → Monthly**: Tap back button or month/year header → Return to monthly view
4. **Date Navigation**: Use month/year picker or swipe gestures to navigate between months

#### **Monthly View**
- **Tap any day** → Navigate to daily view
- **Visual indicators**: Numbers = appointment count
- **Month navigation**: Swipe left/right or use month picker

#### **Daily View** 
- **Tap existing event** → Edit details (delete option only - no rescheduling)
- **Tap time slot** → Add availability exception
- **Tap back** → Return to monthly view

#### **Event Types**
- **Appointments**: Patient bookings (colored blocks)
- **Availability Exceptions**: Unavailability periods (red background)

#### **Conflict Prevention**
- **AI Agent**: Only sees truly available slots
- **Exception Conflicts**: Practitioner can create exceptions that conflict with appointments (shows warning)
- **Patient Notification**: Automatic LINE message when appointments deleted
- **Deletion**: Done through edit view, not swipe gestures

## Technical Implementation

### **Database Schema**

#### **Schema Design: Hybrid Approach**

The database uses a hybrid approach with a base `calendar_events` table and specialized tables for different event types:

**Benefits:**
- **Unified Calendar View**: Single query for all events (appointments + exceptions)
- **Consistent Google Calendar Sync**: Same sync logic for all event types
- **Type Safety**: Specialized tables maintain data integrity
- **Extensibility**: Easy to add new event types in the future
- **Performance**: Optimized indexes for each use case

**Architecture:**
- `calendar_events`: Base table with common fields (timing, sync, metadata)
- `appointments`: Specialized table with patient/appointment-specific data
- `availability_exceptions`: Specialized table for unavailability periods
- `practitioner_availability`: Default weekly schedule (unchanged)

#### **Default Working Hours**
```sql
CREATE TABLE practitioner_availability (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT check_valid_time_range CHECK (start_time < end_time),
    CONSTRAINT check_day_of_week_range CHECK (day_of_week >= 0 AND day_of_week <= 6)
);

-- Index for fast lookups
CREATE INDEX idx_practitioner_availability_user_day 
ON practitioner_availability(user_id, day_of_week);

-- Composite index for availability queries
CREATE INDEX idx_practitioner_availability_user_day_time 
ON practitioner_availability(user_id, day_of_week, start_time);
```

#### **Base Calendar Event**
```sql
CREATE TABLE calendar_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL, -- 'appointment', 'availability_exception'
    date DATE NOT NULL,
    start_time TIME,  -- null = all day event
    end_time TIME,    -- null = all day event
    gcal_event_id VARCHAR(255) UNIQUE,  -- For Google Calendar sync
    gcal_watch_resource_id VARCHAR(255), -- For webhook notifications
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT check_valid_time_range CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time),
    CONSTRAINT check_valid_event_type CHECK (event_type IN ('appointment', 'availability_exception'))
);

-- Index for fast date lookups
CREATE INDEX idx_calendar_events_user_date 
ON calendar_events(user_id, date);

-- Index for event type queries
CREATE INDEX idx_calendar_events_type 
ON calendar_events(event_type);

-- Index for Google Calendar sync
CREATE INDEX idx_calendar_events_gcal_sync 
ON calendar_events(gcal_event_id);

-- Composite index for calendar queries (user + date + type)
CREATE INDEX idx_calendar_events_user_date_type 
ON calendar_events(user_id, date, event_type);
```

#### **Appointments (Specialized)**
```sql
CREATE TABLE appointments (
    calendar_event_id INTEGER PRIMARY KEY REFERENCES calendar_events(id) ON DELETE CASCADE,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    appointment_type_id INTEGER NOT NULL REFERENCES appointment_types(id),
    status VARCHAR(50) NOT NULL -- 'confirmed', 'canceled_by_patient', 'canceled_by_clinic'
);

-- Index for patient queries
CREATE INDEX idx_appointments_patient 
ON appointments(patient_id);
```

#### **Availability Exceptions (Specialized)**
```sql
CREATE TABLE availability_exceptions (
    id SERIAL PRIMARY KEY,
    calendar_event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE
);

-- Index for exception queries
CREATE INDEX idx_availability_exceptions_calendar_event 
ON availability_exceptions(calendar_event_id);

-- Note: Multiple exceptions per day are allowed. Overlapping exceptions 
-- for the same practitioner are also allowed (e.g., 10am-12pm and 11am-1pm).
```

### **API Endpoints**

#### **Default Schedule Management**
```typescript
// Get practitioner's default schedule
GET /api/clinic/practitioners/{user_id}/availability/default

// Update default schedule
PUT /api/clinic/practitioners/{user_id}/availability/default
{
  "monday": [
    { "start_time": "09:00", "end_time": "12:00" },
    { "start_time": "14:00", "end_time": "18:00" }
  ],
  "tuesday": [
    { "start_time": "09:00", "end_time": "17:00" }
  ]
  // ... other days
}
```

#### **Calendar Data**
```typescript
// Get calendar data for a month (monthly view)
GET /api/clinic/practitioners/{user_id}/availability/calendar?month=2025-01&page=1&limit=31
{
  "month": "2025-01",
  "total_days": 31,
  "page": 1,
  "limit": 31,
  "days": [
    {
      "date": "2025-01-01",
      "appointment_count": 2
    },
    {
      "date": "2025-01-02", 
      "appointment_count": 1
    },
    {
      "date": "2025-01-03",
      "appointment_count": 3
    },
    {
      "date": "2025-01-15",
      "appointment_count": 1
    }
  ]
}

// Get calendar data for a specific day (daily view)
GET /api/clinic/practitioners/{user_id}/availability/calendar?date=2025-01-15
{
  "date": "2025-01-15",
  "default_schedule": [
    { "start_time": "09:00", "end_time": "12:00" },
    { "start_time": "14:00", "end_time": "18:00" }
  ],
  "events": [
    {
      "calendar_event_id": 1,
      "type": "appointment",
      "start_time": "10:00",
      "end_time": "11:00",
      "title": "陳小姐 - 初診評估",
      "patient_id": 1,
      "appointment_type_id": 1,
      "status": "confirmed"
    },
    {
      "calendar_event_id": 2,
      "type": "availability_exception",
      "start_time": "17:00",
      "end_time": "18:00",
      "title": "Unavailable",
      "exception_id": 1
    },
    {
      "calendar_event_id": 3,
      "type": "availability_exception",
      "start_time": "18:00",
      "end_time": "19:00",
      "title": "Unavailable",
      "exception_id": 2
    },
    {
      "calendar_event_id": 4,
      "type": "availability_exception",
      "start_time": "19:00",
      "end_time": "20:00",
      "title": "Unavailable",
      "exception_id": 3
    }
  ]
}

// Get available slots for booking (AI agent use)
GET /api/clinic/practitioners/{user_id}/availability/slots?date=2025-01-15&appointment_type_id=1
{
  "available_slots": [
    {
      "start_time": "09:00",
      "end_time": "10:00"
    },
    {
      "start_time": "11:00", 
      "end_time": "12:00"
    }
  ]
}
```

#### **Exception Management**
```typescript
// Create exception
POST /api/clinic/practitioners/{user_id}/availability/exceptions
{
  "date": "2025-01-15",
  "start_time": "14:00",
  "end_time": "18:00"
}

// Response
{
  "calendar_event_id": 2,
  "exception_id": 1,
  "date": "2025-01-15",
  "start_time": "14:00",
  "end_time": "18:00",
  "gcal_event_id": "gcal_event_123",
  "created_at": "2025-01-10T10:00:00Z"
}

// Update exception
PUT /api/clinic/practitioners/{user_id}/availability/exceptions/{exception_id}
{
  "start_time": "15:00",
  "end_time": "19:00"
}

// Response
{
  "calendar_event_id": 2,
  "exception_id": 1,
  "date": "2025-01-15",
  "start_time": "15:00",
  "end_time": "19:00",
  "gcal_event_id": "gcal_event_123",
  "updated_at": "2025-01-10T11:00:00Z"
}

// Delete exception
DELETE /api/clinic/practitioners/{user_id}/availability/exceptions/{exception_id}

// Response
{
  "message": "Availability exception deleted successfully"
}
```

#### **Error Response Schema**
```typescript
interface ErrorResponse {
  error: string;
  message: string;
  details?: any;
}

interface WarningResponse {
  warning: string;
  message: string;
  details?: any;
}

// Example: Warning when creating availability exception with conflicts
{
  "warning": "appointment_conflicts",
  "message": "This availability exception conflicts with existing appointments. The appointments will remain valid but marked as 'outside hours'.",
  "details": {
    "conflicting_appointments": [
      {
        "calendar_event_id": 1,
        "start_time": "14:00",
        "end_time": "15:00",
        "patient": "陳小姐"
      }
    ]
  }
}

// Example: Warning when default availability changes affect appointments
{
  "warning": "appointments_outside_hours",
  "message": "Some appointments will be outside your new working hours",
  "details": {
    "affected_appointments": [
      {
        "calendar_event_id": 1,
        "date": "2025-01-20",
        "time": "18:00-19:00",
        "patient": "陳小姐"
      }
    ]
  }
}

// Example: Overlapping intervals validation error
{
  "error": "overlapping_intervals",
  "message": "Time intervals cannot overlap",
  "details": {
    "conflicting_intervals": ["09:00-12:00", "10:00-14:00"]
  }
}

```

### **AI Agent Integration**

#### **Availability Query with Conflict Prevention**
```python
async def get_practitioner_availability(
    user_id: int, 
    date: datetime,
    appointment_type_id: int
) -> List[TimeSlot]:
    """
    Get available time slots for a practitioner on a specific date.
    
    Args:
        user_id: Practitioner ID
        date: Date to check availability
        appointment_type_id: Appointment type to determine duration
    
    Returns:
        List of available time slots considering:
        - Default weekly schedule
        - Specific day exceptions (takes precedence over appointments)
        - Existing appointments (only if not conflicting with exceptions)
        - Conflict prevention (no overlapping slots)
        - Appointment type duration
    """
    # 1. Get appointment type duration
    appointment_type = await get_appointment_type(appointment_type_id)
    duration = appointment_type.duration_minutes
    
    # 2. Get default schedule for day of week
    default_schedule = await get_default_schedule(user_id, date.weekday())
    
    # 3. Check for exceptions on that date
    exceptions = await get_date_exceptions(user_id, date)
    
    # 4. Get existing appointments
    appointments = await get_appointments(user_id, date)
    
    # 5. Calculate available slots (no conflicts possible)
    available_slots = calculate_slots_without_conflicts(
        default_schedule, 
        exceptions, 
        appointments,
        duration
    )
    
    return available_slots
```

#### **Conflict Detection for Exceptions**
```python
async def check_exception_conflicts(
    user_id: int, 
    date: datetime, 
    start_time: time, 
    end_time: time
) -> List[Appointment]:
    """Check for appointment conflicts before setting availability exception.
    
    Returns conflicting appointments for warning display.
    Appointments remain valid but will be marked as 'outside hours'.
    """
    
    conflicts = await db.query(Appointment).join(CalendarEvent).filter(
        CalendarEvent.user_id == user_id,
        CalendarEvent.event_type == "appointment",
        CalendarEvent.date == date,
        Appointment.status == "confirmed",
        # Check for time overlap
        CalendarEvent.start_time < end_time,
        CalendarEvent.end_time > start_time
    ).all()
    
    return conflicts
```

## Appointment Deletion & Conflict Prevention

### **Conflict Prevention Strategy**
- **AI Agent**: Only sees truly available slots, cannot book conflicts
- **Exception Conflicts**: Practitioner can create exceptions that conflict with appointments (shows warning)
- **Exception Priority**: Availability exceptions take precedence over appointments for future scheduling
- **Appointment Validity**: Conflicting appointments remain valid but marked as "outside hours"
- **Real-time Validation**: Check availability before confirming any changes

### **Appointment Deletion Flows**

#### **1. Practitioner Deletes from Our System**
```python
async def delete_appointment(calendar_event_id: int, practitioner_id: int):
    """Delete appointment and notify patient."""
    
    # 1. Get appointment details with calendar event
    appointment = await db.query(Appointment).join(CalendarEvent).filter(
        Appointment.calendar_event_id == calendar_event_id,
        CalendarEvent.user_id == practitioner_id
    ).first()
    
    if not appointment:
        raise NotFoundError("Appointment not found")
    
    patient = await get_patient(appointment.patient_id)
    
    # 2. Delete from Google Calendar (if synced)
    if appointment.calendar_event.gcal_event_id:
        await delete_gcal_event(appointment.calendar_event.gcal_event_id)
    
    # 3. Update appointment status
    await update_appointment_status(calendar_event_id, "canceled_by_clinic")
    
    # 4. Send LINE message to patient
    await send_cancellation_message(patient.line_user_id, {
        "appointment": appointment,
        "practitioner": practitioner,
        "reschedule_option": True
    })
    
    # 5. Log deletion for audit
    await log_appointment_deletion(calendar_event_id, practitioner_id, "manual_deletion")
```

#### **2. Google Calendar Deletion**
```python
async def handle_gcal_deletion_webhook(event_data: dict):
    """Handle Google Calendar deletion - sync to our system."""
    
    # 1. Find appointment by Google Calendar event ID
    appointment = await db.query(Appointment).join(CalendarEvent).filter(
        CalendarEvent.gcal_event_id == event_data['id'],
        CalendarEvent.event_type == "appointment"
    ).first()
    
    if not appointment:
        return  # Not our event
    
    # 2. Get patient details
    patient = await get_patient(appointment.patient_id)
    
    # 3. Update appointment status
    await update_appointment_status(appointment.calendar_event_id, "canceled_by_clinic")
    
    # 4. Send LINE message to patient
    await send_cancellation_message(patient.line_user_id, {
        "appointment": appointment,
        "practitioner": appointment.calendar_event.user,
        "reschedule_option": True,
        "deletion_source": "google_calendar"
    })
    
    # 5. Log deletion for audit
    await log_appointment_deletion(appointment.calendar_event_id, appointment.calendar_event.user_id, "gcal_deletion")
```

#### **3. Patient LINE Cancellation Message**
```python
async def send_cancellation_message(line_user_id: str, context: dict):
    """Send appointment cancellation message to patient."""
    
    message = f"""
�� 預約取消通知

您的預約已被取消：
• 時間：{context['appointment'].start_time}
• 治療師：{context['practitioner'].name}
• 項目：{context['appointment'].appointment_type}

如需重新預約，請回覆「重新預約」或直接告訴我您方便的時間。

如有疑問，請聯繫診所。
"""
    
    await line_service.send_message(line_user_id, message)
```


## Future Google Calendar Sync

### **Bidirectional Sync Strategy**
- **DB → GCal**: Create/update/delete events in Google Calendar
- **GCal → DB**: Webhook notifications for changes made in Google Calendar
- **Flexible Deletion**: Appointments can be deleted from either system
- **Patient Notification**: Automatic LINE message when appointments are deleted from either source

### **Sync Implementation**
```python
async def sync_to_google_calendar(user_id: int):
    """Sync availability exceptions and appointments to Google Calendar."""
    # 1. Get all events that need syncing
    exceptions = await get_unsynced_exceptions(user_id)
    appointments = await get_unsynced_appointments(user_id)
    
    # 2. Create/update Google Calendar events
    for event in exceptions + appointments:
        gcal_event = await create_or_update_gcal_event(event)
        await update_event_sync_status(event.id, gcal_event['id'])
    
    # 3. Set up webhook for future changes
    await setup_gcal_webhook(user_id)

async def handle_google_calendar_webhook(event_data: dict):
    """Handle Google Calendar webhook notifications."""
    # 1. Find corresponding database event by gcal_event_id
    db_event = await find_event_by_gcal_id(event_data['id'])
    
    # 2. Update database with Google Calendar changes
    await update_event_from_gcal(db_event, event_data)
    
    # 3. Notify patient if appointment changed
    if db_event.event_type == 'appointment':
        await notify_patient_appointment_change(db_event)
```

### **Google Calendar Event Properties**
```python
def create_gcal_event_properties(appointment: Appointment):
    """Create Google Calendar event with clear identification."""
    return {
        "summary": f"{appointment.patient.full_name} - {appointment.appointment_type.name}",
        "description": f"""Patient: {appointment.patient.full_name}
Phone: {appointment.patient.phone_number}
Appointment Type: {appointment.appointment_type.name}
Managed by Clinic Bot - Changes will sync automatically""",
        "colorId": "11",  # Special color for clinic appointments
        "visibility": "private",
        "transparency": "opaque",
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "popup", "minutes": 60},
                {"method": "email", "minutes": 1440}  # 24 hours
            ]
        }
    }
```

### **Sync Fields Explanation**
- **`gcal_event_id`**: Unique identifier from Google Calendar (null = not synced yet)
- **`gcal_watch_resource_id`**: Webhook resource ID for change notifications
- **Sync Policy**: All events sync when user has Google Calendar connected
- **Sync Failure Handling**: Exponential retry (1s, 2s, 4s, 8s), mark as failed after 4 attempts

## Implementation Priority

### **Phase 1: Core Availability**
1. Default weekly schedule management (settings form)
2. Specific day exceptions (calendar UI)
3. Calendar view with visual indicators
4. AI agent integration for availability queries

### **Phase 2: Enhanced UX**
1. Appointment management on calendar
2. Bulk operations (copy schedule, clear exceptions)
3. Smart suggestions based on history

### **Phase 3: Future Features**
1. Google Calendar sync
2. Rescheduling workflows
3. Advanced scheduling algorithms

This design provides a practitioner-centric, intuitive, and extensible approach to availability management that aligns with user expectations while supporting healthcare-specific needs.

## Implementation Changes Required

### **Database Schema Changes**

#### **1. Create New Tables**
```sql
-- Create calendar_events base table
CREATE TABLE calendar_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('appointment', 'availability_exception')),
    date DATE NOT NULL,
    start_time TIME,  -- null = all day event
    end_time TIME,    -- null = all day event
    gcal_event_id VARCHAR(255) UNIQUE,
    gcal_watch_resource_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT check_valid_time_range CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time)
);

-- Create indexes
CREATE INDEX idx_calendar_events_user_date ON calendar_events(user_id, date);
CREATE INDEX idx_calendar_events_type ON calendar_events(event_type);
CREATE INDEX idx_calendar_events_gcal_sync ON calendar_events(gcal_event_id);
CREATE INDEX idx_calendar_events_user_date_type ON calendar_events(user_id, date, event_type);

-- Create availability_exceptions table
CREATE TABLE availability_exceptions (
    id SERIAL PRIMARY KEY,
    calendar_event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_availability_exceptions_calendar_event ON availability_exceptions(calendar_event_id);
```

#### **2. Modify Existing Tables**
```sql
-- Modify appointments table to use calendar_event_id as primary key
-- Step 1: Add calendar_event_id column
ALTER TABLE appointments ADD COLUMN calendar_event_id INTEGER REFERENCES calendar_events(id);

-- Step 2: Migrate existing appointments to calendar_events
-- (Migration script needed to create calendar_events records for existing appointments)

-- Step 3: Drop old columns and constraints
ALTER TABLE appointments DROP COLUMN id;
ALTER TABLE appointments DROP COLUMN user_id;
ALTER TABLE appointments DROP COLUMN start_time;
ALTER TABLE appointments DROP COLUMN end_time;
ALTER TABLE appointments DROP COLUMN gcal_event_id;
ALTER TABLE appointments DROP COLUMN created_at;
ALTER TABLE appointments DROP COLUMN updated_at;

-- Step 4: Make calendar_event_id the primary key
ALTER TABLE appointments ADD PRIMARY KEY (calendar_event_id);

-- Step 5: Update indexes
DROP INDEX idx_user_schedule;
DROP INDEX idx_gcal_sync;
CREATE INDEX idx_appointments_patient ON appointments(patient_id);
```

#### **3. Update practitioner_availability Table**
```sql
-- Remove is_available column (not needed in new design)
ALTER TABLE practitioner_availability DROP COLUMN is_available;

-- Update unique constraint to allow multiple intervals per day
DROP CONSTRAINT uq_user_day_availability;
-- No replacement constraint needed - multiple intervals per day are allowed

-- Add composite index for better performance
CREATE INDEX idx_practitioner_availability_user_day_time 
ON practitioner_availability(user_id, day_of_week, start_time);
```

### **Model Changes**

#### **1. Create New Models**
```python
# backend/src/models/calendar_event.py
class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    event_type: Mapped[str] = mapped_column(String(50))
    date: Mapped[date] = mapped_column(Date)
    start_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    end_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    gcal_event_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gcal_watch_resource_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("User", back_populates="calendar_events")
    appointment = relationship("Appointment", back_populates="calendar_event", uselist=False)
    availability_exception = relationship("AvailabilityException", back_populates="calendar_event", uselist=False)

# backend/src/models/availability_exception.py
class AvailabilityException(Base):
    __tablename__ = "availability_exceptions"
    
    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    calendar_event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id"), primary_key=True)
    
    # Relationships
    calendar_event = relationship("CalendarEvent", back_populates="availability_exception")
```

#### **2. Update Existing Models**
```python
# Update Appointment model
class Appointment(Base):
    __tablename__ = "appointments"
    
    calendar_event_id: Mapped[int] = mapped_column(ForeignKey("calendar_events.id"), primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    appointment_type_id: Mapped[int] = mapped_column(ForeignKey("appointment_types.id"))
    status: Mapped[str] = mapped_column(String(50))
    
    # Relationships
    calendar_event = relationship("CalendarEvent", back_populates="appointment")
    patient = relationship("Patient", back_populates="appointments")
    appointment_type = relationship("AppointmentType", back_populates="appointments")

# Update User model
class User(Base):
    # ... existing fields ...
    
    # Add new relationships
    calendar_events = relationship("CalendarEvent", back_populates="user")
    # Remove old appointments relationship, replace with:
    # appointments = relationship("Appointment", back_populates="calendar_event", secondary="calendar_events")

# Update PractitionerAvailability model
class PractitionerAvailability(Base):
    # ... existing fields ...
    
    # Remove is_available field
    # Remove unique constraint on (user_id, day_of_week)
```

### **API Changes**

#### **1. Update Existing Endpoints**
```python
# Update practitioner availability endpoints to support multiple intervals per day
@router.get("/practitioners/{user_id}/availability/default")
async def get_default_schedule(user_id: int, ...):
    # Return grouped by day with multiple intervals
    return {
        "monday": [
            {"start_time": "09:00", "end_time": "12:00"},
            {"start_time": "14:00", "end_time": "18:00"}
        ],
        # ... other days
    }

@router.put("/practitioners/{user_id}/availability/default")
async def update_default_schedule(user_id: int, schedule_data: dict, ...):
    # Handle multiple intervals per day
    # Remove old intervals and create new ones
    # Check for conflicts with future appointments
```

#### **2. Add New Endpoints**
```python
# Calendar data endpoints
@router.get("/practitioners/{user_id}/availability/calendar")
async def get_calendar_data(user_id: int, month: str = None, date: str = None, ...):
    # Return monthly or daily calendar data with events

# Exception management endpoints
@router.post("/practitioners/{user_id}/availability/exceptions")
async def create_availability_exception(user_id: int, exception_data: dict, ...):
    # Create availability exception with conflict checking

@router.put("/practitioners/{user_id}/availability/exceptions/{exception_id}")
async def update_availability_exception(user_id: int, exception_id: int, ...):
    # Update availability exception

@router.delete("/practitioners/{user_id}/availability/exceptions/{exception_id}")
async def delete_availability_exception(user_id: int, exception_id: int, ...):
    # Delete availability exception

# AI agent availability query
@router.get("/practitioners/{user_id}/availability/slots")
async def get_available_slots(user_id: int, date: str, appointment_type_id: int, ...):
    # Return available time slots for AI agent booking
```

### **Migration Strategy**

#### **1. Data Migration Script**
```python
# Create migration script to move existing appointments to new schema
async def migrate_appointments_to_calendar_events():
    """
    Migrate existing appointments to new calendar_events schema.
    This is a one-time migration that:
    1. Creates calendar_events records for all existing appointments
    2. Updates appointments table to reference calendar_events
    3. Preserves all existing data and relationships
    """
    
    # Get all existing appointments
    appointments = db.query(Appointment).all()
    
    for appointment in appointments:
        # Create calendar_event record
        calendar_event = CalendarEvent(
            user_id=appointment.user_id,
            event_type="appointment",
            date=appointment.start_time.date(),
            start_time=appointment.start_time.time(),
            end_time=appointment.end_time.time(),
            gcal_event_id=appointment.gcal_event_id,
            created_at=appointment.created_at,
            updated_at=appointment.updated_at
        )
        
        db.add(calendar_event)
        db.flush()  # Get the ID
        
        # Update appointment to reference calendar_event
        appointment.calendar_event_id = calendar_event.id
        
    db.commit()
```

#### **2. Backward Compatibility**
```python
# Add temporary compatibility layer during migration
class AppointmentCompat:
    """Temporary compatibility layer for existing code."""
    
    @property
    def start_time(self):
        return self.calendar_event.start_time
    
    @property
    def end_time(self):
        return self.calendar_event.end_time
    
    @property
    def user_id(self):
        return self.calendar_event.user_id
```

### **Frontend Changes**

#### **1. Update Calendar Components**
- Modify calendar view to show multiple exceptions per day
- Update daily view to display overlapping exceptions
- Add visual indicators for "outside hours" appointments
- Implement warning dialogs for conflict scenarios

#### **2. Update Settings Form**
- Support multiple intervals per day in weekly schedule
- Remove "is_available" checkbox (not needed)
- Add auto-save functionality
- Add conflict warning for default availability changes

#### **3. Update API Integration**
- Update API calls to use new endpoint structure
- Handle new response formats with calendar_event_id
- Implement warning response handling
- Add pagination support for calendar data

### **Testing Requirements**

#### **1. Unit Tests**
- Test new calendar_events model
- Test availability_exceptions model
- Test updated appointment model
- Test conflict detection logic
- Test multiple intervals per day

#### **2. Integration Tests**
- Test calendar data API endpoints
- Test exception management endpoints
- Test AI agent availability queries
- Test Google Calendar sync with new schema
- Test migration script

#### **3. End-to-End Tests**
- Test complete user flows for availability management
- Test conflict scenarios and warning displays
- Test calendar navigation and interactions
- Test appointment booking with new availability system

### **Deployment Plan**

#### **Phase 1: Database Migration**
1. Create new tables (calendar_events, availability_exceptions)
2. Run migration script to move existing appointments
3. Update appointments table structure
4. Update practitioner_availability table

#### **Phase 2: Backend Updates**
1. Update models and relationships
2. Implement new API endpoints
3. Update existing endpoints
4. Add conflict detection logic

#### **Phase 3: Frontend Updates**
1. Update calendar components
2. Update settings form
3. Implement new user flows
4. Add warning dialogs

#### **Phase 4: Testing & Rollout**
1. Comprehensive testing
2. Staging environment validation
3. Gradual rollout to production
4. Monitor and fix any issues

This implementation plan ensures a smooth transition to the new practitioner calendar design while maintaining data integrity and system functionality.
