# React Query Migration - Phase 2 Week 4: Continue Migration

**Date:** January 6, 2026
**Status:** ✅ COMPLETED - All targets achieved
**Previous Status:** Phase 2 Week 3 Complete (4 query hooks created, 2 components migrated)
**Completion Status:** Phase 2 Week 4 Complete (7 hooks created, 7 components migrated, bonus functionality)

## Executive Summary

This document outlines the detailed implementation plan for continuing the React Query migration in Phase 2 Week 4. The goal is to migrate 5-10 more components from the custom `useApiData` hook to React Query, focusing on settings pages and critical components.

**Current State:**
- ✅ React Query installed and QueryClient configured
- ✅ 4 query hooks created: `usePractitioners`, `usePatients`, `useMembers`, `useAutoAssignedAppointments`
- ✅ 2 components migrated: `MembersPage`, `AutoAssignedAppointmentsPage`
- ✅ MSW installed for integration testing

**Week 4 Targets:**
- Migrate 5-10 additional components/hooks to React Query
- Create comprehensive API mock handlers with MSW
- Focus on settings pages and high-impact components
- Ensure backward compatibility during transition

## 1. Components Identified for Migration

Based on codebase analysis, the following components still use `useApiData` and are prioritized for migration:

### High Priority (Settings & Core Components)
1. **`SettingsAppointmentsPage`** - Uses `useApiData` for members data
2. **`CalendarView`** - Uses `useApiData` for clinic settings
3. **`useAppointmentTypes` hook** - Critical hook used across appointment flows

### Medium Priority (Dashboard Components)
4. **`RevenueDistributionPage`** - Dashboard analytics
5. **`LineUsagePage`** - LINE integration analytics
6. **`BusinessInsightsPage`** - Business intelligence data

### Low Priority (Remaining Components)
7. **`PatientsPage`** - Patient management
8. **`PatientDetailPage`** - Patient details view
9. **`LineUsersPage`** - LINE users management
10. **`AvailabilityPage`** - Practitioner availability
11. **`SystemClinicsPage`** - System administration
12. **`ProfilePage`** - User profile management

## 2. Detailed Migration Plan

### 2.1 Query Hooks to Create

#### 1. `useAppointmentTypes`
**Current Usage:** `frontend/src/hooks/useAppointmentTypes.ts`
```typescript
// Current useApiData usage
const { data, loading, error, refetch } = useApiData(
  fetchAppointmentTypes,
  {
    enabled: !!clinicId,
    dependencies: [patientId],
    defaultErrorMessage: '無法載入服務項目',
  }
);
```

**Migration Plan:**
```typescript
// New: frontend/src/hooks/queries/useAppointmentTypes.ts
import { useQuery } from '@tanstack/react-query';
import { useAppointmentStore } from '../../stores/appointmentStore';
import { liffApiService } from '../../services/liffApi';

export const useAppointmentTypes = (patientId?: number | null) => {
  const { clinicId } = useAppointmentStore();

  return useQuery({
    queryKey: ['appointmentTypes', clinicId, patientId],
    queryFn: async () => {
      if (!clinicId) throw new Error('Clinic ID is required');

      const response = await liffApiService.getAppointmentTypes(clinicId, patientId || undefined);

      const appointmentTypes = response.appointment_types.map(type => ({
        ...type,
        clinic_id: clinicId,
        is_deleted: false,
      }));

      return {
        appointmentTypes,
        appointmentTypeInstructions: response.appointment_type_instructions || null,
      };
    },
    enabled: !!clinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
```

#### 2. `useClinicSettings`
**Current Usage:** `frontend/src/components/CalendarView.tsx`
```typescript
// Current useApiData usage
const { data: clinicSettingsData } = useApiData(
  () => apiService.getClinicSettings(),
  {
    enabled: true,
    dependencies: [],
    cacheTTL: 10 * 60 * 1000,
  }
);
```

**Migration Plan:**
```typescript
// New: frontend/src/hooks/queries/useClinicSettings.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const useClinicSettings = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['clinicSettings', activeClinicId],
    queryFn: () => apiService.getClinicSettings(),
    enabled: !!activeClinicId,
    staleTime: 10 * 60 * 1000, // 10 minutes (longer cache for settings)
  });
};
```

#### 3. `useRevenueDistribution`
**Current Usage:** `frontend/src/pages/dashboard/RevenueDistributionPage.tsx`

**Migration Plan:**
```typescript
// New: frontend/src/hooks/queries/useRevenueDistribution.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const useRevenueDistribution = (dateRange?: { start: string; end: string }) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['revenueDistribution', activeClinicId, dateRange],
    queryFn: () => apiService.getRevenueDistribution(dateRange),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
```

