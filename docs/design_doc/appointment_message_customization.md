# Appointment Message Customization - Design

## Overview

Allow clinic admins to customize appointment confirmation and reminder messages per appointment type, with toggle controls for when messages are sent.

## Requirements

### Message Types
1. **Patient-triggered confirmation** - Sent when patient books via LIFF (default: enabled for new items, disabled for existing items after migration)
2. **Clinic-triggered confirmation** - Sent when clinic user creates appointment (currently sent by default)
3. **Pre-appointment reminder** - Sent X hours before appointment (currently sent by default, uses existing clinic-level `reminder_hours_before` setting - global setting, not per-appointment-type)

### Customization Features
- Toggle on/off for each message type per appointment type
- Custom message templates with placeholders
- Preview functionality before saving
- Validation (message required when toggle is ON)

## Database Design

### Schema Changes

**`appointment_types` table - Add columns:**
```sql
-- Toggle flags
-- Note: Database defaults (patient: true, clinic: true, reminder: true)
-- Migration explicitly sets existing items to false for patient confirmation (preserves current behavior)
send_patient_confirmation: bool (default: true)   -- Default true for new items, migration sets existing to false
send_clinic_confirmation: bool (default: true)     -- Currently sent by default
send_reminder: bool (default: true)                -- Currently sent by default

-- Message templates (always populated with system default text)
-- Fields are required (not nullable) and always contain text
-- New items and migrated items get populated with system default text
patient_confirmation_message: text (not null)
clinic_confirmation_message: text (not null)
reminder_message: text (not null)
```

**Rationale:**
- Per-appointment-type granularity (different services may need different messaging)
- Always populated with system default text (simpler logic, no NULL checks)
- Fields are required when toggle is ON (validation)
- Text field supports long messages with placeholders
- New items automatically get default text, admin can edit as needed

### Migration Strategy
- All existing appointment types get:
  - `send_patient_confirmation = false` (explicitly set to false to preserve current behavior - prevents unexpected messages to existing patients)
  - `send_clinic_confirmation = true` (matches current behavior - sent)
  - `send_reminder = true` (matches current behavior - sent)
  - All `*_message` fields populated with system default text (see Default Messages section)
- New appointment types created after migration:
  - Get database defaults: `send_patient_confirmation = true`, `send_clinic_confirmation = true`, `send_reminder = true`
  - All `*_message` fields populated with system default text
- Zero breaking changes - existing behavior preserved (existing items keep patient confirmation disabled)
- **Migration rollback:** Standard Alembic rollback. Can restore message fields from backup if needed.

## Placeholder System

### Available Placeholders

**Common to all messages:**
- `{病患姓名}` - Patient's full name
- `{服務項目}` - Service/item name
- `{預約時間}` - Formatted datetime (e.g., "2024年11月15日 14:30")
- `{預約日期}` - Formatted date (e.g., "2024年11月15日")
- `{預約時段}` - Time only (e.g., "14:30")
- `{治療師姓名}` - Practitioner name with title (or "不指定" for auto-assigned)
- `{診所名稱}` - Clinic display name
- `{診所地址}` - Clinic address (if available)
- `{診所電話}` - Clinic phone (if available)

**Confirmation-specific:**
- `{病患備註}` - Patient's notes (if provided, otherwise empty)

**Reminder-specific:**
- (Uses same placeholders as confirmation)

### Placeholder Format
- Use `{變數名稱}` syntax (curly braces with Traditional Chinese)
- Case-sensitive (Traditional Chinese characters)
- Invalid placeholders are left as-is (no error, but no substitution)
- Missing data (e.g., no address) renders as empty string

## User Experience Design

### UI Location
**Option A: Service Item Edit Modal (Recommended)**
- Add new section "訊息設定" (Message Settings) in `ServiceItemEditModal`
- Three collapsible sections, one per message type
- Each section has toggle + message editor
- Consistent with existing modal pattern

**Option B: Separate Settings Page**
- New page `/admin/clinic/settings/messages`
- Table view with all appointment types
- Less discoverable, more clicks

**Recommendation: Option A** - Keeps related settings together, easier to discover

### Message Editor Design

