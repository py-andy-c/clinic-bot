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

## Backend Technical Design

### API Endpoints

#### `POST /clinic/appointments/{appointment_id}/checkout`
- **Description**: Create receipt for appointment checkout
- **Path Parameters**: `appointment_id`
- **Request Body**:
  ```typescript
  {
    payment_method: "cash" | "card" | "transfer" | "other",
    items: [{
      service_item_id?: number,
      practitioner_id?: number | null,
      billing_scenario_id?: number | null,
      custom_name?: string,
      amount: number,
      revenue_share: number,
      quantity?: number
    }]
  }
  ```
- **Response**: `{ receipt_id: number, receipt_number: string }`
- **Errors**:
  - 400: Validation errors, appointment already has receipt, appointment cancelled
  - 403: Permission denied
  - 404: Appointment not found
  - 500: Internal server error

#### `GET /clinic/receipts/{receipt_id}`
- **Description**: Get receipt details
- **Path Parameters**: `receipt_id`
- **Response**: `Receipt` object with full details
- **Errors**: 404, 500

#### `PUT /clinic/receipts/{receipt_id}/void`
- **Description**: Void a receipt
- **Path Parameters**: `receipt_id`
- **Request Body**: `{ reason: string }`
- **Response**: `{ success: true }`
- **Errors**:
  - 400: Invalid reason
  - 403: Not admin
  - 404: Receipt not found, already voided
  - 500: Internal server error

#### `GET /clinic/receipts/{receipt_id}/html`
- **Description**: Get receipt as HTML for display/preview
- **Path Parameters**: `receipt_id`
- **Response**: HTML string
- **Errors**: 404, 500

#### `GET /clinic/receipts/{receipt_id}/download`
- **Description**: Download receipt as PDF
- **Path Parameters**: `receipt_id`
- **Response**: PDF file
- **Errors**: 404, 500

#### `GET /clinic/billing-scenarios?practitioner_id={id}&appointment_type_id={id}`
- **Description**: Get billing scenarios for practitioner-service combination
- **Query Parameters**: `practitioner_id`, `appointment_type_id`
- **Response**: `BillingScenario[]`
- **Errors**: 500

### Database Schema

**Receipts Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `appointment_id`: Foreign key to appointments (ON DELETE RESTRICT)
- `receipt_number`: String (unique per clinic, format: "YYYY-NNNNN")
- `receipt_data`: JSONB (immutable snapshot)
- `issue_date`: DateTime
- `total_amount`: Integer (cents, for queries)
- `total_revenue_share`: Integer (cents, for queries)
- `payment_method`: String
- `is_voided`: Boolean
- `voided_at`: DateTime (nullable)
- `voided_by_user_id`: Foreign key to users (nullable)
- `void_reason`: String (nullable)
- `created_at`: DateTime
- `updated_at`: DateTime

**Billing Scenarios Table**:
- `id`: Primary key
- `clinic_id`: Foreign key to clinics
- `practitioner_appointment_type_id`: Foreign key to practitioner_appointment_types
- `name`: String (unique per practitioner-service)
- `amount`: Integer (cents)
- `revenue_share`: Integer (cents)
- `is_default`: Boolean
- `is_deleted`: Boolean (soft delete)
- `created_at`: DateTime
- `updated_at`: DateTime

**Constraints**:
- `total_revenue_share <= total_amount` (trigger enforced)
- `amount > 0` (check constraint)
- `revenue_share >= 0` (check constraint)
- Receipt numbers unique per clinic (unique index)
- Only one active receipt per appointment (partial unique index)

### Business Logic Implementation

**ReceiptService** (`backend/src/services/receipt_service.py`):
- `create_receipt()`: Validates appointment status, creates receipt with JSONB snapshot, generates receipt number
- `void_receipt()`: Validates permissions, voids receipt with reason, preserves audit trail
- `generate_receipt_number()`: Creates sequential receipt numbers per clinic per year
- `get_receipt_html()`: Generates HTML receipt using WeasyPrint template

