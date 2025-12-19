# Billing & Checkout - Business Logic & Technical Design

## Overview

This document defines the business logic and technical design for billing, checkout workflows, and receipt management in the clinic system. It covers billing scenarios, checkout modal logic, receipt generation, and critical constraints.

---

## Key Business Logic

### 1. Service Items vs Appointment Types

**Conceptual Change**: Appointment types are now conceptually "service items" with billing configuration, but the table name `appointment_types` is kept for backward compatibility.

**Additional Fields**:
- `receipt_name`: Name to display on receipt (can differ from `name`)
- `allow_patient_booking`: Whether patients can book this service via LIFF (default: true)
- `description`: Service description shown on LIFF
- `scheduling_buffer_minutes`: Additional minutes added to duration for scheduling (default: 0)

**Rationale**: Service items need billing configuration separate from scheduling configuration. The receipt name allows clinics to use different names on receipts vs. internal display.

### 2. Billing Scenarios

**Purpose**: Support multiple pricing options per practitioner per service (e.g., regular price, discounts, member prices).

**Structure**:
- Each billing scenario belongs to a practitioner-service combination (`practitioner_appointment_type_id`)
- Each scenario defines:
  - `name`: Scenario name (e.g., "原價", "九折", "會員價")
  - `amount`: Amount charged to patient (shown on receipt)
  - `revenue_share`: Revenue share to clinic (internal only, must be <= amount)
  - `is_default`: Whether this is the default scenario for this combination

**Business Rules**:
- `revenue_share <= amount` (enforced at database and application level)
- `amount > 0` (billing scenarios cannot have zero amount)
- `revenue_share >= 0`
- Scenario name must be unique per practitioner-service combination (excluding deleted)
- Only one default scenario per practitioner-service combination
- When default is deleted, next scenario becomes default (or none if empty)

**Rationale**: Allows clinics to define standard pricing options while maintaining flexibility for custom pricing during checkout.

### 3. Checkout Modal Business Logic

**Core Principle**: Conditional field dependencies - earlier field selections determine what options are available in later fields.

**Field Structure** (per checkout item):
- **服務項目** (Service Item): Dropdown with all service options + "其他" (Other)
- **Practitioner**: Dropdown with filtered practitioners + "無" (None)
- **Billing Scenario**: Dropdown with scenarios based on service+practitioner + "其他" (Other)
- **金額** (Amount): Price charged to patient
- **抽成** (Revenue Share): Clinic's revenue share
- **自訂項目名稱** (Custom Item Name): Text field (only shown when service item is "其他")
- **Quantity**: Number of items (default: 1)

**Field Dependencies**:
1. **Service Item → Practitioner**: 
   - Regular service: Shows practitioners who offer that service
   - "其他": Shows all practitioners
2. **Service Item + Practitioner → Billing Scenario**:
   - Only shown when: Service item is regular AND practitioner is selected
   - Options: All billing scenarios for the service+practitioner combination + "其他"
3. **Billing Scenario → Amount/Revenue Share**:
   - Scenario selected: Fields are read-only (values from scenario)
   - "其他" selected: Fields become editable
4. **Service Item = "其他"**:
   - Custom item name field appears (required)
   - Billing scenario dropdown hidden
   - Amount and revenue share always editable

**Initialization**: First item (and new items) are automatically populated from appointment context (`appointment_type_id` and `practitioner_id`), providing a quick starting point that can be modified.