#### 4. `useLineUsage`
**Current Usage:** `frontend/src/pages/dashboard/LineUsagePage.tsx`

**Migration Plan:**
```typescript
// New: frontend/src/hooks/queries/useLineUsage.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const useLineUsage = (dateRange?: { start: string; end: string }) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['lineUsage', activeClinicId, dateRange],
    queryFn: () => apiService.getLineUsage(dateRange),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
```

#### 5. `useBusinessInsights`
**Current Usage:** `frontend/src/pages/dashboard/BusinessInsightsPage.tsx`

**Migration Plan:**
```typescript
// New: frontend/src/hooks/queries/useBusinessInsights.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const useBusinessInsights = (dateRange?: { start: string; end: string }) => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['businessInsights', activeClinicId, dateRange],
    queryFn: () => apiService.getBusinessInsights(dateRange),
    enabled: !!activeClinicId,
    staleTime: 15 * 60 * 1000, // 15 minutes (analytics data)
  });
};
```

### 2.2 Component Migration Steps

#### Migration Pattern
For each component, follow this pattern:

1. **Create the query hook** (as shown above)
2. **Update component imports:**
   ```typescript
   // Remove
   import { useApiData } from '../../hooks/useApiData';

   // Add
   import { useNewQueryHook } from '../../hooks/queries/useNewQueryHook';
   ```

3. **Replace useApiData usage:**
   ```typescript
   // Before
   const { data, loading, error, refetch } = useApiData(fetchFn, options);

   // After
   const { data, isLoading: loading, error, refetch } = useNewQueryHook();
   ```

4. **Update loading/error handling:**
   - Change `loading` to `isLoading` (or keep alias)
   - Ensure error handling remains compatible
   - Update any `defaultErrorMessage` handling

5. **Add to query hooks index:**
   ```typescript
   // frontend/src/hooks/queries/index.ts
   export { useNewQueryHook } from './useNewQueryHook';
   ```

#### Specific Component Migrations

**1. SettingsAppointmentsPage Migration:**
```typescript
// In SettingsAppointmentsPage.tsx
// Replace:
const { data: membersData, loading: membersLoading } = useApiData(
  () => apiService.getMembers(),
  {
    enabled: true,
    dependencies: [user?.active_clinic_id],
    cacheTTL: 5 * 60 * 1000,
  }
);

// With:
const { data: membersData, isLoading: membersLoading } = useMembers();
```

**2. CalendarView Migration:**
```typescript
// In CalendarView.tsx
// Replace:
const { data: clinicSettingsData } = useApiData(
  () => apiService.getClinicSettings(),
  {
    enabled: true,
    dependencies: [],
    cacheTTL: 10 * 60 * 1000,
  }
);

// With:
const { data: clinicSettingsData } = useClinicSettings();
```

**3. useAppointmentTypes Hook Migration:**
Update all components using `useAppointmentTypesQuery` to use the new React Query version:
```typescript
// Replace:
const { data, isLoading, error, refetch } = useAppointmentTypesQuery(patientId);

// With:
const { data, isLoading, error, refetch } = useAppointmentTypes(patientId);
```

## 3. MSW Setup for Integration Testing

### 3.1 Create MSW Handlers
Create comprehensive API mock handlers for testing:

```typescript
// frontend/src/mocks/handlers.ts
import { rest } from 'msw';

export const handlers = [
  // Members API
  rest.get('/api/members', (req, res, ctx) => {
    return res(ctx.json([
      {
        id: 1,
        full_name: 'Dr. Smith',
        email: 'smith@example.com',
        roles: ['practitioner'],
        is_active: true,
        patient_booking_allowed: true,
      },
    ]));
  }),

  // Appointment Types API
  rest.get('/api/appointment-types/:clinicId', (req, res, ctx) => {
    const { clinicId } = req.params;
    return res(ctx.json({
      appointment_types: [
        {
          id: 1,
          name: 'General Treatment',
          duration_minutes: 60,
          allow_patient_booking: true,
        },
      ],
      appointment_type_instructions: 'Please select your service',
    }));
  }),

  // Clinic Settings API
  rest.get('/api/clinic-settings', (req, res, ctx) => {
    return res(ctx.json({
      clinic_name: 'Test Clinic',
      timezone: 'Asia/Taipei',
      // ... other settings
    }));
  }),

  // Analytics APIs
  rest.get('/api/analytics/revenue-distribution', (req, res, ctx) => {
    return res(ctx.json({
      data: [],
      summary: { total: 10000 },
    }));
  }),

  // Add more handlers as needed...
];
```