**BillingScenarioService** (`backend/src/services/billing_scenario_service.py`):
- `get_scenarios()`: Returns billing scenarios for practitioner-service combination
- `create_scenario()`: Validates business rules, creates billing scenario
- `update_scenario()`: Updates scenario with validation
- `delete_scenario()`: Soft deletes scenario, handles default scenario reassignment

**Key Business Logic**:
- JSONB snapshot pattern: All receipt data stored immutably at creation time
- Receipt number generation: Sequential per clinic per calendar year
- Validation cascade: Appointment status → Receipt existence → Item validation
- Permission checks: Admin-only for voiding, clinic isolation enforced

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)
- [x] **Data Source**: Multiple API endpoints for billing scenarios, receipts, appointment context
- [x] **Current Implementation**: Using `useApiData` hook
  - **Note**: Migration to React Query planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`
- [x] **Query Keys** (when migrated to React Query):
  - `['billing-scenarios', practitionerId, appointmentTypeId]` - Billing scenarios
  - `['receipt', receiptId]` - Single receipt
  - `['receipt-html', receiptId]` - Receipt HTML
  - `['practitioners-by-service', serviceItemId]` - Practitioners for service
- [x] **Cache Strategy**:
  - **Current**: Custom cache with TTL (5 minutes default), clinic ID auto-injection
  - **Future (React Query)**:
    - `staleTime`: 5 minutes (billing data)
    - `staleTime`: 10 minutes (receipt data - rarely changes)
    - `cacheTime`: 10 minutes
    - Invalidation triggers: Billing scenario changes, receipt creation/voiding

#### Client State (UI State)
- [x] **CheckoutModal State** (`frontend/src/components/calendar/CheckoutModal.tsx`):
  - **State Properties**:
    - `items`: Array of checkout items (service, practitioner, scenario, amounts)
    - `paymentMethod`: Payment method selection
    - `billingScenarios`: Cached billing scenarios per practitioner-service combo
    - `practitionersByServiceItem`: Cached practitioners per service item
    - `expandedQuantityItems`: UI state for quantity expansion
  - **Actions**:
    - Add/remove checkout items
    - Update item fields with dependency handling
    - Validate and submit checkout
  - **Usage**: Complex state management for conditional field dependencies

- [x] **Local Component State**:
  - `CheckoutModal`: Items array, payment method, loading/error states, modal states
  - `ReceiptViewModal`: Receipt display, download functionality
  - `ReceiptListModal`: Receipt list filtering and pagination
  - `ServiceItemSelectionModal`: Service item selection with grouping

#### Form State
- [x] **Custom Form State**: Checkout items managed as complex state objects
  - **Validation**: Real-time validation with inline error messages
  - **Dependencies**: Field changes trigger cascading updates to dependent fields
  - **Default Values**: Auto-populated from appointment context when possible

### Component Architecture

#### Component Hierarchy
```
EventModal
  ├── CheckoutModal
  │   ├── CheckoutItemRow (for each item)
  │   │   ├── ServiceItemSelector
  │   │   ├── PractitionerSelector
  │   │   ├── BillingScenarioSelector
  │   │   ├── AmountFields (editable/read-only based on scenario)
  │   │   └── QuantitySelector
  │   ├── PaymentMethodSelector
  │   ├── TotalSummary
  │   └── ServiceItemSelectionModal (for adding items)
  └── ReceiptViewModal
      ├── ReceiptDisplay
      ├── DownloadButton
      └── VoidButton (admin only)

ReceiptListModal
  ├── ReceiptFilters
  ├── ReceiptList
  └── ReceiptPreviewModal
