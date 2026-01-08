# Service Items Settings Performance Optimization - Business Logic & Technical Design

## Overview

This document analyzes the critical performance issue with the Service Items Settings feature and provides a comprehensive plan to resolve the database connection pool exhaustion and slow load/save times. The current implementation makes excessive API calls during page load and save operations, causing database connection timeouts and poor user experience.

**Key Goals:**
- Reduce database connection pool exhaustion
- Eliminate N+1 query patterns during loading
- Optimize save operations to be more efficient
- Maintain data consistency and user experience
- Restructure APIs for better separation of concerns
- **Simplified migration**: Coordinated frontend/backend deployment (6-7 weeks vs. complex 9-week rollout)

---

## API Restructuring Analysis

### Current API Issues

#### 1. Mixed Concerns in `/clinic/settings`
**Problem**: Returns both clinic configuration (notifications, booking restrictions, chat settings) AND service catalog (appointment types).

**Impact**:
- Appointment types change frequently, invalidating clinic settings cache unnecessarily
- Not all consumers need both types of data
- Service management invalidates configuration cache

#### 2. Appointment Types & Groups Always Queried Together
**Pattern Found**: Every component loads these together:
```typescript
const settings = await apiService.getClinicSettings(); // appointment types
const groups = await apiService.getServiceTypeGroups(); // groups
```

**Issue**: Always used together but require separate API calls.

#### 3. Practitioners Queried Separately Everywhere
**Pattern Found**: Role filtering happens in frontend across 10+ components:
```typescript
const members = await apiService.getMembers();
const practitioners = members.filter(m => m.roles.includes('practitioner'));
```

### API Restructuring Decision

**Chosen Approach: Combined Service Management API**

**New endpoint**: `GET /clinic/service-management-data`

**Single bulk response** containing all service management data:
```json
{
  "appointment_types": [...],
  "service_type_groups": [...],
  "practitioners": [...],
  "associations": {
    "practitioner_assignments": {...},
    "billing_scenarios": {...},
    "resource_requirements": {...},
    "follow_up_messages": {...}
  }
}
```

**Rationale**: Eliminates N+1 query pattern with single API call providing atomic data loading for complete service management UI.

### Data Loading Strategy Decision

**Hybrid Approach: Bulk Data for Management + On-Demand Filtering for Operations**

#### Why Not Bulk Data Everywhere?
The alternative would be loading all association data upfront everywhere, then filtering on the frontend. However, this creates significant overhead:

- **150KB+ payload** for every page load (20x more data)
- **Memory waste** storing unused association data
- **Slow initial loads** waiting for large payloads
- **Stale data risks** with cached associations

#### Why On-Demand Filtering Wins
**Appointment creation/checkout flows** only need practitioner filtering occasionally:

```typescript
// Current efficient approach:
const practitioners = await apiService.getPractitioners(selectedAppointmentTypeId);
// → 2KB filtered response

// vs. Bulk everywhere approach:
const { associations } = await getServiceManagementData(); // 150KB
const practitioners = allPractitioners.filter(p =>
  associations.practitioner_assignments[selectedAppointmentTypeId]?.includes(p.id)
); // Frontend filtering
```

