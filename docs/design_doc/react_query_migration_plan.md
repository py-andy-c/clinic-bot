# React Query Migration Plan: Phase 2 Week 3

**Document ID:** `react-query-migration-week3-plan`
**Date:** January 6, 2026
**Status:** Detailed Implementation Plan Ready
**Phase:** Phase 2 Week 3 - React Query Migration Start

## Executive Summary

This document outlines the detailed implementation plan for starting the React Query migration in Phase 2 Week 3. The migration will replace the custom `useApiData` hook (795 lines) with React Query (TanStack Query), eliminating 70%+ of state management bugs through built-in caching, race condition handling, and optimistic updates.

**Migration Scope (Week 3):**
- Install React Query and set up QueryClient provider
- Create query hooks for 3 key API endpoints (`usePractitioners`, `usePatients`, `useMembers`)
- Migrate 3 simple components/pages to React Query
- Keep `useApiData` alongside React Query during transition
- Comprehensive testing of migrated components

---

## 1. Current State Analysis

### 1.1 Existing useApiData Implementation

**Location:** `frontend/src/hooks/useApiData.ts` (795 lines)

**Key Features:**
- Custom in-memory cache with TTL (5 minutes default)
- Race condition handling with locks and deduplication
- Clinic ID auto-injection for clinic-specific endpoints
- Function string parsing for cache key generation
- Manual dependency management
- AbortController cleanup for async operations

**Current Usage Patterns:**
- 27+ files using `useApiData`
- Complex caching logic with 64+ CLINIC_SPECIFIC_METHODS
- Manual cache invalidation with `invalidateCacheByPattern`
- Dependencies passed explicitly to handle refetching

### 1.2 API Service Structure

**Main API Methods (from analysis):**
```typescript
// Clinic-specific endpoints (require clinic ID in cache keys)
getMembers()           // MembersPage
getPractitioners()      // Multiple components
getPatients()          // PatientsPage
getClinicSettings()    // Settings pages
getAutoAssignedAppointments() // AutoAssignedAppointmentsPage
getDashboardMetrics()  // Dashboard pages
```

**API Service Location:** `frontend/src/services/api.ts`

### 1.3 Current Migration Status

**Already Completed (Phase 1):**
- ✅ Created `.cursor/rules/frontend.mdc` with React Query guidelines
- ✅ Updated design docs with frontend sections
- ✅ E2E testing framework (Playwright) ready

**Ready for Phase 2 Week 3:**
- ✅ Frontend Cursor rules enforce React Query usage
- ✅ Design docs specify query keys and cache strategies

---

## 2. Detailed Implementation Plan

### 2.1 Week 3: React Query Migration Start

#### Day 1: Installation and Setup (2-3 hours)

**1. Install React Query:**
```bash
npm install @tanstack/react-query
npm install -D @tanstack/react-query-devtools  # Optional: for development
```

**2. Create QueryClient Configuration:**
```typescript
// frontend/src/lib/queryClient.ts (NEW FILE)
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes (matches useApiData)
      gcTime: 10 * 60 * 1000, // 10 minutes (cache time)
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof AxiosError && error.response?.status >= 400 && error.response?.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false, // Don't retry mutations
    },
  },
});
```

**3. Set up QueryClient Provider in App.tsx:**
```typescript
// frontend/src/App.tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AuthProvider>
            <ModalProvider>
              <ModalQueueProvider>
                <UnsavedChangesProvider>
                  <AppRoutes />
                </UnsavedChangesProvider>
              </ModalQueueProvider>
            </ModalProvider>
          </AuthProvider>
        </I18nextProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
```

#### Day 2-3: Create Query Hooks (4-6 hours)

**1. Create Base Query Hook Pattern:**
```typescript
// frontend/src/hooks/queries/usePractitioners.ts (NEW FILE)
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export interface Practitioner {
  id: number;
  name: string;
  // ... other fields
}

export const usePractitioners = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['practitioners', activeClinicId],
    queryFn: () => apiService.getPractitioners(),
    enabled: !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
```

**2. Create Query Hooks for 3 Key Endpoints:**

