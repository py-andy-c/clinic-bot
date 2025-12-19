# Design Documentation Consolidation Plan

## Overview

This document proposes a consolidation plan for the 34 design documents in `docs/design_doc/`. The goal is to:
1. **Document current state** (product expectations + high-level technical design)
2. **Remove outdated options** (docs that discuss multiple approaches but only one was chosen)
3. **Eliminate redundancy** (overlapping docs merged into single source of truth)
4. **Group logically** (by functional area/component)

## Proposed Grouping Strategy

Group by **functional area** (what the feature does), not by technical component. This makes it easier to find relevant documentation.

### Group 1: Appointments (Core Business Logic)
**Current docs:**
- `appointment_business_logic.md` ✅ (Keep - core rules)
- `appointment_duplication.md` ✅ (Keep - specific feature)
- `appointment_permissions.md` ✅ (Keep - access control)
- `single_page_appointment_creation.md` ❓ (Check if implemented)
- `appointment_form_refactor_optimization.md` ❓ (Check if implemented)
- `reschedule_plan.md` ❓ (Check if implemented)
- `recurring_appointments.md` ❓ (Check if implemented)
- `allow_patient_practitioner_selection.md` ✅ (Keep - setting/feature)

**Proposed consolidation:**
- **`appointments.md`** - Core appointment business logic, permissions, and constraints
  - Merge: `appointment_business_logic.md` (core rules)
  - Merge: `appointment_permissions.md` (access control)
  - Merge: `appointment_duplication.md` (feature)
  - Merge: `allow_patient_practitioner_selection.md` (setting)
  - Include: Current state of form implementation (from refactor docs if implemented)
  - Include: Reschedule feature (if implemented)
  - Include: Recurring appointments (if implemented)
  - Remove: Multiple options discussions, focus on current implementation

### Group 2: Billing & Checkout
**Current docs:**
- `billing_system.md` ⚠️ (Very long, discusses multiple options - consolidate)
- `checkout_modal_business_logic.md` ✅ (Keep - current implementation)
- `appointment_checkout_and_receipt_management.md` ✅ (Keep - constraints)
- `pdf_receipt_generation.md` ❓ (Check if implemented)

**Proposed consolidation:**
- **`billing_and_checkout.md`** - Billing system, checkout workflow, receipt management
  - Merge: `checkout_modal_business_logic.md` (current checkout flow)
  - Merge: `appointment_checkout_and_receipt_management.md` (constraints)
  - Extract from `billing_system.md`: Current state only (remove options discussions)
  - Include: PDF receipt generation (if implemented)
  - Remove: Historical options, focus on what's implemented

### Group 3: Resources & Scheduling
**Current docs:**
- `resource_selection.md` ✅ (Keep - component logic)
- `facility_resource_constraints.md` ✅ (Keep - constraints)
- `override_availability_scheduling.md` ❓ (Check if implemented)
- `calendar_refresh_optimization.md` ❓ (Check if implemented)

**Proposed consolidation:**
- **`resources_and_scheduling.md`** - Resource selection, constraints, availability
  - Merge: `resource_selection.md` (component)
  - Merge: `facility_resource_constraints.md` (constraints)
  - Include: Override availability (if implemented)
  - Include: Calendar optimization (if implemented)
  - Focus: Current implementation, not historical options

### Group 4: LINE Integration & Notifications
**Current docs:**
- `line_chatbot.md` ✅ (Keep - chatbot feature)
- `line_message_business_logic.md` ✅ (Keep - message types)
- `appointment_notification_overhaul.md` ✅ (Keep - notification flow)
- `availability_notification.md` ✅ (Keep - availability alerts)
- `proactive_line_users.md` ❓ (Check if implemented)
- `chatbot_test_feature.md` ❓ (Check if implemented)
- `eval_suite.md` ❓ (Check if implemented)

