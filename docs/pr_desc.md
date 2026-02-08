# PR Description: Unify Actionable Card UX and Standardize Mobile Interface

## Overview

This PR standardizes the user experience across the application's management pages by unifying the `ActionableCard` component. The update focuses on creating a premium, mobile-first design with consistent action styling, improved type safety, and better list interactions on smaller screens.

## Key Changes

### 1. ActionableCard Component Enhancements

* **Standardized Button Styling**: Implemented a unified design for action buttons.
  * **Primary**: Solid blue for main actions (e.g., "Save", "Book").
  * **Secondary**: Light blue background for common actions ("Edit", "View").
  * **Danger**: Light red background for destructive actions ("Delete").
  * **Ghost**: Transparent background for cancellations or secondary options.
* **Icon Removal**: Removed icons from action buttons for a cleaner, text-focused interface.
* **Improved Content Layout**: Removed `line-clamp-2` restriction on descriptions to support expandable content.
* **Type Safety**: Enhanced props using `Omit` to safely handle `ReactNode` titles.

### 2. Mobile Interface Refactoring

Refactored key pages to use `ActionableCard` for optimized mobile views:

* **Patients Page**:
  * Standardized "View" and "Book" actions.
  * Made LINE User display names clickable links on mobile.
* **LINE Users Page**:
  * Implemented a collapsed/expanded view for patient lists.
  * Integrated the patient count toggle directly into the list flow.
  * Unified AI auto-reply toggle display.
* **Patient Detail Page**:
  * Updated `PatientAppointmentsList` to use `ActionableCard`, providing a consistent look for appointment history.
* **Service Items**:
  * Enabling drag-and-drop sorting with the new card pattern.
* **Settings Pages**:
  * Standardized management lists for Medical Record Templates, Patient Form Templates, and Resources.
  * Refactored LIFF URL cards in Appointment Settings.
* **System Clinics Page**:
  * Updated clinic overview cards with standardized metadata badges.

### 3. Stability and Maintenance

* **TypeScript Fixes**: Resolved 20+ TypeScript errors:
  * Explicit typing for `.map()` parameters.
  * Fixed missing imports and hook usages.
  * Corrected event handler typing.
* **Test Compliance**: All frontend tests pass (`run_frontend_tests.sh`).
* **UX Consistency**: Transitioned from implicit clickable cards to explicit, clearly labeled action buttons for better usability.

## Verification Results

* **Type Checking**: `tsc` passes with 0 errors.
* **Unit Tests**: All 118 unit tests passed successfully.
* **Manual Verification**:
  * Verified mobile expansion behavior on LINE Users page.
  * Checked clickable links on Patients page mobile view.
  * Confirmed consistent card styling in Patient Detail appointment list.

## UI Patterns

* **Edit/View**: Secondary variant (Soft Blue)
* **Delete**: Danger variant (Soft Red)
* **Primary Action**: Primary variant (Solid Blue)
