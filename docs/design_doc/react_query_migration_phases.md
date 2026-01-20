# React Query Migration: Remaining Phases

## Executive Summary

This document outlines the remaining phases for migrating the clinic management system from manual cache management to React Query. Phase 1 (Calendar Page Appointment Creation) has been successfully completed and merged.

## Migration Overview

**Completed**:
- Phase 1 - Calendar Page Appointment Creation ✅
- Phase 3 - All Patient Management Pages Appointment Creation ✅

**Remaining**:
- Phase 2 - DateTimePicker Component Migration
- Phase 4 - Manual Cache Removal
- Phase 5 - Conflict Detection Enhancement

## Phase 2: DateTimePicker Component Migration

### Scope
Migrate the `DateTimePicker.tsx` component from manual availability cache to React Query-based availability fetching.

### Current Implementation
- Uses `availabilityCache.ts` and `resourceAvailabilityCache.ts`
- Loads month-view availability data manually
- Complex state management for date ranges and cache invalidation

### Target Implementation
- Use `useBatchAvailabilitySlots` hook for month-view data
- Leverage React Query's automatic cache management
- Simplify state management by removing manual cache logic

### Technical Details
```typescript
// New implementation will use:
const { data: monthAvailability } = useBatchAvailabilitySlots({
  practitionerId,
  appointmentTypeId,
  dates: monthDateRange, // Array of dates for the month
  excludeCalendarEventId
});
```

### Dependencies
- May need to recreate `useBatchAvailabilitySlots` hook (removed in Phase 1)
- Requires `useAvailabilitySlots` hook (completed in Phase 1)

### Risk Assessment
- **High Risk**: Complex component with intricate availability loading logic
- **High Impact**: Affects all appointment booking flows
- **Testing Required**: Comprehensive integration testing for month-view loading

### Success Criteria
- [ ] Month-view availability loads correctly
- [ ] No performance regression in date selection
- [ ] Cache invalidation works across date ranges
- [ ] All existing DateTimePicker functionality preserved

### Estimated Effort
- Development: 3-4 days
- Testing: 1-2 days
- Total: 4-6 days

## Phase 3: Patient Management Pages Migration

### Scope
Migrate the remaining patient management pages from manual cache invalidation to React Query patterns.

### Target Components ✅ COMPLETED
1. **PatientDetailPage.tsx** ✅
   - Appointment creation migrated to optimistic updates
   - Editing operations retain manual cache invalidation

2. **PatientAppointmentsList.tsx** ✅
   - Appointment creation migrated to optimistic updates
   - Editing/deletion operations retain manual cache invalidation

3. **PatientsPage.tsx** ✅
   - Appointment creation migrated to optimistic updates
   - Patient list appointment creation now has instant feedback

4. **AutoAssignedAppointmentsPage.tsx**
   - No direct appointment creation - uses modal components
   - Cache invalidation appropriately handled by modal components

### Migration Strategy
For each page:
1. Replace manual cache invalidation calls with React Query mutations
2. Implement optimistic updates where appropriate
3. Add comprehensive error handling and rollback
4. Update tests to cover new patterns

### Technical Approach
```typescript
// Replace this pattern:
await apiService.createClinicAppointment(formData);
invalidateCacheForDate(practitionerId, appointmentTypeId, date);

// With this pattern:
const createMutation = useCreateAppointmentOptimistic();
await createMutation.mutateAsync({
  practitionerId,
  appointmentTypeId,
  date,
  startTime,
  patientId
});
// Cache automatically managed by React Query
```

### Risk Assessment
- **Medium Risk**: Multiple pages with different usage patterns
- **Medium Impact**: Affects patient management workflows
- **Coordination Required**: Ensure consistent patterns across pages

### Success Criteria
- [ ] All manual cache invalidation calls removed
- [ ] Optimistic updates implemented where beneficial
- [ ] Error handling standardized across pages
- [ ] No functional regressions in patient workflows
- [ ] Performance maintained or improved

### Estimated Effort
- PatientDetailPage: 2 days
- PatientAppointmentsList: 2 days
- AutoAssignedAppointmentsPage: 1 day
- Integration testing: 2 days
- Total: 7 days

## Phase 4: Manual Cache Removal

### Scope
Remove all manual cache utility files and their associated tests after confirming complete migration.

