# Checkout Modal Business Logic Design Document

## Overview

This document describes the business logic for the checkout modal in the clinic admin platform. The checkout modal allows clinic administrators to process payments for appointments by creating checkout items with service selections, practitioner assignments, billing scenarios, and custom pricing.

## Rationale and Key Logic

### Core Principle: Conditional Field Dependencies

The checkout modal implements a cascading dependency system where:
1. **Earlier field selections determine what options are available in later fields**
2. **Changing earlier fields can automatically clear or reset dependent fields**
3. **Field visibility and editability are determined by the current selection state**

This design ensures data consistency and prevents invalid combinations (e.g., selecting a billing scenario for a practitioner who doesn't offer that service).

### Key Design Decisions

1. **Unified Item Structure**: All checkout items use the same field structure, regardless of whether they represent standard services or custom items. The distinction is made through field values, not different UI structures.

2. **Appointment Context Auto-Population**: New items (including the first item) are automatically populated from the appointment context (`appointment_type_id` and `practitioner_id`), providing a quick starting point that can be modified as needed.

3. **Flexible Pricing**: The system supports both predefined billing scenarios (read-only pricing) and custom pricing (editable fields), allowing clinics to handle standard cases efficiently while maintaining flexibility for special circumstances.

4. **Progressive Disclosure**: Fields are shown or hidden based on selections, reducing UI clutter and guiding users through valid workflows.

## Field Structure

Each checkout item contains the following fields:

- **服務項目** (Service Item): Dropdown with all service options + "其他" (Other)
- **Practitioner**: Dropdown with filtered practitioners + "無" (None)
- **Billing Scenario**: Dropdown with scenarios based on service+practitioner + "其他" (Other)
- **金額** (Amount): Price charged to patient
- **抽成** (Revenue Share): Clinic's revenue share
- **自訂項目名稱** (Custom Item Name): Text field (only shown when service item is "其他")
- **Quantity**: Number of items (default: 1)

## Detailed Field Behavior

### 1. 服務項目 (Service Item)

**Options**:
- All service items from `appointmentTypes` prop
- "其他" (Other) option

**Behavior**:
- When a regular service item is selected:
  - `service_item_id` is set to the selected ID
  - Practitioner dropdown becomes available (filtered by service)
  - Billing scenario dropdown may become available (if practitioner selected)
  - Custom item name field is hidden

- When "其他" is selected:
  - `service_item_id` is set to `undefined` (represents "other" type)
  - Practitioner dropdown shows all practitioners (not filtered)
  - Billing scenario dropdown is hidden (not applicable for custom items)
  - Custom item name field is shown and required
  - Amount and revenue share become editable (default to 0 if previously read-only)

**State Changes**:
- When service item changes from regular to regular:
  - If current practitioner doesn't offer the new service → set practitioner to "無" (null)
  - If current practitioner offers the new service → keep practitioner
  - Clear billing scenario (will be re-selected when practitioner is confirmed)
  - Reset amount and revenue share to 0
  - After loading billing scenarios:
    - If scenarios exist: Auto-select default scenario and set amount/revenue_share from scenario
    - If no scenarios exist: Keep amount and revenue_share at 0 (fields become editable)

- When service item changes to/from "其他":
  - Clear practitioner selection (set to null)
  - Clear billing scenario (set to null)
  - Clear amount and revenue share (set to 0)

### 2. Practitioner

**Options**:
- When service item is regular: Practitioners who offer that service (from `practitionersByServiceItem[service_item_id]`) + "無" (None)
- When service item is "其他": All practitioners (from `practitioners` prop) + "無" (None)

**Behavior**:
- When a practitioner is selected:
  - `practitioner_id` is set to the selected ID
  - If service item is regular: Load billing scenarios for the service+practitioner combination
  - Auto-select default billing scenario (if scenarios exist and no scenario is currently selected)
  - If default scenario exists: Set amount and revenue share from scenario (read-only)
  - If no scenarios exist: Show amount and revenue share as editable (default to 0)

- When "無" (None) is selected:
  - `practitioner_id` is set to `null`
  - Billing scenario dropdown is hidden
  - Amount and revenue share become editable (default to 0 if previously read-only)

**State Changes**:
- When practitioner changes:
  - Clear current billing scenario selection
  - Reset amount and revenue share to 0
  - Load billing scenarios for new practitioner (if service item is regular)
  - After loading billing scenarios:
    - If scenarios exist: Auto-select default scenario and set amount/revenue_share from scenario
    - If no scenarios exist: Keep amount and revenue_share at 0 (fields become editable)

### 3. Billing Scenario

**Options**:
- Only shown when: Service item is regular AND practitioner is selected (not "無")
- Options: All billing scenarios for the service+practitioner combination + "其他" (Other)

**Behavior**:
- When a billing scenario is selected:
  - `billing_scenario_id` is set to the scenario ID
  - Amount and revenue share are set from scenario values (read-only)
  - Fields display as read-only (grayed out, non-editable)

- When "其他" (Other) is selected:
  - `billing_scenario_id` is set to `null`
  - Amount and revenue share become editable
  - If fields were previously read-only, reset to 0

**State Changes**:
- When billing scenario changes to a specific scenario:
  - Update amount and revenue share from scenario data
  - Make fields read-only

- When billing scenario changes to "其他":
  - Keep current amount and revenue share if they were already editable
  - Reset to 0 if they were previously read-only

### 4. 金額 (Amount) and 抽成 (Revenue Share)

**Editability Rules**:
- **Editable** when:
  - Service item is "其他"
  - Practitioner is "無" (None)
  - Billing scenario is "其他" (null)
  - No billing scenarios exist for the service+practitioner combination

- **Read-only** when:
  - A billing scenario is selected (values come from scenario)

**Default Values**:
- When fields become editable from read-only state: Default to 0
- When fields remain editable: Keep current values

**Validation**:
- Amount: Must be >= 0 (allows free services)
- Revenue share: Must be >= 0 and <= amount
- Both can be 0 (clinic can give free items)

### 5. 自訂項目名稱 (Custom Item Name)

**Visibility**:
- Only shown when service item is "其他"

**Behavior**:
- Required field (must be filled before checkout)
- Free text input
- Stored in `custom_name` field of CheckoutItem

### 6. Quantity

**Behavior**:
- Default: 1
- Minimum: 1
- Must be an integer
- Affects total calculations (amount * quantity, revenue_share * quantity)

## State Management

### Initialization

**First Item (Modal Opens)**:
1. Check if appointment has `appointment_type_id` and `practitioner_id`
2. If both exist:
   - Set `service_item_id` to appointment's `appointment_type_id`
   - Set `practitioner_id` to appointment's `practitioner_id`
   - Load practitioners for the service item
   - Load billing scenarios for service+practitioner
   - Auto-select default billing scenario (or first scenario, or null if none)
   - Update amount and revenue share based on selected scenario
3. If only `appointment_type_id` exists:
   - Set `service_item_id` to appointment's `appointment_type_id`
   - Set `practitioner_id` to null
   - Load practitioners for the service item
   - Set amount and revenue share to 0 (editable)
4. If neither exists:
   - Start with empty item (no service item selected)
   - Set amount and revenue share to 0

**New Items (Add Item Button)**:
- Always initialize from appointment context (same logic as first item)
- Do NOT copy from first item's current selection
- Use `event.resource.appointment_type_id` and `event.resource.practitioner_id`

### Field Change Handlers

**Service Item Change**:
1. Update `service_item_id`
2. If service item is regular:
   - Load practitioners for the service item
   - Check if current practitioner offers the new service
   - If not, set practitioner to null ("無")
   - Clear billing scenario
   - Clear amount and revenue share (set to 0)
3. If service item is "其他":
   - Set practitioner to null
   - Clear billing scenario
   - Clear amount and revenue share (set to 0)
   - Show custom item name field

**Practitioner Change**:
1. Update `practitioner_id`
2. If practitioner is selected and service item is regular:
   - Load billing scenarios for service+practitioner
   - Auto-select default scenario (or first, or null)
   - Update amount and revenue share based on selected scenario
3. If practitioner is "無":
   - Clear billing scenario
   - Show amount and revenue share as editable (set to 0 if previously read-only)

**Billing Scenario Change**:
1. Update `billing_scenario_id`
2. If scenario is selected:
   - Update amount and revenue share from scenario values
   - Make fields read-only
3. If scenario is "其他" (null):
   - Make amount and revenue share editable
   - Reset to 0 if they were previously read-only

## Validation Rules

### Item-Level Validation

1. **Service Item or Custom Name Required**:
   - If `service_item_id` is undefined/null, `custom_name` must be provided
   - If `service_item_id` is set, `custom_name` is not required

2. **Amount Validation**:
   - Must be >= 0 (allows free services)
   - Must be a valid number

3. **Revenue Share Validation**:
   - Must be >= 0
   - Must be <= amount
   - Must be a valid number

4. **Quantity Validation**:
   - Must be >= 1
   - Must be an integer

5. **Custom Item Name Validation**:
   - Required when `service_item_id` is undefined/null
   - Must be non-empty string

### Checkout Validation

- At least one item must exist
- All items must pass item-level validation
- Total amount can be 0 (allows free checkouts)

## API Integration

### CheckoutItem Interface

```typescript
interface CheckoutItem {
  service_item_id?: number | undefined;  // undefined = "其他"
  practitioner_id?: number | null | undefined;
  billing_scenario_id?: number | null | undefined;  // null = "其他"
  custom_name?: string | undefined;  // Required when service_item_id is undefined
  amount: number;
  revenue_share: number;
  quantity?: number;  // Default: 1
}
```

### API Request Transformation

**For Regular Service Items** (`service_item_id` is defined):
```typescript
{
  item_type: "service_item",
  service_item_id: item.service_item_id,
  practitioner_id: item.practitioner_id,  // Only included if not null/undefined
  billing_scenario_id: item.billing_scenario_id,  // Only included if not null/undefined (can be "其他")
  amount: item.amount,
  revenue_share: item.revenue_share,
  quantity: item.quantity || 1,
  display_order: index
}
```

**For Custom Items** (`service_item_id` is undefined):
```typescript
{
  item_type: "other",
  item_name: item.custom_name,  // Required
  practitioner_id: item.practitioner_id,  // Only included if not null/undefined
  amount: item.amount,
  revenue_share: item.revenue_share,
  quantity: item.quantity || 1,
  display_order: index
}
```

**Note**: 
- `amount` and `revenue_share` are **always required** and included in all API requests (backend requires these fields)
- `billing_scenario_id` is never sent for "other" type items (handled by backend)
- `practitioner_id` is only included in the request if it's not `null` or `undefined` (backend only includes if not None)
- `billing_scenario_id` is only included if it's not `null` or `undefined` (backend only includes if not None)

## UI/UX Considerations

### Field Visibility Matrix

| Service Item | Practitioner | Billing Scenarios Available | UI State |
|--------------|--------------|----------------------------|----------|
| Regular | Selected | Yes | Show billing scenario dropdown, amount/revenue_share read-only if scenario selected |
| Regular | Selected | No | Hide billing scenario dropdown, amount/revenue_share editable |
| Regular | "無" | N/A | Hide billing scenario dropdown, amount/revenue_share editable |
| "其他" | Any | N/A | Hide billing scenario dropdown, show custom name, amount/revenue_share editable |

### User Flow Examples

**Example 1: Standard Service with Billing Scenario**
1. Service item selected → Practitioner dropdown appears
2. Practitioner selected → Billing scenarios load, default selected
3. Amount and revenue share auto-filled (read-only)
4. User can change to "其他" scenario to customize pricing

**Example 2: Custom Item**
1. Service item "其他" selected → Custom name field appears
2. Practitioner can be selected (optional, shows all practitioners)
3. Amount and revenue share are editable
4. No billing scenario dropdown

**Example 3: Service with No Practitioner**
1. Service item selected → Practitioner dropdown appears
2. Practitioner "無" selected → No billing scenarios, amount/revenue_share editable
3. User enters custom pricing

## Error Handling

### Loading Errors
- If practitioner loading fails: Show error, allow user to continue (practitioner may be optional)
- If billing scenario loading fails: Show error, allow user to enter custom pricing

### Validation Errors
- Display inline error messages for each invalid field
- Prevent checkout until all errors are resolved
- Show summary of all validation errors at top of modal

### API Errors
- Display error message from API response
- Allow user to retry after fixing issues
- Preserve form state on error (don't clear user input)

## Edge Cases

1. **Appointment with no service type**: Start with empty item, user must select service or "其他"
2. **Appointment with service but no practitioner**: Auto-select service, practitioner defaults to "無"
3. **Service with no practitioners**: Practitioner dropdown shows only "無"
4. **Practitioner with no billing scenarios**: Show amount/revenue_share as editable
5. **Multiple items with same service**: Each item maintains independent state
6. **Changing service after practitioner selected**: Validate practitioner compatibility, clear if invalid

