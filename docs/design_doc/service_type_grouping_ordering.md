# Service Type Grouping & Ordering - Design

## Overview

Add grouping and ordering capabilities to appointment types for:
- Internal tracking and organization (e.g., "徒手治療" group with variations)
- Display ordering across the application
- Dashboard filtering and breakdown by groups
- **Note**: Groups are internal-only; patients don't see groups

## Current State

- Appointment types (`appointment_types`) are flat with no grouping
- No explicit ordering field; currently ordered by database insertion order
- Similar pattern exists: Resources → ResourceType (parent-child relationship)

## Chosen Design: Parent-Child with Tag-Like UX

### Internal Implementation (Database)

**Structure:**
- Create `service_type_groups` table (similar to `resource_types`)
- Add `service_type_group_id` FK to `appointment_types` (nullable)
- Add `display_order` integer field to `appointment_types`
- Groups have `display_order` for ordering groups themselves

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

**Rationale for Parent-Child:**
- Better query performance (single FK, no joins needed for simple queries)
- Simpler database structure
- Matches existing resource pattern in codebase
- Can migrate to many-to-many later if needed (add junction table)

### User Experience (UI/UX)

**Tag-Like Experience:**
- **No forced grouping**: Clinics can create appointment types without creating groups first
- **Dropdown selection**: Each appointment type has a dropdown to select/change its group
- **Null default**: New services default to no group (null)
- **Easy reassignment**: Simple dropdown change to move service between groups
- **Validation**: Enforce single group per service (UI validation, not DB constraint)

**Rationale for Tag-Like UX:**
- Simpler onboarding: new clinics don't need to create groups first
- More intuitive: feels like tagging rather than hierarchical management
- Easier to move services between groups
- Future-proof: if many-to-many needed later, UI can stay the same (just allow multiple selections)

### Ordering Strategy

**Global Ordering (Not Per-Group):**
- Single `display_order` field on `appointment_types` for global ordering
- Drag-and-drop in a **single global list** of all service types
- Order by: `display_order ASC, id ASC` (id as tiebreaker)
- Groups also have `display_order` for ordering groups in filters/dashboards

**Rationale:**
- More intuitive: users see all services in one list and order them globally
- Avoids confusion: "What if service 1 and 3 are in Group A, but service 2 is in Group B?"
- Simpler UI: one drag-and-drop list instead of per-group lists
- Groups are for filtering/organization, not ordering

**Display Logic:**
- **Patient-facing (LIFF)**: Show services ordered by global `display_order`, ignore groups
- **Admin UI**: 
  - Settings page: Single global list with drag-and-drop, group shown as badge/dropdown
  - Can filter by group, but ordering remains global
- **Dashboard**: Support filtering/grouping by group, but services within groups ordered by global `display_order`

## Migration Strategy

### For Existing Clinics

**Approach: Null Groups (No Forced Grouping)**
- All existing services have `service_type_group_id = NULL`
- All existing services have `display_order` set based on current `id` (preserve existing implicit order)
- Clinics can optionally create groups and assign services later
- **Zero breaking changes** - existing clinics continue working as-is

### Migration Steps

1. Create migration for new tables/columns
2. Set `display_order` for existing services based on `id` (e.g., `display_order = id`)
3. Leave `service_type_group_id` as NULL for all existing services
4. Update queries to handle NULL groups (show ungrouped services)
5. Update UI to support grouping/ordering with tag-like experience

## Additional Considerations

### Query Performance

**Indexes:**
- `(clinic_id, service_type_group_id)` - For filtering services by group
- `(clinic_id, display_order)` - For global ordering queries
- `(clinic_id, service_type_group_id, display_order)` - Composite index for filtered ordering queries (when filtering by group and ordering)

**Query Patterns:**
- Group aggregation: Use `LEFT JOIN service_type_groups` to include ungrouped services (`service_type_group_id IS NULL`)
- Dashboard breakdowns: `GROUP BY service_type_group_id` with `COALESCE(service_type_group_id, -1)` to treat NULL as "未分類"
- Filter by group: Use index on `(clinic_id, service_type_group_id)` for efficient filtering
- Count services per group: Cache group counts per clinic, refresh on group/service changes

