# AI Reply Schedule Configuration

## Overview

Allow the clinic user to configure the hours where the AI reply should be triggered. For each weekday, allow the clinic user to configure period(s) of time AI should reply.

The goal is to give clinics control over when the AI is active, preventing AI responses during off-hours or specific times when human staff might want to handle messages personally, or conversely, ensuring AI only handles messages during specific hours.

***

## Key Business Logic

### 1. Schedule-Based AI Activation

The AI should only reply if the current time matches one of the configured active periods for the current day of the week.

**Rationale**: Clinics operate at different hours and may have different policies for when AI should interact with patients.

### 2. Default Behavior

If no schedule is configured (the field is null or empty), the AI should follow the boolean `chat_enabled` setting (i.e., always on if enabled).

**Rationale**: Backward compatibility and ease of use for clinics that don't need complex scheduling.

### 3. Timezone Handling

All time comparisons must be done in the clinic's local timezone (presumably Taiwan/Asia/Taipei as used elsewhere in the app via `taiwan_now()`).

**Rationale**: Users configure times based on their local wall clock.

***

## Backend Technical Design

### Database Schema

We will update the `ChatSettings` Pydantic model in `backend/src/models/clinic.py` to include the schedule configuration.

#### New Models

```python
class TimePeriod(BaseModel):
    """A specific time period with start and end times in HH:MM format."""
    start_time: str = Field(..., description="Start time in HH:MM format (24-hour)")
    end_time: str = Field(..., description="End time in HH:MM format (24-hour)")

    @field_validator('start_time', 'end_time')
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        if not re.match(r'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$', v):
            raise ValueError('Time must be in 24-hour format HH:MM')
        return v
    
    @model_validator(mode='after')
    def validate_period(self) -> 'TimePeriod':
        if self.start_time >= self.end_time:
             raise ValueError('start_time must be earlier than end_time')
        return self

class AIWeeklySchedule(BaseModel):
    """Weekly schedule for AI replies."""
    mon: List[TimePeriod] = Field(default_factory=list)
    tue: List[TimePeriod] = Field(default_factory=list)
    wed: List[TimePeriod] = Field(default_factory=list)
    thu: List[TimePeriod] = Field(default_factory=list)
    fri: List[TimePeriod] = Field(default_factory=list)
    sat: List[TimePeriod] = Field(default_factory=list)
    sun: List[TimePeriod] = Field(default_factory=list)
```

#### Update `ChatSettings`

```python
class ChatSettings(BaseModel):
    # ... existing fields ...
    ai_reply_schedule: Optional[AIWeeklySchedule] = Field(default=None, description="Weekly schedule for AI replies. If None, AI is active 24/7 (if chat_enabled is True).")
```

### Business Logic Implementation

In `backend/src/api/line_webhook.py`:

1. Create a helper function `is_ai_active_now(schedule: AIWeeklySchedule) -> bool`.
2. Use `taiwan_now()` to get the current day of week and time.
3. Check if the current time falls within any of the time periods for the current day.
4. In `line_webhook` function, after checking `chat_enabled`, checking `is_ai_active_now`.
   * If `chat_enabled` is True but `is_ai_active_now` returns False, log that AI is skipped due to schedule and do NOT process the message.

```python
def is_ai_active_now(schedule: Optional[AIWeeklySchedule]) -> bool:
    if not schedule:
        return True
    
    now = taiwan_now()
    # 0 = Monday, 6 = Sunday
    weekday = now.weekday()
    current_time_str = now.strftime("%H:%M")
    
    # Map weekday number to field name
    day_map = {0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'}
    day_key = day_map.get(weekday)
    
    if not day_key:
        return True # Should not happen
        
    periods = getattr(schedule, day_key, [])
    if not periods:
        # If schedule exists but no periods for today, assume OFF for today? 
        # OR assume if schedule is set, explicit periods are required for activity.
        # DECISION: If ai_reply_schedule is not None, then empty list means NO AI today.
        return False
        
    for period in periods:
        if period.start_time <= current_time_str < period.end_time:
            return True
            
    return False
```

***

## Frontend Technical Design

### UI/UX Design

We will add a new section in the **Chat Settings** (聊天設定) page for "AI Reply Schedule" (AI 回覆排程).

#### 1. Main Control

* **Toggle Switch**: "Limit AI Reply Hours" (限制 AI 回覆時間).
  * **OFF (Default)**: AI replies 24/7 (subject to the main "Chat Function Enabled" toggle).
  * **ON**: Reveals the Weekly Schedule Editor.

#### 2. Weekly Schedule Editor

A weekly configuration view similar to Google Business Profile's operating hours setting.

* **Layout**: 7 rows, one for each day of the week (Monday - Sunday).
* **Row Structure**:
  * **Day Label**: e.g., "Monday" (週一).
  * **Toggle/Checkbox**: "Active" (啟用).
    * If unchecked: Shows "No AI replies" (不回覆).
    * If checked: Shows list of time periods.
  * **Time Periods**:
    * Each period consists of two time pickers (or text inputs): \[Start Time] — \[End Time].
    * Example: `09:00` — `12:00`.
    * **Remove Button**: A trash icon or "X" next to each period to remove it.
  * **Add Period Button**: An "Add Hours" (+) button to allow split shifts (e.g., Morning: 09:00-12:00, Afternoon: 14:00-18:00).

#### 3. Visual Reference (Mockup Description)

```text
[Switch] 限制 AI 回覆時間 (Limit AI Reply Hours)

(When ON):
------------------------------------------------------
週一 (Mon)   [x]  [09:00] - [12:00] [x]
                  [13:30] - [18:00] [x]
                  (+ Add Period)
------------------------------------------------------
週二 (Tue)   [ ]  (Closed / No AI)
------------------------------------------------------
...
------------------------------------------------------
```

### Component Architecture

#### `AIWeeklyScheduleEditor`

A reusable controlled component that manages the `AIWeeklySchedule` object.

* **Props**:
  * `value`: `AIWeeklySchedule | null`
  * `onChange`: `(value: AIWeeklySchedule | null) => void`
  * `disabled`: `boolean`
* **State**:
  * Internal state mirrors the `AIWeeklySchedule` structure.
* **Validation**:
  * Prevent overlapping time ranges within the same day.
  * Ensure Start Time < End Time.
  * If a day is "Active" but has no periods, it is treated as "Closed".

### Interaction Details

1. **Enabling Schedule**: When the main toggle is switched ON for the first time, pre-fill with default business hours (e.g., Mon-Fri 09:00-18:00) to give the user a starting point.
2. **Disabling Schedule**: When switched OFF, clear the schedule or just ignore it (send `null` to backend).
3. **Time Input**: Use a 24-hour format time picker standard to the application.
