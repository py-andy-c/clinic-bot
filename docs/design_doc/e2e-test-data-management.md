# E2E Test Data Management: Scenario-Based Namespace Isolation

**Status:** Approved
**Related:** `docs/design_doc/e2e-testing-foundation-design.md`

## 1. Executive Summary

To enable high-performance, parallel E2E testing without flakiness, we are adopting a **Scenario-Based Namespace Isolation** strategy. Instead of all tests sharing a single "Test Clinic," every test (or test group) operates within its own unique, isolated "Island" of data created by a server-side Seed API.

## 2. Problem Statement

The previous shared-baseline approach suffered from:
- **Isolation Risks:** Concurrent tests modified the same clinic/user, causing unpredictable failures.
- **Inflexible Baselines:** Tests requiring specific states (multiple clinics, busy calendars) had to be skipped or manually "built" via slow UI interactions.
- **Maintenance Overhead:** Tests spent significant time on "cleanup" (restoring changed values) in `finally` blocks.

## 3. Data Strategy: Shared vs. Acquired

We distinguish between infrastructure that enables the system to run and the data that belongs to the business logic.

### 3.1 Shared Infrastructure (Global)
These elements are persistent and shared across the entire test session.
- **Database Schema:** Latest version as defined by `alembic upgrade head`.
- **Infrastructure Tables:** Only `alembic_version` and system-level logging tables.
- **Everything else is wiped** at the start of a test session.

### 3.2 Acquired Data (Test-Specific)
Every test acquires a fresh, private "Island" of business data. This includes:
- **Clinic:** A unique `clinic_id` generated per test.
- **Users:** Fresh `User` records and `UserClinicAssociations`. **No users are shared between parallel tests.**
- **Clinic-Specific Categories:** `ServiceTypeGroup`, `ResourceType`, `AppointmentType`, and `BillingScenario`.
- **Operational Data:** `Patient`, `Appointment`, `CalendarEvent`, etc.

## 4. Technical Architecture

### 4.1 Backend: The Scenario Registry & Seed API
A new, test-only endpoint `/api/test/seed` (active only when `E2E_TEST_MODE=true`) creates the required data state on the server using internal ORM models for maximum speed.

**Conceptual Scenario Registry:**
```python
# backend/src/api/test/scenarios.py
SCENARIOS = {
    "minimal": seed_minimal_clinic,        # 1 Clinic, 1 Admin
    "standard": seed_standard_clinic,      # 1 Clinic, 1 Admin, 1 Prac, 1 ApptType
    "multi_clinic": seed_multi_clinic,    # 2 Clinics, 1 Shared Admin
    "with_appointment": seed_with_appt,   # 1 Clinic + 1 existing Appointment
}
```

### 4.2 Frontend: Contextual Playwright Fixtures
We use Playwright fixtures to abstract the data acquisition. Tests simply request the "type" of environment they need.

```typescript
// tests/e2e/fixtures/context.ts
export const test = base.extend({
  seededPage: async ({ browser, request }, use) => {
    // 1. Request scenario from Seed API
    const response = await request.post('/api/test/seed', { 
      data: { scenario: 'standard' } 
    });
    const { tokens, clinic_id } = await response.json();

    // 2. Create isolated page with authentication tokens
    const context = await browser.newContext();
    const page = await context.newPage();
    await setupAuth(page, tokens[0]); // Primary admin token
    
    await use(page);
    
    // 3. Cleanup: DB remains for debugging, wiped at next session start
    await page.close();
  }
});
```

## 5. Defined Scenarios & Test Mapping

| Scenario | Data Summary | Targeted Tests |
| :--- | :--- | :--- |
| **`MinimalClinic`** | 1 Clinic, 1 Admin | Smoke tests, Page availability checks. |
| **`StandardClinic`** | 1 Clinic, 1 Admin, 1 Practitioner, 1 ApptType, 1 Patient | Appointment creation, Settings save flows. |
| **`MultiClinicAdmin`** | 2 Clinics, 1 User (Admin of both) | **Clinic Switching** (removing previous skips). |
| **`WithAppointment`** | `StandardClinic` + 1 existing Appointment | **Appointment Editing**, Deletion, Rescheduling. |

## 6. Lifecycle & Concurrency

### 6.1 Session Lifecycle
1. **Global Setup:** Run `alembic upgrade head` -> `TRUNCATE` all business tables (cascade) -> Seed required system-level constants.
2. **Test Run:** Parallel workers request unique Scenarios via `/api/test/seed`. Postgres handles concurrency naturally via unique IDs.
3. **Debugging:** If a test fails, the distinct `clinic_id` and `User` records remain in the DB, allowing developers to manually inspect the state.
4. **Global Teardown:** None required.

### 6.2 Key Benefits
- **Performance:** Creating 100 appointments on the backend takes ~50ms vs. ~10s via UI/API.
- **Consistency:** Since the Seed API uses SQLAlchemy Models, tests fail immediately if a migration makes a field "Required" but the Seed logic is missing it.
- **Simplicity:** Test scripts no longer need "Cleanup" logic in `finally` blocks because the entire Clinic is transient.

## 7. Implementation Roadmap

1. **Phase 1:** Implement `/api/test/seed` endpoint and the `Minimal` and `Standard` scenarios.
2. **Phase 2:** Update Playwright fixtures to support scenario-based injection.
3. **Phase 3:** Refactor existing tests to remove manual API setups and cleanup logic.
4. **Phase 4:** Implement `MultiClinicAdmin` and enable previously skipped clinic switching tests.