**Caching Strategy:**
- Cache group list per clinic (invalidate on group create/update/delete)
- Cache service-to-group mapping per clinic (invalidate on service group assignment changes)
- Consider Redis cache for high-traffic clinics with many groups/services

### Soft Delete Behavior
- **Groups**: No soft delete for groups (hard delete only)
  - When group is deleted, set `service_type_group_id = NULL` (CASCADE to NULL)
  - Services become ungrouped immediately
  - Historical data: Services in deleted group show in "未分類" for all historical periods
  - **Rationale**: Prevents orphaned references, maintains data integrity
  - **Historical reports**: Show "未分類" for services that were in deleted group (uses current group assignment)

### Validation Rules
- **UI validation**: Enforce single group per service (dropdown only allows one selection)
- **DB constraint**: No unique constraint needed (nullable FK allows multiple services per group)
- **Future flexibility**: If many-to-many needed later, add junction table; UI can change to multi-select

### API Changes

**Group Management Endpoints:**
- `GET /api/clinics/{id}/service-type-groups` - List all groups for clinic
- `POST /api/clinics/{id}/service-type-groups` - Create new group
- `PUT /api/clinics/{id}/service-type-groups/{group_id}` - Update group (name, display_order)
- `DELETE /api/clinics/{id}/service-type-groups/{group_id}` - Delete group (cascades to NULL)

**Service Type Endpoints:**
- Update `GET /api/clinics/{id}/appointment-types` to include `service_type_group_id` and `service_type_group_name` (always included, no query param needed)
- Update `PUT /api/clinics/{id}/settings` to handle group assignments

**Bulk Reordering Endpoint:**
- `PATCH /api/clinics/{id}/appointment-types/reorder` (RESTful: partial update)
- Accepts: `{ "appointment_type_ids": [1, 3, 2, 4, ...] }` - full ordered list
- Behavior: All-or-nothing transaction (if any ID invalid, entire operation fails)
- Error handling: Returns 400 if IDs don't match current state or include non-existent IDs
- Updates `display_order` based on array position (0-indexed or 1-indexed, document choice)

**Dashboard Endpoints:**
- Add `service_type_group_id` to `DashboardFilters` (optional)
- Add `GroupBreakdown` type (similar to `ServiceItemBreakdown`)
- Add `GroupBreakdownCalculator` for group-level aggregations
- Dashboard endpoints return:
  - Group breakdown when no group filter (default)
  - Service breakdown when group filter applied

## High-Level User Experience Design

### 1. Settings Page - Service Items Management

**Design**: Tab/View Switcher with near full-screen views

**Structure:**
- **Default View**: "服務項目" (Service Items) tab - near full-screen
- **Secondary View**: "群組管理" (Group Management) tab - near full-screen
- **Tab Switcher**: At top of page, allows switching between views
- **Rationale**: Service items are primary (default), groups get full space for future extensibility

#### 1.1 Service Items View (Primary/Default)

**Tab**: "服務項目" (Service Items) - default active tab

**Structure**: Expandable cards for each service type (similar to `AppointmentTypeField`)

**Group Dropdown/Badge:**
- **Location**: In the collapsed view, show group as a badge/tag next to service name
- **In Expanded View**: Group selection dropdown field
  - Label: "群組" (Group)
  - Dropdown options:
    - `""` (empty) = "未分類" (Ungrouped) - default for new services
    - List of all groups (ordered by `display_order`)
    - Separator: "─────────────"
    - Option: "+ 新增群組" (Add New Group)
      - Clicking opens inline form/modal to create new group
      - Only requires name (clinic-scoped uniqueness)
      - After creation, new group appears in dropdown and is automatically selected
      - Group creation and service assignment happen in same session
      - Both changes saved together when user clicks "儲存變更"
- **Visual Indicator**: 
  - Badge style: `<span className="badge">徒手治療</span>` when grouped
  - Gray/neutral style for "未分類" (Ungrouped)
  - **Color coding**: Not in v1; reserved for future enhancement

**Drag-and-Drop Ordering:**
- **Global List**: Single drag-and-drop list of all service types
- **Visual Feedback**: 
  - Drag handle icon on left side of each card
  - Shows drop indicator while dragging
  - Order persists immediately (optimistic update) or on save
- **Ordering Logic**: 
  - Services ordered by global `display_order` (not per-group)
  - User drags services to desired position in the global list
  - Example: Service 1 (Group A), Service 2 (Ungrouped), Service 3 (Group A) can be ordered as 1, 2, 3