### Files to Remove
- `frontend/src/utils/availabilityCache.ts`
- `frontend/src/utils/resourceAvailabilityCache.ts`
- `frontend/src/utils/__tests__/availabilityCache.test.ts`
- `frontend/src/utils/__tests__/resourceAvailabilityCache.test.ts`

### Prerequisites
- [ ] Phase 2 completed and tested
- [ ] Phase 3 completed and tested
- [ ] All components verified to use React Query
- [ ] Comprehensive regression testing completed

### Risk Assessment
- **High Risk**: Breaking change if any components still reference removed files
- **High Impact**: Affects entire application if incomplete migration detected
- **Verification Required**: 100% confidence in complete migration

### Success Criteria
- [ ] No imports of removed cache files remain
- [ ] All tests pass without removed cache dependencies
- [ ] Application starts and functions normally
- [ ] Performance monitoring shows no regressions

### Estimated Effort
- Verification: 1 day
- Removal: 0.5 days
- Regression testing: 1 day
- Total: 2.5 days

## Phase 5: Conflict Detection Enhancement

### Scope
Migrate appointment conflict detection logic to use React Query patterns for improved performance and user experience.

### Current Implementation
- Manual conflict checking with direct API calls
- No caching of conflict results
- Synchronous blocking checks

### Target Implementation
- React Query-based conflict checking with caching
- Optimistic conflict resolution
- Background conflict validation

### Technical Details
```typescript
// New conflict checking hook
const useAppointmentConflicts = (appointmentData) => {
  return useQuery({
    queryKey: ['appointment-conflicts', appointmentData],
    queryFn: () => apiService.checkBatchPractitionerConflicts(appointmentData),
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  });
};
```

### Benefits
- Cached conflict results reduce API calls
- Better UX with non-blocking conflict checks
- Improved performance for complex scheduling scenarios

### Risk Assessment
- **Low Risk**: Independent feature enhancement
- **Low Impact**: Improves existing functionality
- **Optional**: Can be deferred if timeline constraints

### Success Criteria
- [ ] Conflict detection uses React Query caching
- [ ] No performance regression in conflict checking
- [ ] Improved user experience for complex bookings
- [ ] Comprehensive test coverage for edge cases

### Estimated Effort
- Implementation: 2 days
- Testing: 1 day
- Total: 3 days

## Overall Timeline and Dependencies

### Phase Dependencies
- Phase 2 depends on Phase 1 completion ✅
- Phase 3 depends on Phase 2 completion
- Phase 4 depends on Phase 2 + Phase 3 completion
- Phase 5 can be done independently or after Phase 3

### Total Timeline Estimate
- Phase 2: 4-6 days
- Phase 3: 7 days
- Phase 4: 2.5 days
- Phase 5: 3 days
- **Total: 16.5-18.5 days**

### Parallel Work Opportunities
- Phase 5 can be developed in parallel with Phase 2-3
- Design document updates can happen throughout
- Performance monitoring can start after Phase 1

## Success Metrics

### Performance Improvements Expected
- Reduced API calls through intelligent caching
- Faster UI response times with optimistic updates
- Better cache hit rates for availability data
- Reduced memory usage through React Query optimization

### Quality Improvements Expected
- Consistent error handling patterns
- Comprehensive test coverage
- Better TypeScript type safety
- Improved user experience

## Rollback and Risk Mitigation

### Phase-by-Phase Rollback
- Each phase is independently revertible
- Manual cache files remain available until Phase 4
- Feature flags can be added for high-risk components

### Testing Strategy
- Unit tests for each migrated component
- Integration tests for end-to-end workflows
- Performance regression testing
- User acceptance testing for critical paths

## Monitoring and Maintenance

### Post-Migration Monitoring
- Cache hit rates and performance metrics
- Error rates and user experience feedback
- Memory usage and garbage collection patterns
- API call patterns and optimization opportunities

### Future Enhancements
- Advanced React Query features (prefetching, background updates)
- Cache persistence for offline functionality
- Real-time synchronization improvements
- Advanced conflict resolution algorithms

---

**Document Version**: 1.1
**Last Updated**: January 2026
**Phase 1 Status**: ✅ Completed and Merged
**Phase 3 Status**: ✅ Completed and Merged (Appointment Creation Only)
**Next Phase**: Phase 2 - DateTimePicker Migration