**usePractitioners:**
- Query key: `['practitioners', activeClinicId]`
- Used in: Calendar components, appointment forms, settings
- Clinic-specific: ✅ (auto-includes clinic ID)

**usePatients:**
- Query key: `['patients', activeClinicId]`
- Used in: PatientsPage, patient selection modals
- Clinic-specific: ✅

**useMembers:**
- Query key: `['members', activeClinicId]`
- Used in: MembersPage
- Clinic-specific: ✅

**3. Query Hooks Directory Structure:**
```
frontend/src/hooks/queries/
├── usePractitioners.ts
├── usePatients.ts
├── useMembers.ts
└── index.ts (barrel exports)
```

#### Day 4-5: Migrate Simple Components (6-8 hours)

**Migration Strategy:**
1. **Start with simple pages** (not complex forms)
2. **Keep useApiData alongside React Query** during transition
3. **Test each migration thoroughly**
4. **Update one component at a time**

**Component Selection (Simple to Complex):**
1. **MembersPage** - Simple list with refetch
2. **PatientsPage** - Simple list with search/filter
3. **ProfilePage** - Single data fetch (if applicable)

**Migration Example - MembersPage:**

**Before:**
```typescript
// MembersPage.tsx (current)
const fetchMembers = useCallback(() => apiService.getMembers(), []);

const { data: members, loading, error, refetch } = useApiData<Member[]>(
  fetchMembers,
  {
    enabled: !isLoading && isAuthenticated,
    dependencies: [isLoading, isAuthenticated, activeClinicId],
    defaultErrorMessage: '無法載入成員列表',
    initialData: [],
  }
);
```

**After:**
```typescript
// MembersPage.tsx (migrated)
import { useMembers } from '../hooks/queries';

const { data: members, isLoading: loading, error, refetch } = useMembers();

// Error message handling
const errorMessage = error ? '無法載入成員列表' : null;
```