- **Large List Handling** (50+ services):
  - Optional group filter in settings: Filter to show only services in selected group for easier reordering
  - Filter is temporary (for reordering only), doesn't affect global order
  - Global order maintained in background regardless of filter
  - **Future enhancement**: Per-group ordering toggle for power users (out of scope for v1)

**Visual Layout Example:**
```
[Settings Page - Service Items]

[Tab Switcher]
┌─────────────────────────────────────┐
│ [服務項目] [群組管理]               │
├─────────────────────────────────────┤
│ [Service Items List - Drag to Reorder]
│ ┌─────────────────────────────────┐ │
│ │ [≡] 初診評估    [徒手治療]      │ │
│ │     時長: 60 分鐘 • 3 位治療師  │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [≡] 復健治療    [未分類]         │ │
│ │     時長: 30 分鐘 • 2 位治療師  │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [≡] 徒手治療-進階 [徒手治療]    │ │
│ │     時長: 45 分鐘 • 1 位治療師  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [+ 新增服務項目]                    │
└─────────────────────────────────────┘
```

#### 1.2 Group Management View (Secondary)

**Tab**: "群組管理" (Group Management) - switchable view

**UI Components:**
- **Group List**: Display all groups for the clinic
  - Shows group name and count of services in group
  - Groups ordered by `display_order`
  - Drag-and-drop to reorder groups (for group ordering in filters)
- **Add Group Button**: "+ 新增群組" (Add Group)
  - Creates new group inline or via form
  - Only requires name (clinic-scoped uniqueness)
  - Can add additional fields in future (extensible)
- **Edit/Delete Actions**: Per group
  - Edit: Change group name (and future fields)
  - Delete: Confirms if group has services, sets their `service_type_group_id` to NULL

**Visual Design:**
- Full-screen view allows for future expansion
- List or card layout for groups
- Shows count: "徒手治療 (5)" - 5 services in group
- Extensible: Can add fields, descriptions, colors, etc. without modal constraints
- **Future enhancements**: Color coding, descriptions, icons (out of scope for v1)

**Visual Layout Example:**
```
[Settings Page - Service Items]

[Tab Switcher]
┌─────────────────────────────────────┐
│ [服務項目] [群組管理]               │
├─────────────────────────────────────┤
│ [Group Management - Full Screen]    │
│ ┌─────────────────────────────────┐ │
│ │ [≡] 徒手治療          (5)       │ │
│ │     [編輯] [刪除]               │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [≡] 物理治療          (3)       │ │
│ │     [編輯] [刪除]               │ │
│ └─────────────────────────────────┘ │
│                                     │
│ [+ 新增群組]                        │
│                                     │
│ (Future: Can add fields, colors,    │
│  descriptions, etc. here)           │
└─────────────────────────────────────┘
```

**Service Item Expanded View (in Service Items tab):**
```
┌─────────────────────────────────────┐
│ [收起]                              │
│                                     │
│ 項目名稱: [初診評估____________]     │
│ 收據項目名稱: [初診評估________]    │
│ 群組: [徒手治療 ▼]                  │
│    └─ 未分類                        │
│    └─ 徒手治療                      │
│    └─ 物理治療                      │
│    └─ ─────────────                │
│    └─ + 新增群組                    │
│ 時長: [60] 分鐘                     │
│ ... (other fields)                  │
└─────────────────────────────────────┘
```

**Inline Group Creation:**
- Clicking "+ 新增群組" opens inline form/modal
- Form fields: Group name (required, clinic-scoped uniqueness)
- **Validation**: 
  - Name uniqueness checked on blur (immediate feedback)
  - Full validation on form submit
- **On save**: New group is created and automatically selected for the service
- **Optimistic update**: Group appears in dropdown immediately (visible in both tabs)
- **On cancel**: If group was created but form cancelled, group remains created (user can delete in group management tab)
- Both group creation and service assignment are part of same form session
- All changes (group creation + service assignment) saved together when clicking "儲存變更"

**Tab Switching Behavior:**
- Switching tabs preserves unsaved changes (warns if leaving with unsaved changes)
- Each tab maintains its own state
- "儲存變更" button saves changes from both tabs (if any changes exist)
- Can switch between tabs freely to manage both services and groups
- Groups created inline in service items view immediately appear in group management view