**Layout per message type:**
```
┌─────────────────────────────────────┐
│ ☑ 發送確認訊息 (當病患自行預約時)      │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 訊息範本 *                       │ │
│ │ ┌─────────────────────────────┐ │ │
│ │ │ {病患姓名}，您的預約已建立：  │ │ │
│ │ │                               │ │ │
│ │ │ {預約時間} - 【{服務項目}】{治 │ │ │
│ │ │ 療師姓名}                      │ │ │
│ │ │                               │ │ │
│ │ │ 期待為您服務！                 │ │ │
│ │ └─────────────────────────────┘ │ │
│ │                                   │ │
│ │ 可用變數：                        │ │
│ │ {病患姓名} {服務項目} {預約時間}  │ │
│ │ {治療師姓名} {診所名稱} ...       │ │
│ │                                   │ │
│ │ [預覽訊息] [重設為預設值]          │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
* 當開關開啟時為必填
```

**Features:**
1. **Toggle switch** - Enable/disable message sending
2. **Textarea** - Multi-line message editor (min-height: 120px)
   - Always populated with text (system default for new items, existing text for existing items)
   - Required when toggle is ON
   - Editable at all times
3. **Placeholder helper** - Clickable chips or dropdown to insert placeholders
4. **Preview button** - Opens preview modal with sample data
5. **Reset button** - Populates textarea with current system default text
6. **Character counter** - Shows current length / 3500 (warning at 3000, error at 3500)

### Preview Modal

**Design:**
```
┌─────────────────────────────────────┐
│ 訊息預覽                             │
├─────────────────────────────────────┤
│                                     │
│ 王小明，您的預約已建立：             │
│                                     │
│ 2024年11月16日 14:30 - 【初診評估】 │
│ 張醫師                                │
│                                     │
│ 期待為您服務！                       │
│                                     │
│ ─────────────────────────────────  │
│                                     │
│ 使用的變數：                         │
│ • {病患姓名} → 王小明                │
│ • {預約時間} → 2024年11月16日 14:30 │
│ • {服務項目} → 初診評估              │
│   (實際服務項目名稱)                  │
│ • {治療師姓名} → 張醫師              │
│   (目前使用者或診所治療師)            │
│                                     │
│ [關閉]                               │
└─────────────────────────────────────┘
```
Note: Preview uses actual service item name and current user/practitioner name

**Preview data (use actual context where possible):**
- **Practitioner name**: Use current user's name (if they're a practitioner) or first available practitioner at clinic
- **Appointment type**: Use the actual service item's name being edited
- **Clinic info**: Use actual clinic data (name, address, phone)
- **Patient name**: Use realistic sample (e.g., "王小明")
- **Appointment time**: Use tomorrow's date at a reasonable time (e.g., "2024年11月16日 14:30")
- **Patient notes**: Empty or sample text
- Show which placeholders were used and their values
- Helps admin verify message looks correct with real context

### Validation

**Inline validation:**
- Real-time check for placeholder syntax (optional, non-blocking)
- Highlight invalid placeholders in red (e.g., `{無效變數}`)
- Character counter showing current length / 3500 limit
- Warning if approaching limit (> 3000 chars)

**On save validation:**
- If toggle is ON and message is empty → error (field is required)
- If toggle is ON and message contains only whitespace → error
- If toggle is ON and message exceeds 3500 characters → error (buffer for placeholder expansion)
- If toggle is OFF: message can be empty (ignored, but still editable)
- Invalid placeholder syntax → warning (not error, allows flexibility)
- Placeholder completeness validation → warning if placeholder used but data unavailable:
  - `{診所地址}` used but clinic has no address
  - `{診所電話}` used but clinic has no phone
  - Other optional fields that might be missing

**Validation errors:**
- Show in validation summary modal (consistent with existing pattern)
- Clickable errors → scroll to field and highlight

### Default Messages

These are the system default messages used to populate new appointment types and during migration. Each appointment type stores its own message text (not system-wide). Admins can edit them per appointment type.

**Storage Location:**
- Default messages stored as constants in backend (e.g., `services/message_template_service.py` or `core/constants.py`)
- Used during migration and for new item initialization
- "重設為預設值" button always uses current system defaults (allows updates if defaults change)

**Patient-triggered confirmation:**
```
{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！
```

**Clinic-triggered confirmation:**
```
{病患姓名}，您的預約已建立：

{預約時間} - 【{服務項目}】{治療師姓名}

期待為您服務！
```
(Note: Currently identical to patient-triggered. Can be customized per appointment type if needed. Future: could include clinic notes if use cases differ.)

