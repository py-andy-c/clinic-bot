# E2E Testing Guide & Learnings

## Overview

This document captures our learnings from implementing the appointment creation E2E test, including debugging strategies, infrastructure fixes, and recommendations for future E2E test development.

## 🎯 Critical Reflections & Future Improvements

### Why Schema Mismatches Are Hard to Detect

**Problem**: We spent significant time debugging before discovering the Zod schema mismatch with `liff_urls` field.

**Root Causes**:
- **Silent Validation Failures**: Zod rejections happen silently, returning `undefined` without errors
- **Bottom-Up Debugging**: Focused on UI symptoms ("no appointment types") rather than data flow
- **Missing Observability**: No logging in data loading/validation pipelines
- **Assumption Bias**: Assumed data loading worked, focused on interaction issues

**Example**:
```typescript
// This failed silently:
const clinicSettingsData = useClinicSettings(shouldFetchSettings);
// Zod validation happened here ^ but no error was logged
// Result: clinicSettingsData = undefined → appointmentTypes = []
```

### Preventing Schema Mismatches

**1. Enhanced Zod Error Logging**
```typescript
const ClinicSettingsSchema = z.object({
  liff_urls: z.record(z.string(), z.string()).nullish(),
}).catch((error) => {
  console.error('❌ ClinicSettings validation failed:', {
    errors: error.errors,
    endpoint: 'clinic/settings',
    receivedData: error.receivedData,
    expectedSchema: 'ClinicSettingsSchema'
  });
  throw error;
});
```

**2. Seed Data Validation**
```typescript
// In seed API - validate data matches frontend schemas
function validateSeedDataCompatibility(seedData) {
  // Use frontend Zod schemas to validate seed data
  // Fail fast if incompatible
}
```

**3. Data Flow Health Checks**
```typescript
test('data flow integration', async ({ browser, request }) => {
  // 1. Seed data via API
  // 2. Load through React Query
  // 3. Verify no validation errors
  // 4. Verify UI renders correctly
});
```

### Discovering Issues Sooner

**Runtime Validation Logging**:
```typescript
// In React Query error handlers:
if (error.name === 'ZodError') {
  console.error('🚨 Schema validation failed:', {
    endpoint: queryKey,
    errors: error.errors,
    receivedData: error.receivedData,
    expectedSchema: schemaName
  });
}
```

**API Response Validation**:
```typescript
// Backend middleware:
async function validateApiResponses(request, callNext) {
  const response = await callNext(request);
  if (response.status === 200) {
    // Validate response against expected schema
    // Log warnings for mismatches
  }
  return response;
}
```

### Moving Away from Visual Debugging

**Current Problem**: AI agent (me) relied on human visual inspection to discover label format issues.

**Better Approach**: Programmatic DOM inspection for autonomous debugging.

**Smart Selector Discovery**:
```typescript
async function findActualSelector(page, expectedText) {
  const elements = await page.locator(`text=/${expectedText}/i`).all();

  console.log(`Found ${elements.length} elements containing "${expectedText}"`);
  for (const el of elements) {
    const text = await el.textContent();
    const tag = await el.evaluate(el => el.tagName);
    console.log(`- ${tag}: "${text}"`);
  }
  return elements;
}
```

**Component State Inspection**:
```typescript
const componentState = await page.evaluate(() => ({
  appointmentTypes: window.debugAppointmentTypes, // From console.log
  selectedValue: window.debugSelectedAppointmentType,
  validationErrors: window.debugValidationErrors
}));
```

### Better Test Failure Messages

**Current Problem**: Test failures are vague and require investigation.

**Improved Assertions**:
```typescript
// Instead of:
expect(page.getByText('一般治療')).toBeVisible()
// Error: "locator not found"

// Use:
expect(page).toHaveAppointmentType('一般治療');
// Error: "Appointment type '一般治療' not found. Available: ['一般治療 (60分鐘)', '針灸治療 (45分鐘)']"
```

**Format-Aware Testing**:
```typescript
test('appointment type labels follow expected format', async ({ page }) => {
  const options = await page.locator('select option').allTextContents();
  const expectedFormat = /^(.+) \((\d+)分鐘\)$/;

  for (const option of options) {
    if (option !== '選擇預約類型') {
      expect(option).toMatch(expectedFormat);
    }
  }
});
```

**Change Detection Warnings**:
```typescript
const APPOINTMENT_TYPE_FORMAT = 'NAME (DURATION分鐘)';
console.warn(`⚠️  If this test fails, check if appointment type format changed from: "${APPOINTMENT_TYPE_FORMAT}"`);
```

### Other Potential Schema Mismatches

**Areas to Audit**:
- User profile data structures
- Appointment data fields
- Patient information schemas
- Settings and configuration objects
- Any optional fields that might be `null` vs `undefined`

**Common Patterns to Check**:
- Fields with `.optional()` that receive `null` from backend
- Enum values that don't match frontend expectations
- Date/time format differences
- Missing foreign key relationships in seed data

## 🎯 Project Status

