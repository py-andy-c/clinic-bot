# User Experience Proposal: "Review Changes" Step in Appointment Editing

## Overview
Add a "review changes" step before final confirmation in all three appointment editing flows. This provides a clear before/after comparison so users can verify changes before saving.

---

## 1. Calendar Page Editing (EditAppointmentModal)

### Current Flow:
```
Form → Note (optional) → Preview (LINE message) → Save
```

### Proposed Flow:
```
Form → Review Changes → Note (optional) → Preview (LINE message) → Save
```

### Review Changes Step Details:
- **Position**: After form step, before note step
- **Content**: Vertical before/after comparison showing:
  - **Original Appointment** (top section)
    - Practitioner (with name or "自動指派")
    - Date & Time
    - Notes (if applicable, read-only)
  - **New Appointment** (bottom section)
    - Practitioner (highlighted if changed)
    - Date & Time (highlighted if changed)
    - Notes (if applicable, read-only)
- **Visual Indicators**:
  - ✓ checkmark or highlight for changed fields
  - Gray/neutral styling for unchanged fields
  - Clear section headers: "原預約" and "新預約"
- **Time Change Warning**:
  - If time changed: Show warning banner
  - Message: "時間已變更，請確認病患可配合此時間"
  - Styled as yellow/orange warning box
- **Actions**:
  - "返回修改" (Back to Edit) → returns to form step
  - "下一步" (Next) → proceeds to note step (if LINE user) or save (if no LINE user)

### Special Cases:
- **No LINE user**: Review Changes → Save (skip note and preview)
- **Originally auto-assigned + no time change**: Review Changes → Save (skip note and preview)
- **No changes detected**: Skip review step (same as current behavior)

---

## 2. Pending Review Appointments (AutoAssignedAppointmentsPage)

### Current Flow:
```
Form → Note (optional) → Preview (LINE message) → Save
```
(Uses same EditAppointmentModal component)

### Proposed Flow:
```
Form → Review Changes → Note (optional) → Preview (LINE message) → Save
```
(Same as calendar page editing)

### Review Changes Step Details:
- **Same as calendar page editing** (uses EditAppointmentModal)
- **Button Text Changes**:
  - Form step button: "下一步" (instead of "確認指派")
  - Save step button: "確認指派" (final confirmation)
- **Time Change Warning**:
  - If time changed: Show warning banner
  - Message: "時間已變更，請確認病患可配合此時間"
  - Styled as yellow/orange warning box

---

## 3. LIFF Rescheduling (RescheduleFlow)

### Current Flow:
```
Single Page Form → Direct Submit
```

### Proposed Flow:
```
Form → Review Changes → Submit
```

### Review Changes Step Details:
- **Position**: After all form fields are filled, before final submission
- **Content**: Vertical before/after comparison showing:
  - **Original Appointment** (top section)
    - Practitioner (name or "不指定"/"自動指派")
    - Date & Time
    - Notes (if any)
  - **New Appointment** (bottom section)
    - Practitioner (highlighted if changed)
    - Date & Time (highlighted if changed)
    - Notes (highlighted if changed)
- **Visual Design**:
  - Card layout with clear separation
  - Original values on top, new values on bottom
  - Highlight changed fields with ✓ checkmark
  - No arrow or "變更為" text between sections
- **Actions**:
  - "返回修改" (Back to Edit) → returns to form
  - "確認改期" (Confirm Reschedule) → submits changes
- **Validation**:
  - Only show if `hasChanges` is true
  - Check cancellation constraint before showing review (same as current)

---

## Visual Design

### Review Changes Screen Layout (Vertical Before/After):