**Reminder:**
```
提醒您，您預約的【{服務項目}】預計於【{預約時間}】開始，由【{治療師姓名}】為您服務。

診所：{診所名稱}
地址：{診所地址}
電話：{診所電話}

請準時前往診所，期待為您服務！
```

## Technical Implementation

### Backend Changes

**1. Model Updates (`appointment_type.py`)**
```python
send_patient_confirmation: Mapped[bool] = mapped_column(default=True)  # Default true for new items
send_clinic_confirmation: Mapped[bool] = mapped_column(default=True)
send_reminder: Mapped[bool] = mapped_column(default=True)
# Note: Migration explicitly sets existing items' send_patient_confirmation to False

# Always populated with text (not nullable)
# New items get system default text, existing items get populated during migration
patient_confirmation_message: Mapped[str] = mapped_column(Text, nullable=False)
clinic_confirmation_message: Mapped[str] = mapped_column(Text, nullable=False)
reminder_message: Mapped[str] = mapped_column(Text, nullable=False)
```

**2. Message Rendering Service**
Create `MessageTemplateService`:
```python
class MessageTemplateService:
    @staticmethod
    def render_message(
        template: str,
        context: Dict[str, Any]
    ) -> str:
        """Render message template with placeholders."""
        # Template always contains text (never None)
        message = template
        
        # Replace placeholders (Traditional Chinese placeholders)
        # Context keys should match placeholder names (e.g., "病患姓名", "服務項目")
        # Replace in order: longest placeholders first to avoid substring conflicts
        # (e.g., {預約時間} before {預約日期} to prevent partial matches)
        sorted_keys = sorted(context.keys(), key=len, reverse=True)
        for key in sorted_keys:
            placeholder = f"{{{key}}}"
            value = str(context[key] or "")
            message = message.replace(placeholder, value)
        
        return message
    
    @staticmethod
    def build_confirmation_context(
        appointment: Appointment,
        patient: Patient,
        practitioner_name: str,
        clinic: Clinic
    ) -> Dict[str, Any]:
        """Build context dict for confirmation messages."""
        # Returns dict with Traditional Chinese keys matching placeholders:
        # {"病患姓名": patient.full_name, "服務項目": appointment_type.name, 
        #  "預約時間": formatted_datetime, "治療師姓名": practitioner_name, etc.}
        # Format datetime, extract components, etc.
        ...
    
    @staticmethod
    def build_reminder_context(
        appointment: Appointment,
        patient: Patient,
        practitioner_name: str,
        clinic: Clinic
    ) -> Dict[str, Any]:
        """Build context dict for reminder messages."""
        # Returns dict with Traditional Chinese keys: {"病患姓名": "...", "服務項目": "...", etc.}
        ...
```

**3. Appointment Service Updates**
Modify `AppointmentService.create_appointment()` to send patient-triggered confirmation:
```python
# Send patient confirmation if enabled (when line_user_id is provided)
if line_user_id and appointment_type.send_patient_confirmation:
    practitioner_name_for_notification = get_practitioner_name_for_notification(...)
    NotificationService.send_appointment_confirmation(
        db, appointment, practitioner_name_for_notification, clinic, 
        trigger_source='patient_triggered'
    )
```

**4. Notification Service Updates**
Modify `NotificationService.send_appointment_confirmation()`:
```python
# Check toggle based on trigger_source
if trigger_source == 'patient_triggered':
    if not appointment_type.send_patient_confirmation:
        return False  # Skip sending
    template = appointment_type.patient_confirmation_message
elif trigger_source == 'clinic_triggered':
    if not appointment_type.send_clinic_confirmation:
        return False
    template = appointment_type.clinic_confirmation_message

# Render message (template always contains text)
context = MessageTemplateService.build_confirmation_context(...)
message = MessageTemplateService.render_message(template, context)
```

**5. Reminder Service Updates**
Modify `ReminderService.format_reminder_message()`:
```python
# Check toggle
if not appointment_type.send_reminder:
    return None  # Skip reminder

# Template always contains text (never None)
template = appointment_type.reminder_message
context = MessageTemplateService.build_reminder_context(...)
message = MessageTemplateService.render_message(template, context)
```

