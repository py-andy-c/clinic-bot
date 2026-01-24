# PR: Improve Appointment Creation Validation Experience

## Overview
This PR improves the user experience of the "Create Appointment" modal by refactoring how form validation works. Instead of disabling the "Next" button until all fields are valid (which can be confusing), the button is now always enabled (unless loading) and clicking it triggers clear, inline validation errors next to the relevant fields.

## Changes

### 1. Validation UX Overhaul
- **Enabled "Next" Button**: The "Next" (下一步) button is no longer disabled when fields are missing. Instead, clicking it performs a full validation check.
- **Inline Errors**: Validation errors ("必填") now appear directly to the right of the field labels (Patient, Appointment Type, Practitioner, Date & Time).
- **Auto-Clearing**: Errors automatically clear as soon as the user selects a value for the corresponding field.

### 2. Recurrence Validation Improvements
- **Default Value**: Configuring recurrence now automatically pre-fills the occurrence count to **1**, reducing the chance of submitting an invalid form.
- **Validation Visibility**: Fixed an issue where missing recurrence counts were not triggering validation errors if other fields were also missing. All errors now display simultaneously.
- **Consistent Styling**: Recurrence count validation uses the same inline style ("必填") as other fields.
- **State Reset**: Toggling "Recurrence" off now cleanly resets the count to default and clears any related validation errors.

### 3. Visual Styling
- **Less Intrusive Errors**: Validation error text has been styled with `font-normal` (instead of inheriting bold weights) to be distinct yet not overwhelming, matching existing error styles in the application.
- **Clean UI**: Removed the global error banner for field validation in favor of the more precise inline indicators.

### 4. Technical Updates
- **Refactored `CreateAppointmentModal`**: Introduced `validationErrors` state to manage field-level validity.
- **Component Updates**: Updated `DateTimePicker` and `AppointmentTypeSelector` props to support passing in external validation error messages.
- **Test Coverage**: Updated unit tests to reflect the new "always enabled" button logic and verified validation flows.