```

#### Component List
- [x] **CheckoutModal** (`frontend/src/components/calendar/CheckoutModal.tsx`)
  - **Props**: `event`, `appointmentTypes`, `practitioners`, `onClose`, `onSuccess`
  - **State**: Items array, payment method, billing scenarios cache, practitioners cache, loading states
  - **Dependencies**: `useApiData` (billing scenarios, practitioners), complex field dependency logic
  - **Features**: Conditional field dependencies, real-time validation, service item selection modal

- [x] **ReceiptViewModal** (`frontend/src/components/calendar/ReceiptViewModal.tsx`)
  - **Props**: `receiptId`, `isOpen`, `onClose`
  - **State**: Receipt data, HTML content, loading states
  - **Dependencies**: `useApiData` (receipt HTML), download functionality

- [x] **ReceiptListModal** (`frontend/src/components/calendar/ReceiptListModal.tsx`)
  - **Props**: `appointmentId`, `isOpen`, `onClose`
  - **State**: Receipt list, filters, pagination
  - **Dependencies**: `useApiData` (receipt list)

- [x] **ServiceItemSelectionModal** (`frontend/src/components/calendar/ServiceItemSelectionModal.tsx`)
  - **Props**: `isOpen`, `onClose`, `onSelect`, `groups`
  - **State**: Selected service items, quantity
  - **Dependencies**: Service item groups, quantity handling

### User Interaction Flows

#### Flow 1: Checkout Process (Clinic Admin)
1. User clicks appointment on calendar → `EventModal` opens
2. User clicks "結帳" button (only shown if appointment has no active receipt)
3. `CheckoutModal` opens, auto-populated from appointment context
4. User reviews/modifies checkout items:
   - Change service item → Practitioners update → Billing scenarios load
   - Change practitioner → Billing scenarios update
   - Select billing scenario → Amount/revenue share auto-fill (read-only)
   - Or select "其他" → Amount/revenue share become editable
5. User adds additional items if needed (multi-service appointments)
6. User selects payment method
7. User clicks "確認結帳"
8. Frontend validates all items and checkout rules
9. API call creates receipt with JSONB snapshot
10. Success message shown, modal closes, calendar refreshes with checkout indicator
   - **Edge case**: Appointment already has receipt → Checkout button hidden, error if attempted
   - **Edge case**: No billing scenarios → Amount fields editable, revenue share defaults to 0
   - **Error case**: Validation error → Field-level errors shown, user can fix and retry

#### Flow 2: Receipt Viewing
1. User clicks appointment with receipt → `EventModal` opens
2. User clicks "收據" button → `ReceiptListModal` opens
3. User sees list of receipts (active and voided)
4. User clicks receipt → `ReceiptViewModal` opens
5. User can view receipt HTML, download PDF
6. Admin can void receipt (requires reason)
   - **Edge case**: Voided receipt → Watermark shown, void info displayed
   - **Edge case**: Multiple receipts → Shows all, sorted by issue date

#### Flow 3: Receipt Voiding (Admin Only)
1. Admin opens receipt view modal
2. Admin clicks "作廢收據" button
3. Confirmation modal asks for void reason (1-500 characters)
4. Admin enters reason and confirms
5. Receipt voided, void info recorded
6. Modal updates to show voided status
7. Appointment checkout status changes (can create new receipt)
   - **Edge case**: Non-admin user → Void button hidden
   - **Edge case**: Already voided → Void button hidden
   - **Error case**: Invalid reason → Validation error shown

#### Flow 4: Service Item Selection for Checkout
1. User clicks "新增項目" in checkout modal
2. `ServiceItemSelectionModal` opens with grouped service items
3. User selects service item and quantity
4. User clicks "確認"
5. Modal closes, new checkout item added with auto-populated fields
   - **Edge case**: Service with no practitioners → Practitioner set to "無", amounts editable

### Edge Cases and Error Handling

#### Edge Cases
- [x] **Race Condition**: User switches clinic during checkout
  - **Solution**: `useApiData` includes clinic ID in cache keys, automatically refetches on clinic switch
  - **Future (React Query)**: Query invalidation on clinic switch

- [x] **Concurrent Checkout**: Multiple admins try to checkout same appointment
  - **Solution**: Database constraint prevents multiple active receipts per appointment
  - **Behavior**: First checkout succeeds, second fails with clear error message

- [x] **Clinic Switching**: User switches clinic while checkout modal open
  - **Solution**: Modal should close or show warning, data refetches with new clinic context

- [x] **Component Unmount**: Component unmounts during checkout API call
  - **Solution**: `useApiData` checks `isMountedRef` before state updates, prevents memory leaks

- [x] **Network Failure**: API call fails during checkout
  - **Solution**: Error message shown, user can retry checkout
  - **Implementation**: `useApiData` handles errors, shows user-friendly messages

- [x] **Stale Data**: User views appointment, another user modifies it, first user tries to checkout
  - **Solution**: Backend validates appointment status and receipt existence before allowing checkout

- [x] **Receipt Voiding During Checkout**: Receipt voided while user viewing receipt
  - **Solution**: Receipt data includes void status, UI updates accordingly

- [x] **Appointment Context Missing**: Appointment has no service type/practitioner
  - **Solution**: Checkout starts with empty item, user must select all fields manually

- [x] **Billing Scenario Deleted**: Scenario deleted after user loads checkout
  - **Solution**: Backend validates scenario existence before allowing checkout, returns error if deleted

#### Error Scenarios
- [x] **API Errors (4xx, 5xx)**:
  - **User Message**: User-friendly error messages extracted from API response
  - **Recovery Action**: User can retry operation, or cancel and try again
  - **Implementation**: `getErrorMessage()` utility, `useApiData` displays errors

- [x] **Validation Errors**:
  - **User Message**: Field-level error messages (e.g., "請選擇服務項目", "金額不能為負數")
  - **Field-level Errors**: Shown inline next to form fields via real-time validation
  - **Implementation**: Frontend validation logic, error state management

- [x] **Loading States**:
  - **Initial Load**: Loading spinner shown while fetching billing scenarios/practitioners
  - **Checkout**: Submit button disabled, loading spinner shown during receipt creation
  - **Receipt View**: Loading shown while fetching receipt HTML
  - **Implementation**: `useApiData` provides `loading` state, components show spinners

- [x] **Permission Errors (403)**:
  - **User Message**: "您沒有權限執行此操作"
  - **Recovery Action**: User cannot proceed
  - **Implementation**: Backend returns 403, frontend shows error message, checkout button hidden for non-admins

- [x] **Not Found Errors (404)**:
  - **User Message**: "收據不存在" or "預約不存在"
  - **Recovery Action**: Modal closes, user returns to calendar
  - **Implementation**: Backend returns 404, frontend closes modal or redirects

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Test Scenario**: Complete checkout flow
  - Steps:
    1. Login as admin
    2. Navigate to calendar
    3. Click appointment without receipt
    4. Click "結帳"
    5. Verify modal opens with auto-populated fields
    6. Modify fields if needed
    7. Select payment method
    8. Click "確認結帳"
    9. Verify success message, receipt created
  - Assertions: Receipt created successfully, appointment shows checkout indicator
  - Edge cases: Test with custom service item, test validation errors, test concurrent checkout

- [x] **Test Scenario**: Receipt viewing and voiding
  - Steps:
    1. Open receipt list modal
    2. Click receipt to view
    3. Verify receipt displays correctly
    4. Admin clicks void button
    5. Enter void reason
    6. Confirm voiding
    7. Verify voided status shown
  - Assertions: Receipt displays, voiding works, status updates
  - Edge cases: Test voided receipt display, test non-admin user (void button hidden)

- [x] **Test Scenario**: Field dependencies in checkout
  - Steps:
    1. Open checkout modal
    2. Change service item
    3. Verify practitioners update
    4. Change practitioner
    5. Verify billing scenarios load
    6. Select scenario
    7. Verify amounts become read-only
  - Assertions: Field dependencies work correctly, validation prevents invalid combinations

#### Integration Tests (MSW)
- [x] **Test Scenario**: Checkout modal initialization
  - Mock API responses: Billing scenarios, practitioners
  - User interactions: Open checkout modal
  - Assertions: Fields auto-populate from appointment context, billing scenarios load

- [x] **Test Scenario**: Checkout submission with validation
  - Mock API responses: Checkout success
  - User interactions: Fill form, submit
  - Assertions: Validation errors shown for invalid fields, API called with correct data on valid submit

- [x] **Test Scenario**: Error handling
  - Mock API responses: 400 (validation), 403 (permission), 409 (concurrent)
  - User interactions: Submit invalid form, trigger errors
  - Assertions: Appropriate error messages shown, user can retry

- [x] **Test Scenario**: Receipt operations
  - Mock API responses: Receipt HTML, void success
  - User interactions: View receipt, void receipt
  - Assertions: Receipt displays, voiding works with proper validation

#### Unit Tests
- [x] **Component**: `CheckoutModal`
  - Test cases: Renders correctly, handles field dependencies, validates form, handles API errors, manages complex state
- [x] **Component**: `ReceiptViewModal`
  - Test cases: Renders receipt HTML, handles download, shows void status
- [x] **Hook**: Checkout field dependency logic
  - Test cases: Service change updates practitioners, practitioner change loads scenarios, scenario selection sets amounts
- [x] **Utility**: Billing scenario normalization
  - Test cases: Handles string/number types, NaN values, null/undefined

### Performance Considerations

- [x] **Data Loading**:
  - Billing scenarios cached per practitioner-service combination (avoid redundant API calls)
  - Practitioners cached per service item (avoid redundant API calls)
  - Receipt HTML cached briefly (receipts don't change frequently)

- [x] **Caching**:
  - Current: Custom cache with clinic ID injection, TTL-based invalidation
  - Future: React Query will provide better caching with automatic invalidation

- [x] **Optimistic Updates**:
  - Not currently used (checkout requires server validation)
  - Receipt voiding could use optimistic updates (revert on failure)

- [x] **Lazy Loading**:
  - Receipt view modal loaded on demand
  - Service item selection modal loaded on demand
  - Receipt list loaded when needed

- [x] **Memoization**:
  - Checkout item rows memoized to prevent unnecessary re-renders
  - Field dependency calculations cached

---

## Integration Points

### Backend Integration
- [x] **Dependencies on other services**:
  - `ReceiptService` depends on `AppointmentService` (status validation)
  - Receipt generation uses `AppointmentService` for data snapshot
  - Billing scenarios managed by `BillingScenarioService`

- [x] **Database relationships**:
  - Receipts linked to appointments, clinics
  - Billing scenarios linked to practitioner-appointment type combinations
  - Foreign key constraints prevent orphaned records

- [x] **API contracts**:
  - RESTful API with consistent request/response models
  - Validation errors follow standard format

### Frontend Integration
- [x] **Shared components used**:
  - `BaseModal`, `NumberInput`, `LoadingSpinner`, `ErrorMessage`
  - Form components and utilities

- [x] **Shared hooks used**:
  - `useApiData` (data fetching)
  - `useModal` (modal management)

- [x] **Shared stores used**:
  - None (complex local state management)

- [x] **Navigation/routing changes**:
  - Calendar page integration: Checkout modal opens from event modal
  - Receipt viewing: Integrated into event modal

---

## Security Considerations

- [x] **Authentication requirements**:
  - Checkout and receipt operations require authenticated clinic user
  - Voiding requires admin role

- [x] **Authorization checks**:
  - Checkout: All clinic users can create receipts
  - Receipt viewing: All clinic users can view receipts
  - Receipt voiding: Admin-only
  - Receipt downloading: All clinic users
  - Billing scenarios viewing: All clinic users can view billing scenarios during checkout
  - Billing scenarios management (create/update/delete): Admin-only

- [x] **Input validation**:
  - All checkout data validated on frontend and backend
  - Amount and revenue share validated as positive numbers
  - Payment method validated against allowed values

- [x] **XSS prevention**:
  - User input sanitized before display
  - Receipt HTML generated server-side with proper escaping

- [x] **CSRF protection**:
  - API uses JWT authentication tokens
  - Tokens validated on every request

- [x] **Data isolation**:
  - Clinic isolation enforced via `ensure_clinic_access()` dependency
  - Users can only access receipts and checkout for their clinic's appointments

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
- Backend technical design (API endpoints, database schema, business logic)
- Frontend technical design (state management, components, user flows, testing requirements)

All business rules are enforced at both frontend (UX) and backend (source of truth) levels.

**Migration Status**: This document has been migrated to the new template format. Frontend sections reflect current implementation using `useApiData`. React Query migration is planned for Phase 2 (Weeks 3-5) per `ai_frontend_dev.md`.
