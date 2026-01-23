# Design Doc: Slot-Integrated Appointment Creation

## Background
The "New Appointment" modal should leverage the rich context of the calendar grid. Clicking a slot in a Practitioner column, a Resource column, or an empty area should auto-populate the form logically while maintaining a predictable state that respects user intent.

## Core Principles
1. **Respect User Selection (Sticky Intent)**: Data originating from a direct user action (grid click, manual selection, or specific props) must not be overwritten by "Convenience" logic (e.g., patient-based auto-selection).
2. **Soft Constraints (Amber State)**: Allow any combination of Practitioner, Type, Time, and Resource. Use Amber warnings for incompatibility or conflicts instead of hard blocks. All clinic users have the authority to bypass these warnings.
3. **Intent Tracking**: Distinguish between data that is "Assumed" (auto-populated by logic) and data that is "Intended" (explicitly chosen by user context).

---

## Field Interaction & Business Logic

### 1. The Selection Context (Grid Clicks)
Grid clicks establish "Sticky" (`slot`) intent for specific fields.

| Click Location | Population | Practitioner Intent | Time Intent | Resource Intent |
| :--- | :--- | :--- | :--- | :--- |
| **Practitioner Column** | Prac + Time | `slot` | `slot` | `none` |
| **Resource Column** | Time only | `none` | `slot` | `none` |
| **Empty Area / Week View** | Time (Date/Time) | `none` | `slot` | `none` |

### 2. Practitioner & Appointment Type Compatibility
- **Inclusive Selection**: Selection modals show all options, not just compatible ones.
- **Labeling**: Items that don't match the current pairing are dimmed/labeled (e.g., "Not usually offered").
- **Banner Warning**: If an incompatible pair is selected, show: *"該治療師通常不提供此服務項目，但您仍可繼續建立預約。"*

### 3. Time, Duration & Conflicts
- **Conflict Calculation**: Only triggers when **Practitioner**, **Start Time**, and **Appointment Type** (for duration) are all present.
- **Dynamic Feedback**: If the user moves the time or changes the practitioner, the conflict check results update immediately.
- **Grid-Inferred Warnings**: If the initial click falls on an "Unavailable" (grey) grid area, show an immediate Amber warning: *"此時段在班表中標記為不可用，但您仍可繼續建立預約。"*

### 4. Patient-Based Auto-Population
- **Rule**: If Practitioner intent is `none`, selecting a patient auto-populates their assigned practitioner (Intent: `auto`).
- **Sticky Protection**: If intent is `slot`, `manual`, or `prop`, do **NOT** overwrite the field when the patient changes.
- **Intent Reset & Trigger**: If a user manually clears a field (sets to `null`), its intent reverts to `none`. If a patient is already selected, clearing the practitioner should immediately trigger the "Assigned Practitioner" lookup.

---

## Technical Changes

### 1. `useAppointmentForm.ts` (Core Logic)
- **State Introduction**: Add `intents` state using the `IntentSource` type (`'none' | 'auto' | 'manual' | 'slot' | 'prop'`).
- **Initialization**: Update the `useEffect` that consumes `preSelected` props to initialize intents. 
    - Use `slot` if the value came from a grid click.
    - Use `prop` if it was passed as a direct prop (e.g., duplication).
- **Setter Wrappers**: 
    - Implement `setPractitioner(id, source = 'manual')`.
    - Implement `setPatient(id, source = 'manual')`.
- **Patient Effect**: Refactor the assigned-practitioner effect to check `intents.practitioner === 'none'` before applying the default.
- **Removal of Legacy Logic**: Delete code that automatically resets the time or date when selection dependencies change (e.g., when the appointment type is cleared).

### 2. `CalendarGrid.tsx` & `AvailabilityPage.tsx` (Event Plumbing)
- **Grid Update**: Modify `handleSlotClick` to extract and pass `practitionerId` from the column metadata.
- **Context Pass-through**: In `AvailabilityPage`, maintain a `slotContext` state that holds `{ start, practitionerId }`. 
- **Modal Props**: Pass `slotContext` into the `CreateAppointmentModal` as `preSelectedPractitionerId` and `preSelectedTime`.
- **Cleanup**: Set `slotContext` to `null` when the modal closes.

### 3. `PractitionerSelectionModal.tsx` & `ServiceItemSelectionModal.tsx` (UI)
- **Removal of Filtering**: Remove the `availablePractitioners` filtering logic that hides practitioners not supporting the current type.
- **Compatibility Labels**:
    - Practitioners: Show "Doesn't offer this service" (Amber) if `practitioner.supported_types` doesn't include the current selection.
    - Service Items: Show "Not offered by therapist" (Amber) if the item is not in the practitioner's list.

### 4. `DateTimePicker.tsx` (Validation)
- **Conditional Conflict Invocation**: Modify the conflict-check effect to bail out early if `appointmentTypeId` is `null`.
- **"Unavailable" UI State**: Add a visual warning or amber state if the current `selectedTime` matches an `availability` slot marked as unavailable/blocked in the backend data.

### 5. `CreateAppointmentModal.tsx` (Presentation)
- **Form-Level Banner**: Add a new component area to display persistent Amber warnings for:
    - User clicking an unavailable slot.
    - Practitioner/Type incompatibility.
    - Duration exceeding practitioner's shift.

---

## Intent Tracking Detail

### Hierarchy of Authority
- `none`: Blank. Can be overwritten by anything.
- `auto`: Suggested by system. Can be overwritten by `manual` or a *new* `auto` trigger.
- `manual`/`slot`/`prop`: Set by user action. **Immutable** by system logic.

### State Reset Diagram
- `manual` field → manually set to `null` → Intent becomes `none`.
- Intent `none` + `selectedPatientId` exists → Trigger `autoPopulate()`.