**Rationale**: Ensures data consistency and prevents invalid combinations (e.g., selecting a billing scenario for a practitioner who doesn't offer that service).

### 4. Checkout Validation

**Item-Level Validation**:
- Service item or custom name required
- Amount must be >= 0 (allows free services)
- Revenue share must be >= 0 and <= amount
- Quantity must be >= 1 and integer
- Custom item name required when service item is "其他"

**Checkout-Level Validation**:
- At least one item must exist
- All items must pass item-level validation
- Total amount can be 0 (allows free checkouts)
- Appointment must exist and not be cancelled
- Appointment must not already have an active (non-voided) receipt
- Payment method must be provided and valid (one of: "cash", "card", "transfer", "other")

**Rationale**: Prevents invalid checkouts while allowing flexibility (free services, zero amounts).

### 5. Receipt Constraints

**Critical Business Rules** (see `appointments.md` for full details):

1. **Previously Checked Out Appointments Cannot Be Modified**
   - If an appointment has **any receipt** (active or voided), it cannot be edited, rescheduled, or cancelled
   - Applies to both clinic users and patients
   - **Rationale**: Maintains accounting integrity and audit trail

2. **Cancelled Appointments Cannot Be Checked Out**
   - Cancelled appointments cannot have receipts created
   - Enforced in `ReceiptService.create_receipt()` (validates `status == "confirmed"`)

3. **Receipt Visibility**
   - **Patients**: Can only see **active receipts** (not voided)
   - **Clinic Users**: Can see **all receipts** (active and voided)

### 6. Receipt Immutability

**Design Pattern**: JSONB snapshot pattern ensures immutability when dependencies change.

**Structure**:
- `receipt_data` (JSONB): Complete immutable snapshot of all receipt data at creation time
- Frequently queried fields extracted to columns for performance:
  - `receipt_number`: Sequential receipt number (e.g., "2024-00001")
  - `issue_date`: Receipt issue date
  - `total_amount`: Total amount charged to patient
  - `total_revenue_share`: Total revenue share (internal)
- Voiding information stored in columns (not in JSONB):
  - `is_voided`: Whether receipt has been voided
  - `voided_at`: Timestamp when receipt was voided
  - `voided_by_user_id`: Admin user who voided the receipt
  - `void_reason`: Reason for voiding (1-500 characters)

**Database Constraints**:
- `receipt_data` is immutable (database trigger prevents updates)
- Only one active (non-voided) receipt per appointment (partial unique index)
- Receipt numbers unique per clinic

**Rationale**: Complies with Taiwan legal requirements (Physical Therapists Act, Medical Care Act, Commercial Accounting Act) and maintains complete audit trail.

### 7. Receipt Voiding and Re-issuing

**Voiding Rules**:
- Only admins can void receipts
- Voiding requires a reason (1-500 characters)
- Voided receipts cannot be modified (void_info is immutable after voiding)
- Voided receipts are preserved for audit trail

**Re-issuing**:
- After voiding, clinic users can create a new receipt for the same appointment
- New receipt gets new receipt number
- Old voided receipt remains in database for audit trail

**Rationale**: Allows corrections while maintaining complete audit trail for legal compliance.

---

## Edge Cases

### 1. Appointment with No Service Type

**Scenario**: Appointment created without service type (edge case).

**Behavior**: Checkout modal starts with empty item, user must select service or "其他"

### 2. Service with No Practitioners

**Scenario**: Service item exists but no practitioners offer it.

**Behavior**: Practitioner dropdown shows only "無" (None), amount/revenue_share become editable

### 3. Practitioner with No Billing Scenarios

**Scenario**: Practitioner offers service but no billing scenarios defined.

**Behavior**: Billing scenario dropdown hidden, amount/revenue_share become editable

### 4. Multiple Items with Same Service

**Scenario**: User adds multiple checkout items with same service.

**Behavior**: Each item maintains independent state, can have different practitioners/scenarios

### 5. Changing Service After Practitioner Selected

**Scenario**: User changes service item after practitioner is selected.

**Behavior**: 
- If current practitioner doesn't offer new service → set practitioner to "無" (null)
- If current practitioner offers new service → keep practitioner
- Clear billing scenario and reset amount/revenue_share to 0

### 6. Receipt Voiding Impact on Checkout Status

**Scenario**: Receipt is voided after appointment is checked out.

**Behavior**:
- `has_active_receipt` changes from `true` → `false` (checkout status: "checked out" → "not checked out")
- `has_any_receipt` remains `true` (appointment remains "previously checked out")
- Appointment cannot be modified (constraint still applies)
- UI updates checkout indicator, but modification buttons remain disabled

### 7. Receipt Voiding During Appointment Edit Attempt

**Scenario**: User A voids receipt while User B is trying to edit appointment.

**Behavior**: User B's edit attempt is blocked by constraint (voided receipt still counts as "any receipt")

### 8. Appointment Checked Out, Receipt Voided, Appointment Cancelled

**Scenario**: Appointment checked out, receipt voided, then user tries to cancel.

**Behavior**: Cancellation blocked (constraint prevents cancellation after checkout, even if receipt is voided)

### 9. Concurrent Checkout Attempts

**Scenario**: Two users try to checkout same appointment simultaneously.

**Behavior**: Database constraint prevents multiple active receipts (partial unique index on `appointment_id` where `is_voided = false`). First checkout succeeds, second fails with clear error.

---

## Technical Design

### Checkout Modal State Management

**Initialization**:
- First item auto-populated from appointment context (`appointment_type_id` and `practitioner_id`)
- If both exist: Load practitioners and billing scenarios, auto-select default scenario
- If only `appointment_type_id` exists: Load practitioners, set amount/revenue_share to 0 (editable)
- If neither exists: Start with empty item

**Field Change Handlers**:
- **Service Item Change**: Update practitioner options, clear dependent fields if invalid
- **Practitioner Change**: Load billing scenarios, auto-select default if exists
- **Billing Scenario Change**: Update amount/revenue_share (read-only if scenario selected, editable if "其他")

**Validation**: Real-time validation with inline error messages. Submit button disabled until all items pass validation.

### Receipt Generation

**PDF Generation**: Uses WeasyPrint with HTML/CSS templates.

**Template Structure**:
- Receipt template uses `receipt_data` JSONB field (immutable snapshot)
- Supports Traditional Chinese text rendering (NotoSansTC font)
- A4 page size with proper text wrapping and multi-page handling
- Voided receipt watermark overlay

**Endpoints**:
- `GET /api/receipts/{receipt_id}/html`: HTML receipt view (for LIFF and clinic preview)
- `GET /api/receipts/{receipt_id}/download`: PDF receipt download

**Rationale**: Ensures consistency between HTML display and PDF download. Immutability ensures receipts remain accurate even if dependencies change.

### Receipt Number Generation

**Format**: Sequential receipt number per clinic (e.g., "2024-00001")

**Generation**:
- Format: `{year}-{sequential_number}` (5 digits, zero-padded)
- Sequential number resets each calendar year (January 1)
- Unique per clinic (enforced by database constraint)

**Rationale**: Provides human-readable receipt numbers that comply with Taiwan legal requirements.

### Receipt Settings

**Location**: Stored in `clinic.settings` JSONB column under `receipt_settings` key.

**Fields**:
- `custom_notes`: Optional custom notes to append at the end of receipts (max 2000 characters)
- `show_stamp`: Whether to display a stamp with clinic name and checkout date on receipts (default: false)

**Rationale**: Allows clinics to customize receipt appearance and add clinic-specific information.

---

## Summary

This document covers:
- Service items and billing scenarios (pricing options per practitioner-service)
- Checkout modal business logic (conditional field dependencies)
- Checkout validation (item-level and checkout-level rules)
- Receipt constraints (previously checked out appointments cannot be modified)
- Receipt immutability (JSONB snapshot pattern for legal compliance)
- Receipt voiding and re-issuing (corrections with audit trail)
- Edge cases (no service type, no practitioners, no scenarios, concurrent checkouts)
- Technical design (state management, PDF generation, receipt number generation)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