### 3.2 Setup MSW in Tests
```typescript
// frontend/src/test-utils/msw-setup.ts
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';

export const server = setupServer(...handlers);

// Test setup
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 3.3 Create Integration Tests
```typescript
// Example: frontend/src/pages/settings/__tests__/SettingsAppointmentsPage.integration.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../../test-utils/msw-setup';
import SettingsAppointmentsPage from '../SettingsAppointmentsPage';

// Setup MSW
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('loads members data successfully', async () => {
  const queryClient = new QueryClient();
  
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsAppointmentsPage />
    </QueryClientProvider>
  );

  await waitFor(() => {
    expect(screen.getByText('Dr. Smith')).toBeInTheDocument();
  });
});
```

## 4. Implementation Timeline

### Day 1-2: Core Settings Components
1. Create `useAppointmentTypes` query hook
2. Create `useClinicSettings` query hook
3. Migrate `useAppointmentTypes` hook to React Query
4. Migrate `CalendarView` component
5. Create integration tests with MSW

### Day 3-4: Dashboard Components
6. Create `useRevenueDistribution` query hook
7. Create `useLineUsage` query hook
8. Create `useBusinessInsights` query hook
9. Migrate dashboard pages to React Query
10. Add dashboard integration tests

### Day 5: Consolidation & Testing
11. Update all query hooks index file
12. Comprehensive testing of migrated components
13. Verify no regressions with existing functionality
14. Update documentation

## 5. Testing Strategy

### 5.1 Unit Tests for Query Hooks
```typescript
// frontend/src/hooks/queries/__tests__/useAppointmentTypes.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAppointmentTypes } from '../useAppointmentTypes';

test('fetches appointment types successfully', async () => {
  const queryClient = new QueryClient();
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  const { result } = renderHook(() => useAppointmentTypes(), { wrapper });

  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data?.appointmentTypes).toBeDefined();
  });
});
```

### 5.2 Integration Tests with MSW
- Test complete component integration
- Mock API responses
- Verify loading states and error handling
- Test cache behavior

### 5.3 E2E Tests
- Verify end-to-end functionality still works
- Run existing E2E tests to ensure no regressions
- Add new E2E tests for migrated components

## 6. Risk Mitigation

### 6.1 Backward Compatibility
- Keep `useApiData` alongside React Query during transition
- Gradual migration component by component
- Comprehensive testing before removing `useApiData`

### 6.2 Error Handling
- Ensure error messages remain user-friendly
- Maintain existing error handling patterns
- Add proper error boundaries where needed

### 6.3 Performance Considerations
- Monitor query cache sizes
- Ensure appropriate stale times
- Test with realistic data volumes

### 6.4 Rollback Plan
- Ability to revert individual components to `useApiData`
- Keep `useApiData` implementation intact during migration
- Document rollback procedures

## 7. Success Criteria

### 7.1 Functional Requirements
- [ ] All migrated components load data correctly
- [ ] Loading states work properly
- [ ] Error handling remains functional
- [ ] Cache invalidation works on clinic switching
- [ ] No performance regressions

### 7.2 Testing Requirements
- [ ] Unit tests pass for all new query hooks
- [ ] Integration tests pass with MSW
- [ ] Existing E2E tests still pass
- [ ] No console errors in browser

### 7.3 Code Quality Requirements
- [ ] TypeScript types are correct
- [ ] Query keys follow consistent patterns
- [ ] Error handling is consistent
- [ ] Code follows React Query best practices

## 8. Next Steps (Week 5)

After completing Week 4 migration:
1. **Complete React Query Migration:** Migrate remaining components
2. **Remove useApiData:** After comprehensive testing
3. **Add Integration Tests:** Expand MSW test coverage
4. **Update Documentation:** Reflect new patterns

## 9. Files to Create/Modify

### New Files:
- `frontend/src/hooks/queries/useAppointmentTypes.ts`
- `frontend/src/hooks/queries/useClinicSettings.ts`
- `frontend/src/hooks/queries/useRevenueDistribution.ts`
- `frontend/src/hooks/queries/useLineUsage.ts`
- `frontend/src/hooks/queries/useBusinessInsights.ts`
- `frontend/src/mocks/handlers.ts`
- `frontend/src/test-utils/msw-setup.ts`
- Various test files

### Modified Files:
- `frontend/src/hooks/queries/index.ts` (add exports)
- `frontend/src/hooks/useAppointmentTypes.ts` (migrate to React Query)
- `frontend/src/components/CalendarView.tsx` (migrate to React Query)
- `frontend/src/pages/settings/SettingsAppointmentsPage.tsx` (migrate to React Query)
- Dashboard page components (migrate to React Query)
- All components using `useAppointmentTypesQuery`

---

**Implementation Ready:** This document provides the complete technical specification for Phase 2 Week 4 React Query migration. The plan includes detailed code examples, testing strategies, and risk mitigation approaches.

