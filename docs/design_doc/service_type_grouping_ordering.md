# Service Type Grouping & Ordering - Design

## Overview

Add grouping and ordering capabilities to appointment types for:
- Internal tracking and organization (e.g., "徒手治療" group with variations)
- Display ordering across the application
- Dashboard filtering and breakdown by groups
- **Note**: Groups are internal-only; patients don't see groups

## Database Design

### Structure

**Schema:**
```sql
service_type_groups:
  - id
  - clinic_id
  - name (unique per clinic)
  - display_order
  - created_at, updated_at

appointment_types:
  - ...existing fields...
  - service_type_group_id (FK, nullable, default NULL)
  - display_order (integer, default 0)
```

**Rationale:**
- Parent-child relationship for performance (single FK, no joins needed)
- Nullable FK allows services without groups
- Matches existing resource pattern in codebase
- Can migrate to many-to-many later if needed

### Migration Strategy

- All existing services have `service_type_group_id = NULL`
- All existing services have `display_order` set based on current `id`
- Zero breaking changes - existing clinics continue working as-is

## User Experience Design

### Single Editing Session

**Key Principle**: The entire service items settings page (`/admin/clinic/settings/service-items`) is a **single editing session**. All changes across all views are staged locally and only saved when the user clicks "儲存變更".

**Editing Scope:**
- **Service Items Tab**: Table view showing all service items
- **Group Management Tab**: Table view for managing groups
- **Service Item Edit Modal**: Full-page modal for editing individual service items

**User Flow:**
1. User can switch freely between tabs and open/edit service items
2. All changes are staged in local state (no database writes)
3. Changes reflect immediately in the UI (reactive dependencies)
4. User clicks "儲存變更" → all changes saved atomically
5. Navigation warning only appears when leaving the page (not when switching tabs/modals)

### Reactive Dependencies

**Cross-View Reactivity:**
- **New groups** created in Group Management tab → immediately available in Service Item modal's group dropdown
- **New service items** → immediately counted in group's service item count (before save)
- **Group deletion** → automatically unassigns service items (sets `service_type_group_id` to `null`)
- **Service item deletion** → automatically removes associations (practitioner assignments, billing scenarios, resource requirements)

**Implementation:**
- Shared staging state (Zustand store or React Context)
- Computed values (group counts) update reactively
- All views read from same staging state

### UI Structure

#### Service Items Tab (Default)

**Table View:**
- Columns: Name, Group, Duration, Price, Actions
- Mobile: Card list layout
- Actions: Edit, Delete
- "新增服務項目" button

**Group Badge:**
- Shows group name next to service name
- "未分類" for ungrouped items
- Updates immediately when group changes (before save)

#### Group Management Tab

**Table View:**
- Columns: Group Name, Service Item Count, Actions
- Service count updates reactively (includes new items before save)
- Drag-and-drop for reordering
- Inline editing for group names
- "新增群組" button

#### Service Item Edit Modal

**Full-Page Modal:**
- Opens from table row click
- Contains all service item fields
- Group dropdown includes temporary groups (created in same session)
- No save button in modal (only "取消" to close)
- Changes staged until page-level "儲存變更" is clicked

### Save Behavior

**Single "儲存變更" Button:**
- Location: Top-right (desktop), sticky bottom (mobile)
- Appears when there are unsaved changes
- Saves all changes atomically:
  1. Save groups first → get real IDs
  2. Map temporary group IDs → real IDs in service items
  3. Save service items → get real IDs
  4. Map temporary service item IDs → real IDs in associations
  5. Save associations (practitioner assignments, billing scenarios, resource requirements)

**Error Handling:**
- Save what succeeded, show errors for failures
- Error summary shows which items/groups failed
- Clickable errors → opens relevant modal/tab and scrolls to field

### Validation

**Hybrid Approach:**
- **Basic validation**: Inline (required fields, format) - immediate feedback
- **Complex validation**: On save (business rules, dependencies)
- **Deeply nested errors**: Validation summary modal

**Validation Summary Modal:**
- Appears if errors exist in closed modals
- Lists all errors grouped by type (Service Items, Groups, Associations)
- Each error is clickable:
  - Opens relevant modal/tab
  - Scrolls to and focuses the field
  - Highlights the error
- Prevents save until all errors are fixed

### Discard Changes

**"取消變更" Button:**
- Appears next to "儲存變更" when there are unsaved changes
- Confirms before discarding
- Resets all staging state to original values

### Deletion Behavior

**Group Deletion:**
- Auto-unassigns service items (sets `service_type_group_id` to `null`)
- Shows toast: "已移除群組，相關服務項目已設為未分類"
- Updates counts reactively

**Service Item Deletion:**
- Deletes associations silently (practitioner assignments, billing scenarios, resource requirements)
- Shows toast: "已刪除服務項目及其相關設定"
- Updates counts reactively

## Technical Implementation

### State Management

