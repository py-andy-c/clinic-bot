# Settings Form State Management

## Overview

This document describes the architecture and design decisions for managing settings form state in the clinic bot application. The design separates form state from server state, uses dedicated Zustand stores for complex forms, and provides a reusable pattern for future settings forms.

## Architecture

### Separation of Concerns

**Server State** (managed in `SettingsContext`):
- `ClinicSettings` including `appointment_types`
- Fetched from API, cached via `useApiData` hook
- Shared across multiple settings pages

**Form State** (managed in dedicated Zustand stores):
- User edits and unsaved changes
- Practitioner assignments and billing scenarios
- Independent of server state updates

### Current Implementation

#### Service Items Store (`serviceItemsStore.ts`)

A dedicated Zustand store that manages:
- **Practitioner Assignments**: Maps service item IDs to practitioner IDs
- **Billing Scenarios**: Maps `"serviceItemId-practitionerId"` keys to scenario arrays
- **Loading States**: Tracks loading for assignments and lazy-loaded scenarios
- **Save Logic**: Handles temporary ID mapping when service items are created

**Key Actions**:
- `loadPractitionerAssignments(appointmentTypes)`: Loads assignments from API
- `loadBillingScenarios(serviceItemId, practitionerId)`: Lazy loads scenarios when needed
- `updatePractitionerAssignments(serviceItemId, practitionerIds)`: Updates form state
- `updateBillingScenarios(key, scenarios)`: Updates form state
- `save(appointmentTypeIdMapping)`: Saves changes with temporary ID mapping
- `reset()`: Resets to original data
- `clear()`: Clears all data (called on clinic change)
- `hasUnsavedChanges()`: Checks for unsaved changes

#### Generic Factory Pattern (`createSettingsFormStore.ts`)

A reusable factory function for creating Zustand stores for settings forms:

```typescript
createSettingsFormStore<TFormData, TServerData>(config)
```

**Features**:
- Type-safe with TypeScript generics
- Standard operations: `load()`, `save()`, `updateField()`, `updateFields()`, `reset()`, `hasUnsavedChanges()`
- Handles loading/error states
- Change detection (original vs current)
- Optional hooks: `onBeforeSave`, `onAfterSave`, `validateFormData`

**Note**: The `serviceItemsStore` is currently a standalone implementation due to its complexity (temporary ID mapping, lazy loading). The generic factory is available for future, simpler forms.

## Key Design Decisions

### 1. Explicit Actions Over Reactive Effects

**Decision**: Use explicit actions (`loadBillingScenarios()`, `clear()`) instead of reactive `useEffect` hooks.

**Rationale**:
- Prevents unintended state clearing when unrelated data changes
- Makes state flow predictable and testable
- Avoids cascading updates from `useEffect` dependencies

**Implementation**:
- `ServiceItemsSettings` component calls `loadBillingScenarios()` explicitly when service item expands
- `SettingsContext` calls `serviceItemsStore.clear()` explicitly on clinic change
- No reactive `useEffect` that clears scenarios on `settings` changes

### 2. Independent Store for Service Items

**Decision**: Extract service items state to a dedicated Zustand store, separate from `SettingsContext`.

**Rationale**:
- Prevents state clearing when `settings` object changes
- Isolates complex logic (temporary ID mapping, lazy loading)
- Makes testing easier (isolated state management)
- Follows existing pattern (`appointmentStore` uses Zustand)

**Boundary**:
- **Appointment types** remain in `SettingsContext` (part of `ClinicSettings`)
- **Service items store** manages only `practitionerAssignments` and `billingScenarios`
- Store reads appointment types from context but doesn't react to changes

### 3. Save Coordination

**Decision**: Coordinate saves in the page component (`SettingsServiceItemsPage`).

**Rationale**:
- Appointment types must be saved first to get real IDs
- Service items store needs the ID mapping to update temporary IDs
- Page component has visibility into both contexts

**Implementation**:
```typescript
// In SettingsServiceItemsPage
const handleSave = async () => {
  // 1. Save appointment types first
  await saveSettingsData();
  
  // 2. Get ID mapping and save service items
  const idMapping = getAppointmentTypeIdMapping();
  await serviceItemsStore.getState().save(idMapping);
};
```

### 4. Temporary ID Mapping

**Decision**: Handle temporary ID mapping in the store's `save()` method.

**Rationale**:
- Temporary IDs are generated on the frontend (timestamps)
- Backend returns real IDs after save
- Store needs to update its state with real IDs after save
- Logic is complex and specific to service items

**Implementation**:
- Store accepts `appointmentTypeIdMapping` parameter in `save()`
- Applies mapping to practitioner assignments and billing scenario keys
- Updates state with real IDs after successful save

### 5. Lazy Loading of Billing Scenarios

**Decision**: Load billing scenarios explicitly when service item expands, not reactively.

**Rationale**:
- Scenarios are only needed when user expands a service item
- Prevents unnecessary API calls
- Avoids loading scenarios for temporary (unsaved) service items

**Implementation**:
- `loadBillingScenarios()` checks if already loaded or loading
- Skips loading if service item ID is temporary (timestamp > threshold)
- Handles 404 gracefully (treats as "no scenarios exist yet")

### 6. Generic Factory for Future Forms

**Decision**: Create a generic factory pattern for future settings forms, even though `serviceItemsStore` doesn't use it.

**Rationale**:
- Establishes a reusable pattern for simpler forms
- Provides consistency across future implementations
- Reduces boilerplate for new forms
- `serviceItemsStore` is too complex for the generic pattern (temporary IDs, lazy loading)

**Usage**:
- Future simple forms can use `createSettingsFormStore` with minimal configuration
- Complex forms (like service items) can remain standalone if needed

## File Structure

```
frontend/src/
├── contexts/
│   └── SettingsContext.tsx          # Server state (ClinicSettings)
├── stores/
│   ├── serviceItemsStore.ts         # Service items form state
│   └── createSettingsFormStore.ts   # Generic factory for future forms
├── components/
│   └── ServiceItemsSettings.tsx      # UI component (uses store)
└── pages/
    └── settings/
        └── SettingsServiceItemsPage.tsx  # Coordinates saves
```

## Usage Pattern

### For New Simple Settings Forms

1. Create store using generic factory:
```typescript
const useChatSettingsStore = createSettingsFormStore({
  fetchServerData: () => apiService.getChatSettings(),
  transformServerToForm: (server) => ({ ... }),
  transformFormToServer: (form) => ({ ... }),
  saveFormData: (data) => apiService.updateChatSettings(data),
});
```

2. Use in component:
```typescript
const store = useChatSettingsStore();
// Use store.formData, store.updateField(), store.save(), etc.
```

### For Complex Forms (Like Service Items)

1. Create standalone Zustand store with custom logic
2. Follow the same pattern: explicit actions, clear boundaries, proper reset/clear
3. Coordinate saves in page component if needed

## Benefits

1. **Fixes Bugs**: Prevents scenarios from disappearing or refreshing unexpectedly
2. **Separation of Concerns**: Form state separate from server state
3. **Testability**: Isolated stores are easier to test
4. **Reusability**: Generic factory for future forms
5. **Maintainability**: Clear ownership and explicit state flow
6. **Extensibility**: Easy to add new forms or fields

## Future Considerations

- **React Query**: If adopting React Query for server state management, consider migrating server state to React Query while keeping Zustand for form state
- **More Complex Forms**: If other forms become complex, extract them to dedicated stores following the same pattern
- **Generic Factory Enhancement**: If temporary ID mapping becomes common, consider adding it to the generic factory