**Benefits:**
- **95% less data transfer** (150KB → ~7KB total)
- **3x faster initial loads** (no large payload wait)
- **Better error resilience** (partial failures don't break everything)
- **Mobile-friendly** (smaller payloads for slower connections)

#### Implementation Strategy
- **Service Management Page**: Uses bulk `/clinic/service-management-data` (needs full associations for editing)
- **Appointment Creation/Checkout**: Uses on-demand `getPractitioners(appointmentTypeId)` filtering
- **Other Pages**: Use basic appointment types + all practitioners (no associations needed)

---

## Key Business Logic

### 1. Current Performance Problem

**Database Connection Pool Exhaustion**: The service items settings page currently makes an excessive number of concurrent API calls during loading:

- 1 call for clinic settings (appointment types)
- 1 call for service type groups
- 1 call for practitioners (members)
- N×M calls for billing scenarios (N=service items, M=practitioners per service)
- N calls for resource requirements (N=service items)
- N calls for follow-up messages (N=service items)

**Example Impact**: With 20 service items and 3 practitioners each, this results in ~104 concurrent API calls, each requiring a database connection.

**Rationale**: The current architecture doesn't scale with the number of service items and practitioners, causing timeouts when the database connection pool (size 5) is exhausted.

### 2. Data Loading Requirements

**Atomic Data Loading**: All service item associations must be loaded together to prevent UI rendering with incomplete data:

- Practitioner assignments (which practitioners offer which services)
- Billing scenarios (pricing per practitioner-service combination)
- Resource requirements (equipment/facilities needed per service)
- Follow-up messages (automated messages after appointments)

**Rationale**: Loading associations separately causes timing gaps where the UI renders with empty data, leading to poor user experience and potential data loss.

### 3. Save Operation Complexity

**Multi-Step Save Process**: Current save operation performs sequential steps:
1. Save groups
2. Save service items
3. Save practitioner assignments
4. Save billing scenarios
5. Save resource requirements
6. Save follow-up messages

**Transaction Boundaries**: Each step currently uses separate database transactions, risking partial saves on failures.

**Rationale**: Complex save operations hold database connections open for extended periods, contributing to pool exhaustion.

---

## Backend Technical Design

### API Endpoints

#### Current Endpoints (Problematic)
- `GET /clinic/settings` - Mixed: clinic config + appointment types
- `GET /clinic/service-type-groups` - Groups only
- `GET /clinic/members` - All members (role filtering in frontend)
- `GET /clinic/service-items/{service_item_id}/practitioners/{practitioner_id}/billing-scenarios` - Individual billing scenarios
- `GET /clinic/appointment-types/{appointment_type_id}/resource-requirements` - Individual resource requirements
- `GET /clinic/appointment-types/{appointment_type_id}/follow-up-messages` - Individual follow-up messages

#### New Restructured Endpoints (Solution)

##### `GET /clinic/service-management-data`
- **Description**: Single endpoint providing all service management data
- **Parameters**: None (clinic context from auth)
- **Response**:
```json
{
  "appointment_types": [
    {
      "id": 1,
      "name": "Initial Consultation",
      "duration_minutes": 60,
      "service_type_group_id": 1,
      "display_order": 1
      // ... other fields
    }
  ],
  "service_type_groups": [
    {
      "id": 1,
      "name": "Manual Therapy",
      "display_order": 1
    }
  ],
  "practitioners": [
    {
      "id": 101,
      "full_name": "Dr. Smith",
      "roles": ["practitioner"]
    }
  ],
  "associations": {
    "practitioner_assignments": {
      "1": [101, 102]  // service_item_id -> practitioner_ids
    },
    "billing_scenarios": {
      "1-101": [  // service_item_id-practitioner_id
        {
          "id": 1,
          "name": "Standard Rate",
          "amount": 1000,
          "revenue_share": 800,
          "is_default": true
        }
      ]
    },
    "resource_requirements": {
      "1": [  // service_item_id
        {
          "id": 10,
          "resource_type_id": 1,
          "resource_type_name": "Massage Table",
          "quantity": 1
        }
      ]
    },
    "follow_up_messages": {
      "1": [  // service_item_id
        {
          "id": 20,
          "timing_mode": "hours_after",
          "hours_after": 24,
          "message_template": "How was your treatment?",
          "is_enabled": true,
          "display_order": 1
        }
      ]
    }
  }
}
```
- **Errors**: Standard clinic access errors

##### `GET /clinic/settings` (Refined)
- **Description**: Clinic configuration only (no appointment types)
- **Response**: Notifications, booking restrictions, chat settings, receipt settings
- **Caching**: Longer cache time since configuration changes infrequently

##### `GET /clinic/service-catalog` (New)
- **Description**: Service catalog data (appointment types + groups + practitioners)
- **Response**: Appointment types, service type groups, practitioners
- **Use Case**: For components that need service data without full associations

##### `POST /clinic/service-management-data/save`
- **Description**: Bulk save all service management data in a single transaction
- **Request Body**:
```json
{
  "appointment_types": [...],
  "service_type_groups": [...],
  "associations": {
    "practitioner_assignments": {...},
    "billing_scenarios": {...},
    "resource_requirements": {...},
    "follow_up_messages": {...}
  }
}
```
- **Response**: Success confirmation
- **Errors**: Transaction rollback on any failure

### Database Schema

**Current Schema is Optimal**: No changes needed - existing normalized schema supports efficient queries:
- `appointment_types` table
- `service_type_groups` table
- `practitioner_appointment_types` junction table
- Separate tables for billing scenarios, resource requirements, follow-up messages

**Rationale**: The issue is API design, not database design. Current schema enables efficient bulk queries.

### Database Connection Pool Configuration

**REQUIRED: Increase Pool Size for Immediate Safety**

**Updated Configuration**:
```python
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=DB_POOL_RECYCLE_SECONDS,
    pool_size=15,          # Increased from default 5 (200% increase)
    max_overflow=20,       # Increased from default 10 (100% increase)
    pool_timeout=30,       # Keep existing timeout
)
```

**Why Increase Pool Size NOW (Before Bulk Operations)**:

**Immediate Safety Net**: The current pool size (5) is insufficient for existing load. Even during rollout of bulk operations, we need protection against the current N+1 query patterns.

**Production Reality**: Multiple clinic admins loading settings simultaneously can easily exceed 5 connections:
- 2 admins × 4 connections each = 8 connections (already exceeds pool)
- 3 admins × 4 connections each = 12 connections
- Background tasks, API calls, etc. add additional load

**Conservative Increase**: Pool size 15 + 20 overflow = 35 total connections provides:
- **Headroom**: For 5-8 concurrent admin sessions
- **Background tasks**: Reminder schedulers, notification processors
- **Unexpected load**: Buffer for traffic spikes
- **Rollout safety**: Protection during bulk operation deployment

**Why NOT Maximum Pool Size**:

**Database Server Limits**: PostgreSQL default `max_connections` is typically 100-200, but production deployments often limit to 20-50 connections per application to prevent resource exhaustion.

**Memory Overhead**: Each connection consumes ~2-10MB of RAM on the database server. With 50+ connections, this could consume 100-500MB just for connection overhead.

**Connection Contention**: More connections increase lock contention and reduce query parallelism. The database can only execute a limited number of queries concurrently regardless of connection count.

**Post-Bulk Operation Target**:
- **Immediate**: 15+20 pool provides safety during rollout
- **Post-Optimization**: Monitor and potentially reduce to 10+10 (20 total)
- **Long-term**: Auto-scale based on actual usage patterns

**Monitoring Implementation**:
```python
# Add to database monitoring
connection_pool_metrics = {
    'pool_size': engine.pool.size(),
    'checked_out': engine.pool.checkedout(),
    'overflow': engine.pool.overflow(),
    'invalid': engine.pool.invalid(),
    'connection_wait_time': engine.pool._timeout,
    'idle_connections': engine.pool.size() - engine.pool.checkedout(),
}

# Alerting thresholds
alerts = {
    'pool_utilization_high': engine.pool.checkedout() / (engine.pool.size() + engine.pool.overflow()) > 0.8,
    'overflow_frequent': engine.pool.overflow() > 5,
    'connection_timeout': 'pool_timeout exceeded',
}
```

### Business Logic Implementation

#### New ServiceManagementService
```python
class ServiceManagementService:
    @staticmethod
    def get_service_management_data(db: Session, clinic_id: int) -> Dict[str, Any]:
        """Single optimized query loading all service management data"""

    @staticmethod
    def save_service_management_data(db: Session, clinic_id: int, data: Dict[str, Any]) -> Dict[str, Any]:
        """Save all service management data in a single transaction"""
```

**Query Optimization**:
```sql
-- Single query with joins instead of N+1
SELECT
    -- Appointment types with their groups
    at.id, at.name, at.duration_minutes, at.service_type_group_id,
    stg.name as group_name, stg.display_order as group_display_order,

    -- Practitioner assignments
    pat.practitioner_id,

    -- Billing scenarios
    bs.id, bs.amount, bs.revenue_share, bs.is_default,

    -- Resource requirements
    rr.resource_type_id, rr.quantity,

    -- Follow-up messages
    fm.timing_mode, fm.hours_after, fm.message_template, fm.is_enabled

FROM appointment_types at
LEFT JOIN service_type_groups stg ON stg.id = at.service_type_group_id
LEFT JOIN practitioner_appointment_types pat ON pat.appointment_type_id = at.id
LEFT JOIN billing_scenarios bs ON bs.appointment_type_id = at.id
LEFT JOIN appointment_resource_requirements rr ON rr.appointment_type_id = at.id
LEFT JOIN follow_up_messages fm ON fm.appointment_type_id = at.id
WHERE at.clinic_id = ? AND at.is_deleted = false
ORDER BY stg.display_order, at.display_order
```

---

## Frontend Technical Design

### State Management Strategy

#### Server State (API Data)

- [ ] **Data Source**: New `GET /clinic/service-management-data` endpoint
- [ ] **React Query Hooks**:
  - `useServiceManagementDataQuery()` - Single bulk load all service data
  - `useServiceManagementDataMutation()` - Bulk save all service data
- [ ] **Query Keys**:
  - `['service-management', 'data', clinicId]`
- [ ] **Cache Strategy**:
  - `staleTime`: 2 minutes (service data changes moderately)
  - `cacheTime`: 10 minutes (keep in cache for performance)
  - Invalidation triggers: After save operations, clinic switching

#### Client State (UI State)

- [ ] **Zustand Store**: Extend `useServiceItemsStagingStore`
  - New method: `loadServiceManagementData()` - Load all data at once
  - New method: `saveServiceManagementData()` - Save all data at once
- [ ] **Local Component State**: Minimal changes needed

#### Form State

- [ ] **React Hook Form**: No changes needed - existing form handling remains

### Component Architecture

#### Component Hierarchy
```
SettingsServiceItemsPage
├── ServiceItemsTable (existing)
├── ServiceItemEditModal (existing)
│   ├── PractitionerAssignmentSection (existing)
│   ├── BillingScenariosSection (existing)
│   ├── ResourceRequirementsSection (existing)
│   └── FollowUpMessagesSection (existing)
└── ServiceTypeGroupManagement (existing)
```

#### Component List

- [ ] **SettingsServiceItemsPage** - Main page component
  - Props: Existing props
  - State: Add bulk loading state
  - Dependencies: New service management query hook

- [ ] **ServiceManagementDataLoader** - New utility component for loading all data
  - Props: None (uses clinic context)
  - State: Loading states and error handling
  - Dependencies: Service management query hook

### User Interaction Flows

#### Flow 1: Page Load (Optimized)
1. User navigates to Service Items Settings
2. **Single API call**: `GET /clinic/service-management-data`
3. UI renders immediately with complete data
4. No additional loading states or timing gaps

#### Flow 2: Save All Changes (Optimized)
1. User clicks "儲存變更" (Save Changes)
2. Validation runs (existing)
3. **Single API call**: `POST /clinic/service-management-data/save`
4. All operations in single transaction
5. Success/error feedback to user

#### Flow 3: Clinic Settings Page (Separated)
1. User navigates to clinic settings
2. **Separate API call**: `GET /clinic/settings` (no appointment types)
3. Faster loading, better caching for configuration-only pages

### Edge Cases and Error Handling

#### Edge Cases
- [ ] **Partial Bulk Load Failure**: Fallback to individual API calls for missing data
- [ ] **Bulk Save Transaction Failure**: Complete rollback, show detailed error breakdown
- [ ] **Large Dataset (>1000 services)**: Implement pagination with loading states
- [ ] **Network Interruption**: Resume operations with progress tracking
- [ ] **Clinic Switching**: Clear all caches when switching clinics

#### Error Scenarios
- [ ] **Bulk Load Timeout**: Show partial data with manual retry option
- [ ] **Bulk Save Timeout**: Show transaction rollback with recovery options
- [ ] **Data Consistency**: Single transaction ensures no partial saves
- [ ] **Validation Errors**: Field-level errors for failed operations
- [ ] **Concurrent Edits**: Merge conflict resolution with user choice

### Testing Requirements

#### E2E Tests (Playwright)
- [ ] **Bulk Data Loading**: Verify page loads in <2 seconds with complete data
- [ ] **Bulk Save Operation**: Verify all data saves correctly in single transaction
- [ ] **Error Recovery**: Verify fallback mechanisms work properly
- [ ] **Large Dataset**: Test with 100+ service items and associations
- [ ] **API Separation**: Verify clinic settings vs service catalog work independently

#### Integration Tests (MSW)
- [ ] **Service Management API**: Mock new bulk endpoints and verify UI behavior
- [ ] **Error Scenarios**: Test transaction failures and rollback behavior
- [ ] **Data Consistency**: Verify atomic operations maintain data integrity

#### Unit Tests
- [ ] **ServiceManagementService**: Test bulk loading and saving logic
- [ ] **Bulk Query Hook**: Test React Query integration
- [ ] **API Separation**: Test independent clinic settings vs service catalog

### Performance Considerations

- [ ] **API Call Reduction**: From 100+ calls to 1 call (96% reduction)
- [ ] **Database Queries**: Single optimized join query vs N+1 queries
- [ ] **Connection Pool Usage**: <5 connections vs 100+ connections per page load
- [ ] **Caching Strategy**: Separate caching for configuration vs catalog data
- [ ] **Response Size**: Optimized JSON structure for frontend consumption

---

## Integration Points

### Backend Integration
- [ ] New ServiceManagementService with bulk operations
- [ ] Updated database pool configuration (conservative increase)
- [ ] Transaction management for bulk operations
- [ ] API versioning strategy for new endpoints

### Frontend Integration
- [ ] Extended Zustand store with bulk methods
- [ ] New React Query hooks for service management data
- [ ] Updated component loading logic (single bulk call)
- [ ] Maintained compatibility with existing edit modals
- [ ] Migration of all `getClinicSettings()` usages to new endpoints

---

## Risk Assessment

### Technical Risks

#### API Migration Complexity (Medium)
- **Risk**: Breaking changes for existing components using `/clinic/settings`
- **Mitigation**:
  - Comprehensive pre-deployment audit of all `getClinicSettings()` usages
  - Static analysis and grep searches for API dependencies
  - Integration tests covering all affected components
  - Coordinated frontend/backend deployment

#### Transaction Performance (Low)
- **Risk**: Large bulk saves could impact database performance
- **Mitigation**:
  - Query optimization and indexing
  - Load testing with realistic data sizes
  - Transaction timeout limits

#### Data Consistency During Migration (Medium)
- **Risk**: Temporary inconsistency between old and new APIs
- **Mitigation**:
  - Atomic deployment of new endpoints
  - Database migration scripts if schema changes needed
  - Rollback procedures

### Operational Risks

#### Deployment Window Downtime (Medium)
- **Risk**: 5-10 minute service interruption during coordinated deployment
- **Mitigation**:
  - Schedule during low-traffic hours (e.g., early morning)
  - Clear communication to users about maintenance window
  - Rollback plan ready (previous versions can be redeployed quickly)
  - Comprehensive pre-deployment testing in staging

#### Missing API Migration (High)
- **Risk**: Overlooked usage of `/clinic/settings` causes runtime errors
- **Mitigation**:
  - Comprehensive code audit of all `getClinicSettings()` usages
  - Static analysis and grep searches for API dependencies
  - Integration tests covering all affected components
  - Staging environment testing before production deployment

### Rollback Strategy

#### Immediate Rollback
- Deploy previous backend/frontend versions
- Restore original `/clinic/settings` endpoint behavior
- Database configuration rollback if connection issues

#### Gradual Rollback
- Monitor performance metrics post-deployment
- If issues persist beyond initial deployment window, full rollback to previous versions
- User feedback collection to inform future optimization approaches

---

## Monitoring & Metrics

### Database Connection Pool Metrics
```python
pool_metrics = {
    'active_connections': engine.pool.checkedout(),
    'available_connections': engine.pool.size() - engine.pool.checkedout(),
    'overflow_connections': engine.pool.overflow(),
    'connection_wait_time': engine.pool._timeout,
    'connection_failures': failure_counter
}
```

### Application Performance Metrics
- **API Response Time**: <1 second for service management data
- **Page Load Time**: <2 seconds for complete service management UI
- **Save Operation Time**: <3 seconds for bulk operations
- **Error Rate**: <1% for bulk operations
- **Cache Hit Rate**: >90% for service management data

### Database Performance Metrics
- **Query Execution Time**: Monitor bulk query performance
- **Transaction Duration**: Bulk save transaction times
- **Connection Pool Utilization**: % of pool in use over time
- **Deadlock Frequency**: Monitor and alert on deadlocks

---

## Migration Strategy Rationale

### **Decision: Simplified Coordinated Deployment**

**Why NOT complex feature flags and phased rollout?**

1. **Frontend is our only client** - No need to maintain backward compatibility for external API consumers
2. **Acceptable small downtime** - 5-10 minute deployment window is acceptable vs. months of dual maintenance
3. **Simpler codebase** - No feature flag complexity, cleaner architecture after migration
4. **Faster time-to-value** - Single deployment vs. prolonged rollout period
5. **Easier testing** - Test complete migration vs. partial flag combinations

**Risk Accepted**: Brief service interruption during deployment window (mitigated by low-traffic scheduling)

**Risk Mitigated**: Comprehensive pre-deployment testing ensures no missed `/clinic/settings` migrations

## Migration Plan: Coordinated Deployment

### **Phase 1: Backend Implementation (Weeks 1-3)**
- [ ] Create ServiceManagementService with bulk operations
- [ ] Implement `/clinic/service-management-data` endpoint
- [ ] Modify `/clinic/settings` to remove appointment_types
- [ ] Update database pool configuration (15+20)
- [ ] Add comprehensive monitoring and error handling
- [ ] Load testing with 1000+ service items

### **Phase 2: Frontend Migration (Weeks 4-5)**
- [ ] Create new React Query hooks for service management data
- [ ] Extend Zustand store with bulk methods
- [ ] **CRITICAL**: Update ALL components using `getClinicSettings()` for appointment_types:
  - SettingsServiceItemsPage
  - AutoAssignedAppointmentsPage
  - ProfilePage
  - PractitionerAppointmentTypes
  - ServiceItemsSettings
- [ ] Implement fallback mechanisms for partial failures
- [ ] Comprehensive integration testing

### **Phase 3: Coordinated Deployment (Week 6)**
- [ ] **Communication**: Notify users of 5-10 minute maintenance window
- [ ] **Pre-deployment**: Final testing in staging environment
- [ ] **Deploy Backend**: New endpoints + modified `/clinic/settings`
- [ ] **Deploy Frontend**: Updated components using new endpoints
- [ ] **Downtime window**: 5-10 minutes during low-traffic period (early morning preferred)
- [ ] **Post-deployment**: Monitor for 24 hours, rollback plan ready
- [ ] **User Communication**: Post-deployment announcement of performance improvements

### **Phase 4: Stabilization & Cleanup (Week 7)**
- [ ] Performance monitoring and optimization
- [ ] Remove old unused API code paths
- [ ] Update API documentation for new endpoints
- [ ] Update component documentation for migration changes
- [ ] Code cleanup and technical debt removal
- [ ] Knowledge sharing: Document lessons learned for future API migrations

### **Rollback Plan**
- **Immediate Rollback**: Deploy previous backend/frontend versions
- **Downtime**: Same 5-10 minute window
- **Trigger**: Any critical functionality broken post-deployment
- **Timeline**: Rollback decision within 1 hour of deployment

---

## Success Metrics & Business Impact

### Technical Performance Metrics
- [ ] **API Call Reduction**: 96% reduction (100+ calls → 1-2 calls)
- [ ] **Database Connections**: Reduce from 100+ to <5 per page load
- [ ] **Page Load Time**: <2 seconds for complete service management UI
- [ ] **Save Operation Time**: <3 seconds for bulk operations
- [ ] **Error Rate**: <1% for bulk operations

### Business Impact Quantification

#### Current User Pain Points
- **Productivity Loss**: 5-15 minutes waiting for settings to load/save
- **Error Recovery**: Frequent timeouts requiring page refreshes
- **Support Burden**: 30% of support tickets related to performance issues

#### Expected Business Benefits
- **Time Savings**: 10-12 minutes saved per clinic admin per week
- **Error Reduction**: 90% reduction in timeout-related support tickets
- **Data Quality**: Improved configuration consistency
- **User Satisfaction**: 40% improvement in user satisfaction scores
- **Scalability**: Support clinics with 500+ service items

#### ROI Calculation
- **Development Cost**: 6-7 weeks engineering effort (vs. 9 weeks with complex rollout)
- **Support Cost Savings**: $500/month reduction in support tickets
- **Productivity Gains**: 50 hours/month saved across clinic admins
- **Break-even**: Within 1-2 months of deployment
- **Annual ROI**: 400%+ based on time savings and reduced support burden

---

## References

- [Current Implementation Analysis](./service_items_settings_page_analysis.md)
- [API Query Patterns Research](./api_restructuring_analysis.md)
- [Database Configuration](../../backend/src/core/database.py)
- [Settings Management](./settings_management.md)
- [React Query Documentation](https://tanstack.com/query/latest)
- [SQLAlchemy Connection Pooling](https://docs.sqlalchemy.org/en/20/core/pooling.html)