**6. Preview Endpoint**
Add to `clinic.py`:
```python
@router.post("/appointment-message-preview")
async def preview_appointment_message(
    request: MessagePreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """Preview appointment message with actual context data."""
    # Validate appointment_type_id belongs to clinic
    clinic_id = ensure_clinic_access(current_user)
    appointment_type = db.query(AppointmentType).filter(
        AppointmentType.id == request.appointment_type_id,
        AppointmentType.clinic_id == clinic_id
    ).first()
    if not appointment_type:
        raise HTTPException(status_code=404, detail="服務項目不存在")
    clinic = db.query(Clinic).get(clinic_id)
    
    # Get message template from request (or from appointment_type if not provided)
    template = request.template or get_message_template(appointment_type, request.message_type)
    
    # Validate template parameter (if provided)
    if request.template:
        if len(request.template) > 3500:
            raise HTTPException(status_code=400, detail="訊息範本長度超過限制")
        # Basic validation: ensure template is string and not maliciously long
    
    # Build context using actual data:
    # - Practitioner: current_user's name (if practitioner) or first practitioner at clinic
    # - Appointment type: appointment_type.name (actual service item name)
    # - Clinic: clinic data (name, address, phone)
    # - Patient: sample name ("王小明")
    # - Time: tomorrow at reasonable time (e.g., 14:30)
    context = build_preview_context(
        appointment_type=appointment_type,
        current_user=current_user,
        clinic=clinic,
        db=db
    )
    
    # Render message using MessageTemplateService
    preview_message = MessageTemplateService.render_message(template, context)
    
    # Validate placeholder completeness
    # Check if placeholders in template reference data that's unavailable
    # e.g., {診所地址} but clinic.address is None
    completeness_warnings = validate_placeholder_completeness(template, context, clinic)
    
    # Return preview with used placeholders and completeness warnings
    return {
        "preview_message": preview_message,
        "used_placeholders": extract_used_placeholders(template, context),
        "completeness_warnings": completeness_warnings  # e.g., ["{診所地址} 但診所尚未設定地址"]
    }
```

**7. New Item Initialization**
When creating new appointment types (frontend or backend):
- Populate all three message fields with system default text (see Default Messages section)
- Toggles use database defaults: `send_patient_confirmation=true`, `send_clinic_confirmation=true`, `send_reminder=true`
- Note: New items get patient confirmation enabled by default (better UX), while existing items remain disabled (backward compatibility)

### Frontend Changes

**1. Service Item Edit Modal**
- Add "訊息設定" section (collapsible)
- Three subsections for each message type
- Toggle + textarea (always populated with text) + helper buttons
- New items: textarea pre-populated with system default text
- Existing items: textarea shows current stored text
- "重設為預設值" button populates with current system default (always uses latest defaults, not original)
- Integrate with existing staging store (see `serviceItemsStagingStore.ts` pattern from service type grouping feature)

**2. Preview Modal Component**
- Reusable modal for message preview
- Shows rendered message + placeholder mapping
- Uses actual context data:
  - Current user's name for practitioner (if applicable)
  - Actual service item name being edited
  - Real clinic data
  - Realistic sample data for patient/time

**3. Placeholder Helper**
- Clickable chips or dropdown
- Inserts placeholder at cursor position
- Shows available placeholders per message type

**4. Validation**
- Add to existing validation flow
- Check empty/whitespace-only messages when toggle is ON (field is required)
- Check character limit (3500 chars max) when toggle is ON
- Check placeholder completeness (warn if placeholder used but data unavailable)
- Field can be empty when toggle is OFF (but still editable)
- Highlight invalid placeholders (optional)
- Show character counter (current / 3500, warning at 3000)

## Edge Cases & Considerations

### 1. Missing Data
**Scenario:** Placeholder references data that doesn't exist (e.g., no clinic address)
**Solution:** 
- Validation warning: "訊息使用了 {診所地址}，但診所尚未設定地址"
- Message still sends (placeholder replaced with empty string)
- Admin can choose to fix or proceed

### 2. Auto-Assigned Appointments
**Scenario:** `{治療師姓名}` for auto-assigned appointments
**Solution:** Use "不指定" (existing behavior)

### 3. Recurring Appointments
**Scenario:** Custom messages for recurring appointments
**Solution:** Use same confirmation message template, rendered per appointment. Each appointment in the series uses the appointment type's message settings.