**Proposed consolidation:**
- **`line_integration.md`** - LINE chatbot, messages, notifications
  - Merge: `line_chatbot.md` (chatbot)
  - Merge: `line_message_business_logic.md` (message types)
  - Merge: `appointment_notification_overhaul.md` (notification flow)
  - Merge: `availability_notification.md` (availability alerts)
  - Include: Proactive LINE users (if implemented)
  - Include: Chatbot test/eval features (if implemented)
  - Focus: Current state, remove options discussions

### Group 5: Patient Management
**Current docs:**
- `patient_detail_page.md` ✅ (Keep - page design)
- `patient_detail_appointment_edit_delete.md` ⚠️ (Overlaps with above - merge)
- `manual_patient_creation_ux.md` ❓ (Check if implemented)

**Proposed consolidation:**
- **`patient_management.md`** - Patient pages, creation, editing
  - Merge: `patient_detail_page.md` (page design)
  - Merge: `patient_detail_appointment_edit_delete.md` (appointment actions)
  - Include: Manual patient creation (if implemented)
  - Focus: Current implementation

### Group 6: UI Components & Forms
**Current docs:**
- `datetime_picker_state_management.md` ✅ (Keep - component logic)
- `settings_form_state_management.md` ✅ (Keep - component logic)
- `date_time_format_standardization.md` ✅ (Keep - format rules)

**Proposed consolidation:**
- **`ui_components.md`** - Shared UI components, state management, formatting
  - Merge: `datetime_picker_state_management.md` (component)
  - Merge: `settings_form_state_management.md` (component)
  - Merge: `date_time_format_standardization.md` (formatting)
  - Focus: Current implementation, not historical refactors

### Group 7: System Architecture
**Current docs:**
- `multi-clinic-user.md` ✅ (Keep - architecture)
- `clinic_specific_provider_liff.md` ❓ (Check if implemented)
- `MIGRATE_LINE_USER_ID_TO_ASSOCIATION.md` ⚠️ (Migration doc - archive or delete if complete)
- `multi_lang.md` ❓ (Check if implemented)

**Proposed consolidation:**
- **`system_architecture.md`** - Multi-clinic, LIFF, migrations, internationalization
  - Keep: `multi-clinic-user.md` (current architecture)
  - Include: Clinic-specific LIFF (if implemented)
  - Include: Multi-language (if implemented)
  - Archive/Delete: Migration docs (if complete)
  - Focus: Current state, not migration history

### Group 8: Dashboards & Analytics
**Current docs:**
- `revenue_dashboard.md` ✅ (Already consolidated - keep as-is)

**Status:** ✅ Already done

## Implementation Steps

### Phase 1: Audit Current State
1. For each doc marked with ❓, check if feature is implemented
2. For docs marked ⚠️, identify what's current vs. historical options
3. Create checklist of what to keep vs. remove

### Phase 2: Create Consolidated Docs
1. Create new consolidated docs (one per group)
2. Structure: Business Logic → Technical Design → Current Implementation
3. Remove: Multiple options discussions, focus on chosen approach
4. Preserve: Critical business rules, constraints, current architecture

### Phase 3: Archive/Delete
1. Delete old docs after consolidation
2. Archive migration docs (if complete) to separate folder
3. Keep one consolidated doc per functional area

## Expected Outcome

**Before:** 34 docs (many overlapping, discussing options)
**After:** ~8 consolidated docs (one per functional area, current state only)

1. `appointments.md` - Appointment business logic, permissions, features
2. `billing_and_checkout.md` - Billing, checkout, receipts
3. `resources_and_scheduling.md` - Resources, constraints, availability
4. `line_integration.md` - LINE chatbot, messages, notifications
5. `patient_management.md` - Patient pages, creation, editing
6. `ui_components.md` - Shared components, state management
7. `system_architecture.md` - Multi-clinic, LIFF, i18n
8. `revenue_dashboard.md` - ✅ Already done

## Notes

- **Focus on "what is" not "what could be"** - Document current state
- **Preserve business rules** - Critical constraints and logic must be documented
- **Remove options discussions** - If we chose one approach, document that only
- **Keep it concise** - Like `revenue_dashboard.md`, be brief but complete
- **Archive migrations** - Move completed migration docs to `docs/archive/` if needed

