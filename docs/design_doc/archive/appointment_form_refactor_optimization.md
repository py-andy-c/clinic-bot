# Appointment Form Refactor and Performance Optimization

## Overview
This document outlines the plan to refactor the appointment creation and editing forms to improve performance, eliminate UI flickering, and increase code reusability. The refactor focuses on `EditAppointmentModal` and `CreateAppointmentModal` (which also handles appointment duplication).

## Goals
1.  **Eliminate UI Flickering**: Ensure all necessary data (practitioners, assigned resources) is loaded before rendering the form fields.
2.  **Optimize Initial Load Time**: Reduce the number of sequential API calls (waterfalls) and defer non-essential data fetching.
3.  **Optimize Duplication Flow**: Provide a stable, non-jarring experience when duplicating appointments by avoiding immediate conflict errors and auto-expanding the calendar.
4.  **Improve Resource Selection UX**: Remove unnecessary debouncing during initial load and optimize resource fetching.
5.  **Increase Code Reusability**: Extract shared logic and UI components used by both `EditAppointmentModal` and `CreateAppointmentModal`.

## Proposed Changes

### 1. Shared Logic Hook: `useAppointmentForm`
A custom hook `frontend/src/hooks/useAppointmentForm.ts` to manage the core state, validation, and side effects of the appointment form.

- **Inputs**: 
    - `mode`: `'create' | 'edit' | 'duplicate'`.
    - `initialData`: Partial appointment data (e.g., from an existing event or duplication source).
    - `appointmentTypes`: Full list of available types.
    - `practitioners`: Full list of all practitioners.
- **State**:
    - **Form values**: `selectedAppointmentTypeId`, `selectedPractitionerId`, `selectedDate`, `selectedTime`, `clinicNotes`, `selectedResourceIds`.
    - **Reference**: `referenceDateTime` (original appointment time for display).
    - **UI State**: `isInitialLoading` (true until all mount-time data is ready), `isLoadingPractitioners`, `availablePractitioners`, `isLoadingResources`, `error`, `isValid`.
- **Logic**:
    - **Parallel Initialization**: On mount, if an `eventId` is provided (Edit/Duplicate), fetch filtered practitioners and currently assigned resources in parallel using `Promise.allSettled` to handle partial failures gracefully (e.g., allow form to proceed even if resources fail to load).
    - **Request Cancellation**: Implement `AbortController` to cancel in-flight API calls if the modal is closed.
    - **Duplication Specifics**: If `mode === 'duplicate'`, initialize `selectedTime` as an empty string (`''`) while keeping `selectedDate` to avoid immediate conflict triggers while placing the user on the correct day.
    - **Validation**: Centralize field-level validation and overall form validity.
    - **Auto-Deselection**: Clear dependent fields (practitioner, time) when their parent selection (type, practitioner) changes.

### 2. Performance Optimizations

#### A. Parallelize Practitioner and Resource Fetching
Eliminate the waterfall where `ResourceSelection` waits for the modal to finish its own resource fetch.
- Both `apiService.getPractitioners(typeId)` and `apiService.getAppointmentResources(eventId)` will be triggered together in the `useAppointmentForm` hook.

#### B. Optimized `ResourceSelection` Loading
- **Skip Initial Debounce**: `ResourceSelection` will be modified to fetch availability immediately if all required parameters are present on mount.
- **Stable Layout**: Render the `ResourceSelection` container even while loading (using a skeleton or stable height) to prevent "診所備註" (Clinic Notes) and footer buttons from shifting.

#### C. Deferred Calendar Availability Fetching
- `DateTimePicker` will be updated to only trigger the expensive `getBatchAvailableSlots` call (month availability) when the user explicitly clicks to expand the calendar.
- Results will be cached to ensure subsequent expansions are instantaneous.

#### D. Conditional Conflict Checking
- For existing appointments (Edit mode), the initial `checkSchedulingConflicts` call on mount will be skipped. It will only be triggered if the **Date**, **Time**, or **Practitioner** is changed by the user.

### 3. Duplication UX Improvements
- **Reference Header**: Show `原預約時間：2025/12/31(三) 9:30 AM` at the top of the form so the user has the original context.
- **Initial Expansion**: The `DateTimePicker` will be initialized in an **expanded** state for duplication, as the user almost certainly needs to select a new time.
- **No Immediate Conflict**: Since `selectedTime` is cleared on start for duplicates, the user won't be greeted by a "Time Conflict" error immediately.

### 4. Shared UI Components
Extract repeated UI sections into atomic components in `frontend/src/components/calendar/form/`:
- **Skeleton Loader**: A layout-aware skeleton for the entire form body during `isInitialLoading`.
- `AppointmentReferenceHeader`: Displays the original appointment time for context (Edit/Duplicate).
- `AppointmentTypeSelector`: Handles sorting and the "(原)" label logic.
- `PractitionerSelector`: Handles the "Loading..." state and empty filtered states.
- `FormSection`: A wrapper component for consistent spacing and labeling.

### 5. Implementation Plan

#### Phase 1: Infrastructure
1.  Create `frontend/src/hooks/useAppointmentForm.ts` with `mode`, validation, and `AbortController` support.
2.  Create shared atomic components and **Skeleton Loader** in `frontend/src/components/calendar/form/`.
3.  Modify `ResourceSelection.tsx` to support `skipInitialDebounce` and parallel resource data.

#### Phase 2: Refactor Edit Modal
1.  Update `EditAppointmentModal.tsx` to use `useAppointmentForm(mode="edit")`.
2.  Implement the "Loading all data first" pattern using `isInitialLoading` and the Skeleton Loader.
3.  Replace raw selectors with shared atomic components.

#### Phase 3: Refactor Create Modal
1.  Update `CreateAppointmentModal.tsx` to use `useAppointmentForm(mode="create")`.
2.  Apply shared UI components to ensure visual consistency.

#### Phase 4: Refactor Duplicate Modal
1.  Update `CreateAppointmentModal.tsx` duplication logic to use `useAppointmentForm(mode="duplicate")`.
2.  Implement `mode="duplicate"` logic (clearing time, auto-expanding calendar).
3.  Apply shared UI components and the `AppointmentReferenceHeader`.

#### Phase 5: DateTimePicker Optimization
1.  Modify `DateTimePicker.tsx` to defer month availability fetching until expansion and implement caching.
2.  Add `initialExpanded` prop support.
3.  Optimize conflict check triggers and "Stable Mount" logic.

#### Phase 6: Testing & Verification
1.  Unit tests for `useAppointmentForm` hook (state transitions, validation, auto-deselection).
2.  Manual verification of duplication flow (flicker-free, calendar expansion).
3.  Verify conflict detection still works correctly after user changes date/time.

## Expected Outcomes
- **Flicker-free opening**: The modal content appears all at once when ready, or shows a single clean loading state.
- **Smooth Duplication**: Modal opens with the calendar already expanded to the right date, original time visible as a label, and no error messages.
- **Perceived speed increase**: By parallelizing requests and skipping debounces, the form becomes interactive ~300-600ms faster.
- **Maintainability**: Reduced code duplication between `Edit` and `Create` modals by approximately 40-50%.
