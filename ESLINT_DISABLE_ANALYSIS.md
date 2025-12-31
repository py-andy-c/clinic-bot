# ESLint Disable Analysis

This document analyzes all `// eslint-disable-next-line` comments in the codebase to identify which can be removed or addressed.

## Summary

**Total instances: 68**

### By Category:
- `no-console`: 13 instances (19%)
- `react-hooks/exhaustive-deps`: 21 instances (31%)
- `@typescript-eslint/no-unused-vars`: 15 instances (22%)
- `react-refresh/only-export-components`: 5 instances (7%)
- `@typescript-eslint/no-explicit-any`: 9 instances (13%)
- Mixed/Other: 5 instances (7%)

---

## 1. `no-console` (13 instances)

### Files:
- `frontend/src/utils/errorTracking.ts` (11 instances)
- `frontend/src/utils/logger.ts` (4 instances)

### Analysis:
These are in logging utilities where console usage is intentional. All instances are wrapped in `if (import.meta.env.DEV)` checks.

### Recommendation: ✅ **KEEP** (but can be improved)
**Option 1 (Recommended):** Add ESLint rule override for these specific files:
```javascript
// In .eslintrc.cjs, add:
overrides: [
  {
    files: ['src/utils/errorTracking.ts', 'src/utils/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]
```

**Option 2:** Keep the disables but add a comment explaining why (already done in errorTracking.ts).

**Action:** Configure ESLint override to allow console in logging utility files.

---

## 2. `react-hooks/exhaustive-deps` (21 instances)

### Files with instances:
- `SettingsContext.tsx` (1)
- `ResourceSelection.tsx` (1)
- `ProfilePage.tsx` (1)
- `SettingsAppointmentsPage.tsx` (1)
- `SettingsRemindersPage.tsx` (1)
- `CalendarView.tsx` (1)
- `RescheduleFlow.tsx` (2)
- `SettingsChatPage.tsx` (1)
- `SettingsClinicInfoPage.tsx` (1)
- `SettingsReceiptsPage.tsx` (1)
- `useSettingsPage.ts` (1)
- `useCalendarSelection.ts` (1)
- `useApiData.ts` (1)
- `ServiceItemEditModal.tsx` (1)
- `Step3SelectPractitioner.tsx` (1)
- `Step7Success.tsx` (1)
- `DateInput.tsx` (1)
- `AppointmentList.tsx` (2 - uses `eslint-disable-line` instead)

### Analysis by Pattern:

#### Pattern A: Intentionally omitted stable callbacks (5 instances)
**Examples:**
- `DateInput.tsx:133` - `onChange` intentionally omitted (should be stable)
- `useCalendarSelection.ts:152` - `selectedIds` intentionally omitted to avoid loops
- `ServiceItemEditModal.tsx:174` - `reset` intentionally omitted

**Recommendation:** ✅ **KEEP** - These are legitimate cases with good comments explaining why.

#### Pattern B: Settings pages with optional chaining (5 instances)
**Examples:**
- `SettingsAppointmentsPage.tsx:183` - `settings?.clinic_info_settings`
- `SettingsRemindersPage.tsx:87` - `settings?.notification_settings`
- `SettingsChatPage.tsx:79` - `settings?.chat_settings`
- `SettingsClinicInfoPage.tsx:83` - `settings?.clinic_info_settings`
- `SettingsReceiptsPage.tsx:79` - `settings?.receipt_settings`

**Analysis:** These depend on nested optional properties. ESLint wants `settings` in deps, but the code only wants to react to the specific nested property.

**Recommendation:** ⚠️ **REVIEW** - Could potentially use `useMemo` to extract the nested value and depend on that, or add `settings` to deps if safe.

#### Pattern C: useMemo with allAppointments (2 instances)
**File:** `AppointmentList.tsx:141, 153`

**Analysis:** `useMemo` depends only on `allAppointments` but uses `moment` and `TAIWAN_TIMEZONE` which are stable.

**Recommendation:** ✅ **KEEP** - These are correct; `moment` and constants don't need to be in deps.

#### Pattern D: Complex dependency arrays (9 instances)
**Examples:**
- `RescheduleFlow.tsx:233` - Uses `Array.from(assignedPractitionerIds).join(',')` in deps
- `Step3SelectPractitioner.tsx:126` - Similar pattern
- `SettingsContext.tsx:165` - Includes `clearServiceItems` which might be stable
- `ResourceSelection.tsx:586` - Comment explains guard clause prevents re-fetching
- `useApiData.ts:778` - Documented as intentional (dependencies array is passed by caller)

**Recommendation:** ⚠️ **REVIEW** - Some could be improved:
- For Set/Array dependencies: Use `useMemo` to create stable string representation
- For stable callbacks: Wrap in `useCallback` or extract to refs
- For `useApiData`: Already well-documented, likely necessary

#### Pattern E: Profile/Calendar pages (2 instances)
- `ProfilePage.tsx:361` - `[activeClinicId, isLoading]`
- `CalendarView.tsx:1538` - `[preSelectedPatientId]`