✅ **Appointment Creation E2E Test**: Fully implemented and passing
✅ **Testing Infrastructure**: Fixed and robust
✅ **Data Management**: Clean isolation between test runs

## 📚 Key Learnings

### 1. **Infrastructure Bugs Masquerade as Feature Issues**

**Problem**: Initial test failures were actually caused by testing infrastructure bugs, not the appointment creation feature itself.

**Evidence**:
- 429 accumulated appointment types from missing table truncation
- Frontend rejecting seeded data due to schema validation bug
- "No practitioners available" was actually "practitioners not associated with accumulated appointment types"

**Lesson**: Always verify testing infrastructure health before debugging application logic.

### 2. **Database State Management is Critical**

**Problem**: E2E tests accumulated data across runs, causing unpredictable behavior.

**Root Cause**: Missing global setup for table truncation as specified in design docs.

**Solution Implemented**:
```typescript
// global-setup.ts - Automatic cleanup before each test run
async function globalSetup() {
  // Run migrations
  // TRUNCATE all business tables
  // Clean database state
}
```

### 3. **Schema Validation Affects Test Data**

**Problem**: Frontend Zod schema rejected `null` values for optional fields in seeded data.

**Fix Applied**:
```typescript
// Before: Rejected null values
liff_urls: z.record(z.string(), z.string()).optional()

// After: Accepts null, undefined, or valid object
liff_urls: z.record(z.string(), z.string()).nullish()
```

**Lesson**: Test data must match production schema expectations.

### 4. **Component Understanding is Essential**

**Problem**: Test selectors failed because we misunderstood component behavior.

**Examples**:
- Patient dropdown uses buttons, not `<option>` elements
- Date picker uses clickable day buttons, not input fields
- Time selection uses time slot buttons, not select dropdowns
- Modal has multi-step flow requiring "Next Step" button

**Lesson**: Study component implementations before writing tests.

### 5. **Modal Flows Are Complex State Machines**

**Problem**: Appointment modal has multiple steps (form → conflict check → confirmation).

**Discovery**: Tests must navigate complete user flows, not just fill forms.

```typescript
// Required flow:
await fillForm();          // Step 1: Fill all fields
await clickNextStep();     // Step 2: Navigate to confirmation
await clickSubmit();       // Step 3: Final submission
```

## 🔧 Debugging Strategies

### 1. **Browser Console Logging**

**Technique**: Add console.log to frontend components during debugging.

```typescript
// In React component
console.log('🔍 ComponentName - data:', data);
console.log('🔍 ComponentName - loading:', loading);
console.log('🔍 ComponentName - error:', error);
```

**Playwright Setup**:
```typescript
// Capture browser logs in test
page.on('console', msg => {
  console.log('🌐 BROWSER:', msg.text());
});
```

### 2. **Progressive Test Building**

**Approach**: Build tests incrementally, verifying each step.

```typescript
test('step 1: modal opens', async () => { /* basic test */ });
test('step 2: patient selection', async () => { /* add one field */ });
test('step 3: complete form', async () => { /* full flow */ });
```

### 3. **Fresh Browser Context**

**Problem**: Fixture contamination between tests.

**Solution**: Use fresh browser context for complex tests.

```typescript
test('complex test', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Clean isolation
});
```

### 4. **Visual Debugging**

**Technique**: Take screenshots at failure points.

```typescript
await page.screenshot({ path: 'debug-step.png' });
```

### 5. **API Verification**

**Technique**: Verify backend API responses directly.

```bash
curl "http://localhost:8001/api/clinic/settings" \
  -H "Authorization: Bearer $TOKEN"
```

## 🚀 Recommendations for Future Tests

### 1. **Testing Infrastructure Checklist**

Before writing new E2E tests:

- [ ] Verify global setup truncates tables correctly
- [ ] Confirm seed data matches frontend schemas
- [ ] Test API endpoints return expected data structure
- [ ] Validate authentication flow works

### 2. **Component Documentation**

For each UI component, document:

```typescript
// Component: PatientSelector
// Test IDs: patient-selector, create-patient-button
// Behavior: Search input triggers dropdown with patient buttons
// Selection: Click patient button (not <option>)
// Edge Cases: Loading states, empty results, creation flow
```

### 3. **Test Data Strategy**

- **Fresh Seeds**: Use unique clinic/user IDs per test
- **Minimal Data**: Only seed what's needed for the test
- **Validation**: Ensure seeded data matches production schemas

### 4. **Standardized Test Patterns**

**Basic Test Structure**:
```typescript
test.describe('Feature Name', () => {
  test('should complete happy path', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Setup: Seed data + authentication
    // 2. Navigate: Go to feature page
    // 3. Interact: Complete user flow
    // 4. Verify: Check results

    await context.close();
  });
});
```

### 5. **Error Handling & Debugging**

**Standard Debug Steps**:
1. Add browser console logging to components
2. Take screenshots at failure points
3. Verify API responses directly
4. Check network requests in browser dev tools
5. Isolate failing steps into separate tests