### 2. Dashboard Pages - Filtering & Breakdown

#### 2.1 Filter Bar Design

**Default Filters (Always Visible):**
- Date range (開始日期, 結束日期)
- Practitioner (治療師)
- Group (群組) - **Primary filter dimension**

**Conditional Filter:**
- Service Type (服務項目) - **Only appears when a group is selected**
  - When group selected: Shows only services within that group
  - When no group: Filter is hidden (not needed)

**Filter Behavior:**
- **Group filter**: Options: "全部" (All), list of groups (ordered by `display_order`), "未分類" (Ungrouped)
- **Service Type filter** (conditional):
  - Only visible when group is selected
  - Shows services within selected group
  - Options: "全部" (All services in group), individual services
  - Custom items appear when "未分類" is selected (see Edge Case #5)
  - **Large list handling**: If 10+ services, add search input in dropdown
  - **Pagination**: Not needed (dropdown scrolls, search handles large lists)

#### 2.2 Context-Aware Breakdown

**Breakdown Logic Based on Filter Context:**

**When Group Filter Applied:**
- **Chart**: Breaks down by service type (within selected group)
- **Chart View Selector**: Shows "依服務項目" | "依治療師" (removes "依群組" option)
- **Breakdown Tables**: 
  - "依服務項目" table: Shows services within selected group
  - "依治療師" table: Shows practitioners (always shown)

**When No Group Filter (Default):**
- **Chart**: Breaks down by group (all groups)
- **Chart View Selector**: Shows "依群組" | "依治療師" (removes "依服務項目" option)
- **Breakdown Tables**:
  - "依群組" table: Shows all groups with aggregated totals
    - Includes "未分類" as virtual group (aggregates all services with `service_type_group_id = NULL`)
    - Real groups aggregated by `service_type_group_id`
    - Both use same aggregation logic (sum revenue, count items, etc.)
  - "依治療師" table: Shows practitioners (always shown)
  - "依服務項目" table: **Hidden** (not shown when no group selected)

**Rationale:**
- Groups are primary use case - default view shows groups
- Service breakdown only relevant when focusing on a specific group
- Context-aware UI reduces clutter and confusion

#### 2.3 Chart View Selector Behavior

**Auto-Adaptation (Option A):**
- Selector options change based on filter context
- **No group selected**: "依群組" | "依治療師"
- **Group selected**: "依服務項目" | "依治療師"
- User can still manually select between available options
- Selector automatically updates when group filter changes
- **Visual indicator**: Show brief tooltip/help text: "檢視方式會根據群組篩選自動調整" (View mode adjusts based on group filter)
- **Preservation logic**: If "依治療師" is selected, preserve it when context changes (works in both contexts)
- If current selection not available in new context, auto-switch to first available option

**Visual Example:**
```
[No Group Selected]
Chart View: [依群組 ▼] | [依治療師]
  └─ Options: 依群組, 依治療師

[Group "徒手治療" Selected]
Chart View: [依服務項目 ▼] | [依治療師]
  └─ Options: 依服務項目, 依治療師
```

#### 2.4 Dashboard Pages Affected

**Business Insights Page:**
- Filter bar: Date, Practitioner, Group (Service Type conditional)
- Chart: Adapts breakdown based on filter context
- Breakdown tables: Group table (default) or Service table (when group selected)

**Revenue Distribution Page:**
- Filter bar: Date, Practitioner, Group (Service Type conditional)
- Table: Shows receipt items filtered by selected group/service
- Breakdown adapts based on filter context

**Other Dashboard Pages:**
- Any page with service item filtering gets group filter
- Service filter becomes conditional based on group selection

### 3. Patient-Facing (LIFF) - No Changes

**Service Selection Page:**
- Shows services in global `display_order`
- Groups are completely hidden from patients
- No visual indication of grouping
- Simple list of services as before

**Rationale**: Groups are internal organization tools; patients don't need to see them.

### 4. User Flows

#### 4.1 New Clinic Onboarding

1. Clinic creates first service type
   - No groups exist yet
   - Group dropdown shows "未分類" (Ungrouped) - selected by default
   - Service created successfully without needing to create a group first

2. Clinic optionally creates groups later
   - Can create groups at any time
   - Can assign existing services to groups via dropdown

#### 4.2 Organizing Existing Services

**Option A: Create Group First, Then Assign**
1. Clinic admin opens service item settings (default: "服務項目" tab)
2. Admin switches to "群組管理" tab
3. Admin creates a group: "徒手治療"
4. Admin switches back to "服務項目" tab
5. Admin expands a service and selects "徒手治療" from group dropdown
6. Service now shows badge "徒手治療" in collapsed view
7. Admin clicks "儲存變更" to save both group creation and service assignment

**Option B: Create Group Inline While Assigning (Same Session)**
1. Clinic admin opens service item settings (default: "服務項目" tab)
2. Admin expands a service
3. Admin clicks group dropdown and selects "+ 新增群組"
4. Admin enters group name: "徒手治療" in inline form
5. New group is created and automatically selected for the service
6. Service now shows badge "徒手治療" in collapsed view
7. Admin can continue editing other services or create more groups inline
8. Admin clicks "儲存變更" to save all changes (group creation + service assignments) together

**Additional Actions:**
- Admin can drag-and-drop services to reorder globally
- Order persists across all views (settings, dashboard, LIFF)

#### 4.3 Dashboard Filtering (Primary Use Case)

**Default View (No Group Selected):**
1. User navigates to Business Insights page
2. Filter bar shows: Date, Practitioner, Group (default: "全部")
3. User sees breakdown by groups in chart and "依群組" table
4. Chart view selector shows: "依群組" | "依治療師"

**Group-Focused View:**
1. User selects "徒手治療" from group filter
2. Service Type filter now appears in filter bar
3. Service Type filter shows only services in "徒手治療" group
4. Chart automatically switches to show breakdown by service type (within group)
5. Chart view selector updates to: "依服務項目" | "依治療師"
6. "依服務項目" breakdown table appears, showing services in selected group
7. User can optionally select specific service for further refinement

### 5. Visual Design Details

#### 5.1 Group Badges/Tags

**Style:**
- Small badge/tag component
- Color: Subtle background (e.g., `bg-blue-100 text-blue-800`)
- Size: Small, fits inline with service name
- Icon: Optional small icon (e.g., folder/tag icon)

**Placement:**
- Collapsed view: Next to service name
- Expanded view: In the group dropdown field
- Dashboard: In filter dropdown as section headers

#### 5.2 Drag-and-Drop Indicators

**Visual Feedback:**
- Drag handle: `≡` icon (hamburger menu style) on left
- While dragging: 
  - Card becomes semi-transparent
  - Drop indicator line shows where item will be placed
- After drop: Smooth animation to new position

**Accessibility:**
- Keyboard navigation support (arrow keys to reorder)
- Screen reader announcements for position changes

#### 5.3 Empty States

**No Groups:**
- Group dropdown shows only "未分類" (Ungrouped)
- Optional hint: "建立群組以更好地組織服務項目" (Create groups to better organize service items)

**No Services in Group:**
- Empty groups hidden from filter dropdown (see Edge Case #1)
- In settings, group shows count "(0)"

**Ungrouped Services:**
- Show "未分類" badge in gray/neutral color
- Appear in their own section in dashboard filters

### 6. Technical UX Considerations

#### 6.1 Performance

- **Lazy Loading**: Groups loaded with service types, not separately
- **Optimistic Updates**: Drag-and-drop updates UI immediately, syncs on save
- **Debouncing**: Group filter changes debounced for dashboard queries

#### 6.2 Data Consistency

- **Save Behavior**: 
  - Group changes saved with service type form
  - Drag-and-drop order saved separately (bulk update endpoint)
  - Both trigger "unsaved changes" warning

#### 6.3 Error Handling

- **Group Deletion**: 
  - If group has services, confirm modal dialog: "刪除此群組將使 X 個服務項目變為未分類。歷史資料仍會保留，但將顯示為未分類。確定要刪除嗎？" (Deleting this group will make X service items ungrouped. Historical data will remain but will show as ungrouped. Are you sure you want to delete?)
  - Services become ungrouped (no error)
  - Modal prevents accidental deletion

- **Group Name Conflicts**: 
  - Validation: "此群組名稱已存在" (Group name already exists)
  - Clinic-scoped uniqueness enforced
  - **Name constraints**: Max length 255 characters (matches database), no special character restrictions (allow Unicode for Chinese/Japanese)

### 7. Summary of UX Principles

1. **No Forced Grouping**: Services can exist without groups
2. **Tag-Like Selection**: Simple dropdown, not hierarchical management
3. **Global Ordering**: One list, drag-and-drop, not per-group
4. **Visual Clarity**: Badges show groups, but don't dominate UI
5. **Progressive Enhancement**: Groups are optional, enhance organization without complexity
6. **Internal Only**: Groups hidden from patients, only for clinic staff

## Future Migration Path

If we need many-to-many grouping later:
1. Create `appointment_type_groups` junction table
2. Migrate data: `INSERT INTO appointment_type_groups SELECT id, service_type_group_id FROM appointment_types WHERE service_type_group_id IS NOT NULL`
3. Remove `service_type_group_id` FK from `appointment_types`
4. Update UI: Change dropdown to multi-select (or tag selector)
5. **Key advantage**: UI can stay mostly the same - just change single-select to multi-select

## Summary

**Implementation**: Parent-child relationship (single nullable FK) for performance
**UX**: Tag-like experience (dropdown, null default, no forced grouping)
**Ordering**: Global list with drag-and-drop (not per-group)
**Dashboard**: Group-first filtering with context-aware breakdown
  - Default: Group filter, breakdown by groups
  - Group selected: Service filter appears, breakdown by services within group
  - Chart view selector adapts automatically
**Migration**: Null groups - zero breaking changes for existing clinics
**Future**: Can migrate to many-to-many if needed, UI changes minimal

## Edge Cases & Considerations

### 1. Empty Groups
**Scenario**: Group exists but has no services assigned
**Handling**: 
- **Hide empty groups from filter dropdown** (cleaner UX)
- Empty groups still visible in settings page for management
- If user somehow selects empty group (edge case), show empty state: "此群組目前沒有服務項目"
- Breakdown tables don't show empty groups

### 2. All Services Ungrouped
**Scenario**: Clinic has no groups, all services are ungrouped
**Handling**:
- Group filter shows only "未分類" option
- Default view shows "未分類" as single group in breakdown
- Service filter appears when "未分類" is selected
- Consider showing hint: "建立群組以更好地組織服務項目"

### 3. Group Deleted While Filtered
**Scenario**: User has group filter applied, then deletes that group (same or different tab/window)
**Handling**:
- On next filter apply or data refresh, group filter resets to "全部"
- Show notification: "已選取的群組已刪除，已切換為全部群組。歷史資料仍會保留，但將顯示為未分類" (Selected group deleted, switched to all groups. Historical data will remain but will show as ungrouped)
- Services in deleted group become ungrouped (`service_type_group_id = NULL`)
- Historical data still accessible (services still exist, just ungrouped)
- **Historical reports**: All data for services in deleted group shows under "未分類" (uses current group assignment)

### 4. Service Moved Between Groups
**Scenario**: Service is moved from Group A to Group B while user has Group A filter applied
**Handling**:
- Service disappears from current view (no longer in Group A)
- **If service filter was set to that service: Reset service filter to "全部"**
- Show notification: "已選取的服務項目已變更群組"
- Do NOT auto-switch group filter (safer, more predictable)

### 5. Custom Items (Receipt Items with Custom Names)
**Scenario**: Receipt items with `item_type == 'other'` (custom names not in appointment_types)
**Handling**:
- Custom items cannot belong to groups (no appointment_type_id)
- Custom items always appear in "未分類" group
- When "未分類" group is selected, custom items appear in service filter
- In breakdown tables, custom items shown under "未分類" group

### 6. Historical Data & Group Changes
**Scenario**: Receipt items reference services that changed groups or were in deleted groups
**Handling**:
- **Use current group assignment** (not historical group at time of receipt)
- Historical data uses `service_item_id`, not `group_id`
- When calculating breakdowns, look up current group of service
- If service moved between groups mid-period, all data shows in current group
- If service is now ungrouped, show in "未分類"
- **UI Note**: Add help text in dashboard: "分組依據目前設定" (Grouping based on current settings)
- Simpler implementation; reflects current organization structure

### 7. Multiple Groups with Same Service Name
**Scenario**: Two groups have services with same name (different appointment_type_id)
**Handling**:
- Service filter shows: "服務名稱 [群組名稱]" for disambiguation
- Or show service ID in tooltip/context
- Backend uses service_item_id, not name, so no conflict

### 8. Performance with Many Groups/Services
**Scenario**: Clinic has 20+ groups, 100+ services
**Handling**:
- Group filter dropdown: Limit to ~10-15 visible, add search if needed
- Service filter: Only shows services in selected group (already limited)
- Breakdown tables: Pagination if needed (currently shows all)
- Consider virtual scrolling for large lists

### 9. Chart View Selector State Persistence
**Scenario**: User selects "依治療師", then changes group filter
**Handling**:
- If new context doesn't support current selection, auto-switch to first available option
- Example: User on "依服務項目", removes group filter → auto-switch to "依群組"
- Preserve selection when possible (e.g., "依治療師" works in both contexts)

### 10. Soft-Deleted Services in Groups
**Scenario**: Service is soft-deleted but still has historical receipt data
**Handling**:
- Soft-deleted services don't appear in filter dropdowns
- Groups with only soft-deleted services are hidden from filter (empty group rule)
- Historical data for soft-deleted services still appears in breakdowns
- When calculating group breakdowns, include soft-deleted services' historical data in their current group
- Apply fade-out logic: Groups with only soft-deleted services don't appear unless they have data in date range

### 11. Group Ordering in Filter Dropdown
**Scenario**: Multiple groups need to be ordered in filter dropdown
**Handling**:
- Order groups by `display_order` ASC, then by name ASC
- "未分類" (Ungrouped) appears at end (after all groups)
- "全部" (All) appears at top
- Order: "全部" → Groups (by display_order) → "未分類"

### 12. Group Name Changes
**Scenario**: User changes group name while dashboard has that group filtered
**Handling**:
- Group filter automatically updates to show new name (filter uses group ID, not name)
- No need to reset filter or refresh
- Breakdown tables update to show new group name
- Filter uses `group_id` internally; name is just display

### 13. Bulk Service Operations
**Scenario**: User wants to move multiple services to a group at once
**Handling**:
- **Out of scope for v1** - handle one service at a time
- **Future enhancement** (post-v1): Add bulk selection in settings page
- Bulk operations: Select multiple services, choose group from dropdown, apply to all
- **Priority**: Monitor user feedback; prioritize if high demand

### 14. Permissions for Group Management
**Scenario**: Who can create/edit/delete groups?
**Handling**:
- **Only clinic admins** can manage groups (create, edit, delete)
- Practitioners can view groups and assign services to groups (if they have permission to edit services)
- Groups are organizational structure, similar to appointment type management

### 15. "未分類" as Filter State vs Real Group
**Scenario**: Is "未分類" a real group or just a filter state?
**Handling**:
- **"未分類" is a filter state, not a real group**
- No `service_type_groups` record for "未分類"
- Represents services with `service_type_group_id = NULL`
- Appears in filter dropdown and breakdown tables as a virtual group
- **Aggregation**: Uses same aggregation logic as real groups
  - Query: `WHERE service_type_group_id IS NULL` or `COALESCE(service_type_group_id, -1)`
  - Treated as single virtual group in breakdowns
  - Same calculation: sum revenue, count items, etc.
- Custom items (receipt items with `item_type == 'other'`) also appear under "未分類"

### 16. API Backward Compatibility
**Scenario**: Existing API endpoints return appointment types, now need to include group info
**Handling**:
- Add `service_type_group_id` and `service_type_group_name` to `AppointmentTypeResponse` (optional fields)
- Existing clients ignore new fields if not present
- Dashboard endpoints return group breakdown when appropriate
- All new fields are optional/additive (no breaking changes)

### 17. Export/Reporting with Groups
**Scenario**: User exports dashboard data or generates reports
**Handling**:
- Include group information in exports
- Group breakdown included in exported data
- CSV/Excel exports show group column
- **Scheduled reports**: Include group breakdowns in email summaries
- **Future enhancement**: Option to export by group or by service

### 18. Concurrent Group Modifications
**Scenario**: Multiple admins modify groups simultaneously
**Handling**:
- Last write wins (standard database behavior)
- Group name changes and service assignments: Last update wins
- **Future enhancement**: Add optimistic locking if conflicts become common

