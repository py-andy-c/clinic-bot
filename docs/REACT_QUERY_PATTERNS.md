# React Query Patterns

This document describes the React Query patterns used in the clinic-bot frontend application.

## Overview

We migrated from a custom `useApiData` hook to React Query (TanStack Query) for better server state management, caching, and synchronization.

## Query Hooks

### Pattern: Custom Query Hooks

Each API endpoint has a corresponding custom hook that wraps React Query's `useQuery`:

```typescript
// hooks/usePatients.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../services/api';
import { useAuth } from './useAuth';

export const patientsKeys = {
  all: ['patients'] as const,
  lists: () => [...patientsKeys.all, 'list'] as const,
  list: (params: { page?: number; pageSize?: number; search?: string; clinicId?: number }) =>
    [...patientsKeys.lists(), params] as const,
  detail: (id: number, clinicId?: number) =>
    [...patientsKeys.all, 'detail', id, clinicId] as const,
};

export function usePatients(params: UsePatientsParams = {}) {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;
  const { page, pageSize, search, enabled = true } = params;

  return useQuery({
    queryKey: patientsKeys.list({
      page,
      pageSize,
      search,
      clinicId: activeClinicId ?? undefined,
    }),
    queryFn: () => apiService.getPatients(page, pageSize, undefined, search),
    enabled: enabled && !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
```

### Key Principles

1. **Query Key Factory**: Use a query key factory pattern for type-safe, hierarchical keys
2. **Clinic ID in Keys**: Include `activeClinicId` in query keys to prevent cross-clinic cache pollution
3. **Stale Time**: Set appropriate stale times (5 minutes for most data, 1 minute for frequently changing data)
4. **Enabled Flag**: Use `enabled` to conditionally fetch based on authentication and other conditions

## Mutation Hooks

### Pattern: Custom Mutation Hooks

Mutations use `useMutation` with automatic cache invalidation:

```typescript
// hooks/usePatients.ts
export function useUpdatePatient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useMutation({
    mutationFn: ({ patientId, data }: { patientId: number; data: PatientUpdateData }) =>
      apiService.updatePatient(patientId, data),
    onSuccess: (updatedPatient, variables) => {
      // Invalidate both detail and list queries
      queryClient.invalidateQueries({ queryKey: patientsKeys.detail(variables.patientId, activeClinicId ?? undefined) });
      queryClient.invalidateQueries({ queryKey: patientsKeys.lists() });
    },
  });
}
```

### Key Principles

1. **Cache Invalidation**: Always invalidate related queries after successful mutations
2. **Optimistic Updates**: Consider optimistic updates for better UX (not implemented yet)
3. **Error Handling**: Handle errors in the component, not in the mutation hook

## Usage in Components

### Basic Query Usage

```typescript
import { usePatients } from '../hooks/usePatients';
import { getErrorMessage } from '../types/api';

function PatientsPage() {
  const { data, isLoading, error } = usePatients({
    page: 1,
    pageSize: 25,
    search: searchQuery,
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message={getErrorMessage(error)} />;

  return <PatientsList patients={data?.patients || []} />;
}
```

### Mutation Usage

```typescript
import { useUpdatePatient } from '../hooks/usePatients';

function PatientForm({ patientId }: { patientId: number }) {
  const updatePatient = useUpdatePatient();

  const handleSubmit = async (data: PatientUpdateData) => {
    try {
      await updatePatient.mutateAsync({ patientId, data });
      alert('Patient updated successfully');
    } catch (error) {
      alert(getErrorMessage(error));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button disabled={updatePatient.isPending}>
        {updatePatient.isPending ? 'Saving...' : 'Save'}
      </button>
    </form>
  );
}
```

## Query Key Management

### Hierarchical Keys

Query keys are hierarchical to enable partial invalidation:

```typescript
patientsKeys.all                    // ['patients']
patientsKeys.lists()                // ['patients', 'list']
patientsKeys.list({ page: 1 })     // ['patients', 'list', { page: 1 }]
patientsKeys.detail(123)            // ['patients', 'detail', 123]
```

### Invalidation Patterns

```typescript
// Invalidate all patient queries
queryClient.invalidateQueries({ queryKey: patientsKeys.all });

// Invalidate only list queries
queryClient.invalidateQueries({ queryKey: patientsKeys.lists() });

// Invalidate specific patient
queryClient.invalidateQueries({ queryKey: patientsKeys.detail(patientId) });
```

## Testing with MSW

We use MSW (Mock Service Worker) for API mocking in tests:

```typescript
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';

beforeEach(() => {
  server.resetHandlers();
});

it('should fetch patients', async () => {
  server.use(
    http.get('/clinic/patients', () => {
      return HttpResponse.json({
        patients: mockPatients,
        total: 1,
        page: 1,
        page_size: 10,
      });
    })
  );

  const { result } = renderHook(() => usePatients({ enabled: true }), {
    wrapper: createWrapper(),
  });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
```

## Migration from useApiData

### Before (useApiData)

```typescript
const fetchPatients = useCallback(() => apiService.getPatients(), []);
const { data, loading, error, refetch } = useApiData(fetchPatients, {
  enabled: isAuthenticated,
  dependencies: [isAuthenticated],
});
```

### After (React Query)

```typescript
const { data, isLoading, error, refetch } = usePatients({
  enabled: isAuthenticated,
});
```

### Key Differences

1. **Loading State**: `loading` → `isLoading`
2. **No fetchFn**: Pass parameters directly to the hook
3. **Automatic Caching**: No need for manual cache management
4. **Better TypeScript**: Full type inference from API service

## Best Practices

1. **Always use query key factories** for type safety and maintainability
2. **Include clinic ID in query keys** when data is clinic-specific
3. **Set appropriate stale times** based on data volatility
4. **Invalidate related queries** after mutations
5. **Use MSW for testing** to avoid flaky tests
6. **Handle errors gracefully** with user-friendly messages
7. **Use `enabled` flag** to prevent unnecessary fetches

## Available Hooks

- `usePatients` - Fetch and manage patients
- `usePatient` - Fetch single patient
- `usePractitioners` - Fetch practitioners
- `useMembers` - Fetch clinic members
- `useClinicSettings` - Fetch clinic settings
- `useLineUsers` - Fetch LINE users
- `useClinics` - Fetch clinics (system admin)
- `useProfile` - Fetch user profile
- `useAppointments` - Fetch appointments
- `useDashboard` - Dashboard metrics and insights
- `useServiceTypeGroups` - Service type groups
- `usePractitionerStatus` - Practitioner status
- `usePatientAppointments` - Patient appointments

Each hook has corresponding mutation hooks for create/update/delete operations.