### 4. Deleted Appointment Types
**Scenario:** Appointment type soft-deleted but appointments exist
**Solution:** Use stored message text from appointment_type (fields are always populated, so text is available even if soft-deleted)

### 5. Empty Message When Toggle is ON
**Scenario:** Toggle ON but message is empty or only whitespace
**Solution:** Validation error - field is required when toggle is ON. Message field is always populated with text (system default for new items), so this should only happen if admin clears it.

### 6. Very Long Messages
**Scenario:** Message exceeds character limits
**Solution:** 
- Template limit: 3500 characters (provides buffer for placeholder expansion)
- LINE text messages: 5000 characters max (after placeholder replacement)
- Character counter shows current length / 3500
- Warning at 3000 chars, error at 3500 chars

### 7. Special Characters
**Scenario:** User includes special characters that break formatting
**Solution:** 
- Allow all characters (LINE supports Unicode)
- No sanitization needed (trust admin input)
- Preview shows exact rendering

### 8. Placeholder in Notes
**Scenario:** Patient notes contain `{something}` that looks like placeholder
**Solution:** Only replace known placeholders (Traditional Chinese), leave unknown ones as-is

### 9. System Default Changes After Migration
**Scenario:** System default messages are updated after appointment types are created
**Solution:** Existing appointment types keep their stored text (won't auto-update). Admin can use "重設為預設值" button to update manually.

### 10. Concurrent Edits
**Scenario:** Multiple admins edit same appointment type
**Solution:** Last write wins (standard database behavior, staging store prevents conflicts within session)

### 11. Patient Has No LINE User
**Scenario:** Patient doesn't have LINE account linked
**Solution:** Skip sending (existing behavior), no error

### 12. Appointment Type Deleted During Active Appointment
**Scenario:** Appointment type is soft-deleted but has active appointments
**Solution:** Use stored message text from appointment_type (fields are always populated, so text is available even if soft-deleted). If appointment_type relationship is null (edge case), fallback to system default messages from constants.

### 13. Toggle Changed After Appointment Created
**Scenario:** Admin disables reminder after appointment is created
**Solution:** Reminder check happens at send time (not schedule time), so toggle change affects future reminders only. Already scheduled reminders may still send if scheduler already queued them.

### 14. Placeholder Replacement Creates Very Long Message
**Scenario:** After placeholder replacement, message exceeds LINE's 5000 character limit
**Solution:** 
- Template limit of 3500 chars provides buffer for placeholder expansion
- If final message still exceeds 5000 chars, send anyway (LINE API will handle truncation or error)
- Character count validation is on template length only (simpler, predictable)

### 15. Appointment Edits
**Scenario:** Admin edits appointment (time, practitioner, etc.)
**Solution:** Uses existing edit notification logic (separate from confirmation messages). Confirmation messages are only sent on creation, not on edits.

### 16. Message Contains Only Placeholders
**Scenario:** Admin creates message with only placeholders, no actual text
**Solution:** Valid message - placeholders will be replaced with actual values. No validation needed (admin intent is clear).

### 17. Preview Context Data
**Scenario:** Current user is not a practitioner, or no practitioners exist at clinic
**Solution:** Fallback order (explicit):
1. Current user (if they're a practitioner at this clinic) → use their name
2. First available practitioner at clinic → use their name
3. No practitioners exist → use "不指定" or sample name "治療師"
- Always use actual service item name from appointment_type
- Always use real clinic data (name, address, phone) - live data, not snapshot

### 18. Placeholder Completeness Validation
**Scenario:** Message uses `{診所地址}` but clinic has no address set
**Solution:**
- **Inline (optional)**: Real-time warning as user types (non-blocking)
- **On save**: Show warning "訊息使用了 {診所地址}，但診所尚未設定地址" (non-blocking)
- **In preview**: Show warning in completeness_warnings response
- Admin can choose to:
  - Remove the placeholder from message
  - Set the missing data (e.g., add clinic address)
  - Proceed anyway (placeholder will render as empty string)
- Validation is warning only (non-blocking) - allows flexibility

### 19. Multiple Placeholder Occurrences
**Scenario:** Same placeholder appears multiple times in message (e.g., `{病患姓名}，您好！{病患姓名}的預約已建立`)
**Solution:** All occurrences are replaced with the same value (standard string replace behavior). This is valid and expected.

### 20. Malformed Placeholder Syntax
**Scenario:** Message contains malformed placeholders (e.g., `{{病患姓名}}`, `{病患姓名`, `病患姓名}`)
**Solution:** 
- Only properly formatted placeholders `{變數名稱}` are replaced
- Malformed syntax is left as-is (no error, no substitution)
- Invalid placeholder highlighting (optional) can help catch these

### 21. Patient Confirmation When Booking Disabled
**Scenario:** `send_patient_confirmation = true` but `allow_patient_booking = false` for appointment type
**Solution:** 
- Patient confirmation only sent when patient actually books via LIFF
- If `allow_patient_booking = false`, patients can't book via LIFF, so confirmation won't be sent
- No conflict - toggle is per-appointment-type setting, booking restriction is separate

### 22. Cancelled Appointments
**Scenario:** Appointment is cancelled after confirmation/reminder is sent
**Solution:** 
- Cancellation messages use separate logic (existing cancellation notification system)
- Confirmation/reminder message settings don't affect cancellation messages
- Out of scope for this feature

## API Endpoints

**Preview:**
- `POST /api/clinic/appointment-message-preview`
  - Request: `{ appointment_type_id, message_type, template? }`
    - `appointment_type_id`: Required - used to get actual service item name and clinic context
    - `message_type`: Required - "patient_confirmation" | "clinic_confirmation" | "reminder"
    - `template`: Optional - message template to preview (if not provided, uses stored template from appointment_type)
  - Response: `{ preview_message, used_placeholders, completeness_warnings? }`
    - `preview_message`: Rendered message with placeholders replaced
    - `used_placeholders`: List of placeholders used and their values
    - `completeness_warnings`: Optional array of warnings for placeholders used but data unavailable (e.g., ["{診所地址} 但診所尚未設定地址"])
    - Uses actual context: current user as practitioner, actual service item name, real clinic data

**Settings:**
- `GET /api/clinic/settings` - Includes appointment types with message settings
- `PUT /api/clinic/settings` - Saves appointment types with message settings (existing endpoint)

## Design Decisions

1. **Character limits:** Template limit 3500 chars (1500 char buffer for placeholder expansion), warning at 3000, error at 3500. If final message exceeds 5000 chars after replacement, LINE API handles truncation/error.
2. **Placeholder validation:** 
   - Invalid placeholders → warnings only (allows flexibility for future placeholders)
   - Missing data validation → warnings when placeholder used but data unavailable (e.g., `{診所地址}` but no address set)
   - Warnings are non-blocking (admin can proceed), errors block save
3. **Placeholder replacement:** Replace longest placeholders first to avoid substring conflicts
4. **System-wide defaults:** Stored as constants in backend, not editable in v1 (per-appointment-type customization sufficient)
5. **Message history:** Not tracked in v1 (simple edit workflow)
6. **Bulk operations:** Not supported in v1 (can add copy/paste later if needed)
7. **Rich formatting:** Text-only in v1 (LINE buttons/images can be added later)
8. **Multi-language:** Single language (Traditional Chinese) in v1. Placeholder keys are Traditional Chinese - future i18n would require refactoring.
9. **Migration rollback:** Migration is reversible - can rollback by setting message fields to NULL (if allowed) or restoring from backup. Standard Alembic rollback applies.
10. **Testing strategy:** 
    - Unit tests: MessageTemplateService (placeholder replacement, edge cases, longest-first ordering)
    - Integration tests: Preview endpoint (validation, completeness warnings, context building)
    - Validation tests: Empty messages, character limits, placeholder completeness
    - Edge case tests: Malformed placeholders, missing data, multiple occurrences

## Summary

**Design Principles:**
1. **Per-appointment-type granularity** - Different services may need different messaging
2. **Backward compatible** - All existing behavior preserved (default text matches current messages)
3. **Always populated fields** - Message fields always contain text (system default for new items)
4. **Simple state management** - No NULL checks, just text (simpler logic)
5. **Flexible placeholders** - Easy to extend with new variables
6. **Preview before save** - Reduces errors and improves UX
7. **Consistent with existing patterns** - Uses staging store, validation summary, etc.

**Key Benefits:**
- Personalized messaging per service type
- Control over when messages are sent
- Preview reduces mistakes
- Easy to extend with new placeholders
- No breaking changes to existing functionality