**Staging Store Structure:**
```typescript
interface StagingState {
  // Service items (existing + new with temporary IDs)
  serviceItems: AppointmentType[];
  originalServiceItems: AppointmentType[];
  
  // Groups (existing + new with temporary IDs)
  groups: ServiceTypeGroup[];
  originalGroups: ServiceTypeGroup[];
  
  // Associations (keyed by service item ID, including temporary IDs)
  practitionerAssignments: Record<number, number[]>;
  billingScenarios: Record<string, BillingScenario[]>;
  resourceRequirements: Record<number, ResourceRequirement[]>;
  
  // Original associations for change detection
  originalPractitionerAssignments: Record<number, number[]>;
  originalBillingScenarios: Record<string, BillingScenario[]>;
  originalResourceRequirements: Record<number, ResourceRequirement[]>;
}
```

**Temporary ID Strategy:**
- Groups: Negative IDs (e.g., `-Date.now()`)
- Service Items: Positive timestamps (e.g., `Date.now()`)
- Threshold: `1000000000000` to distinguish temporary from real IDs

### Reactive Computations

**Group Counts:**
```typescript
const getGroupCount = (groupId: number | null) => {
  return stagingState.serviceItems.filter(
    item => item.service_type_group_id === groupId
  ).length;
};
```

**Available Groups:**
```typescript
const availableGroups = [
  ...stagingState.groups, // Includes temporary groups
  ...originalGroups.filter(g => !stagingState.groups.find(sg => sg.id === g.id))
];
```

### Save Orchestration

**Save Flow:**
1. **Validate all changes** → show summary modal if errors
2. **Save groups** (create/update/delete) → get real IDs
3. **Map temporary group IDs** → update service items
4. **Save service items** (create/update/delete) → get real IDs
5. **Map temporary service item IDs** → update associations
6. **Save associations** → with mapped real IDs
7. **Reload data** → refresh UI with real IDs
8. **Show success/error summary**

**ID Mapping:**
```typescript
const mapTemporaryIds = (
  temporaryItems: Item[],
  savedItems: Item[]
): Record<number, number> => {
  // Match by name + duration for service items
  // Match by name for groups
  // Return mapping: tempId -> realId
};
```

### Change Detection

**Unsaved Changes:**
```typescript
const hasUnsavedChanges = () => {
  return (
    serviceItemsChanged() ||
    groupsChanged() ||
    associationsChanged() ||
    hasTemporaryIds()
  );
};
```

**Navigation Warning:**
- Only triggers when leaving the page (not when switching tabs/modals)
- Uses `useUnsavedChangesDetection` hook
- Shows browser confirmation dialog

## Dashboard Integration

### Filter Bar

**Default Filters:**
- Date range
- Practitioner
- Group (primary filter dimension)

**Conditional Filter:**
- Service Type - only appears when a group is selected
- Shows only services within selected group

### Context-Aware Breakdown

**No Group Selected (Default):**
- Chart: Breakdown by groups
- Chart View Selector: "依群組" | "依治療師"
- Breakdown Tables: "依群組" table shows all groups

**Group Selected:**
- Chart: Breakdown by service types (within group)
- Chart View Selector: "依服務項目" | "依治療師"
- Breakdown Tables: "依服務項目" table shows services in group

## Edge Cases

### 1. Empty Groups
- Hide from filter dropdown
- Show in settings with count "(0)"
- Can be deleted without confirmation

### 2. Group Deleted While Filtered
- Filter resets to "全部" on next refresh
- Show notification about group deletion
- Historical data shows as "未分類"

### 3. Concurrent Modifications
- Last write wins (standard database behavior)
- Staging state prevents conflicts within same session

### 4. Validation Errors in Closed Modals
- Validation summary modal lists all errors
- Clickable errors open relevant modal/tab
- Prevents save until all fixed

## API Endpoints

**Group Management:**
- `GET /api/clinic/service-type-groups` - List all groups
- `POST /api/clinic/service-type-groups` - Create group
- `PUT /api/clinic/service-type-groups/{id}` - Update group
- `PUT /api/clinic/service-type-groups/bulk-order` - Reorder groups
- `DELETE /api/clinic/service-type-groups/{id}` - Delete group

**Service Items:**
- `GET /api/clinic/settings` - Includes appointment types with groups
- `PUT /api/clinic/settings` - Saves appointment types with group assignments

**Bulk Operations:**
- All changes saved in single `PUT /api/clinic/settings` request
- Backend handles group creation, service item creation, and associations atomically

## Summary

**Design Principles:**
1. **Single editing session** - All changes staged until "儲存變更"
2. **Reactive dependencies** - Changes reflect immediately across views
3. **No navigation warnings** - Free switching between tabs/modals
4. **Atomic save** - All changes saved together
5. **Validation summary** - Handles deeply nested errors
6. **Consistent with platform** - Matches other settings pages

**Key Benefits:**
- Eliminates timing issues with temporary IDs
- Prevents false "unsaved changes" warnings
- Allows flexible editing workflows
- Clear user mental model
- Simpler implementation