**Migration Steps per Component:**
1. Import new query hook
2. Replace useApiData call with query hook
3. Update loading/error property names
4. Handle error messages (query hooks don't have defaultErrorMessage)
5. Test functionality
6. Remove old useApiData import (keep temporarily for rollback)

#### Day 6-7: Testing and Validation (4-6 hours)

**1. Unit Tests:**
```typescript
// frontend/src/hooks/queries/__tests__/usePractitioners.test.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePractitioners } from '../usePractitioners';
// Mock MSW handlers for API calls
// Test loading states, error states, data fetching
```

**2. Integration Tests:**
- Test component renders with query data
- Test loading states
- Test error states
- Test refetch functionality

**3. E2E Tests:**
- Run existing E2E tests to ensure no regressions
- Test migrated pages work end-to-end

**4. Manual Testing Checklist:**
- [ ] Page loads correctly
- [ ] Loading states work
- [ ] Error states display properly
- [ ] Refetch works (pull-to-refresh, manual refresh)
- [ ] Clinic switching invalidates cache
- [ ] No console errors

---

## 3. Technical Details

### 3.1 Query Key Strategy

**Clinic-Specific Queries:**
```typescript
// Include activeClinicId in query key for automatic invalidation on clinic switch
queryKey: ['practitioners', activeClinicId]
queryKey: ['patients', activeClinicId]
queryKey: ['members', activeClinicId]
```

**Parameterized Queries:**
```typescript
// For queries with parameters
queryKey: ['patient', patientId]  // Non-clinic specific
queryKey: ['appointments', activeClinicId, dateRange]  // Clinic + params
```

### 3.2 Cache Invalidation Strategy

**Clinic Switching:**
```typescript
// Automatically handled by including activeClinicId in query keys
// When user switches clinic, activeClinicId changes → queries refetch
```

**Manual Invalidation:**
```typescript
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate specific queries
queryClient.invalidateQueries({ queryKey: ['practitioners'] });

// Invalidate all queries for current clinic
queryClient.invalidateQueries({ 
  predicate: (query) => query.queryKey.includes(activeClinicId) 
});
```

### 3.3 Error Handling

**Query Error Handling:**
```typescript
const { data, error, isLoading } = usePractitioners();

if (error) {
  // Handle error - React Query doesn't provide defaultErrorMessage
  const errorMessage = getErrorMessage(error) || '無法載入資料';
  return <ErrorMessage message={errorMessage} />;
}
```

**Migration Note:** Unlike `useApiData`, React Query doesn't have `defaultErrorMessage`. Error handling moves to component level.

### 3.4 Loading States

**React Query Loading States:**
```typescript
const { data, isLoading, isFetching, isError } = useQuery({...});

// isLoading: true on first load, false afterwards
// isFetching: true when refetching (background updates)
// isError: true when query failed
```

### 3.5 Optimistic Updates (Future)

**For mutations (Week 4+):**
```typescript
const mutation = useMutation({
  mutationFn: (newMember) => apiService.createMember(newMember),
  onMutate: async (newMember) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ['members'] });
    
    // Snapshot previous value
    const previousMembers = queryClient.getQueryData(['members']);
    
    // Optimistically update
    queryClient.setQueryData(['members'], (old) => [...old, newMember]);
    
    return { previousMembers };
  },
  onError: (err, newMember, context) => {
    // Rollback on error
    queryClient.setQueryData(['members'], context.previousMembers);
  },
  onSettled: () => {
    // Always refetch after mutation
    queryClient.invalidateQueries({ queryKey: ['members'] });
  },
});
```

---

## 4. Risk Mitigation

### 4.1 Rollback Strategy

**Keep useApiData During Transition:**
- Don't remove `useApiData` until all migrations complete
- Each component can rollback individually if issues arise
- Gradual migration allows testing at each step

**Migration Flags (Optional):**
```typescript
// Can add feature flags if needed
const USE_REACT_QUERY = true; // Toggle per component during migration
```

### 4.2 Testing Strategy

**Comprehensive Testing:**
1. **Unit Tests:** Test query hooks in isolation
2. **Integration Tests:** Test components with MSW
3. **E2E Tests:** Test full user flows (existing Playwright tests)
4. **Manual Testing:** Verify edge cases (clinic switching, network errors)

**Test Data Consistency:**
- Ensure same data returned from React Query vs useApiData
- Compare loading states and error handling
- Verify cache behavior matches

### 4.3 Performance Monitoring

**Key Metrics to Monitor:**
- Page load times
- API request frequency
- Cache hit rates
- Error rates

**Performance Comparison:**
- React Query should provide better performance due to deduplication
- Monitor for any regressions in initial load times

---

## 5. Implementation Timeline

### Week 3 Detailed Schedule

**Day 1: Setup (2-3 hours)**
- [ ] Install @tanstack/react-query
- [ ] Create QueryClient configuration
- [ ] Set up QueryClientProvider in App.tsx
- [ ] Test basic setup (app loads without errors)

**Day 2: Query Hooks (3-4 hours)**
- [ ] Create usePractitioners hook
- [ ] Create usePatients hook
- [ ] Create useMembers hook
- [ ] Create barrel exports (index.ts)
- [ ] Unit tests for query hooks

**Day 3: First Migration (3-4 hours)**
- [ ] Migrate MembersPage to useMembers
- [ ] Test MembersPage functionality
- [ ] Verify no regressions
- [ ] Update component documentation

**Day 4: Second Migration (3-4 hours)**
- [ ] Migrate PatientsPage to usePatients
- [ ] Test PatientsPage functionality
- [ ] Verify no regressions
- [ ] Update component documentation

**Day 5: Third Migration (3-4 hours)**
- [ ] Identify and migrate third simple component
- [ ] Test component functionality
- [ ] Verify no regressions
- [ ] Update component documentation

**Day 6-7: Testing & Validation (4-6 hours)**
- [ ] Run full E2E test suite (existing tests)
- [ ] Manual testing of migrated components
- [ ] Performance monitoring
- [ ] Update migration documentation
- [ ] Prepare for Week 4 (continued migration)

### Success Criteria (End of Week 3)

**Functional:**
- ✅ React Query installed and configured
- ✅ 3 query hooks created (practitioners, patients, members)
- ✅ 3 components migrated to React Query
- ✅ All migrated components tested and working
- ✅ No regressions in existing functionality

**Code Quality:**
- ✅ Query hooks follow consistent patterns
- ✅ Proper TypeScript types
- ✅ Error handling implemented
- ✅ Cache invalidation working

**Testing:**
- ✅ Unit tests for query hooks
- ✅ Existing E2E tests still passing
- ✅ Manual testing completed

---

## 6. Code Examples

### 6.1 Query Hook Template

```typescript
// frontend/src/hooks/queries/usePractitioners.ts
import { useQuery } from '@tanstack/react-query';
import { apiService } from '../../services/api';
import { useAuth } from '../useAuth';

export const usePractitioners = () => {
  const { user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  return useQuery({
    queryKey: ['practitioners', activeClinicId],
    queryFn: () => apiService.getPractitioners(),
    enabled: !!activeClinicId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};
```

### 6.2 Component Migration Example

```typescript
// Before: MembersPage.tsx (useApiData)
import { useApiData } from '../hooks/useApiData';

const fetchMembers = useCallback(() => apiService.getMembers(), []);

const { data: members, loading, error, refetch } = useApiData<Member[]>(
  fetchMembers,
  {
    enabled: !isLoading && isAuthenticated,
    dependencies: [isLoading, isAuthenticated, activeClinicId],
    defaultErrorMessage: '無法載入成員列表',
    initialData: [],
  }
);

// After: MembersPage.tsx (React Query)
import { useMembers } from '../hooks/queries';

const { data: members, isLoading: loading, error, refetch } = useMembers();

// Handle error messages (React Query doesn't provide defaultErrorMessage)
const errorMessage = error ? '無法載入成員列表' : null;
```

### 6.3 Cache Invalidation Example

```typescript
// After member creation/update
import { useQueryClient } from '@tanstack/react-query';

const queryClient = useQueryClient();

// Invalidate members query
queryClient.invalidateQueries({ queryKey: ['members', activeClinicId] });

// Or invalidate all clinic-specific queries
queryClient.invalidateQueries({ 
  predicate: (query) => query.queryKey.includes(activeClinicId) 
});
```

---

## 7. Next Steps (Week 4)

### Phase 2 Week 4: React Query Migration Continue

**Planned Tasks:**
- Migrate settings pages to React Query
- Install MSW for integration testing
- Create API mock handlers
- Migrate 5-10 more components
- Test migration with MSW mocks

**Preparation for Week 4:**
- Document lessons learned from Week 3
- Identify next components to migrate (complexity order)
- Set up MSW integration testing
- Plan for mutation hooks (create, update, delete operations)

---

## 8. Documentation Updates

### Files to Update After Migration

**1. Component Documentation:**
- Update MembersPage, PatientsPage, and migrated component docs
- Add React Query usage examples
- Document query keys and cache strategies

**2. Migration Guide:**
- Create `docs/design_doc/react_query_migration_guide.md`
- Document migration patterns
- Include before/after examples

**3. Cursor Rules Update:**
- Update `.cursor/rules/frontend.mdc` with migration progress
- Add specific React Query patterns

---

## 9. Success Metrics

### Week 3 Success Criteria

**Functional Completeness:**
- ✅ 3 query hooks created and tested
- ✅ 3 components successfully migrated
- ✅ No functionality regressions
- ✅ All existing tests passing

**Code Quality:**
- ✅ Consistent query hook patterns
- ✅ Proper error handling
- ✅ TypeScript types maintained
- ✅ Clean, readable code

**Performance:**
- ✅ No performance regressions
- ✅ Cache working correctly
- ✅ Clinic switching invalidates cache properly

**Knowledge Transfer:**
- ✅ Team understands React Query patterns
- ✅ Migration documentation complete
- ✅ Ready for Week 4 continued migration

---

**End of Phase 2 Week 3 React Query Migration Plan**

**Next Actions:**
1. Review and approve this plan
2. Start Day 1 implementation
3. Track progress against timeline
4. Prepare for Week 4 continuation