**Recommendation:** ⚠️ **REVIEW** - Need to check what's being omitted and if it's safe.

**Action:** Review each instance individually. Many are legitimate, but some could be improved with better dependency management.

---

## 3. `@typescript-eslint/no-unused-vars` (15 instances)

### Files:
- `FollowUpMessagesSection.tsx` (6 instances)
- `ServiceItemEditModal.tsx` (3 instances)
- `resourcesStore.ts` (1)
- `tokenRefresh.ts` (1)
- Test files (4 instances)

### Pattern: Destructuring to omit properties
**Example from `FollowUpMessagesSection.tsx:495`:**
```typescript
const { days_after, time_of_day, ...rest } = prev;
return rest;
```

**Analysis:** These are intentionally omitting properties from objects. The destructured variables are unused by design.

### Recommendation: ✅ **FIXABLE**
**Solution:** Prefix unused variables with `_`:
```typescript
const { days_after: _days_after, time_of_day: _time_of_day, ...rest } = prev;
```

Or use a utility type:
```typescript
type OmitFields<T, K extends keyof T> = Omit<T, K>;
// Then use: OmitFields<typeof prev, 'days_after' | 'time_of_day'>
```

**Action:** Replace destructured unused vars with `_` prefix or use `Omit` utility type.

---

## 4. `react-refresh/only-export-components` (5 instances)

### Files:
- `SettingsContext.tsx:33` - `useSettings` hook
- `TimeRangePresets.tsx:50, 83` - Component exports
- `useAuth.tsx:39` - `useAuth` hook
- `UnsavedChangesContext.tsx:10` - `useUnsavedChanges` hook
- `ModalQueueContext.tsx:60` - `useModalQueue` hook
- `ModalContext.tsx:24` - `useModal` hook

### Analysis:
These are custom hooks exported from files that also export components or are context files. The rule wants only components exported from component files.

### Recommendation: ⚠️ **REVIEW**
**Option 1:** Move hooks to separate files (e.g., `useSettings.ts` instead of exporting from `SettingsContext.tsx`)
**Option 2:** Keep if the hooks are tightly coupled to the context/component and moving them would hurt code organization.

**Action:** Evaluate each case - if hooks can be cleanly separated, move them. Otherwise, keep the disables with comments.

---

## 5. `@typescript-eslint/no-explicit-any` (9 instances)

### Files:
- `useApiData.ts` (2) - Cache and in-flight requests Map types
- Test files (6) - Mocking and test utilities
- `SystemClinicsPage.tsx` (1) - Type assertion for optional property

### Analysis:

#### Production Code (3 instances):
1. **`useApiData.ts:54, 59`** - Generic cache Map types
   ```typescript
   const cache = new Map<string, CacheEntry<any>>();
   const inFlightRequests = new Map<string, Promise<any>>();
   ```
   **Recommendation:** ⚠️ **FIXABLE** - Could use `unknown` or proper generic constraints

2. **`SystemClinicsPage.tsx:145`** - Type assertion for `liff_id`
   ```typescript
   (updateData as any).liff_id = editingClinic.liff_id.trim() === '' ? null : editingClinic.liff_id;
   ```
   **Recommendation:** ⚠️ **FIXABLE** - Could use proper type definition or `Partial<>` with type assertion

#### Test Files (6 instances):
**Recommendation:** ✅ **KEEP** - `any` is often acceptable in tests for mocking. Could use `unknown` with type assertions if desired.

**Action:** Fix production code instances, keep test file instances.

---

## 6. Mixed/Other (5 instances)

### `useApiData.ts:470` - Comment in JSDoc explaining the disable
**Recommendation:** ✅ **KEEP** - Well-documented

### `calendarUtils.test.ts:149` - Multiple rules disabled
**Recommendation:** ⚠️ **REVIEW** - Check if both are necessary

---

## Priority Recommendations

### High Priority (Easy Wins):
1. **Fix `@typescript-eslint/no-unused-vars`** (15 instances) - Prefix with `_` or use `Omit` type
2. **Configure ESLint override for `no-console`** (13 instances) - Add file-specific rule override
3. **Fix `@typescript-eslint/no-explicit-any` in production** (3 instances) - Use `unknown` or proper types

### Medium Priority (Requires Review):
4. **Review `react-hooks/exhaustive-deps`** (21 instances) - Many are legitimate, but some could be improved
5. **Evaluate `react-refresh/only-export-components`** (5 instances) - Consider moving hooks to separate files

### Low Priority (Likely Keep):
6. **Keep test file `any` types** (6 instances) - Acceptable in tests
7. **Keep well-documented `exhaustive-deps`** (5-8 instances) - Already have good comments

---

## Estimated Impact

- **Removable/Addressable:** ~30-35 instances (44-51%)
- **Should Keep (legitimate):** ~25-30 instances (37-44%)
- **Needs Review:** ~8-13 instances (12-19%)

---

## Next Steps

1. Start with high-priority fixes (unused vars, console override, any types)
2. Review medium-priority items case-by-case
3. Document decisions for cases that remain disabled