### 6. **Performance & Reliability**

- **Timeouts**: Use appropriate timeouts for async operations
- **Waits**: Prefer explicit waits over sleep delays
- **Selectors**: Use data-testid attributes over CSS selectors
- **Isolation**: Run tests in parallel when possible

## 📋 Future Test Development Workflow

### Phase 1: Preparation (30 minutes)
1. **Review Design Docs**: Understand feature requirements
2. **Component Analysis**: Study UI components and their selectors
3. **API Verification**: Confirm backend endpoints work
4. **Data Planning**: Design minimal seed data needed

### Phase 2: Implementation (1-2 hours)
1. **Basic Test**: Verify page loads and basic interactions
2. **Step-by-Step**: Build complete user flow incrementally
3. **Edge Cases**: Test error states and validation
4. **Debugging**: Use console logging and screenshots as needed

### Phase 3: Validation (30 minutes)
1. **Run Tests**: Verify all scenarios pass (we now have 1 comprehensive test)
2. **Cleanup**: Remove debug logging and redundant tests
3. **Documentation**: Update component test selectors
4. **CI Check**: Ensure tests run in automated environment

### Current Test Status
- ✅ **1 comprehensive test**: `create full appointment @critical @appointment`
- ✅ **Global setup**: Database truncation + clean state for every test run
- ✅ **Complete coverage**: Authentication → UI interaction → backend verification
- ✅ **Infrastructure fixed**: Table truncation, schema validation, fresh contexts

## 🔍 Common Pitfalls to Avoid

### 1. **Assuming Component Behavior**
- ❌ Don't assume dropdowns use `<select>` elements
- ✅ Inspect actual HTML structure

### 2. **Ignoring Modal Complexity**
- ❌ Don't test only form filling
- ✅ Test complete user flows including navigation

### 3. **Poor Test Isolation**
- ❌ Don't rely on shared fixtures for complex tests
- ✅ Use fresh browser contexts when needed

### 4. **Missing Data Validation**
- ❌ Don't assume seed data works
- ✅ Verify API responses match frontend expectations

### 5. **Inadequate Debugging**
- ❌ Don't rely only on Playwright errors
- ✅ Add browser logging and visual debugging

## 🏆 Success Metrics

### Test Quality Indicators
- **Reliability**: Tests pass consistently across runs
- **Speed**: Complete within reasonable time limits (<30s)
- **Isolation**: No interference between test runs
- **Maintainability**: Easy to update when UI changes

### Infrastructure Health
- **Clean State**: Database properly reset between runs
- **Data Consistency**: Seed data matches production schemas
- **API Compatibility**: Frontend and backend expectations aligned

## 📚 Resources

- **Playwright Docs**: https://playwright.dev/docs/
- **Testing Best Practices**: https://playwright.dev/docs/best-practices
- **Component Documentation**: See individual component files for test selectors
- **Design Documents**: `docs/design_doc/e2e-testing-foundation-design.md`

---

## 🚀 Action Plan for Future Prevention

### Immediate (Next Sprint)
1. **Add Zod error logging** to all critical schemas
2. **Create data flow health checks** in E2E setup
3. **Implement programmatic DOM inspection helpers**
4. **Add smart selector discovery functions**

### Short Term (Next Month)
1. **Audit all seed data** for schema compliance
2. **Add API response validation middleware**
3. **Create format-aware test assertions**
4. **Implement development-time schema warnings**

### Long Term (Next Quarter)
1. **Type-safe seed data generation**
2. **Automated schema compatibility testing**
3. **AI-powered test debugging assistants**
4. **Comprehensive data flow monitoring**

### Implementation Checklist
- [ ] Add Zod validation error logging
- [ ] Create `findActualSelector()` helper function
- [ ] Add `analyzeDropdownStructure()` for DOM inspection
- [ ] Implement data flow health check tests
- [ ] Audit all seed data for schema compliance
- [ ] Add format-aware test assertions

---

## 🎯 Key Takeaways

### 1. **Infrastructure Bugs Masquerade as Feature Issues**
E2E testing infrastructure bugs can completely mask actual functionality issues. The appointment creation feature worked perfectly - the testing infrastructure was broken!

### 2. **Schema Mismatches Are Silent Killers**
Zod validation failures happen silently, making debugging extremely difficult. Always add error logging to critical data validation points.

### 3. **Visual Debugging Creates Bottlenecks**
Relying on human visual inspection slows down the AI-agent debugging cycle. Programmatic DOM inspection enables autonomous debugging.

### 4. **Test Data Must Match Production Schemas**
Seed data validation against frontend schemas prevents runtime failures. Test data ≠ Production data can cause silent failures.

### 5. **Data Flow > UI Interaction**
Debug data pipelines first, then UI interactions. Most "UI not working" issues are actually "data not loading" issues.

**Future selves**: Trust but verify your testing setup. When tests fail unexpectedly, check infrastructure first, then application logic. Implement programmatic debugging to eliminate visual inspection bottlenecks.
