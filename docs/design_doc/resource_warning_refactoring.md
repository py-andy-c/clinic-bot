# Resource Warning System Refactoring Plan

## Overview

This document outlines the refactoring of the resource warning system to replace the current resource type level warnings with two more specific and actionable warning types.

## Current Problems

### 1. Resource Type Level Warning Issues
The current `ResourceConflictDetail` structure is not user-friendly:
```typescript
ResourceConflictDetail: {
  resource_type_id: number;
  resource_type_name: string;
  required_quantity: number;
  total_resources: number;
  allocated_count: number;
}
```

**Problems:**
- Shows aggregate information that doesn't help users take action
- Users don't care about `total_resources` or `allocated_count` 
- Doesn't differentiate between "not enough selected" vs "selected resources conflict"
- Confusing messaging like "資源不足：治療室（需要：2，總數：3，已用：2）"

### 2. Mixed Logic
Current system mixes two independent concerns:
- Quantity sufficiency (did user select enough?)
- Resource availability (are selected resources conflicting?)

## Proposed Solution

Replace with two independent, actionable warning types:

### 1. Selection Quantity Warning
**Logic**: `selected_count < required_quantity`
**Focus**: User's selection vs. appointment requirements
**Message**: "您只選了 1 個治療室，但需要 2 個"
**Action**: User needs to select more resources

### 2. Resource Conflict Warning  
**Logic**: Selected resource has time overlap with other appointments
**Focus**: Specific resource availability conflicts
**Message**: "治療室A 已被其他預約使用 (14:00-15:00)"
**Action**: User can choose different resource or override

## Implementation Plan

### Phase 1: Remove Resource Type Level Warnings

#### Frontend Removals
1. **ConflictDisplay.tsx**:
   - Remove `resource` case in `getWarningText()` function (lines 50-59)
   - Remove resource conflict handling logic

2. **ResourceSelection.tsx**:
   - Remove "資源不足" badge (lines 735-738)
   - Remove "數量不足" badge (lines 740-744)
   - Remove resource type level conflict detection logic

3. **Type Definitions**:
   - Remove `ResourceConflictDetail` from `types/api.ts`
   - Update `SchedulingConflictResponse` to remove `resource_conflicts` field

#### Backend Removals
1. **resource_service.py**:
   - Remove `check_resource_availability()` method's conflict generation logic
   - Remove creation of `ResourceConflictDetail` dictionaries
   - Simplify availability checking to return boolean + available resources only

2. **API Endpoints**:
   - Remove resource conflict logic from scheduling conflict detection endpoints
   - Update response schemas to remove resource conflict details

### Phase 2: Add Independent Resource Warnings

#### New Data Structures

```typescript
// Selection quantity warning
SelectionInsufficientWarning: {
  type: 'selection_insufficient';
  resource_type_name: string;
  required_quantity: number;
  selected_quantity: number;
}

// Resource conflict warning
ResourceConflictWarning: {
  type: 'resource_conflict';
  resource_name: string;
  resource_type_name: string;
  conflicting_appointment: {
    practitioner_name: string;
    start_time: string;
    end_time: string;
  };
}
```

#### Display Structure
Resource warnings will be displayed hierarchically in ConflictDisplay:

```
• 資源選擇
  • 治療室（需要 2 個，只選了 1 個）
  • 治療室A 已被 張三 使用 (14:00-15:00)
  • 床（需要 3 個，只選了 1 個）
  • 床B 已被 李四 使用 (14:30-15:30)
```

**Key Design Principles:**
- Concise messaging without redundant prefixes
- Group by resource type (quantity warning first, then conflicts)
- Use practitioner names in conflict messages
- Maintain existing bullet point format with sub-bullets

#### Backend Implementation
1. **New Warning Logic**:
   - Calculate selection quantity warnings by comparing selected resources vs requirements
   - Calculate resource conflict warnings by checking time overlaps for selected resources
   - Return both warning types independently

2. **API Response Updates**:
   - Add new fields to `SchedulingConflictResponse`:
     ```typescript
     selection_insufficient_warnings?: SelectionInsufficientWarning[];
     resource_conflict_warnings?: ResourceConflictWarning[];
     ```

#### Frontend Implementation
1. **ConflictDisplay.tsx**:
   - Add hierarchical warning display for resource warnings
   - Parent bullet: "資源選擇"
   - Sub-bullets grouped by resource type with quantity warning first, then conflicts
   - Example display:
     ```
     • 資源選擇
       • 治療室（需要 2 個，只選了 1 個）
       • 治療室A 已被 張三 使用 (14:00-15:00)
       • 床（需要 3 個，只選了 1 個）
       • 床B 已被 李四 使用 (14:30-15:30)
     ```
   - Order: Resource type quantity warning first, then individual resource conflicts
   - Group by resource type for logical organization

2. **ResourceSelection.tsx**:
   - Keep individual resource conflict indicators (⚠️ on specific resources)
   - Remove resource type level badges (already done in Phase 1)

### Phase 3: Testing & Validation

#### Test Cases
1. **Selection Quantity Only**:
   - User selects 1 resource when 2 required
   - Should show quantity warning, no conflict warnings
   - Display: "• 資源選擇\n  • 治療室（需要 2 個，只選了 1 個）"

2. **Resource Conflict Only**:
   - User selects sufficient quantity but some resources conflict
   - Should show conflict warnings, no quantity warnings
   - Display: "• 資源選擇\n  • 治療室A 已被 張三 使用 (14:00-15:00)"

3. **Both Warnings**:
   - User selects insufficient quantity AND some selected resources conflict
   - Should show both warning types grouped by resource type
   - Display: "• 資源選擇\n  • 治療室（需要 2 個，只選了 1 個）\n  • 治療室A 已被 張三 使用 (14:00-15:00)"

4. **Multiple Resource Types**:
   - Issues with multiple resource types
   - Should group by resource type with proper ordering
   - Display: "• 資源選擇\n  • 治療室（需要 2 個，只選了 1 個）\n  • 治療室A 已被 張三 使用 (14:00-15:00)\n  • 床（需要 3 個，只選了 1 個）\n  • 床B 已被 李四 使用 (14:30-15:30)"

5. **No Warnings**:
   - User selects sufficient quantity with no conflicts
   - Should show no resource warnings

#### Validation Criteria
- Warnings are clear and actionable
- Users can understand exactly what to fix
- Independent logic works correctly
- No regression in existing functionality

## Benefits

### User Experience
- **Clearer messaging**: Each warning addresses a specific problem
- **Better actionability**: Users know exactly what to fix
- **Reduced confusion**: No more aggregate numbers that don't help

### Technical Benefits
- **Simpler logic**: Two straightforward checks instead of complex aggregation
- **More precise**: Targets the actual user action needed
- **Flexible**: Can show one, both, or neither warning independently
- **Maintainable**: Clear separation of concerns

## Migration Strategy

1. **Backward Compatibility**: During transition, maintain old API structure alongside new one
2. **Feature Flags**: Consider using feature flags to roll out changes gradually
3. **Documentation**: Update API documentation and frontend component docs
4. **Testing**: Comprehensive testing of all warning combinations

## Timeline

- **Phase 1**: Remove old warnings (1-2 days)
- **Phase 2**: Implement new warnings (2-3 days)  
- **Phase 3**: Testing & validation (1-2 days)

**Total estimated time**: 4-7 days

## Success Metrics

- Reduced user confusion in resource selection
- Fewer support tickets related to resource warnings
- Improved appointment creation success rate
- Positive user feedback on warning clarity