```
┌─────────────────────────────────────┐
│  確認變更 (Review Changes)          │
├─────────────────────────────────────┤
│                                     │
│  原預約                              │
│  ┌─────────────────────────────┐   │
│  │ 治療師: 王醫師              │   │
│  │ 日期: 2024-01-15           │   │
│  │ 時間: 10:00 AM              │   │
│  │ 備註: (無)                  │   │
│  └─────────────────────────────┘   │
│                                     │
│  新預約                              │
│  ┌─────────────────────────────┐   │
│  │ 治療師: 李醫師  ✓           │   │
│  │ 日期: 2024-01-16  ✓        │   │
│  │ 時間: 2:00 PM  ✓            │   │
│  │ 備註: (無)                  │   │
│  └─────────────────────────────┘   │
│                                     │
│  ⚠️ 時間已變更，請確認病患可配合此時間 │
│                                     │
│  [返回修改]  [下一步]               │
└─────────────────────────────────────┘
```

### Design Specifications:
- **Layout**: Vertical stack (original on top, new on bottom)
- **No arrow or separator text** between sections
- **Changed fields**: Show ✓ checkmark or highlight
- **Warning banner**: Yellow/orange background, visible icon, clear message
- **Spacing**: Adequate padding between sections for readability

---

## Implementation Details

### Step State Management:
- **EditAppointmentModal**: Add `'review'` to `EditStep` type: `'form' | 'review' | 'note' | 'preview'`
- **RescheduleFlow**: Add review step state (could be a separate component or inline)

### Change Detection:
- Reuse existing `hasChanges` logic
- Track which specific fields changed for highlighting:
  - `practitionerChanged`: boolean
  - `timeChanged`: boolean (date or time)
  - `notesChanged`: boolean (if applicable)
- Compare original values vs. current form values

### Conditional Flow:
- Show review step only if changes detected
- Skip review if no changes (maintain current behavior)
- Show time change warning only if `timeChanged === true`

### Button Text Updates:
- **AutoAssignedAppointmentsPage**: 
  - Form step: `formSubmitButtonText="下一步"` (default)
  - Save step: "確認指派" (in handleSave or final confirmation)

### Warning Message:
- **Text**: "時間已變更，請確認病患可配合此時間"
- **Condition**: Show when `timeChanged === true`
- **Style**: Warning banner (yellow/orange background, icon, clear text)

### Backend Considerations:
- No backend changes needed (review is frontend-only)
- Existing validation and save logic remains unchanged

---

## User Benefits

1. **Reduces errors**: Users can verify changes before proceeding
2. **Improves confidence**: Clear visibility of what will change
3. **Better UX**: Standard review pattern users expect
4. **Prevents accidental changes**: Extra confirmation step
5. **Mobile-friendly**: Vertical layout works well on all screen sizes
6. **Time change awareness**: Warning ensures clinic users confirm patient availability

---

## Edge Cases to Handle

1. **No changes**: Skip review step (current behavior)
2. **Only practitioner changed** (no time change): Show review, no warning
3. **Only time changed** (same practitioner): Show review + warning
4. **Both changed**: Show review + warning
5. **Notes changed**: Include in review if editable
6. **Auto-assignment**: Show "不指定" or "自動指派" clearly
7. **Original appointment was auto-assigned**: Show original practitioner as "自動指派" or "不指定"

---

## Questions Answered

1. **Visual layout**: ✅ Vertical before/after layout
2. **Skip option**: ❌ No skip option
3. **Animation**: ❌ No animations

---

## Summary of Changes

### Calendar Page Editing:
- ✅ Add review step **before** note step
- ✅ Show time change warning if time changed
- ✅ Use vertical before/after layout

### Pending Review Appointments:
- ✅ Add review step **before** note step
- ✅ Change form button to "下一步"
- ✅ Change save button to "確認指派"
- ✅ Show time change warning if time changed
- ✅ Use vertical before/after layout

### LIFF Rescheduling:
- ✅ Add review step before submit
- ✅ Use vertical before/after layout
- ✅ No arrow/separator text

---

## Next Steps

1. Update `EditAppointmentModal` to add review step
2. Update `AutoAssignedAppointmentsPage` button text
3. Update `RescheduleFlow` to add review step
4. Implement change detection and highlighting
5. Add time change warning component
6. Test all three flows

