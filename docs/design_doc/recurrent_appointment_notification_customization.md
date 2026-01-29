# Design Doc: Recurrent Appointment Notification Customization

## Objective

Enable clinics to customize the consolidated LINE notification sent to patients when multiple recurrent appointments are created by a clinic user. This includes adding a new message template field to the service item settings, providing preview functionality, and improving the default message format.

## Requirements

1. **Customization Field**: Add a new template field for recurrent appointment confirmations in the `AppointmentType` model.
2. **Alembic Migration**: Add the new column and populate existing records with a default template.
3. **Default Template Improvement**:
   * Include weekdays in the date range.
   * Format single-day occurrences as: `預約時間：{Date} ({Weekday})`.
   * Increase the maximum number of displayed occurrences from 10 to 100.
   * New format:
     ```
     {Patient Name}，已為您建立 {Count} 個預約：

     預約時間：{Start Date} ({Start Weekday}) 至 {End Date} ({End Weekday})
     1. {Date} {Time}
     2. ...
     【{Appointment Type}】{Practitioner Name}

     期待為您服務！
     ```
4. **Frontend Integration**:
   * Add the new field to `ServiceItemEditModal`.
   * Support preview functionality with appropriate sample data.
5. **Placeholders**:
   * `{預約數量}`: Total number of appointments.
   * `{預約時段列表}`: The numbered list of appointments.

## Technical Design

### 1. Data Model Changes

Add the following fields to `AppointmentType` in `backend/src/models/appointment_type.py`:

* `recurrent_clinic_confirmation_message: Mapped[str]`
* `send_recurrent_clinic_confirmation: Mapped[bool] = mapped_column(default=True)` (Optional, but consistent with other triggers)

Wait, the user only mentioned "Adding a new field for customization". Usually, these have a toggle. Let's include the toggle for consistency.

### 2. Constants

Update `backend/src/core/message_template_constants.py`:

```python
DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE = """{病患姓名}，已為您建立 {預約數量} 個預約：

{預約時段列表}

【{服務項目}】{治療師姓名}

期待為您服務！"""
```

### 3. Backend Implementation (`appointments.py`)

Modify `create_recurring_appointments` to:

1. Fetch `appointment_type` settings.
2. If `len(created_appointments) > 1`:
   * Generate `date_range` with weekday support.
   * Generate `appointment_text` with up to 100 items.
   * Construct context for template rendering.
   * Use the custom template if provided.

### 4. Message Template Service

Update `MessageTemplateService.build_preview_context` and add a new `build_recurrent_confirmation_context` to handle the specific placeholders for recurrent appointments.

### 5. Preview API

Update `backend/src/api/clinic/previews.py` to support `recurrent_clinic_confirmation` message type.

### 6. Frontend Components

* `frontend/src/constants/messageTemplates.ts`: Add new message type and defaults.
* `frontend/src/components/MessageSettingsSection.tsx`: Add the new toggle and textarea.
* `frontend/src/components/ServiceItemEditModal.tsx`: Sync state and handle saving.

## Migration Strategy

1. Create Alembic migration to add `recurrent_clinic_confirmation_message` and `send_recurrent_clinic_confirmation`.
2. Set `send_recurrent_clinic_confirmation` to `true` by default.
3. Populate `recurrent_clinic_confirmation_message` with the `DEFAULT_RECURRENT_CLINIC_CONFIRMATION_MESSAGE` for all existing records.

## Available Placeholders

The following placeholders will be available for the recurrent appointment notification template.

| Placeholder | Context Type | Description | Example |
| :--- | :--- | :--- | :--- |
| **`{病患姓名}`** | Common | Patient's full name | 王小明 |
| **`{預約數量}`** | Recurrent-only | Total number of successfully created appointments | 12 |
| **`{預約時段列表}`** | Recurrent-only | Numbered list of dates and times (up to 100) | 1. 12/25 (三) 14:00... |
| **`{服務項目}`** | Common | Name of the appointment type | 初診評估 |
| **`{治療師姓名}`** | Common | Practitioner's name with title | 李醫師 |
| **`{診所名稱}`** | Common | Display name of the clinic | 範例診所 |
| **`{診所地址}`** | Common | Registered clinic address | 台北市... |
| **`{診所電話}`** | Common | Clinic contact number | 02-1234... |

### Internal Variable Logic for Recurrent Notifications

* **`{預約時段列表}`**:
  * Each item formatted as: `N. MM/DD (週) HH:mm`
  * Limit increased to **100** occurrences.

## Comparison: Single vs. Recurrent Placeholders

To avoid confusion, the following table calls out placeholders that are **unavailable** or behave differently for recurrent appointments compared to single appointments.

| Placeholder | Available in Single? | Available in Recurrent? | Reasoning |
| :--- | :--- | :--- | :--- |
| `{預約時間}` | ✅ | ❌ | Recurrent has multiple times; use `{預約時段列表}`. |
| `{預約結束時間}` | ✅ | ❌ | Recurrent has multiple end times. |
| `{預約日期}` | ✅ | ❌ | Recurrent covers multiple dates; use `{預約時段列表}`. |
| `{預約時段}` | ✅ | ❌ | Recurrent has multiple slots. |
| `{預約數量}` | ❌ | ✅ | Only relevant when multiple appointments are created. |
| `{預約時段列表}` | ❌ | ✅ | Only relevant for recurring sets. |

## Refined Backend Implementation Logic

1. **Trigger Determination**:
   * When creating recurring appointments, if `count == 1`, use the standard `clinic_confirmation_message` template and its associated placeholders (including `{預約時間}`).
   * If `count > 1`, use the new `recurrent_clinic_confirmation_message` template and its specific placeholder set.
2. **List Truncation**: Strictly allow up to 100 items. If more exist (though UI usually limits this), append `... 還有 X 個`.
